import { describe, expect, it } from 'vitest';
import {
  formatFileReference,
  buildPromptWithAttachments,
  getImageFilePaths,
  type AttachmentRow,
} from '../server/services/attachment-service.js';

function makeAttachment(overrides: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    id: 'att_001',
    target_type: 'task',
    target_id: 'task_001',
    pipeline_id: 'pipe_001',
    filename: 'uuid-1234.png',
    original_name: 'screenshot.png',
    mime_type: 'image/png',
    size_bytes: 2048,
    created_at: '2026-03-18T00:00:00Z',
    ...overrides,
  };
}

describe('formatFileReference', () => {
  it('returns @-prefixed path for gemini provider', () => {
    expect(formatFileReference('file.txt', 'gemini')).toBe('@.attachments/file.txt');
  });

  it('returns plain path for claude provider', () => {
    expect(formatFileReference('file.txt', 'claude')).toBe('.attachments/file.txt');
  });

  it('returns plain path for codex provider', () => {
    expect(formatFileReference('file.txt', 'codex')).toBe('.attachments/file.txt');
  });

  it('preserves filenames with spaces and special chars', () => {
    expect(formatFileReference('my file (1).pdf', 'claude')).toBe('.attachments/my file (1).pdf');
  });
});

describe('buildPromptWithAttachments', () => {
  it('returns original prompt when no attachments', () => {
    expect(buildPromptWithAttachments('do stuff', [], 'claude')).toBe('do stuff');
  });

  it('prepends attachment list for claude', () => {
    const att = makeAttachment({ original_name: 'data.csv', mime_type: 'text/csv', size_bytes: 1024 });
    const result = buildPromptWithAttachments('analyze this', [att], 'claude');
    expect(result).toContain('The following files are attached in the .attachments/ directory:');
    expect(result).toContain('.attachments/data.csv');
    expect(result).toContain('text/csv');
    expect(result).toContain('analyze this');
  });

  it('uses gemini-specific phrasing and @-syntax', () => {
    const att = makeAttachment({ original_name: 'doc.txt', mime_type: 'text/plain', size_bytes: 512 });
    const result = buildPromptWithAttachments('read file', [att], 'gemini');
    expect(result).toContain('The following files are attached:');
    expect(result).not.toContain('.attachments/ directory');
    expect(result).toContain('@.attachments/doc.txt');
  });

  it('lists multiple attachments', () => {
    const atts = [
      makeAttachment({ original_name: 'a.txt', mime_type: 'text/plain', size_bytes: 100 }),
      makeAttachment({ original_name: 'b.png', mime_type: 'image/png', size_bytes: 2048 }),
    ];
    const result = buildPromptWithAttachments('check files', atts, 'claude');
    expect(result).toContain('.attachments/a.txt');
    expect(result).toContain('.attachments/b.png');
  });

  it('includes human-readable file sizes', () => {
    const att = makeAttachment({ size_bytes: 1536 });
    const result = buildPromptWithAttachments('test', [att], 'claude');
    expect(result).toContain('1.5 KB');
  });

  it('ends with the original task input', () => {
    const att = makeAttachment();
    const result = buildPromptWithAttachments('my task input', [att], 'claude');
    expect(result).toMatch(/my task input$/);
  });
});

describe('getImageFilePaths', () => {
  it('returns empty array when no attachments', () => {
    expect(getImageFilePaths([])).toEqual([]);
  });

  it('extracts only image mime types', () => {
    const atts = [
      makeAttachment({ original_name: 'pic.png', mime_type: 'image/png' }),
      makeAttachment({ original_name: 'doc.txt', mime_type: 'text/plain' }),
      makeAttachment({ original_name: 'photo.jpg', mime_type: 'image/jpeg' }),
    ];
    expect(getImageFilePaths(atts)).toEqual([
      '.attachments/pic.png',
      '.attachments/photo.jpg',
    ]);
  });

  it('returns empty when no images present', () => {
    const atts = [
      makeAttachment({ original_name: 'data.csv', mime_type: 'text/csv' }),
      makeAttachment({ original_name: 'config.json', mime_type: 'application/json' }),
    ];
    expect(getImageFilePaths(atts)).toEqual([]);
  });

  it('handles various image mime types', () => {
    const atts = [
      makeAttachment({ original_name: 'a.webp', mime_type: 'image/webp' }),
      makeAttachment({ original_name: 'b.gif', mime_type: 'image/gif' }),
      makeAttachment({ original_name: 'c.svg', mime_type: 'image/svg+xml' }),
    ];
    expect(getImageFilePaths(atts)).toHaveLength(3);
  });
});
