import { describe, expect, it } from 'vitest';
import { CLI_TEMPLATES, buildCliArgs } from '../server/executor/cli-templates.js';

describe('buildCliArgs', () => {
  it('uses claude json output by default', () => {
    const args = buildCliArgs(CLI_TEMPLATES.claude, 'hello', {
      skipPermissions: true,
    });

    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
  });

  it('overrides claude output format to stream-json', () => {
    const args = buildCliArgs(CLI_TEMPLATES.claude, 'hello', {
      skipPermissions: false,
      outputFormat: 'stream-json',
      includePartialMessages: true,
    });

    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args).toContain('--verbose');
    expect(args).toContain('--include-partial-messages');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('uses codex dangerous bypass mode when skip enabled', () => {
    const args = buildCliArgs(CLI_TEMPLATES.codex, 'hello', {
      skipPermissions: true,
    });

    // Codex uses the explicit dangerous bypass flag in CLI skip-permissions mode.
    expect(args).toContain('exec');
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  it('adds --add-dir flags for codex workspace dirs', () => {
    const args = buildCliArgs(CLI_TEMPLATES.codex, 'hello', {
      skipPermissions: true,
      additionalWorkspaceDirs: ['/repo/.git'],
    });

    expect(args).toEqual(
      expect.arrayContaining([
        '--add-dir',
        '/repo/.git',
      ]),
    );
  });

  it('adds --file flags for Claude attachments', () => {
    const args = buildCliArgs(CLI_TEMPLATES.claude, 'hello', {
      skipPermissions: true,
      attachmentFiles: ['/tmp/spec.pdf', '/tmp/mock.png'],
    });

    expect(args).toEqual(
      expect.arrayContaining([
        '--file',
        '/tmp/spec.pdf',
        '--file',
        '/tmp/mock.png',
      ]),
    );
  });

  it('adds --file flags for Gemini attachments', () => {
    const args = buildCliArgs(CLI_TEMPLATES.gemini, 'hello', {
      skipPermissions: true,
      attachmentFiles: ['/tmp/spec.pdf'],
    });

    expect(args).toEqual(
      expect.arrayContaining(['--file', '/tmp/spec.pdf']),
    );
  });

  it('skips --file flags for Codex (no native flag)', () => {
    const args = buildCliArgs(CLI_TEMPLATES.codex, 'hello', {
      skipPermissions: true,
      attachmentFiles: ['/tmp/spec.pdf'],
    });

    expect(args).not.toContain('--file');
    expect(args).not.toContain('/tmp/spec.pdf');
  });

  it('adds --add-dir flags for claude workspace dirs', () => {
    const args = buildCliArgs(CLI_TEMPLATES.claude, 'hello', {
      skipPermissions: true,
      additionalWorkspaceDirs: ['/repo/.git'],
    });

    expect(args).toEqual(
      expect.arrayContaining([
        '--add-dir',
        '/repo/.git',
      ]),
    );
  });

  it('adds --include-directories flags for gemini workspace dirs', () => {
    const args = buildCliArgs(CLI_TEMPLATES.gemini, 'hello', {
      skipPermissions: true,
      additionalWorkspaceDirs: ['/repo/.git'],
    });

    expect(args).toEqual(
      expect.arrayContaining([
        '--include-directories',
        '/repo/.git',
      ]),
    );
  });

  it('skips --file flags when attachmentFiles is empty', () => {
    const args = buildCliArgs(CLI_TEMPLATES.claude, 'hello', {
      skipPermissions: true,
      attachmentFiles: [],
    });

    expect(args).not.toContain('--file');
  });

  it('has fileFlag defined for Claude and Gemini templates', () => {
    expect(CLI_TEMPLATES.claude.fileFlag).toBe('--file');
    expect(CLI_TEMPLATES.gemini.fileFlag).toBe('--file');
    expect(CLI_TEMPLATES.codex.fileFlag).toBeNull();
  });

  it('has extraDirFlag defined for all CLI providers', () => {
    expect(CLI_TEMPLATES.claude.extraDirFlag).toBe('--add-dir');
    expect(CLI_TEMPLATES.gemini.extraDirFlag).toBe('--include-directories');
    expect(CLI_TEMPLATES.codex.extraDirFlag).toBe('--add-dir');
  });
});
