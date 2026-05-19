import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

async function readSource(path) {
  return readFile(join(process.cwd(), path), 'utf8');
}

test('AgentsPage uses responsive directory, stats and shared ui controls', async () => {
  const source = await readSource('src/components/agents/AgentsPage.tsx');

  assert.match(source, /Agent Directory/);
  assert.match(source, /Manage agent roles, status visibility, and default model assignment\./);
  assert.match(source, /grid grid-cols-2 gap-3 lg:grid-cols-4/);
  assert.match(source, /Search agents, ids or prompts/);
  assert.match(source, /<AgentCard/);
  assert.match(source, /<EmptyState/);
  assert.match(source, /if \(!agents\.some\(\(agent\) => agent\.id === selectedId\)\)/);
});

test('ModelsPage composes ModelCard and ActivityLog with provider detection', async () => {
  const source = await readSource('src/components/models/ModelsPage.tsx');

  assert.match(source, /Model Configuration/);
  assert.match(source, /Re-detect Providers/);
  assert.match(source, /grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3/);
  assert.match(source, /<ModelCard/);
  assert.match(source, /<ActivityLog entries=\{activityEntries\} \/>/);
  assert.match(source, /No model usage yet/);
});

test('SettingsPage is tabbed and uses shared form primitives', async () => {
  const source = await readSource('src/components/settings/SettingsPage.tsx');

  assert.match(source, /Runtime configuration, notifications, and MCP integration\./);
  assert.match(source, /<Tabs/);
  assert.match(source, /<TabsTrigger value="runtime">Runtime<\/TabsTrigger>/);
  assert.match(source, /<TabsTrigger value="notifications">Notifications<\/TabsTrigger>/);
  assert.match(source, /<TabsTrigger value="integrations">Integrations<\/TabsTrigger>/);
  assert.match(source, /Save Changes/);
  assert.match(source, /Reset Changes/);
  assert.match(source, /Security Warning/);
});

test('LogPanel adds filtering, readable timestamps and typed badges', async () => {
  const source = await readSource('src/components/pipelines/LogPanel.tsx');

  assert.match(source, /Activity Log/);
  assert.match(source, /Search logs/);
  assert.match(source, /LOG_FILTERS/);
  assert.match(source, /formatLogTime/);
  assert.match(source, /splitHighlightedTokens/);
  assert.match(source, /No logs match the current filter\./);
});
