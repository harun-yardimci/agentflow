# Pipeline & Task Screen Designs

> File: `designs/design-system.pen` (Pencil editor)

## Screens Inventory

### 1. Pipeline Overview (Desktop — 1440x900)
- **ID**: `fjfyo`
- **Layout**: TopBar + Sidebar (240px) + Content area
- **Sidebar**: Pipeline list with status dots (active/success/idle/warning)
- **Content**: Header with title + "New Pipeline" CTA, pipeline table
- **Table columns**: Name (with status dot), Status (pill), Tasks, Model (color-coded), Updated, Actions (play/menu)
- **4 sample pipelines**: Build Pipeline v3 (running), Data Migration (completed), Code Review Bot (queued), Deploy Pipeline (approval)

### 2. Pipeline Detail (Desktop — 1440x900)
- **ID**: `M8Reo`
- **Layout**: TopBar + Sidebar + Content area
- **Header**: Pipeline name + running status pill, meta text (task counts by status), "Add Task" + "Run" buttons
- **Progress bar**: 8-segment bar showing completed (green), running (blue), warning (amber), queued (gray)
- **Stage columns**: 3 stages side-by-side
  - Stage 0 (Research): 3 completed TaskCards
  - Stage 1 (Build): 2 running + 1 awaiting approval TaskCards
  - Stage 2 (QA): 2 queued TaskCards
- **Stage headers**: "Stage N · Name" + completion badge (3/3, 2/3, 0/2)

### 3. Task Drawer (420x900)
- **ID**: `sx1gw`
- **Layout**: Header (Task Details + close) → Body → Footer
- **Title section**: Task name, status pill, stage badge, priority badge
- **Metadata**: Agent, Model (color-coded), Approval, Depends On, Duration — key-value rows
- **Output section**: Terminal-style log box with colored output lines (green=success, blue=active, gray=info)
- **Footer**: "Stop" (red ghost) + "Retry" (secondary) buttons

### 4. Add Task Drawer (420x900)
- **ID**: `mzsrw`
- **Layout**: Header + Scrollable form + Footer
- **Form fields**:
  - Task Name (InputGroup)
  - Input/Prompt (textarea, 120px)
  - Agent (SelectGroup — developer)
  - Model (SelectGroup — Claude)
  - Approval (SelectGroup — auto)
  - Stage (InputGroup — 0)
  - Priority (SelectGroup — medium)
  - Depends On (InputGroup — task IDs)
- **Footer**: Cancel (ghost) + "Add Task" (primary)

### 5. New Pipeline Modal (520x480)
- **ID**: `bAwob`
- **Layout**: Header with title + subtitle → Body → Footer
- **Form fields**:
  - Pipeline Name (InputGroup)
  - Description (optional textarea, 80px)
- **Footer**: Cancel (ghost) + "Create" (primary)
- **Styling**: 8px border-radius, border stroke, surface-1 fill

### 6. Pipeline Overview — Empty State (1440x900)
- **ID**: `Ty8Qa`
- **Layout**: Same shell as Pipeline Overview
- **Empty state**: Centered vertically
  - 64x64 icon container with git-branch icon
  - "No pipelines yet" title
  - "Create your first pipeline..." description (320px, centered)
  - "Create Pipeline" primary CTA

### 7. Pipeline Overview — Tablet (768x1024)
- **ID**: `al3CT`
- **Layout**: TopBar + Content (no sidebar)
- **Pipelines as cards** (not table): Each card has name row (dot + name + status pill) and meta row (tasks, model, updated)
- **4 pipeline cards** stacked vertically

### 8. Pipeline Detail — Tablet (768x1024)
- **ID**: `yTIA6`
- **Layout**: TopBar + Content (no sidebar)
- **Header**: Compact — name + status + "Add" + "Run" buttons
- **Stages stacked vertically**: Each stage has header + horizontal card row (2 cards per row)
- **Progress bar**: 3-segment simplified

## Design Tokens Used

All screens use the design system variables:
- **Surfaces**: `--surface-0` (bg) through `--surface-4`
- **Text**: `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-quaternary`
- **Accent**: `--accent` (#d97706), `--accent-bg`, `--accent-hover`
- **Status**: `--status-active` (blue), `--status-success` (green), `--status-warning` (amber), `--status-error` (red), `--status-idle` (gray)
- **Model colors**: `--model-claude` (amber), `--model-gemini` (blue), `--model-codex` (green)
- **Typography**: IBM Plex Mono only, sizes 10-15px
- **Spacing**: 4px grid (4-32px)
- **Radii**: 4/6/8px

## Components Referenced

| Component | ID | Usage |
|---|---|---|
| TopBar | `f6ssN` | All screens |
| Sidebar | `JFkiN` | Desktop screens (not used directly — custom built for flexibility) |
| SidebarItem/Active | `9DBDe` | Active pipeline in sidebar |
| SidebarItem/Default | `xOgj2` | Inactive pipelines in sidebar |
| TaskCard | `yCGUY` | Pipeline Detail stage columns |
| Button/Primary | `kECDK` | CTAs (Run, New Pipeline, Create, Add Task) |
| Button/Secondary | `i6r7V` | Secondary actions (Add Task, Retry) |
| Button/Ghost | `Zguuv` | Cancel, Stop |
| Button/IconOnly | `i2vnC` | Table actions, drawer close |
| StatusPill/* | `zEcls`, `rzHZP`, `MiYxL`, `71DqA`, `kZuDX` | Status indicators |
| Badge/* | `mnBZU`, `BAYsp`, `aW9vN`, `l05R3`, `tVXPG` | Stage counts, metadata |
| InputGroup | `GlfrW` | Form text inputs |
| SelectGroup | `cefJX` | Form dropdowns |

## Responsive Strategy

| Breakpoint | Sidebar | Pipeline List | Stage Layout | Task Drawer |
|---|---|---|---|---|
| Desktop (1440px) | Visible (240px) | Table with columns | Horizontal columns | Side panel (420px) |
| Tablet (768px) | Hidden | Card stack | Horizontal cards per stage, stages stacked | Full-width overlay |

## Interaction Notes

- **Pipeline row hover**: Subtle background highlight (surface-2)
- **Task card click**: Opens Task Drawer from right
- **"+" Add Task**: Opens Add Task Drawer from right
- **"New Pipeline" button**: Opens New Pipeline Modal (centered overlay)
- **Stage badges**: Color-coded by completion (success=done, info=partial, default=none)
- **Progress bar segments**: Each segment = 1 task, colored by task status
- **Model text**: Color-coded (claude=amber, gemini=blue, codex=green)
