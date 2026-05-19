# Context Packet Compaction Design

Date: 2026-04-02
Status: Implemented
Owner: Codex

## Summary

This change adds a reversible prompt-compaction layer for task handoff context.
Large upstream context blocks are no longer always copied into prompts verbatim.
Instead, AgentFlow:

- detects the content type of large context blocks
- compacts them deterministically for prompt use
- stores the original content in a `context_packets` table
- writes full originals to hidden task-worktree files when a run needs them

The goal is to reduce prompt size without losing the ability to inspect the full
original context later.

## Scope

Implemented in this phase:

- reversible storage for compacted context packets
- deterministic compaction for markdown/text, logs, code, and JSON
- prompt integration for:
  - dependency outputs
  - sibling task outputs
  - cycle summary
  - cycle history
  - previous run context
  - project context
  - shared memory
- backend retrieval endpoint for stored packets
- cycle summary generation from a compacted latest output

Not implemented in this phase:

- automatic model-side retrieval tool calls
- UI for browsing packet references
- semantic/ML summarization

## Design

### Packet Storage

New table: `context_packets`

Each row stores:

- source metadata (`source_type`, `source_key`, task/cycle ownership)
- original content
- compacted content
- estimated token counts before/after
- compaction strategy and detected content type

Rows are reused when the same source/content hash is seen again for the same
task/cycle context.

### Compaction Strategies

Compaction is heuristic and deterministic:

- `json_outline`
  preserves top-level keys and sample items
- `log_focus`
  keeps errors, warnings, and tail/head lines
- `code_outline`
  keeps imports, declarations, comments, and omission markers
- `markdown_focus` / `text_focus`
  keeps headings, bullets, decision-style lines, and tail/head lines

Short content is passed through unchanged.

### Prompt Rendering

Compacted blocks render as:

```text
### <title>
If you need the full source context, read `.agentflow/context-packets/ctxpkt_xxx.md` in the task worktree.
<compact content>
```

This keeps compaction invisible to the end user while still leaving a stable
path for the running agent and internal tooling to inspect the original.

## Retrieval

New endpoint:

- `GET /api/execution/context-packets/:id`

Returns the stored original and compacted forms for a packet.

## Risks And Trade-offs

- Heuristic compaction is intentionally conservative but not semantically
  perfect. It reduces token pressure without requiring a second model call.
- Packet references are currently backend-visible but not yet surfaced in the
  UI.
- Token counts are estimated from text length, not provider-native tokenizers.

## Follow-ups

- surface packet references in execution/task inspection UI
- allow selective re-expansion of packet references during follow-up retries
- consider provider-aware token counting for packet savings metrics
- consider ML/LLM summarization behind a feature flag for very large contexts
