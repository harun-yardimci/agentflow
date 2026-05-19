import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function readSource(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('task drawers group information into consistent sections', () => {
  const taskDrawer = readSource('src/components/pipelines/TaskDrawer.tsx');
  const addTaskDrawer = readSource('src/components/pipelines/AddTaskDrawer.tsx');

  for (const expected of ['Task Details', 'Execution', 'Dependencies']) {
    assert.ok(taskDrawer.includes(expected), `TaskDrawer missing section: ${expected}`);
    assert.ok(addTaskDrawer.includes(expected), `AddTaskDrawer missing section: ${expected}`);
  }

  assert.ok(taskDrawer.includes('Input / Output'));
  assert.ok(addTaskDrawer.includes('Input'));
});

test('pipeline shell components use shared design-system primitives', () => {
  const files = [
    'src/components/pipelines/PipelineSidebar.tsx',
    'src/components/pipelines/PipelineView.tsx',
    'src/components/pipelines/TaskDrawer.tsx',
    'src/components/pipelines/AddTaskDrawer.tsx',
    'src/components/pipelines/NewPipelineModal.tsx',
  ];

  for (const file of files) {
    const source = readSource(file);
    assert.ok(source.includes("from '@/components/ui'"), `${file} should import shared ui`);
  }
});

test('compat aliases remain in place for task drawer composition', () => {
  assert.equal(
    readSource('src/components/pipelines/TaskCreatePanel.tsx').trim(),
    "export { AddTaskDrawer as TaskCreatePanel } from './AddTaskDrawer';",
  );
});
