import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Attachment } from '../src/types/index.js';
import { PlannerAttachments } from '../src/components/pipelines/PlannerAttachments.js';

const attachments: Attachment[] = [
  {
    id: 'att-spec',
    targetType: 'pipeline',
    targetId: 'pipe-1',
    pipelineId: 'pipe-1',
    filename: 'spec.md',
    originalName: 'spec.md',
    mimeType: 'text/markdown',
    sizeBytes: 12 * 1024,
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'att-image',
    targetType: 'pipeline',
    targetId: 'pipe-1',
    pipelineId: 'pipe-1',
    filename: 'diagram.png',
    originalName: 'diagram.png',
    mimeType: 'image/png',
    sizeBytes: 240 * 1024,
    createdAt: '2025-01-01T00:00:00.000Z',
  },
];

describe('PlannerAttachments', () => {
  it('renders selected context files and the prompt budget summary', () => {
    const html = renderToStaticMarkup(
      React.createElement(PlannerAttachments, {
        attachments,
        onAttachmentsChange: () => undefined,
        onSelectedAttachmentIdsChange: () => undefined,
        pipelineId: 'pipe-1',
        selectedAttachmentIds: ['att-spec'],
      }),
    );

    expect(html).toContain('Context Files');
    expect(html).toContain('1 selected');
    expect(html).toContain('spec.md');
    expect(html).toContain('est. 12.0 KB prompt context');
    expect(html).toContain('Choose From Available (2)');
    expect(html).toContain('Text files are capped at 32 KB each and 128 KB total');
  });

  it('renders the empty selection state when no files are chosen', () => {
    const html = renderToStaticMarkup(
      React.createElement(PlannerAttachments, {
        attachments,
        onAttachmentsChange: () => undefined,
        onSelectedAttachmentIdsChange: () => undefined,
        pipelineId: 'pipe-1',
        selectedAttachmentIds: [],
      }),
    );

    expect(html).toContain('No context files selected');
    expect(html).toContain('0 files selected');
  });
});
