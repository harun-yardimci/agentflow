import { describe, expect, it } from 'vitest';
import {
  CreatePipelineSchema,
  UpdatePipelineSchema,
} from '../server/types/api.js';

describe('Pipeline API schema', () => {
  it('accepts legacy-sized rules during update', () => {
    const result = UpdatePipelineSchema.safeParse({
      rules: 'r'.repeat(7416),
    });

    expect(result.success).toBe(true);
  });

  it('accepts legacy-sized rules during create', () => {
    const result = CreatePipelineSchema.safeParse({
      name: 'Legacy Rules Pipeline',
      workingDir: '/tmp/project',
      rules: 'r'.repeat(7416),
    });

    expect(result.success).toBe(true);
  });

  it('requires workingDir during create', () => {
    const result = CreatePipelineSchema.safeParse({
      name: 'Missing Directory Pipeline',
    });

    expect(result.success).toBe(false);
  });

  it('rejects empty workingDir during update', () => {
    const result = UpdatePipelineSchema.safeParse({
      workingDir: '   ',
    });

    expect(result.success).toBe(false);
  });
});
