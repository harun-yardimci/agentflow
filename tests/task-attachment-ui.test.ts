import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  TaskAttachmentSection,
  formatAttachmentDate,
  formatAttachmentSize,
  getAttachmentVisualType,
} from '../src/components/pipelines/TaskAttachmentSection.js';

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('task attachment section', () => {
  it('formats file sizes and dates for the drawer list', () => {
    expect(formatAttachmentSize(512)).toBe('512 B');
    expect(formatAttachmentSize(2048)).toBe('2.0 KB');
    expect(formatAttachmentSize(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(
      formatAttachmentDate(
        '2025-01-10T14:30:00.000Z',
        new Date('2025-01-10T15:00:00.000Z'),
      ),
    ).toMatch(/^Today \d{2}:\d{2}$/);
  });

  it('maps mime types to the expected attachment visuals', () => {
    expect(getAttachmentVisualType('image/png')).toBe('image');
    expect(getAttachmentVisualType('application/pdf')).toBe('pdf');
    expect(getAttachmentVisualType('application/json')).toBe('code');
    expect(getAttachmentVisualType('application/zip')).toBe('file');
  });

  it('renders the empty state upload prompt', () => {
    const html = renderToStaticMarkup(
      createElement(TaskAttachmentSection, {
        attachments: [],
        canDelete: true,
        canUpload: true,
        errorMessage: null,
        isLoading: false,
        isUploading: false,
        onDelete: () => undefined,
        onDismissUploadError: () => undefined,
        onDownload: () => undefined,
        onRetryLoad: () => undefined,
        onRetryUpload: () => undefined,
        onUpload: () => undefined,
        pendingUploads: [],
      }),
    );

    expect(html).toContain('No attachments yet');
    expect(html).toContain('Drag &amp; drop files or click to browse');
    expect(html).toContain('>0<');
  });

  it('renders attachments and pending upload rows together', () => {
    const html = renderToStaticMarkup(
      createElement(TaskAttachmentSection, {
        attachments: [
          {
            id: 'att-1',
            targetType: 'task',
            targetId: 'task-1',
            pipelineId: 'pipe-1',
            filename: 'stored-spec.pdf',
            originalName: 'spec.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2048,
            createdAt: '2025-01-10T10:00:00.000Z',
          },
        ],
        canDelete: true,
        canUpload: true,
        errorMessage: null,
        isLoading: false,
        isUploading: true,
        onDelete: () => undefined,
        onDismissUploadError: () => undefined,
        onDownload: () => undefined,
        onRetryLoad: () => undefined,
        onRetryUpload: () => undefined,
        onUpload: () => undefined,
        pendingUploads: [
          {
            id: 'pending-1',
            name: 'draft.md',
            progress: 42,
            sizeBytes: 1024,
            status: 'uploading',
          },
          {
            id: 'pending-2',
            errorMessage: 'Upload failed',
            name: 'broken.txt',
            progress: 100,
            sizeBytes: 512,
            status: 'error',
          },
        ],
      }),
    );

    expect(html).toContain('spec.pdf');
    expect(html).toContain('draft.md');
    expect(html).toContain('Uploading 42%');
    expect(html).toContain('Upload failed');
    expect(html).toContain('Uploading files...');
  });

  it('renders the locked hint when uploads are disabled for a running task', () => {
    const html = renderToStaticMarkup(
      createElement(TaskAttachmentSection, {
        attachments: [
          {
            id: 'att-1',
            targetType: 'task',
            targetId: 'task-1',
            pipelineId: 'pipe-1',
            filename: 'Sprint Plan (Final)_v2.md',
            originalName: 'Sprint Plan (Final)_v2.md',
            mimeType: 'text/markdown',
            sizeBytes: 1024,
            createdAt: '2025-01-10T10:00:00.000Z',
          },
        ],
        canDelete: false,
        canUpload: false,
        errorMessage: null,
        isLoading: false,
        isUploading: false,
        onDelete: () => undefined,
        onDismissUploadError: () => undefined,
        onDownload: () => undefined,
        onRetryLoad: () => undefined,
        onRetryUpload: () => undefined,
        onUpload: () => undefined,
        pendingUploads: [],
      }),
    );

    expect(html).toContain('Sprint Plan (Final)_v2.md');
    expect(html).toContain('Attachments are locked while the task is running.');
  });
});

describe('task drawer attachment integration', () => {
  it('uses the task-specific attachment component and api helpers', () => {
    const source = readSource('src/components/pipelines/TaskDrawer.tsx');

    expect(source).toContain('TaskAttachmentSection');
    expect(source).toContain('api.getTaskAttachments');
    expect(source).toContain('api.uploadTaskAttachment');
    expect(source).toContain('api.deleteTaskAttachment');
    expect(source).toContain('api.getAttachmentDownloadUrl');
  });

  it('keeps concurrent upload and download orchestration in the drawer', () => {
    const source = readSource('src/components/pipelines/TaskDrawer.tsx');

    expect(source).toContain('Promise.all(');
    expect(source).toContain('window.open(');
    expect(source).toContain("status: 'error'");
    expect(source).toContain('beginUploadProgress(uploadId)');
  });
});
