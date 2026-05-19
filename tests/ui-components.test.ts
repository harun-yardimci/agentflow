import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  Badge,
  Card,
  buttonVariants,
  cardVariants,
  inputVariants,
  selectVariants,
  statusDotVariants,
  textareaVariants,
} from '../src/components/ui';
import { StatusDot } from '../src/components/ui/status-dot';

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('UI design-system variants', () => {
  it('button variants expose primary and danger styles', () => {
    expect(buttonVariants({ size: 'md', variant: 'primary' })).toContain(
      'bg-accent-orange',
    );
    expect(buttonVariants({ size: 'sm', variant: 'danger' })).toContain(
      'text-accent-red',
    );
  });

  it('field variants keep focus ring and invalid styles', () => {
    expect(inputVariants({ size: 'md' })).toContain('focus-visible:ring-2');
    expect(selectVariants({ size: 'md' })).toContain('focus-visible:ring-2');
    expect(textareaVariants({ size: 'md', resize: 'vertical' })).toContain(
      'aria-[invalid=true]:border-accent-red',
    );
  });

  it('card status-bordered applies left border utilities', () => {
    expect(cardVariants({ variant: 'status-bordered' })).toContain('border-l-2');
  });

  it('Badge falls back to neutral for unknown tone', () => {
    const node = Badge({ children: 'Unknown', tone: 'not-real' });
    const className = node.props.className as string;

    expect(className).toContain('text-text-secondary');
  });

  it('StatusDot falls back to idle tone for unknown status', () => {
    const node = StatusDot({ tone: 'missing-tone' });
    const className = node.props.className as string;

    expect(className).toContain('bg-status-idle');
    expect(statusDotVariants({ size: 'lg', tone: 'active' })).toContain(
      'bg-status-active',
    );
  });

  it('Card falls back to idle tone when status tone is invalid', () => {
    const node = Card({ statusTone: 'unknown-tone', variant: 'status-bordered' });
    const className = node.props.className as string;

    expect(className).toContain('border-l-status-idle');
  });
});

describe('UI interactive primitives source checks', () => {
  it('Modal and Drawer handle Escape key close behavior', () => {
    const modalSource = readSource('src/components/ui/modal.tsx');
    const drawerSource = readSource('src/components/ui/drawer.tsx');

    expect(modalSource).toContain("event.key === 'Escape'");
    expect(drawerSource).toContain("event.key === 'Escape'");
  });

  it('Tabs provide role-based accessibility semantics', () => {
    const tabsSource = readSource('src/components/ui/tabs.tsx');

    expect(tabsSource).toContain('role="tablist"');
    expect(tabsSource).toContain('role="tab"');
    expect(tabsSource).toContain('role="tabpanel"');
    expect(tabsSource).toContain('must be used within <Tabs>');
  });
});
