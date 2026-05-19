import { describe, expect, it } from 'vitest';
import { CLI_TEMPLATES, buildCliArgs } from '../server/executor/cli-templates.js';

describe('CLI Templates - imageFlag', () => {
  it('claude has no imageFlag', () => {
    expect(CLI_TEMPLATES.claude.imageFlag).toBeNull();
  });

  it('gemini has no imageFlag', () => {
    expect(CLI_TEMPLATES.gemini.imageFlag).toBeNull();
  });

  it('codex has --image imageFlag', () => {
    expect(CLI_TEMPLATES.codex.imageFlag).toBe('--image');
  });
});

describe('buildCliArgs - imageFiles', () => {
  it('appends --image flags for codex when imageFiles provided', () => {
    const args = buildCliArgs(CLI_TEMPLATES.codex, 'fix bug', {
      skipPermissions: true,
      imageFiles: ['.attachments/screenshot.png', '.attachments/diagram.jpg'],
    });

    expect(args).toContain('--image');
    const imageIndices = args
      .map((a, i) => a === '--image' ? i : -1)
      .filter(i => i !== -1);

    expect(imageIndices).toHaveLength(2);
    expect(args[imageIndices[0]! + 1]).toBe('.attachments/screenshot.png');
    expect(args[imageIndices[1]! + 1]).toBe('.attachments/diagram.jpg');
  });

  it('does not append image flags for claude even with imageFiles', () => {
    const args = buildCliArgs(CLI_TEMPLATES.claude, 'fix bug', {
      skipPermissions: true,
      imageFiles: ['.attachments/screenshot.png'],
    });

    expect(args).not.toContain('--image');
  });

  it('does not append image flags for gemini even with imageFiles', () => {
    const args = buildCliArgs(CLI_TEMPLATES.gemini, 'fix bug', {
      skipPermissions: true,
      imageFiles: ['.attachments/screenshot.png'],
    });

    expect(args).not.toContain('--image');
  });

  it('handles empty imageFiles array', () => {
    const args = buildCliArgs(CLI_TEMPLATES.codex, 'fix bug', {
      skipPermissions: true,
      imageFiles: [],
    });

    expect(args).not.toContain('--image');
  });

  it('handles undefined imageFiles', () => {
    const args = buildCliArgs(CLI_TEMPLATES.codex, 'fix bug', {
      skipPermissions: true,
    });

    expect(args).not.toContain('--image');
  });

  it('preserves other codex flags alongside image flags', () => {
    const args = buildCliArgs(CLI_TEMPLATES.codex, 'fix bug', {
      skipPermissions: true,
      imageFiles: ['.attachments/screenshot.png'],
    });

    expect(args).toContain('exec');
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args).toContain('--image');
    expect(args).toContain('.attachments/screenshot.png');
  });
});
