import React from 'react';

type TreeElement = React.ReactElement<Record<string, unknown>>;

export function findElements(
  node: React.ReactNode,
  predicate: (element: TreeElement) => boolean,
): TreeElement[] {
  const results: TreeElement[] = [];

  const walk = (current: React.ReactNode): void => {
    if (current === null || current === undefined || typeof current === 'boolean') {
      return;
    }

    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }

    if (!React.isValidElement(current)) {
      return;
    }

    const element = current as TreeElement;

    if (predicate(element)) {
      results.push(element);
    }

    walk((element.props.children as React.ReactNode) ?? null);
  };

  walk(node);
  return results;
}

export function textContent(node: React.ReactNode): string {
  const chunks: string[] = [];

  const walk = (current: React.ReactNode): void => {
    if (current === null || current === undefined || typeof current === 'boolean') {
      return;
    }

    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }

    if (typeof current === 'string' || typeof current === 'number') {
      chunks.push(String(current));
      return;
    }

    if (React.isValidElement(current)) {
      const element = current as TreeElement;
      walk((element.props.children as React.ReactNode) ?? null);
    }
  };

  walk(node);
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}
