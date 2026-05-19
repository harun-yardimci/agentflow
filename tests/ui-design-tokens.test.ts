import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('design system token integration', () => {
  it('index.css defines root and dark token variables', () => {
    const css = readSource('src/index.css');

    expect(css).toContain(':root');
    expect(css).toContain('.dark');
    expect(css).toContain('--surface-0: #09090b;');
    expect(css).toContain('--surface-4: #2e2e36;');
    expect(css).toContain('--accent-primary: #d97706;');
    expect(css).toContain('--model-claude: #f59e0b;');
    expect(css).toContain("--font-family-mono: 'IBM Plex Mono'",);
  });

  it('tailwind config exposes semantic and model token groups', () => {
    const tailwindConfig = readSource('tailwind.config.ts');

    expect(tailwindConfig).toContain('darkMode: \'class\'');
    expect(tailwindConfig).toContain('surface: {');
    expect(tailwindConfig).toContain('accent: {');
    expect(tailwindConfig).toContain('status: {');
    expect(tailwindConfig).toContain('model: {');
    expect(tailwindConfig).toContain('fontFamily');
    expect(tailwindConfig).toContain('boxShadow');
  });
});
