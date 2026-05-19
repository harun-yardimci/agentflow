import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Pipeline } from '@/types';
import { PipelineSidebar } from './PipelineSidebar';

const pipelines: Pipeline[] = [
  {
    id: 'p1',
    name: 'Landing Page',
    status: 'running',
    created: '2h ago',
    description: '',
    rules: '',
    enabledAgents: [],
    workingDir: '',
    stages: [],
    logs: [],
    tasks: [
      {
        id: 't1',
        name: 'Research',
        agentId: 'research',
        model: 'gemini',
        approval: 'auto',
        status: 'completed',
        stage: 0,
        dependsOn: [],
        input: 'brief',
        output: 'ok',
        tokens: 100,
        duration: '4s',
        priority: null,
        timeoutMs: 1800000,
        tags: [],
        taskType: 'seeded',
        sourceTaskId: null,
        stageId: null,
        createdAt: null, worktreePath: null, worktreeStatus: null,
      },
    ],
    totalTokensUsed: 0,
    tokensByModel: {},
  },
  {
    id: 'p2',
    name: 'Blog Workflow',
    status: 'awaiting_approval',
    created: '1d ago',
    description: '',
    rules: '',
    enabledAgents: [],
    workingDir: '',
    stages: [],
    logs: [],
    tasks: [],
    totalTokensUsed: 0,
    tokensByModel: {},
  },
];

describe('PipelineSidebar', () => {
  it('renders selected pipeline and status indicator', () => {
    const html = renderToStaticMarkup(
      <PipelineSidebar
        pipelines={pipelines}
        selectedId="p1"
        onSelect={() => undefined}
        onNewPipeline={() => undefined}
        onDelete={() => undefined}
        onRun={() => undefined}
        onPause={() => undefined}
      />,
    );

    expect(html).toContain('Landing Page');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('pipeline-status-p1');
    expect(html).toContain('running');
  });

  it('shows create actions', () => {
    const html = renderToStaticMarkup(
      <PipelineSidebar
        pipelines={pipelines}
        selectedId="p1"
        onSelect={() => undefined}
        onNewPipeline={() => undefined}
        onDelete={() => undefined}
        onRun={() => undefined}
        onPause={() => undefined}
      />,
    );

    expect(html).toContain('+ New Pipeline');
    expect(html).toContain('Pipelines');
  });
});
