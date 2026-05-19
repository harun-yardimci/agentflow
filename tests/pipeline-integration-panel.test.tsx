import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Pipeline } from '@/types';
import { PipelineIntegrationPanel } from '@/components/pipelines/PipelineIntegrationPanel';

const pipeline: Pipeline = {
  id: 'p1',
  name: 'Integration Demo',
  status: 'running',
  created: '2026-03-25 12:00',
  description: '',
  rules: '',
  enabledAgents: [],
  workingDir: '/tmp/demo',
  gitBranch: 'main',
  totalTokensUsed: 0,
  tokensByModel: {},
  stages: [],
  logs: [],
  tasks: [
    {
      id: 't1',
      name: 'Base task',
      agentId: 'dev',
      model: 'claude:sonnet',
      approval: 'auto',
      status: 'completed',
      stage: 0,
      dependsOn: [],
      input: 'Build base',
      output: '',
      tokens: null,
      duration: null,
      priority: null,
      timeoutMs: 1800000,
      tags: [],
      taskType: 'seeded',
      sourceTaskId: null,
      sourceTaskName: null,
      sourceTaskStatus: null,
      sourceTaskArchivedAt: null,
      stageId: null,
      createdAt: '2026-03-25T12:00:00Z',
      worktreePath: null,
      worktreeStatus: 'ready_for_review',
      useWorktree: true,
      branch: null,
    },
    {
      id: 't2',
      name: 'Follow-up fix',
      agentId: 'dev',
      model: 'claude:sonnet',
      approval: 'auto',
      status: 'queued',
      stage: 1,
      dependsOn: ['t1'],
      input: 'Fix review notes',
      output: '',
      tokens: null,
      duration: null,
      priority: null,
      timeoutMs: 1800000,
      tags: [],
      taskType: 'spawned',
      sourceTaskId: 't1',
      sourceTaskName: 'Base task',
      sourceTaskStatus: 'completed',
      sourceTaskArchivedAt: null,
      stageId: null,
      createdAt: '2026-03-25T12:01:00Z',
      worktreePath: '/tmp/worktree',
      worktreeStatus: 'ready_for_review',
      useWorktree: true,
      branch: null,
    },
  ],
};

describe('PipelineIntegrationPanel', () => {
  it('renders pipeline code-line summary and follow-up lineage', () => {
    const html = renderToStaticMarkup(
      <PipelineIntegrationPanel pipeline={pipeline} />,
    );

    expect(html).toContain('Integration');
    expect(html).toContain('Pipeline default');
    expect(html).toContain('Follow-up');
    expect(html).toContain('Base task');
    expect(html).toContain('Waiting on parent review');
    expect(html).toContain('owner:');
    expect(html).toContain('Open task');
  });
});
