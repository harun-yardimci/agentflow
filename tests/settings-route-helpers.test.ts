import { describe, expect, it } from 'vitest';
import {
  serializeSettings,
  toCanonicalSettingKey,
} from '../server/routes/settings.js';

describe('settings route helpers', () => {
  it('maps legacy hook keys to canonical run hook keys', () => {
    expect(toCanonicalSettingKey('pre_task_hook')).toBe('pre_run_hook');
    expect(toCanonicalSettingKey('post_task_hook')).toBe('post_run_hook');
    expect(toCanonicalSettingKey('working_directory')).toBe('working_directory');
  });

  it('serializes legacy hook rows under canonical keys', () => {
    const settings = serializeSettings([
      { key: 'pre_task_hook', value: 'echo old' },
      { key: 'post_run_hook', value: 'echo new' },
    ]);

    expect(settings.pre_run_hook).toBe('echo old');
    expect(settings.post_run_hook).toBe('echo new');
    expect(settings.pre_task_hook).toBeUndefined();
    expect(settings.post_task_hook).toBeUndefined();
  });

  it('prefers canonical values when both canonical and legacy rows exist', () => {
    const settings = serializeSettings([
      { key: 'pre_task_hook', value: 'echo legacy' },
      { key: 'pre_run_hook', value: 'echo canonical' },
    ]);

    expect(settings.pre_run_hook).toBe('echo canonical');
  });
});
