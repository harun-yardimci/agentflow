import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Agent, Attachment, BreakdownTaskPlan } from '../src/types/index.js';
import { ExecutionPlanView } from '../src/components/pipelines/ExecutionPlanView.js';

vi.mock('@/context/ModelContext', () => ({
  useModels: () => ({
    getModel: (id: string) => {
      if (id === 'claude') {
        return {
          id: 'claude',
          provider: 'anthropic',
          label: 'Claude',
          color: '#f97316',
          bg: 'rgba(249, 115, 22, 0.14)',
          costPer1k: 0,
          cliFlag: null,
          sortOrder: 1,
          enabled: true,
        };
      }

      return undefined;
    },
  }),
}));

const agents: Agent[] = [
  {
    id: 'research',
    name: 'Research Agent',
    icon: 'R',
    title: 'Analyst',
    avatarSeed: 'Scout',
    defaultModel: 'claude',
    prompt: 'research',
  },
];

const tasks: BreakdownTaskPlan[] = [
  {
    name: 'Review spec',
    agentId: 'research',
    model: 'claude',
    approval: 'auto',
    stage: 0,
    dependsOn: [],
    input: 'Read the uploaded spec and derive tasks.',
    rationale: 'The spec defines the task breakdown.',
    priority: null,
    tags: ['planning'],
    taskType: 'planned',
  },
];

const attachments: Attachment[] = [
  {
    id: 'att-spec',
    targetType: 'pipeline',
    targetId: 'pipe-1',
    pipelineId: 'pipe-1',
    filename: 'spec.md',
    originalName: 'spec.md',
    mimeType: 'text/markdown',
    sizeBytes: 4096,
    createdAt: '2025-01-01T00:00:00.000Z',
  },
];

describe('ExecutionPlanView', () => {
  it('shows planner context attachments alongside the generated stages', () => {
    const html = renderToStaticMarkup(
      React.createElement(ExecutionPlanView, {
        agents,
        contextAttachments: attachments,
        tasks,
      }),
    );

    expect(html).toContain('Planner Context');
    expect(html).toContain('spec.md');
    expect(html).toContain('These files were attached to the AI breakdown request');
    expect(html).toContain('Stage 1');
    expect(html).toContain('Review spec');
  });
});
