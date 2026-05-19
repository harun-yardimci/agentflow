# AgentFlow UI Audit & Design Direction

> **Date:** 2026-03-13
> **Scope:** Complete UI audit + new design direction for AgentFlow dashboard
> **Reference tools:** Linear, Vercel Dashboard, Raycast

---

## Part 1: UI Audit — Screen-by-Screen Analysis

### 1.1 TopBar (Navigation)

**Current state:** 48px tall bar with logo, nav tabs, pending count badge, online indicator.

| Issue | Category | Severity |
|-------|----------|----------|
| Logo text "AGENTFLOW" uses `tracking-[0.18em]` + `uppercase` + 11px — overly stylized, hard to read | Readability | Medium |
| Active tab indicator is a 16px underline bar — too subtle, easy to miss | Clarity | Medium |
| Pending count shown twice (badge on tab + separate element on right) — redundant | Simplicity | Low |
| "online" indicator is always-visible noise — provides no actionable info most of the time | Simplicity | Low |
| Nav items at 11px are too small for primary navigation | Readability | High |

### 1.2 Pipeline View (Main Screen)

**Current state:** 3-column layout — sidebar (240px) + stage columns (240px each, horizontal scroll) + optional drawer (380px).

| Issue | Category | Severity |
|-------|----------|----------|
| Task cards at 220px fixed width are cramped — text truncates aggressively | Readability | High |
| 9px font used for meta info (created, duration, tokens) — barely legible | Readability | Critical |
| 8px font for task type labels (seeded/spawned/planned) — unreadable | Readability | Critical |
| Too many visual elements per card: status dot + status text + agent icon + agent name + model label + priority badge + tags + meta + action buttons | Simplicity | High |
| Stage column headers use 10px uppercase tracking text — feels "encoded" not readable | Readability | Medium |
| Dependency arrows (SVG overlay) add visual noise without clear benefit at small scale | Simplicity | Medium |
| Horizontal scroll for stages has no visual affordance | Clarity | Medium |
| Selected card uses orange border + shadow — too aggressive for selection state | Simplicity | Low |

### 1.3 Task Card (Core Component)

**Current state:** 220px wide card with left border color-coding, multiple data sections.

| Issue | Category | Severity |
|-------|----------|----------|
| 6 different font sizes in one card (8px, 9px, 10px, 11px, 12px) — no clear hierarchy | Readability | Critical |
| Hover-to-reveal details pattern hides important info (dependencies, tokens) | Clarity | Medium |
| Priority badge uses `!!! / !! / ! / -` text icons — cryptic without learning curve | Clarity | Medium |
| Created timestamp format not human-friendly (raw ISO or "n/a") | Readability | Low |
| Tags section can overflow and push card height unpredictably | Simplicity | Low |

### 1.4 Task Drawer (Detail Panel)

**Current state:** 380px right-side panel with full task editor, output viewer, and action buttons.

| Issue | Category | Severity |
|-------|----------|----------|
| Too many fields shown at once — cognitive overload (name, agent, model, run order, timeout, depends on, approval, priority, tags, input prompt, output) | Simplicity | Critical |
| No visual grouping or sections — fields run together in a long scroll | Clarity | High |
| Output panel has its own tabs (output/stderr), expand/collapse, raw/parsed toggles — complex nested UI | Simplicity | High |
| Multiple action button locations (header + body) — Stop button appears twice for running tasks | Clarity | Medium |
| Model selector buttons at 10px are hard to click on mobile/small screens | Readability | Medium |
| Run order selector (1-5 grid) doesn't explain the parallelism concept well | Clarity | Medium |
| Delete task is buried at the very bottom — but that's probably fine for destructive action | — | — |

### 1.5 Pipeline Header

**Current state:** Pipeline name + status pill + settings gear + created date + chips (tasks, tokens, cost) + action buttons.

| Issue | Category | Severity |
|-------|----------|----------|
| Created date at 9px is too small | Readability | Medium |
| Working directory path shown inline with small icon — gets lost | Clarity | Low |
| Chips (Tasks, Tokens, Cost) use same visual weight as action buttons — hard to distinguish data from actions | Clarity | Medium |
| Delete button is same visual row as Run — too easy to hit accidentally | Simplicity | Medium |

### 1.6 Pipeline Sidebar

**Current state:** Left sidebar with pipeline list, progress bars, mobile dropdown fallback.

| Issue | Category | Severity |
|-------|----------|----------|
| Pipeline names truncate at 240px sidebar width — important context lost | Readability | Medium |
| Progress bar is helpful but the percentage label at 9px is too small | Readability | Low |
| Delete button per pipeline in sidebar is risky — no confirmation from sidebar | Simplicity | Medium |

### 1.7 Agents Page

**Current state:** Sidebar list + right editor panel with icon picker, name, model selector, system prompt textarea.

| Issue | Category | Severity |
|-------|----------|----------|
| Emoji picker grid (32x32 buttons) is visually heavy and takes up disproportionate space | Simplicity | Medium |
| Save button exists but doesn't seem connected to actual save logic (`onClick={() => {}}`) | Clarity | High |
| No visual feedback on save/update actions | Clarity | Medium |
| ID shown as raw UUID — adds clutter, not useful to most users | Simplicity | Low |

### 1.8 Models Page

**Current state:** Provider detection cards + model stats cards + routing guide table.

| Issue | Category | Severity |
|-------|----------|----------|
| Three distinct sections with different visual languages on one page — feels disjointed | Simplicity | Medium |
| Toggle switch implementation uses absolute positioning that could misalign | Clarity | Low |
| Routing guide table is static reference info — takes up significant viewport | Simplicity | Medium |
| "Share" percentage bar is very thin (6px) and hard to read | Readability | Low |

### 1.9 Settings Page

**Current state:** Working directory picker + executor settings (parallel limit, retry, auto-approval) + MCP configuration block.

| Issue | Category | Severity |
|-------|----------|----------|
| MCP config blocks (JSON + TOML) are long code blocks taking up most of the page | Simplicity | Medium |
| Settings and MCP setup are very different concerns mixed on one page | Clarity | Medium |
| Format label at 8px uppercase is barely visible | Readability | Low |

### 1.10 Log Panel

**Current state:** Bottom panel with colored left-border log entries, max 160px height.

| Issue | Category | Severity |
|-------|----------|----------|
| 140px fixed width for timestamp column wastes space | Simplicity | Low |
| Log type only indicated by border color — no text label or icon | Clarity | Medium |
| Max height of 160px is too short for useful log review | Readability | Medium |

---

## Part 2: Cross-Cutting Issues

### Typography Chaos
The current system uses **7 font sizes** (9px, 10px, 11px, 12px, 14px, 18px) but without clear semantic roles. Many components use 3-4 sizes within a single view. The 9px "nano" size is below the readability threshold for most displays.

### Information Density vs. Clarity
The dashboard tries to show everything at once. This works for power users but creates a wall of text for everyone else. There's no progressive disclosure — no "overview first, details on demand."

### Color Overuse
Status colors (8 states), model colors (3), priority colors (4), stage colors (6), tag colors (8), accent colors (4) = **33 distinct semantic colors**. This exceeds human ability to map colors to meanings quickly.

### Monospace Everywhere
Using IBM Plex Mono for ALL text (including headings, labels, and body) reduces readability. Monospace fonts are 15-20% wider than proportional fonts, which is why text truncates so aggressively at 220px card widths.

### Inconsistent Interaction Patterns
- Some selections use orange border, others use background change
- Some states show on hover, others on click
- Action buttons sometimes appear in headers, sometimes inline, sometimes in footers
- No consistent "edit" vs "view" mode distinction

---

## Part 3: New Design Direction

### Philosophy
**"Calm Control"** — The dashboard should feel like a mission control center: authoritative but calm, dense but organized, powerful but not overwhelming.

Reference aesthetic: Linear's minimalism + Vercel's typography clarity + Raycast's information density balance.

### 3.1 Color Palette (Refined Dark Theme)

```
BACKGROUNDS
  --surface-0: #09090b     (zinc-950 — true black background)
  --surface-1: #0f0f12     (elevated panels — slightly warmer)
  --surface-2: #18181b     (zinc-900 — interactive elements)
  --surface-3: #27272a     (zinc-800 — hover states)
  --surface-4: #3f3f46     (zinc-700 — active/pressed)

BORDERS
  --border-default: #27272a    (zinc-800 — primary borders)
  --border-subtle: #1c1c20     (subtle dividers)
  --border-hover: #3f3f46      (zinc-700 — interactive hover)
  --border-focus: #d97706      (amber-600 — focus rings)

TEXT
  --text-primary: #fafafa      (zinc-50 — high contrast headings)
  --text-secondary: #a1a1aa    (zinc-400 — body text, descriptions)
  --text-tertiary: #71717a     (zinc-500 — meta info, timestamps)
  --text-quaternary: #52525b   (zinc-600 — disabled, very dim)

ACCENT (keep orange as brand)
  --accent: #d97706            (amber-600 — primary actions)
  --accent-hover: #b45309      (amber-700 — hover state)
  --accent-bg: #d97706/10      (10% opacity — subtle tint)
  --accent-subtle: #d97706/5   (5% opacity — very subtle)

STATUS (simplified to 5 core states)
  --status-idle: #71717a       (zinc-500 — queued, paused)
  --status-active: #3b82f6     (blue-500 — running)
  --status-success: #22c55e    (green-500 — completed)
  --status-warning: #f59e0b    (amber-500 — awaiting approval)
  --status-error: #ef4444      (red-500 — failed, blocked, rejected)

MODEL COLORS (keep existing — they work well)
  --model-claude: #d97706
  --model-gemini: #3b82f6
  --model-codex: #22c55e
```

**Key changes:**
- Warmer undertones for surfaces (slightly blue-shifted to avoid pure grey flatness)
- Reduced from 33 semantic colors to ~15 core colors
- Text hierarchy simplified to 4 tiers instead of 4+dim
- Status colors reduced from 8 to 5 (merge similar states visually)

### 3.2 Typography Scale

Keep IBM Plex Mono as the sole font but establish strict hierarchy:

```
SCALE (5 sizes, down from 7)
  --text-lg:    0.9375rem / 15px   — Page titles only (was 18px — too large for mono)
  --text-base:  0.8125rem / 13px   — Section headings, card titles, nav items
  --text-sm:    0.75rem   / 12px   — Body text, field values, button labels
  --text-xs:    0.6875rem / 11px   — Secondary info, labels, badges
  --text-2xs:   0.625rem  / 10px   — Timestamps, meta info (absolute minimum size)

WEIGHTS
  600 (semibold) — Headings, active nav, card titles
  500 (medium)   — Body text, field values
  400 (regular)  — Secondary info, labels, descriptions

LINE HEIGHTS
  --leading-tight:   1.3    (headings)
  --leading-normal:  1.5    (body)
  --leading-relaxed: 1.6    (long-form text, code output)
```

**Key changes:**
- Minimum font size raised from 9px to 10px (was unreadable)
- Maximum reduced from 18px to 15px (mono at 18px is too chunky)
- Eliminated 8px and 9px sizes entirely
- 14px demoted — 13px is the new heading size for mono (proportional equivalent of ~15px)

### 3.3 Spacing System (4px/8px Grid)

```
SPACING TOKENS
  --space-0:   0
  --space-1:   4px     (0.25rem)   — Inner gaps, icon margins
  --space-2:   8px     (0.5rem)    — Element spacing within sections
  --space-3:   12px    (0.75rem)   — Between related groups
  --space-4:   16px    (1rem)      — Section padding
  --space-5:   20px    (1.25rem)   — Between sections
  --space-6:   24px    (1.5rem)    — Page padding
  --space-8:   32px    (2rem)      — Major section breaks

COMPONENT SIZES
  Card width: 260px (up from 220px — gives text room to breathe)
  Sidebar: 260px (up from 240px)
  Drawer: 400px (up from 380px)
  TopBar: 48px (keep — this is fine)
  Log panel: 200px max (up from 160px)
  Button height: 32px default, 28px small
  Input height: 36px default

BORDER RADIUS
  --radius-sm: 4px    (badges, small elements)
  --radius-md: 6px    (cards, inputs, buttons)
  --radius-lg: 8px    (panels, modals, drawers)
  --radius-full: 9999px (pills, dots)
```

### 3.4 Component Redesign Inventory

#### Priority 1 — Core Experience (Must Fix)

| Component | Current Issues | Design Direction |
|-----------|---------------|------------------|
| **TaskCard** | Too dense, 6 font sizes, unreadable meta | Simplify to 3 tiers: title (13px semibold), status line (12px), meta (10px). Remove hover-expand — show key info always. Tags limited to 2 visible + "+N more" |
| **TaskDrawer** | Flat field list, no grouping | Group into collapsible sections: Identity (name, agent, model), Configuration (stage, approval, deps, priority, timeout), Tags, Input, Output. Default-collapse config for completed tasks |
| **TopBar** | Small nav text, redundant indicators | Bump nav to 13px. Remove duplicate pending badge. Move online indicator to subtle position or remove entirely |
| **StatusPill** | Works but 8 visual variants is too many | Consolidate: queued+paused=idle (grey), running=active (blue), completed=success (green), awaiting_approval=warning (amber), failed+blocked+rejected=error (red). Show text label for disambiguation |

#### Priority 2 — Important Improvements

| Component | Current Issues | Design Direction |
|-----------|---------------|------------------|
| **PipelineHeader** | Mixed data + actions, delete too accessible | Split into two rows: Row 1 = title + status + settings. Row 2 = stats (left-aligned) + actions (right-aligned). Move Delete into settings drawer or behind "..." menu |
| **PipelineStageColumn** | Dense header, unclear parallel concept | Clearer stage number + name. Use subtle connector lines between stages. Show parallel indicator as a layout hint, not text |
| **LogPanel** | Too compact, no log type labels | Add icon per log type (info/success/warning/error). Increase max height. Add search/filter capability |
| **PipelineSidebar** | Pipeline names truncate | Show full name on hover tooltip. Use two-line layout: name + subtitle (status + progress) |

#### Priority 3 — Polish

| Component | Current Issues | Design Direction |
|-----------|---------------|------------------|
| **AgentsPage** | Emoji picker too large, no save feedback | Collapse emoji picker into a popover. Add toast notification on save. Remove raw ID display |
| **ModelsPage** | Three disjointed sections | Unify visual language. Collapse routing guide into expandable section. Improve share bar visibility |
| **SettingsPage** | MCP config dominates page | Move MCP config to a sub-tab or collapsible section. Focus settings page on runtime configuration |
| **Button** | Works well | Minor: ensure consistent 28px/32px heights. Add loading state variant |
| **Field** | Works well | Minor: reduce label tracking. Add optional help text pattern |
| **Chip** | Works well | No changes needed |
| **ModelBadge** | Works well | No changes needed |
| **ConfirmDialog** | Works well | Minor: add danger variant with red accent |

### 3.5 Interaction Pattern Guidelines

1. **Selection:** Use subtle left-border accent (2px amber) + background shift (surface-2 -> surface-3). No glowing shadow.
2. **Hover:** Background lightens one surface level. Border becomes visible. Transition 150ms.
3. **Focus:** 2px amber ring with 2px offset. Visible on keyboard navigation only (`:focus-visible`).
4. **Loading:** Use skeleton screens for initial load, spinner only for actions in progress.
5. **Empty states:** Show helpful illustration + action button, not just "No data."
6. **Destructive actions:** Always require confirmation. Use red accent only on the confirm button, not the trigger.
7. **Progressive disclosure:** Default view shows summary. Click/expand reveals details. Don't hide essential info behind hover.

### 3.6 Animation Guidelines

```
TRANSITIONS
  --duration-fast: 100ms     (hover, focus changes)
  --duration-normal: 150ms   (selection, state changes)
  --duration-slow: 250ms     (drawer open/close, panel transitions)
  --easing: cubic-bezier(0.16, 1, 0.3, 1)  (smooth decel — matches Linear)

SPECIFIC ANIMATIONS
  Drawer slide-in: 250ms, ease-out, translateX(100%) -> translateX(0)
  Modal: 200ms, fade-in + scale(0.98) -> scale(1)
  Status dot blink: 1.5s, ease-in-out (running indicator)
  Skeleton pulse: 2s, ease-in-out
  Toast: 150ms slide-up + fade-in, auto-dismiss after 3s
```

### 3.7 Geometric Unicode Replacement Guide

Current usage of problematic characters and their replacements:

| Current | Used In | Replace With |
|---------|---------|-------------|
| `◉` | Not currently used | CSS dot (h-2 w-2 rounded-full bg-color) |
| `◈` | Not currently used | CSS diamond or skip |
| `◇` | Not currently used | CSS border-only dot |

**Currently safe:** All emoji usage (agent icons) renders correctly with IBM Plex Mono. Status dots use CSS `rounded-full` — correct approach. No geometric unicode found in current codebase.

---

## Part 4: Implementation Roadmap

### Phase 1: Foundation (CSS Variables + Typography)
1. Update `src/index.css` — new color variables, typography scale, spacing tokens
2. Update Tailwind `@theme` block to match new tokens
3. Fix minimum font sizes globally (grep for `text-[8px]`, `text-[9px]` and bump)

### Phase 2: Core Components
4. Redesign `TaskCard` — wider, cleaner hierarchy, no hover-to-reveal
5. Redesign `TaskDrawer` — grouped sections, collapsible
6. Redesign `TopBar` — larger nav text, remove redundancy
7. Simplify `StatusPill` — 5 visual states instead of 8

### Phase 3: Page-Level Polish
8. Improve `PipelineHeader` — separate data from actions
9. Improve `AgentsPage` — emoji popover, save feedback
10. Improve `ModelsPage` — unified layout
11. Improve `SettingsPage` — reorganize sections

### Phase 4: New Patterns
12. Add toast notification system
13. Add skeleton loading states
14. Add empty state illustrations
15. Add keyboard shortcut system (Raycast-inspired command palette)

---

## Part 5: Design Token Reference (Quick Copy)

```css
/* ---- NEW AGENTFLOW DESIGN TOKENS ---- */

/* Surfaces */
--color-surface-0: #09090b;
--color-surface-1: #0f0f12;
--color-surface-2: #18181b;
--color-surface-3: #27272a;
--color-surface-4: #3f3f46;

/* Borders */
--color-border-default: #27272a;
--color-border-subtle: #1c1c20;
--color-border-hover: #3f3f46;
--color-border-focus: #d97706;

/* Text */
--color-text-primary: #fafafa;
--color-text-secondary: #a1a1aa;
--color-text-tertiary: #71717a;
--color-text-quaternary: #52525b;

/* Status */
--color-status-idle: #71717a;
--color-status-active: #3b82f6;
--color-status-success: #22c55e;
--color-status-warning: #f59e0b;
--color-status-error: #ef4444;

/* Typography */
--text-lg: 0.9375rem;
--text-base: 0.8125rem;
--text-sm: 0.75rem;
--text-xs: 0.6875rem;
--text-2xs: 0.625rem;

/* Spacing */
--space-1: 0.25rem;
--space-2: 0.5rem;
--space-3: 0.75rem;
--space-4: 1rem;
--space-5: 1.25rem;
--space-6: 1.5rem;
--space-8: 2rem;

/* Radii */
--radius-sm: 4px;
--radius-md: 6px;
--radius-lg: 8px;

/* Motion */
--duration-fast: 100ms;
--duration-normal: 150ms;
--duration-slow: 250ms;
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
```

---

## Appendix: Files to Modify

**Phase 1 (Foundation):**
- `src/index.css` — all CSS custom properties
- `src/constants/index.ts` — color constants, potentially merge with CSS vars

**Phase 2 (Core Components):**
- `src/components/atoms/StatusPill.tsx`
- `src/components/pipelines/TaskCard.tsx`
- `src/components/pipelines/TaskDrawer.tsx`
- `src/components/layout/TopBar.tsx`

**Phase 3 (Pages):**
- `src/components/pipelines/PipelineHeader.tsx`
- `src/components/pipelines/PipelineStageColumn.tsx`
- `src/components/pipelines/LogPanel.tsx`
- `src/components/agents/AgentsPage.tsx`
- `src/components/models/ModelsPage.tsx`
- `src/components/settings/SettingsPage.tsx`

**Phase 4 (New):**
- `src/components/atoms/Toast.tsx` (new)
- `src/components/atoms/Skeleton.tsx` (new)
- `src/components/atoms/EmptyState.tsx` (new)
- `src/components/atoms/CommandPalette.tsx` (new, future)
