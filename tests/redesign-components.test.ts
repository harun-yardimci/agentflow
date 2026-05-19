import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('redesigned page components', () => {
  it('AgentCard supports both row and card layouts with quick model assignment', () => {
    const source = readSource('src/components/agents/AgentCard.tsx');

    expect(source).toContain("layout: 'card' | 'row'");
    expect(source).toContain('onQuickAssign');
    expect(source).toContain('cycle');
    expect(source).toContain('Open Crew Member');
  });

  it('ModelCard includes provider availability and usage metrics', () => {
    const source = readSource('src/components/models/ModelCard.tsx');

    expect(source).toContain('Provider:');
    expect(source).toContain('Enable');
    expect(source).toContain('Disable');
    expect(source).toContain('Success');
    expect(source).toContain('Total Cost');
  });

  it('ActivityLog renders searchable timeline entries', () => {
    const source = readSource('src/components/pipelines/ActivityLog.tsx');

    expect(source).toContain('Activity Timeline');
    expect(source).toContain('Search runs');
    expect(source).toContain('No timeline entries');
    expect(source).toContain("status.replace(/_/g, ' ')");
  });
});
