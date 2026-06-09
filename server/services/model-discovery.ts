/**
 * Model Discovery Service
 *
 * Discovers available models by scanning installed CLI tool binaries/packages.
 * No API keys required — reads model names directly from CLI source files.
 *
 * - Claude:  Scans @anthropic-ai/claude-code package for model IDs
 * - Codex:   Extracts model names from codex binary via `strings`
 * - Gemini:  Scans @google/gemini-cli package for model IDs
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '../db/connection.js';

// ─── Types ───

interface DiscoveredModel {
  id: string;
  provider: string;
  label: string;
  cliFlag: string;
  sortOrder: number;
}

export interface DiscoveryResult {
  provider: string;
  added: string[];
  updated: string[];
  removed: string[];
  error?: string;
}

// ─── Shell helpers ───

function exec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function which(bin: string): string | null {
  const result = exec(`which ${bin}`);
  return result || null;
}

/** Resolve the npm package root for a globally-installed CLI binary */
function resolvePackageDir(binPath: string): string | null {
  // Use realpath to resolve all symlinks to the absolute path
  const realPath = exec(`realpath "${binPath}" 2>/dev/null`);
  if (!realPath) return null;

  // Walk up from the resolved path to find package.json
  const parts = realPath.split('/');
  for (let i = parts.length - 1; i >= 2; i--) {
    const candidate = parts.slice(0, i).join('/');
    const hasPackageJson = exec(`test -f "${candidate}/package.json" && echo yes`);
    if (hasPackageJson === 'yes') return candidate;
  }

  return null;
}

// ─── Claude Discovery ───

// Tiers that also expose their previous version as a `<tier>-legacy` model.
const LEGACY_TIERS = new Set(['opus']);

function discoverClaudeModels(): DiscoveredModel[] {
  const binPath = which('claude');
  if (!binPath) return [];

  // Try the npm-package layout first (legacy installs).
  const pkgDir = resolvePackageDir(binPath);
  let raw = pkgDir
    ? exec(`grep -roh '"claude-[a-z0-9.-]*"' "${pkgDir}/" 2>/dev/null | sort -u`)
    : '';

  // Fall back to scanning the binary directly (native Mach-O / single-file installs).
  if (!raw) {
    const realPath = exec(`realpath "${binPath}" 2>/dev/null`) || binPath;
    raw = exec(`strings "${realPath}" 2>/dev/null | grep -oE 'claude-(opus|sonnet|haiku)-[0-9][0-9a-z.-]*' | sort -u`);
  }
  if (!raw) return [];

  const allIds = raw.split('\n').map((s) => s.replace(/"/g, '').trim()).filter(Boolean);

  // Filter to actual model IDs
  // Valid: claude-opus-4-6, claude-sonnet-4-5, claude-haiku-4
  // Skip dated: claude-opus-4-20250514, claude-sonnet-4-5-20250929
  const modelPattern = /^claude-(opus|sonnet|haiku)-(\d+(?:-\d+)?)$/;
  const datedPattern = /\d{8}$/; // Ends with 8-digit date

  // Group by tier, collect only non-dated versions
  const tiers = new Map<string, string[]>();

  for (const id of allIds) {
    if (datedPattern.test(id)) continue; // Skip dated versions
    const match = id.match(modelPattern);
    if (!match) continue;
    const tier = match[1]!;
    const existing = tiers.get(tier) ?? [];
    existing.push(id);
    tiers.set(tier, existing);
  }

  const sortMap: Record<string, number> = { opus: 0, sonnet: 1, haiku: 2 };
  const results: DiscoveredModel[] = [];

  for (const [tier, versions] of tiers) {
    if (versions.length === 0) continue;

    // Pick the highest version: sort by version segments numerically
    // "claude-opus-4-6" > "claude-opus-4-5" > "claude-opus-4"
    versions.sort((a, b) => {
      const aSegs = a.replace(`claude-${tier}-`, '').split('-').map(Number);
      const bSegs = b.replace(`claude-${tier}-`, '').split('-').map(Number);
      for (let i = 0; i < Math.max(aSegs.length, bSegs.length); i++) {
        const diff = (bSegs[i] ?? -1) - (aSegs[i] ?? -1);
        if (diff !== 0) return diff;
      }
      return 0;
    });

    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
    const baseOrder = sortMap[tier] ?? 10;
    // "4-6" → "4.6"
    const toVersion = (flag: string) => flag.replace(`claude-${tier}-`, '').replace(/-/g, '.');

    results.push({
      id: `claude:${tier}`,
      provider: 'claude',
      label: `Claude ${tierLabel} ${toVersion(versions[0]!)}`,
      cliFlag: versions[0]!,
      sortOrder: baseOrder,
    });

    // Expose the previous version as a "-legacy" tier (opus only for now) so it
    // stays selectable instead of being dropped when a newer version ships.
    if (LEGACY_TIERS.has(tier) && versions.length > 1) {
      results.push({
        id: `claude:${tier}-legacy`,
        provider: 'claude',
        label: `Claude ${tierLabel} ${toVersion(versions[1]!)} (Legacy)`,
        cliFlag: versions[1]!,
        sortOrder: baseOrder + 0.1,
      });
    }
  }

  return results;
}

// ─── Codex Discovery ───

interface CodexCachedModel {
  slug: string;
  display_name?: string;
  supported_in_api?: boolean;
  visibility?: string;
  priority?: number;
}

interface CodexModelsCache {
  models?: CodexCachedModel[];
}

function discoverCodexModels(): DiscoveredModel[] {
  const cachedModels = discoverCodexModelsFromCache();
  if (cachedModels.length > 0) {
    return cachedModels;
  }

  return discoverCodexModelsFromBinary();
}

function discoverCodexModelsFromCache(): DiscoveredModel[] {
  const binPath = which('codex');
  if (!binPath) return [];

  const cachePath = join(homedir(), '.codex', 'models_cache.json');

  try {
    const raw = readFileSync(cachePath, 'utf-8');
    const parsed = JSON.parse(raw) as CodexModelsCache;
    if (!Array.isArray(parsed.models) || parsed.models.length === 0) {
      return [];
    }

    const visibleModels = parsed.models.filter((model) =>
      model.visibility === 'list' && model.supported_in_api !== false);
    const candidates = visibleModels.length > 0
      ? visibleModels
      : parsed.models.filter((model) => model.supported_in_api !== false);

    return candidates.map((model, index) => ({
      id: `codex:${model.slug}`,
      provider: 'codex',
      label: model.display_name || `Codex ${model.slug}`,
      cliFlag: model.slug,
      sortOrder: model.priority ?? index,
    }));
  } catch {
    return [];
  }
}

function discoverCodexModelsFromBinary(): DiscoveredModel[] {
  const binPath = which('codex');
  if (!binPath) return [];

  // Codex is a Rust binary — use `strings` to extract model names
  const realPath = exec(`readlink "${binPath}" 2>/dev/null || echo "${binPath}"`);
  const resolved = realPath.startsWith('/')
    ? realPath
    : exec(`cd "$(dirname "${binPath}")" && cd "$(dirname "${realPath}")" && pwd`) + '/' + realPath.split('/').pop();

  // Find the actual binary (might be in a platform-specific subfolder)
  const binaryPath = exec(
    `find "$(dirname "${resolved}")/.." -name "codex" -type f ! -name "*.js" ! -name "*.ts" 2>/dev/null | head -1`
  );

  const target = binaryPath || resolved;
  const raw = exec(`strings "${target}" 2>/dev/null | grep -oE 'gpt-[0-9][0-9a-z._-]+' | sort -u`);

  if (!raw) return [];

  const allIds = raw.split('\n').map((s) => s.trim()).filter(Boolean);

  // Filter to clean model names (remove noise like concatenated strings)
  const cleanPattern = /^gpt-\d+(\.\d+)?(-codex(-mini|-max)?)?$/;
  const modelIds = allIds.filter((id) => cleanPattern.test(id));

  // Also check user's config for their configured model
  const configModel = exec('grep -oE "model\\s*=\\s*\\"[^\\"]+\\"" ~/.codex/config.toml 2>/dev/null | head -1')
    .replace(/model\s*=\s*"/, '').replace(/"$/, '');

  if (configModel && !modelIds.includes(configModel)) {
    modelIds.push(configModel);
  }

  // Deduplicate and sort by version (higher = newer = better)
  const unique = [...new Set(modelIds)].sort((a, b) => {
    // Extract version numbers for comparison
    const va = a.match(/gpt-(\d+(?:\.\d+)?)/)?.[1] ?? '0';
    const vb = b.match(/gpt-(\d+(?:\.\d+)?)/)?.[1] ?? '0';
    return parseFloat(vb) - parseFloat(va);
  });

  return unique.map((id, index) => ({
    id: `codex:${id}`,
    provider: 'codex',
    label: `Codex ${id}`,
    cliFlag: id,
    sortOrder: index,
  }));
}

// ─── Gemini Discovery ───

function discoverGeminiModels(): DiscoveredModel[] {
  const binPath = which('gemini');
  if (!binPath) return [];

  const pkgDir = resolvePackageDir(binPath);
  if (!pkgDir) return [];

  // Grep for gemini model IDs in the CLI source
  const raw = exec(
    `grep -roh 'gemini-[0-9][0-9a-z._-]*' "${pkgDir}/" 2>/dev/null | sort -u`
  );
  if (!raw) return [];

  const allIds = raw.split('\n').map((s) => s.trim()).filter(Boolean);

  // Filter to clean model names (gemini-X.Y-pro, gemini-X-flash, etc.)
  const modelPattern = /^gemini-(\d+(?:\.\d+)?)-(pro|flash)(-lite)?(-\w+)?$/;
  const modelIds = allIds.filter((id) => modelPattern.test(id));

  // Group by base family (gemini-2.5-pro, gemini-3-flash, etc.)
  const families = new Map<string, string[]>();

  for (const id of modelIds) {
    const match = id.match(/^(gemini-\d+(?:\.\d+)?-(?:pro|flash)(?:-lite)?)/);
    if (!match) continue;
    const base = match[1]!;
    const existing = families.get(base) ?? [];
    existing.push(id);
    families.set(base, existing);
  }

  const sortPriority: Record<string, number> = {
    'gemini-3.1-pro': 0,
    'gemini-3.1-flash-lite': 1,
    'gemini-3-pro': 2,
    'gemini-3-flash': 3,
    'gemini-2.5-pro': 4,
    'gemini-2.5-flash': 5,
    'gemini-2.0-flash': 6,
    'gemini-2.0-pro': 7,
    'gemini-1.5-pro': 8,
    'gemini-1.5-flash': 9,
  };

  const results: DiscoveredModel[] = [];
  let fallbackOrder = 20;

  for (const [base, variants] of families) {
    // Prefer suffixed variants (e.g. -preview) over bare base names, because
    // the bare name often appears in source code but isn't a real API model.
    // Among suffixed variants, prefer the shortest one.
    const suffixed = variants.filter((v) => v !== base);
    const candidates = suffixed.length > 0 ? suffixed : variants;
    const cliFlag = candidates.sort((a, b) => a.length - b.length)[0]!;
    const shortName = base.replace('gemini-', '');
    const order = sortPriority[base] ?? fallbackOrder++;

    results.push({
      id: `gemini:${shortName}`,
      provider: 'gemini',
      label: `Gemini ${shortName}`,
      cliFlag,
      sortOrder: order,
    });
  }

  return results;
}

// ─── Antigravity Discovery ───

// agy's `models` subcommand needs a TTY and its backend-defined model ids are not
// locally enumerable, so discovery is presence-based: if the binary is installed we
// report the known Gemini 3 family; if not, we return nothing so the empty-result
// guard in discoverModels() skips the sync and the seeded defaults are preserved.
function discoverAntigravityModels(): DiscoveredModel[] {
  if (!which('agy')) return [];
  return [
    { id: 'antigravity:gemini-3.1-pro',   provider: 'antigravity', label: 'Gemini 3.1 Pro',   cliFlag: 'gemini-3.1-pro',   sortOrder: 0 },
    { id: 'antigravity:gemini-3.5-flash', provider: 'antigravity', label: 'Gemini 3.5 Flash', cliFlag: 'gemini-3.5-flash', sortOrder: 1 },
  ];
}

async function discoverAntigravityModelsViaApi(_apiKey: string): Promise<DiscoveredModel[]> {
  // agy is CLI-only — no public API/SDK to enumerate models from.
  return [];
}

// ─── Provider registry ───

interface ProviderDiscoveryConfig {
  id: string;
  discover: () => DiscoveredModel[];
  discoverViaApi: (apiKey: string) => Promise<DiscoveredModel[]>;
}

const PROVIDER_CONFIGS: ProviderDiscoveryConfig[] = [
  { id: 'claude', discover: discoverClaudeModels, discoverViaApi: discoverClaudeModelsViaApi },
  { id: 'codex', discover: discoverCodexModels, discoverViaApi: discoverCodexModelsViaApi },
  { id: 'gemini', discover: discoverGeminiModels, discoverViaApi: discoverGeminiModelsViaApi },
  { id: 'antigravity', discover: discoverAntigravityModels, discoverViaApi: discoverAntigravityModelsViaApi },
];

// ─── API-based discovery ───

async function discoverClaudeModelsViaApi(apiKey: string): Promise<DiscoveredModel[]> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const list = await client.models.list({ limit: 100 });
  const items = list.data ?? [];

  const tiers = new Map<string, { id: string; displayName: string }[]>();
  for (const item of items) {
    const m = item.id.match(/^claude-(opus|sonnet|haiku)/);
    if (!m) continue;
    const tier = m[1]!;
    const existing = tiers.get(tier) ?? [];
    existing.push({ id: item.id, displayName: item.display_name ?? item.id });
    tiers.set(tier, existing);
  }

  const sortMap: Record<string, number> = { opus: 0, sonnet: 1, haiku: 2 };
  const results: DiscoveredModel[] = [];

  for (const [tier, models] of tiers) {
    if (models.length === 0) continue;
    models.sort((a, b) => b.id.localeCompare(a.id));
    const baseOrder = sortMap[tier] ?? 10;
    const top = models[0]!;
    results.push({
      id: `claude:${tier}`,
      provider: 'claude',
      label: top.displayName || `Claude ${tier}`,
      cliFlag: top.id,
      sortOrder: baseOrder,
    });

    if (LEGACY_TIERS.has(tier) && models.length > 1) {
      const prev = models[1]!;
      results.push({
        id: `claude:${tier}-legacy`,
        provider: 'claude',
        label: `${prev.displayName || `Claude ${tier}`} (Legacy)`,
        cliFlag: prev.id,
        sortOrder: baseOrder + 0.1,
      });
    }
  }
  return results;
}

async function discoverCodexModelsViaApi(apiKey: string): Promise<DiscoveredModel[]> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey });
  const res = await client.models.list();
  const allIds = res.data.map((m) => m.id);

  const cleanPattern = /^gpt-\d+(\.\d+)?(-codex(-mini|-max)?)?$/;
  const filtered = allIds.filter((id) => cleanPattern.test(id));
  const unique = [...new Set(filtered)].sort((a, b) => {
    const va = a.match(/gpt-(\d+(?:\.\d+)?)/)?.[1] ?? '0';
    const vb = b.match(/gpt-(\d+(?:\.\d+)?)/)?.[1] ?? '0';
    return parseFloat(vb) - parseFloat(va);
  });

  return unique.map((id, index) => ({
    id: `codex:${id}`,
    provider: 'codex',
    label: `Codex ${id}`,
    cliFlag: id,
    sortOrder: index,
  }));
}

interface GeminiApiModel {
  name: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

async function discoverGeminiModelsViaApi(apiKey: string): Promise<DiscoveredModel[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Gemini API responded with ${res.status}`);
  }
  const data = (await res.json()) as { models?: GeminiApiModel[] };
  const models = data.models ?? [];
  const ids = models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));

  const modelPattern = /^gemini-(\d+(?:\.\d+)?)-(pro|flash)(-lite)?(-\w+)?$/;
  const filtered = ids.filter((id) => modelPattern.test(id));

  const families = new Map<string, string[]>();
  for (const id of filtered) {
    const match = id.match(/^(gemini-\d+(?:\.\d+)?-(?:pro|flash)(?:-lite)?)/);
    if (!match) continue;
    const base = match[1]!;
    const existing = families.get(base) ?? [];
    existing.push(id);
    families.set(base, existing);
  }

  const sortPriority: Record<string, number> = {
    'gemini-3.1-pro': 0,
    'gemini-3.1-flash-lite': 1,
    'gemini-3-pro': 2,
    'gemini-3-flash': 3,
    'gemini-2.5-pro': 4,
    'gemini-2.5-flash': 5,
    'gemini-2.0-flash': 6,
    'gemini-2.0-pro': 7,
  };

  const results: DiscoveredModel[] = [];
  let fallbackOrder = 20;
  for (const [base, variants] of families) {
    const cliFlag = variants.sort((a, b) => a.length - b.length)[0]!;
    const shortName = base.replace('gemini-', '');
    const order = sortPriority[base] ?? fallbackOrder++;
    results.push({
      id: `gemini:${shortName}`,
      provider: 'gemini',
      label: `Gemini ${shortName}`,
      cliFlag,
      sortOrder: order,
    });
  }
  return results;
}

// ─── Sync logic ───

function syncModelsToDb(
  provider: string,
  discovered: DiscoveredModel[],
): { added: string[]; updated: string[]; removed: string[] } {
  const db = getDb();
  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  // Get provider color/bg from providers table
  const providerRow = db.prepare('SELECT color, bg FROM providers WHERE id = ?').get(provider) as
    { color: string; bg: string } | undefined;
  const color = providerRow?.color ?? '#888888';
  const bg = providerRow?.bg ?? '#111111';

  // Get existing models for this provider
  const existing = db.prepare('SELECT id, cli_flag, label, sort_order FROM models WHERE provider = ?')
    .all(provider) as { id: string; cli_flag: string | null; label: string; sort_order: number }[];
  const existingMap = new Map(existing.map((m) => [m.id, m]));
  const discoveredIds = new Set(discovered.map((m) => m.id));

  const insertStmt = db.prepare(
    'INSERT INTO models (id, provider, label, color, bg, cost_per_1k, cli_flag, sort_order, enabled) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1)'
  );
  const updateStmt = db.prepare(
    'UPDATE models SET label = ?, cli_flag = ?, sort_order = ? WHERE id = ?'
  );
  const deleteStmt = db.prepare('DELETE FROM models WHERE id = ?');

  const syncTx = db.transaction(() => {
    for (const model of discovered) {
      const ex = existingMap.get(model.id);
      if (!ex) {
        insertStmt.run(model.id, provider, model.label, color, bg, model.cliFlag, model.sortOrder);
        added.push(model.id);
      } else if (ex.cli_flag !== model.cliFlag || ex.label !== model.label || ex.sort_order !== model.sortOrder) {
        updateStmt.run(model.label, model.cliFlag, model.sortOrder, model.id);
        updated.push(model.id);
      }
    }

    // Remove models that no longer exist in CLI
    for (const ex of existing) {
      if (!discoveredIds.has(ex.id)) {
        deleteStmt.run(ex.id);
        removed.push(ex.id);
      }
    }
  });

  syncTx();
  return { added, updated, removed };
}

// ─── Public API ───

export async function discoverModels(providerFilter?: string): Promise<DiscoveryResult[]> {
  const configs = providerFilter
    ? PROVIDER_CONFIGS.filter((c) => c.id === providerFilter)
    : PROVIDER_CONFIGS;

  const db = getDb();
  const results: DiscoveryResult[] = [];

  for (const config of configs) {
    const row = db
      .prepare('SELECT execution_mode, api_key FROM providers WHERE id = ?')
      .get(config.id) as { execution_mode: string; api_key: string | null } | undefined;
    const mode = row?.execution_mode === 'api' ? 'api' : 'cli';
    const apiKey = row?.api_key ?? null;

    try {
      let discovered: DiscoveredModel[];
      if (mode === 'api') {
        if (!apiKey) {
          results.push({
            provider: config.id,
            added: [],
            updated: [],
            removed: [],
            error: 'API mode is selected but no API key is configured',
          });
          continue;
        }
        discovered = await config.discoverViaApi(apiKey);
      } else {
        discovered = config.discover();
      }

      if (discovered.length === 0) {
        results.push({
          provider: config.id,
          added: [],
          updated: [],
          removed: [],
          error: mode === 'api'
            ? 'API returned no matching models'
            : 'CLI not found or no models detected',
        });
        continue;
      }
      const sync = syncModelsToDb(config.id, discovered);
      results.push({ provider: config.id, ...sync });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        provider: config.id,
        added: [],
        updated: [],
        removed: [],
        error: message,
      });
    }
  }

  return results;
}
