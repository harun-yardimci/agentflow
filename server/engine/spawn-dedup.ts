/**
 * Spawn Dedup — checks for duplicate/overlapping tasks before spawning.
 *
 * Before creating a new spawned task, compares it against existing active
 * tasks in the pipeline using normalized name matching and input keyword
 * overlap (Jaccard similarity).
 */

import type Database from 'better-sqlite3';
import type { SpawnDirective } from './spawn-parser.js';

interface ActiveTask {
  id: string;
  name: string;
  input: string;
  status: string;
}

interface DedupResult {
  directive: SpawnDirective;
  isDuplicate: boolean;
  matchedTaskId?: string;
  matchedTaskName?: string;
  reason?: string;
}

/** Statuses considered "active" — task is either waiting or in progress */
const ACTIVE_STATUSES = new Set([
  'queued',
  'running',
  'awaiting_approval',
  'pending_requeue',
  'blocked',
]);

/** Minimum Jaccard similarity threshold for input overlap */
const INPUT_SIMILARITY_THRESHOLD = 0.5;

/** Minimum normalized name similarity (Dice coefficient) */
const NAME_SIMILARITY_THRESHOLD = 0.75;

/**
 * Normalize a task name for comparison.
 * Lowercases, strips common prefixes like "Fix:", "Implement:", etc.,
 * and removes non-alphanumeric chars.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(fix|implement|add|create|update|refactor|review|test|debug|resolve|patch|handle)\s*[:\-–—]\s*/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Extract meaningful keywords from text.
 * Strips stop words and returns a set of normalized tokens.
 */
function extractKeywords(text: string): Set<string> {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'must', 'need', 'to', 'of',
    'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
    'that', 'this', 'these', 'those', 'it', 'its', 'and', 'or', 'but', 'not',
    'if', 'then', 'else', 'when', 'where', 'how', 'what', 'which', 'who',
    'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
    'such', 'no', 'nor', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    'just', 'because', 'about', 'up', 'out', 'also', 'make', 'use', 'using',
    'task', 'file', 'code', 'ensure', 'please', 'fix', 'implement', 'add',
    'update', 'change', 'modify',
  ]);

  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !stopWords.has(t));

  return new Set(tokens);
}

/**
 * Jaccard similarity between two sets: |A ∩ B| / |A ∪ B|
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Bigram-based Dice coefficient for name similarity.
 * More tolerant of word order differences than exact matching.
 */
function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) {
    bigramsA.add(a.slice(i, i + 2));
  }

  const bigramsB = new Set<string>();
  for (let i = 0; i < b.length - 1; i++) {
    bigramsB.add(b.slice(i, i + 2));
  }

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

/**
 * Check a single directive against active tasks for duplication.
 */
function checkDirective(
  directive: SpawnDirective,
  activeTasks: ActiveTask[],
): DedupResult {
  const normalizedDirectiveName = normalizeName(directive.name);
  const directiveKeywords = extractKeywords(directive.input);

  for (const task of activeTasks) {
    // 1. Exact normalized name match
    const normalizedTaskName = normalizeName(task.name);
    if (normalizedDirectiveName === normalizedTaskName) {
      return {
        directive,
        isDuplicate: true,
        matchedTaskId: task.id,
        matchedTaskName: task.name,
        reason: `exact name match: "${normalizedTaskName}"`,
      };
    }

    // 2. Fuzzy name match (Dice coefficient)
    const nameSim = diceSimilarity(normalizedDirectiveName, normalizedTaskName);
    if (nameSim >= NAME_SIMILARITY_THRESHOLD) {
      return {
        directive,
        isDuplicate: true,
        matchedTaskId: task.id,
        matchedTaskName: task.name,
        reason: `similar name (${(nameSim * 100).toFixed(0)}% Dice): "${normalizedTaskName}"`,
      };
    }

    // 3. Input keyword overlap (Jaccard)
    const taskKeywords = extractKeywords(task.input);
    const inputSim = jaccardSimilarity(directiveKeywords, taskKeywords);
    if (inputSim >= INPUT_SIMILARITY_THRESHOLD) {
      return {
        directive,
        isDuplicate: true,
        matchedTaskId: task.id,
        matchedTaskName: task.name,
        reason: `similar input (${(inputSim * 100).toFixed(0)}% Jaccard overlap)`,
      };
    }
  }

  return { directive, isDuplicate: false };
}

/**
 * Filter spawn directives, removing duplicates that overlap with active tasks.
 *
 * @param directives - Spawn directives to check
 * @param activeTasks - Currently active (non-terminal) tasks in the pipeline
 * @returns Object with filtered directives and dedup log entries
 */
export function deduplicateSpawnDirectives(
  directives: SpawnDirective[],
  activeTasks: ActiveTask[],
): { kept: SpawnDirective[]; skipped: DedupResult[] } {
  const kept: SpawnDirective[] = [];
  const skipped: DedupResult[] = [];

  // Also check against directives we've already kept (prevent intra-batch dupes)
  const keptAsActive: ActiveTask[] = [];

  for (const directive of directives) {
    const allActive = [...activeTasks, ...keptAsActive];
    const result = checkDirective(directive, allActive);

    if (result.isDuplicate) {
      skipped.push(result);
    } else {
      kept.push(directive);
      keptAsActive.push({
        id: `pending_${kept.length}`,
        name: directive.name,
        input: directive.input,
        status: 'queued',
      });
    }
  }

  return { kept, skipped };
}

/**
 * Get active tasks for a pipeline from the database.
 */
export function getActiveTasks(
  db: Pick<Database.Database, 'prepare'>,
  pipelineId: string,
): ActiveTask[] {
  const statuses = Array.from(ACTIVE_STATUSES);
  const placeholders = statuses.map(() => '?').join(', ');

  return db.prepare(
    `SELECT id, name, input, status FROM tasks
     WHERE pipeline_id = ? AND status IN (${placeholders})`
  ).all(pipelineId, ...statuses) as ActiveTask[];
}
