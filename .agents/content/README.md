# AgentFlow — Marketing Content

Hand-crafted marketing content for the AgentFlow v1.0.0 launch.
All content references [`.agents/product-marketing-context.md`](../product-marketing-context.md) for positioning, audience, voice, and differentiators.

**Phase:** Launch — awareness + first installs + first stars on [github.com/harun-yardimci/agentflow](https://github.com/harun-yardimci/agentflow).
**Audience:** Solo devs, indie hackers, team-of-one builders already using Claude Code / Codex / Gemini CLI.
**Voice:** Founder, dry, technical, no hype.

---

## Layout

```
.agents/content/
├── README.md                                   # this file
├── assets/                                     # screenshots (PNG, 1920×1200)
│   ├── dashboard-pipelines-list.png            # running pipeline, sidebar + board
│   ├── pipeline-board-multi-agent.png         # 5-stage board, 5 different models
│   └── crew-directory.png                      # 9 crew members, 4 models
├── linkedin/
│   ├── post-01-announcement.md                # build-in-public announcement
│   └── post-02-worktree-deep-dive.md          # follow-up on worktree isolation
└── blog/
    ├── why-im-building-agentflow.md           # main entry post (hub)
    ├── example-pipelines.md                   # 3 concrete recipes with prompts + graphs
    ├── worktree-deep-dive.md                  # technical explainer: worktree isolation
    ├── agents-driving-agents.md               # MCP + recursive meta-agent patterns
    └── choosing-the-right-model.md            # defaults table: Opus/Sonnet/Codex/Gemini
```

### Blog structure

The main post (`why-im-building-agentflow.md`) is a **hub**, not a monolith. It introduces the three ideas and three real pipelines, and links out to four sub-pages for depth. Each sub-page stands alone and can be shared independently.

Suggested publish order:

1. Main hub post — broadest reach
2. `example-pipelines.md` — for the "show me the prompts" crowd
3. `worktree-deep-dive.md` — for the "how does it actually work" crowd
4. `agents-driving-agents.md` — for the MCP-curious
5. `choosing-the-right-model.md` — evergreen, good for search/referral traffic

## Recommended sequence

1. **LinkedIn Post #1** (`linkedin/post-01-announcement.md`) — first touch. Hook + 3 differentiators + board screenshot. No link.
2. **Blog post** (`blog/why-im-building-agentflow.md`) — publish on personal site or Substack after Post #1 lands. Linkable if someone asks in DMs.
3. **LinkedIn Post #2** (`linkedin/post-02-worktree-deep-dive.md`) — 5+ days after Post #1. Reinforces one specific differentiator (worktree isolation) with a concrete war story.

## CTA strategy

Product is live as of v1.0.0. Every artifact links back to [github.com/harun-yardimci/agentflow](https://github.com/harun-yardimci/agentflow). Goal:

- Land the *idea* (worktree-per-task + multi-agent + MCP) in the right heads.
- Convert that interest into clones, runs, and the first wave of issues/stars.
- Collect signal in GitHub issues, comments, and DMs on what breaks first.

## Screenshots — how they were captured

Taken via Playwright MCP against a local dev server on `http://localhost:3100`, viewport 1920×1200, with real data (completed "Ozan Game Project" pipeline, 17 tasks, 9 crew members). No mocks, no redactions needed — the data is the user's own dogfooded project data.

To re-capture after UI changes:
- `npm run dev` → wait for frontend on 3100
- Navigate to pipeline board and Crew view
- Re-shoot with same viewport

## Turkish variants

Both LinkedIn posts include a Turkish variant at the bottom. Use only if posting to a TR-heavy audience — the primary target (global indie-hacker / solo-dev audience) reads English.

## Not included (deliberately)

- Sales enablement (one-pagers, battle cards) → no sales motion yet, OSS-only.
- Email sequence → no email capture today; reconsider once stars are flowing.
- Ad creative → paid acquisition is not on the table for an OSS tool at v1.

Product Hunt / Hacker News submissions can layer on top of this content once the repo has a few real users.
