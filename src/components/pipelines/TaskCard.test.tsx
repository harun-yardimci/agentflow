import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Agent, Task } from '@/types';
import { TaskCard } from './TaskCard';

const agents: Agent[] = [
  {
    id: 'research',
    name: 'Research Agent',
    icon: 'R',
    title: 'Research Analyst',
    avatarSeed: 'Scout',
    defaultModel: 'gemini',
    prompt: 'research',
  },
  {
    id: 'designer',
    name: 'Designer Agent',
    icon: 'D',
    title: 'UI/UX Designer',
    avatarSeed: 'Pixel',
    defaultModel: 'claude',
    prompt: 'design',
  },
];

const baseTask: Task = {
  id: 'task-main',
  name: 'UI Audit',
  agentId: 'research',
  model: 'codex',
  approval: 'manual',
  status: 'running',
  stage: 1,
  dependsOn: [],
  input: 'input',
  output: null,
  tokens: null,
  duration: null,
  priority: null,
  timeoutMs: 0,
  tags: [],
  taskType: 'planned',
  sourceTaskId: null,
  stageId: null,
  createdAt: null, worktreePath: null, worktreeStatus: null,
};

const callbacks = {
  onSelect: vi.fn(),
  onDragStart: vi.fn(),
  onApprove: vi.fn(),
  onReject: vi.fn(),
  onAbort: vi.fn(),
  onRetry: vi.fn(),
};

function renderCard(task: Task, allTasks: Task[], isSelected = false): string {
  return renderToStaticMarkup(
    <TaskCard
      task={task}
      agents={agents}
      allTasks={allTasks}
      isSelected={isSelected}
      onSelect={callbacks.onSelect}
      onDragStart={callbacks.onDragStart}
      onApprove={callbacks.onApprove}
      onReject={callbacks.onReject}
      onAbort={callbacks.onAbort}
      onRetry={callbacks.onRetry}
    />,
  );
}

describe('TaskCard', () => {
  it('renders compact summary fields', () => {
    const html = renderCard(baseTask, [baseTask]);

    expect(html).toContain('UI Audit');
    expect(html).toContain('running');
    expect(html).toContain('Research Agent');
    expect(html).toContain('Codex');
    expect(html).toContain('created n/a');
    expect(html).toContain('duration pending');
  });

  it('shows dependency details for selected cards', () => {
    const dependency: Task = {
      ...baseTask,
      id: 'task-dependency',
      name: 'Design Spec',
      status: 'completed',
    };
    const taskWithDeps: Task = {
      ...baseTask,
      dependsOn: ['task-dependency'],
      output: 'ready',
      tokens: 1200,
    };

    const html = renderCard(taskWithDeps, [taskWithDeps, dependency], true);

    expect(html).toContain('Dependencies');
    expect(html).toContain('Design Spec');
    expect(html).toContain('deps 1');
  });

  it('renders approve and reject actions for pending approval tasks', () => {
    const pendingTask: Task = {
      ...baseTask,
      status: 'awaiting_approval',
    };

    const html = renderCard(pendingTask, [pendingTask]);

    expect(html).toContain('Approve');
    expect(html).toContain('Reject');
  });
});
