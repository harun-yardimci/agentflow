import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Agent, KanbanColumn as KanbanColumnType, Task } from '@/types';
import { KanbanColumn } from './KanbanColumn';

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
];

const baseTask: Task = {
  id: 'task-1',
  name: 'First Task',
  agentId: 'research',
  model: 'gemini',
  approval: 'auto',
  status: 'queued',
  stage: 0,
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

const todoColumn: KanbanColumnType = {
  id: 'todo',
  label: 'Todo',
  color: '#4B5563',
};

const runningColumn: KanbanColumnType = {
  id: 'running',
  label: 'Running',
  color: '#2563EB',
};

const callbacks = {
  onTaskSelect: vi.fn(),
  onTaskMove: vi.fn(),
  onApprove: vi.fn(),
  onReject: vi.fn(),
  onAbort: vi.fn(),
  onRetry: vi.fn(),
  onArchive: vi.fn(),
};

describe('KanbanColumn', () => {
  it('renders stage headers and stage count in todo column', () => {
    const tasks: Task[] = [
      baseTask,
      { ...baseTask, id: 'task-2', name: 'Second', stage: 0 },
      { ...baseTask, id: 'task-3', name: 'Third', stage: 1 },
    ];

    const html = renderToStaticMarkup(
      <KanbanColumn
        column={todoColumn}
        tasks={tasks}
        allTasks={tasks}
        agents={agents}
        selectedTaskId={null}
        onTaskSelect={callbacks.onTaskSelect}
        onTaskMove={callbacks.onTaskMove}
        onApprove={callbacks.onApprove}
        onReject={callbacks.onReject}
        onAbort={callbacks.onAbort}
        onRetry={callbacks.onRetry}
        onArchive={callbacks.onArchive}
      />,
    );

    expect(html).toContain('Todo');
    expect(html).toContain('2 stages');
    expect(html).toContain('parallel');
    expect(html).toContain('First Task');
    expect(html).toContain('Second');
    expect(html).toContain('Third');
  });

  it('renders compact empty state for empty columns', () => {
    const html = renderToStaticMarkup(
      <KanbanColumn
        column={runningColumn}
        tasks={[]}
        allTasks={[]}
        agents={agents}
        selectedTaskId={null}
        onTaskSelect={callbacks.onTaskSelect}
        onTaskMove={callbacks.onTaskMove}
        onApprove={callbacks.onApprove}
        onReject={callbacks.onReject}
        onAbort={callbacks.onAbort}
        onRetry={callbacks.onRetry}
        onArchive={callbacks.onArchive}
      />,
    );

    expect(html).toContain('drop task');
    expect(html).toContain('Running');
  });
});
