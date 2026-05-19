import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { findElements, textContent } from '@/test/react-tree';
import { TopBar } from './TopBar';

describe('TopBar', () => {
  it('invokes setPage when nav item is clicked', () => {
    const setPage = vi.fn();
    const tree = TopBar({
      page: 'pipelines',
      setPage,
      pendingCount: 2,
    });

    const buttons = findElements(tree, (element) => element.type === 'button');
    const modelButton = buttons.find((button) =>
      textContent(button.props.children as React.ReactNode).includes('Model Config'),
    );

    expect(modelButton).toBeTruthy();
    (modelButton?.props.onClick as (() => void) | undefined)?.();

    expect(setPage).toHaveBeenCalledWith('models');
  });

  it('keeps pipeline tab active and shows pending summary text', () => {
    const html = renderToStaticMarkup(
      <TopBar page="pipelines" pendingCount={3} setPage={() => undefined} />,
    );

    expect(html).toContain('aria-current="page"');
    expect(html).toContain('3 pending');
    expect(html).toContain('Pipelines');
  });
});
