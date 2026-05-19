import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('pipeline redesign components', () => {
  it('task and add-task drawers expose required sections', () => {
    const taskDrawer = readSource('src/components/pipelines/TaskDrawer.tsx');
    const addTaskDrawer = readSource('src/components/pipelines/AddTaskDrawer.tsx');

    expect(taskDrawer).toContain('Task Details');
    expect(taskDrawer).toContain('Execution');
    expect(taskDrawer).toContain('Dependencies');
    expect(taskDrawer).toContain('Input');
    expect(taskDrawer).toContain('Output');

    expect(addTaskDrawer).toContain('Task Details');
    expect(addTaskDrawer).toContain('Input');
    expect(addTaskDrawer).toContain('Attachments');
  });

  it('pipeline creation and task creation use shared ui components', () => {
    const newPipelineModal = readSource('src/components/pipelines/NewPipelineModal.tsx');
    const addTaskDrawer = readSource('src/components/pipelines/AddTaskDrawer.tsx');

    expect(newPipelineModal).toContain("from '@/components/ui'");
    expect(newPipelineModal).toContain('Modal');

    expect(addTaskDrawer).toContain("from '@/components/ui'");
    expect(addTaskDrawer).toContain('Drawer');
    expect(addTaskDrawer).toContain('Tabs');
  });

  it('task create panel remains an alias to add-task drawer', () => {
    const alias = readSource('src/components/pipelines/TaskCreatePanel.tsx').trim();
    expect(alias).toBe("export { AddTaskDrawer as TaskCreatePanel } from './AddTaskDrawer';");
  });

  it('keeps follow-up actions visible while running and co-locates stop with them', () => {
    const taskDrawer = readSource('src/components/pipelines/TaskDrawer.tsx');
    const renderPrimaryActions = taskDrawer.match(
      /const renderPrimaryActions = \(\) => \([\s\S]*?\n  \);/,
    )?.[0] ?? '';
    const followUpPanel = taskDrawer.match(
      /const followUpPanel = \([\s\S]*?\n  \);/,
    )?.[0] ?? '';

    expect(taskDrawer).toContain(
      'const canDraftFollowUp = canFollowUp || canRestartFresh || isRunning;',
    );
    expect(taskDrawer).toContain(
      "placeholder={isRunning ? 'Write a follow-up while the task runs...' : 'Send a follow-up message...'}",
    );
    expect(renderPrimaryActions).not.toContain('Stop');
    expect(followUpPanel).toContain('{isRunning && onAbort && (');
    expect(followUpPanel).toContain('disabled={isRunning || !followUp.trim()}');
  });
});
