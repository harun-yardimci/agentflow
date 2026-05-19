import assert from 'node:assert/strict';
import test from 'node:test';
import { StatusPill } from './StatusPill';
import type { ExtendedStatus } from './StatusPill';
import { findElements, textContent } from '@/test/react-tree';

test('StatusPill maps running to updated blue token', () => {
  const tree = StatusPill({ status: 'running' });
  const runningStyle = tree.props.style as Record<string, string>;

  assert.equal(runningStyle.color, '#2563EB');

  const [dot] = findElements(
    tree,
    (element) => element.props['data-testid'] === 'status-pill-dot',
  );

  assert.ok(dot);
  const dotStyle = dot.props.style as Record<string, string>;
  assert.equal(dotStyle.backgroundColor, '#3B82F6');
});

test('StatusPill normalizes awaiting_approval as pending', () => {
  const tree = StatusPill({ status: 'awaiting_approval' as ExtendedStatus });

  assert.equal(textContent(tree), 'pending');
  const pendingStyle = tree.props.style as Record<string, string>;
  assert.equal(pendingStyle.color, '#D97706');
});

test('StatusPill supports approved and rejected aliases', () => {
  const approved = StatusPill({ status: 'approved' });
  const rejected = StatusPill({ status: 'rejected' });

  assert.equal(textContent(approved), 'approved');
  assert.equal(textContent(rejected), 'rejected');
  const approvedStyle = approved.props.style as Record<string, string>;
  const rejectedStyle = rejected.props.style as Record<string, string>;
  assert.equal(approvedStyle.color, '#16A34A');
  assert.equal(rejectedStyle.color, '#F97316');
});
