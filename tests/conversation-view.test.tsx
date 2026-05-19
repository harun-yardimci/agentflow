import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConversationView } from '@/components/pipelines/ConversationView';

describe('ConversationView', () => {
  it('renders orphan tool results from legacy streams', () => {
    const raw = JSON.stringify({
      type: 'tool_result',
      tool_id: 'gem_1',
      output: 'Recovered file contents',
      status: 'success',
    });

    const html = renderToStaticMarkup(
      <ConversationView rawOutput={raw} />,
    );

    expect(html).toContain('Tool result');
    expect(html).toContain('gem_1');
    expect(html).toContain('Recovered file contents');
  });
});
