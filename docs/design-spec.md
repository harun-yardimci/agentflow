# AgentFlow Design Specification v2

Pipeline orchestration dashboard — dark theme, monospace-forward, information-dense.

---

## 1. Color System

### Surfaces (background layers, darkest → lightest)

| Token              | Hex       | Usage                                  |
|--------------------|-----------|----------------------------------------|
| `surface-0`        | `#060606` | Page background, deepest layer         |
| `surface-1`        | `#0C0C0C` | Sidebar, columns, panels               |
| `surface-2`        | `#111111` | Cards, inputs, elevated containers     |
| `surface-3`        | `#181818` | Hover states, active backgrounds       |
| `surface-4`        | `#222222` | Selected states, pressed backgrounds   |

**Change from v1:** Increase step contrast between layers. Previous `#080808 → #0a0a0a` gap was only 2 units — nearly invisible. New system uses 6-unit steps for perceptible depth.

### Borders

| Token              | Hex       | Usage                                  |
|--------------------|-----------|----------------------------------------|
| `border-subtle`    | `#161616` | Dividers within same surface level     |
| `border-default`   | `#1E1E1E` | Card borders, column borders           |
| `border-hover`     | `#2A2A2A` | Hover state borders                    |
| `border-active`    | `#3A3A3A` | Focus rings, active inputs             |

### Text

| Token              | Hex       | Contrast  | Usage                               |
|--------------------|-----------|-----------|-------------------------------------|
| `text-primary`     | `#EBEBEB` | 16.8:1    | Headings, task names, primary data  |
| `text-secondary`   | `#999999` | 8.5:1     | Labels, secondary info, timestamps  |
| `text-muted`       | `#666666` | 4.7:1     | Tertiary info, hints, placeholders  |
| `text-dim`         | `#3D3D3D` | 2.3:1     | Decorative text only (counts, bg)   |

**Change:** `text-secondary` bumped from `#888` to `#999` for WCAG AA compliance at small sizes. `text-dim` bumped from `#333` to `#3D3D3D` for minimal legibility.

### Accent

| Token              | Hex       | Background  | Usage                              |
|--------------------|-----------|-------------|-------------------------------------|
| `accent-orange`    | `#D97706` | `#1A1005`   | Primary brand, CTAs, selection      |
| `accent-orange-60` | `#D9770699` | —         | Subtle emphasis, secondary orange   |

### Status Colors

| Status     | Foreground | Background  | Usage                               |
|------------|------------|-------------|---------------------------------------|
| `running`  | `#3B82F6`  | `#0C1629`   | Active execution, in-progress         |
| `done`     | `#22C55E`  | `#0A1A10`   | Completed successfully                |
| `blocked`  | `#EF4444`  | `#1C0A0A`   | Errors, failures, rejected            |
| `pending`  | `#F59E0B`  | `#1A1005`   | Awaiting approval                     |
| `todo`     | `#6B7280`  | `#111116`   | Not started, queued                   |
| `waiting`  | `#6B7280`  | `#111116`   | Waiting for dependencies              |

**Changes from v1:**
- `running` changed from `#2563EB` to `#3B82F6` — brighter, more visible against dark bg.
- `done` changed from `#16A34A` to `#22C55E` — brighter green, better contrast.
- `blocked` changed from `#DC2626` to `#EF4444` — brighter, more attention-grabbing.
- `pending` changed from `#D97706` to `#F59E0B` — disambiguate from accent-orange.
- All backgrounds recalculated: higher saturation tint for better status zone recognition.

### Model Colors

| Model    | Color     | Background  |
|----------|-----------|-------------|
| Claude   | `#D97706` | `#1A1005`   |
| Gemini   | `#3B82F6` | `#0C1629`   |
| Codex    | `#22C55E` | `#0A1A10`   |

---

## 2. Typography

Font stack: `'IBM Plex Mono', ui-monospace, monospace` for ALL text.
Drop IBM Plex Sans — a monospace-only UI strengthens the technical/engineering identity and eliminates font-mixing inconsistency.

### Type Scale (modular, ratio 1.25)

| Token      | Size   | Weight     | Line Height | Letter Spacing | Usage                           |
|------------|--------|------------|-------------|----------------|---------------------------------|
| `display`  | 18px   | 600        | 1.33        | -0.01em        | Page titles (rare)              |
| `heading`  | 14px   | 600        | 1.43        | 0.01em         | Pipeline name, section heads    |
| `body`     | 12px   | 400        | 1.50        | 0.02em         | Task names, form labels, text   |
| `caption`  | 11px   | 500        | 1.36        | 0.03em         | Column headers, badges, chips   |
| `micro`    | 10px   | 400        | 1.40        | 0.04em         | Status pills, metadata, counts  |
| `nano`     | 9px    | 400        | 1.33        | 0.05em         | Decorative only (dep counts)    |

**Key principle:** Only 3 weights: 400 (regular), 500 (medium), 600 (semibold). No bold. Information hierarchy through **size + color**, not weight stacking.

### Hierarchy Rules

1. **Primary info** (task name, pipeline name): `body`/`heading` + `text-primary`
2. **Secondary info** (status, model, agent): `caption`/`micro` + `text-secondary`
3. **Tertiary info** (timestamps, counts, deps): `micro`/`nano` + `text-muted`
4. **Background info** (column counts, decorative): `micro` + `text-dim`

---

## 3. Spacing System

Base unit: **4px**. All spacing is a multiple of 4.

| Token  | Value | Usage                                          |
|--------|-------|-------------------------------------------------|
| `sp-1` | 4px   | Inline gaps (icon-to-text, badge spacing)       |
| `sp-2` | 8px   | Compact padding (pills, badges, chips)          |
| `sp-3` | 12px  | Card internal padding, list item gaps            |
| `sp-4` | 16px  | Section padding, column gaps                     |
| `sp-5` | 20px  | Panel padding, header padding                    |
| `sp-6` | 24px  | Page-level padding, major section separation     |
| `sp-8` | 32px  | Layout-level spacing between major regions       |

### Border Radius

| Token       | Value | Usage                              |
|-------------|-------|------------------------------------|
| `radius-sm` | 4px   | Badges, pills, chips               |
| `radius-md` | 6px   | Cards, inputs, buttons             |
| `radius-lg` | 8px   | Columns, panels, modals            |

---

## 4. Responsive Breakpoints

| Name   | Min Width | Layout Adaptation                                  |
|--------|-----------|-----------------------------------------------------|
| `sm`   | 640px     | Collapse sidebar, stack columns vertically          |
| `md`   | 768px     | Sidebar overlay, 2-column kanban                    |
| `lg`   | 1024px    | Sidebar visible, 3-column kanban                    |
| `xl`   | 1280px    | Full 4-column kanban, side drawers visible          |
| `2xl`  | 1536px    | Wider cards, comfortable spacing                    |

### Layout Rules

- **< 768px**: Sidebar hidden (hamburger toggle). Kanban scrolls horizontally. Drawers become full-screen sheets.
- **768–1023px**: Sidebar as overlay. Kanban columns 2 per row, wrapping. Drawer overlays content.
- **1024–1279px**: Sidebar persistent (180px). 3 kanban columns visible, 4th scrollable.
- **≥ 1280px**: Full layout — sidebar (200px) + 4 kanban columns + drawer (360px).

---

## 5. Component Specifications

### 5.1 TopBar

```
┌─────────────────────────────────────────────────────────────────┐
│  ◆ AGENTFLOW      Pipelines [3]   Agents   Models      ● online│
└─────────────────────────────────────────────────────────────────┘
```

| Property         | Value                                          |
|------------------|------------------------------------------------|
| Height           | 48px                                           |
| Background       | `surface-0`                                    |
| Border           | bottom 1px `border-subtle`                     |
| Padding          | 0 `sp-5` (20px horizontal)                     |
| Layout           | `flex items-center`                            |

**Logo Section** (left):
- Icon: 20×20px orange (`accent-orange`) hexagon on `surface-3` bg
- Brand: `caption` (11px) 600 weight, `text-primary`, tracking 0.08em, uppercase
- Gap between icon and text: `sp-2` (8px)
- Right margin after logo group: `sp-6` (24px)

**Navigation** (center-left):
- Items: horizontal, gap `sp-1` (4px)
- Each item: padding `sp-2 sp-3` (8px 12px), `radius-sm`
- Default: `micro` (10px) 500 weight, `text-muted`
- Hover: `text-secondary`, bg `surface-2`
- Active: `text-primary`, bg `surface-3`, bottom border 2px `accent-orange`
- Notification badge: 16px circle, `accent-orange` bg, black text, `nano` (9px) 600 weight

**Status Indicator** (right):
- `micro` (10px), `text-muted`
- Green dot: 6px circle `status-done` color
- Gap: `sp-1`

**Change from v1:** Height reduced 52→48px. Navigation text smaller and muted by default — only active tab is prominent. Reduces visual noise.

---

### 5.2 PipelineSidebar

```
┌──────────────┐
│  PIPELINES   │
│              │
│  ┌──────────┐│
│  │ Pipeline1││
│  │ ● running││
│  │ ████░░ 4/6│
│  └──────────┘│
│  ┌──────────┐│
│  │ Pipeline2││
│  │ ● done   ││
│  │ ██████ 6/6│
│  └──────────┘│
│              │
│  + new       │
└──────────────┘
```

| Property         | Value                                          |
|------------------|------------------------------------------------|
| Width            | 200px (xl+), 180px (lg), 0/overlay (< lg)     |
| Background       | `surface-0`                                    |
| Border           | right 1px `border-subtle`                      |
| Padding          | `sp-4` (16px)                                  |

**Section Label:**
- `nano` (9px), 500 weight, `text-dim`, uppercase, tracking 0.12em
- Margin bottom: `sp-3` (12px)

**Pipeline Item:**
- Padding: `sp-2 sp-3` (8px 12px)
- Border: 1px transparent → `border-default` on hover
- Border-radius: `radius-md`
- Gap between items: `sp-1` (4px)
- **Name**: `body` (12px) 500 weight, `text-primary`, single line, truncate with ellipsis
- **Status row**: flex, items-center, gap `sp-1`
  - Status dot: 5px circle, status color
  - Status text: `nano` (9px) 400 weight, status color
  - Task count: `nano` (9px) 400 weight, `text-dim`, right-aligned
- **Progress bar**: height 2px, mt `sp-1`, bg `surface-3`, fill `status-done` color, `radius-sm`
- **Selected state**: bg `surface-3`, border `border-hover`, left border 2px `accent-orange`
- **Hover state**: bg `surface-2`, border `border-default`

**New Pipeline Button:**
- `micro` (10px), `text-dim`
- Hover: `accent-orange`
- Margin top: `sp-3`

**Change from v1:** Selected state uses left-accent border (matches task card pattern). Status dot reduced from 6px to 5px. Overall more compact.

---

### 5.3 PipelineHeader

```
┌─────────────────────────────────────────────────────────────────┐
│  AI Blog Pipeline                                    ● running  │
│  Created 2025-01-15T10:30:00Z                                   │
│                                                                  │
│  Tasks 4/8    Tokens 12.4k    Cost $0.18     [+ Add] [▤ Logs]   │
└─────────────────────────────────────────────────────────────────┘
```

| Property         | Value                                          |
|------------------|------------------------------------------------|
| Height           | auto (content-driven)                          |
| Background       | `surface-0`                                    |
| Border           | bottom 1px `border-subtle`                     |
| Padding          | `sp-5` (20px) horizontal, `sp-3` (12px) vertical |

**Row 1 — Title + Status:**
- Layout: `flex items-center justify-between`
- Pipeline name: `heading` (14px), 600 weight, `text-primary`
- Status pill: aligned right

**Row 2 — Timestamp:**
- `nano` (9px), `text-dim`
- Margin top: `sp-1` (4px)

**Row 3 — Stats + Actions:**
- Margin top: `sp-3` (12px)
- Layout: `flex items-center gap-sp-4 flex-wrap`
- **Chips** (Tasks, Tokens, Cost):
  - Layout: label + value inline, gap `sp-1`
  - Label: `nano` (9px), `text-dim`, uppercase
  - Value: `micro` (10px), 500 weight, `text-secondary`
  - Separator between chips: 1px vertical line, `border-subtle`, height 12px
- **Action buttons** (right-aligned):
  - "+ Add Task": primary variant (orange border)
  - "Logs": ghost variant

**Change from v1:** Status pill moved to right of title instead of inline. Chips use inline label:value with separators instead of individual containers — saves horizontal space. Timestamp demoted to `nano`.

---

### 5.4 KanbanColumn

```
┌────────────────────┐
│  ● TODO          4 │
├────────────────────┤
│                    │
│  ┌── Run 0 ──────┐│
│  │ [TaskCard]     ││
│  │ [TaskCard]     ││
│  └───────────────┘│
│  ╎                 │
│  ┌── Run 1 ──────┐│
│  │ [TaskCard]     ││
│  └───────────────┘│
│                    │
└────────────────────┘
```

| Property         | Value                                          |
|------------------|------------------------------------------------|
| Min width        | 200px                                          |
| Flex             | `flex-1`                                       |
| Background       | `surface-1`                                    |
| Border           | 1px `border-default`                           |
| Border-radius    | `radius-lg` (8px)                              |

**Column Header:**
- Padding: `sp-3` (12px) horizontal, `sp-2` (8px) vertical
- Border-bottom: 1px `border-subtle`
- Layout: `flex items-center justify-between`
- **Left group** (dot + label):
  - Status dot: 6px circle, column status color
  - Label: `caption` (11px), 600 weight, column status color, uppercase, tracking 0.06em
  - Gap: `sp-2` (8px)
- **Right** (count):
  - `caption` (11px), 400 weight, `text-dim`
  - Background: `surface-3`, padding `sp-1` (2px 6px), `radius-sm`

**Card Container:**
- Padding: `sp-3` (12px)
- Gap between cards: `sp-2` (8px)
- Overflow-y: auto

**Empty State:**
- Dashed border, `border-default`, `radius-md`
- Height: 72px
- Text: `micro`, `text-dim`, "No tasks"
- Centered flex

**Drop Zone (drag-over):**
- Border: 1px dashed `accent-orange-60`
- Background: `accent-orange` at 3% opacity
- Transition: 150ms

**Stage Groups (Todo column only):**
- **Stage Header**: `nano` (9px), `text-dim`, "Stage N" or "Run N"
- If parallel (>1 task): faint left border 1px `border-default`, padding-left `sp-2`
- **Connector**: vertical dashed line between stage groups, 1px `border-subtle`, centered, height 12px

---

### 5.5 TaskCard

```
┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐   ← left border 2px, status color
│ 🔍 Research keywords   │
│                         │
│ ● running    Claude     │
│ dep: 0                  │
└─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘
```

**Compact (Default) State:**

| Property         | Value                                          |
|------------------|------------------------------------------------|
| Padding          | `sp-3` (12px)                                  |
| Background       | `surface-2`                                    |
| Border           | 1px `border-default`, left 2px status color    |
| Border-radius    | `radius-md` (6px)                              |
| Cursor           | pointer                                        |
| Margin bottom    | `sp-2` (8px)                                   |

**Row 1 — Agent + Name:**
- Layout: `flex items-start gap-sp-2`
- Agent icon: 14px emoji, `shrink-0`
- Task name: `body` (12px), 500 weight, `text-primary`, max 2 lines, line-clamp-2

**Row 2 — Status + Model:**
- Margin top: `sp-2` (8px)
- Layout: `flex items-center justify-between`
- **Status pill**:
  - Dot: 5px circle, status color (blink animation if running)
  - Text: `micro` (10px), status color
  - Background: status bg color, padding `sp-1` (2px 8px), `radius-sm`
- **Model badge**:
  - Dot: 4px circle, model color
  - Text: `micro` (10px), `text-muted`
  - No background (text only, less visual weight than status)

**Row 3 — Dependencies (conditional):**
- Only if `dependsOn.length > 0`
- Margin top: `sp-1` (4px)
- Text: `nano` (9px), `text-dim`
- Format: "↗ 2 deps" (use arrow icon, compact)

**Approval Actions (conditional, pending_approval status):**
- Margin top: `sp-2` (8px)
- Layout: `flex gap-sp-2`
- Approve: `caption`, `status-done` color, ghost button with green border
- Reject: `caption`, `status-blocked` color, ghost button with red border

**Interaction States:**

| State      | Border                    | Background  | Shadow                              |
|------------|---------------------------|-------------|--------------------------------------|
| Default    | `border-default`          | `surface-2` | none                                 |
| Hover      | `border-hover`            | `surface-3` | `0 1px 4px rgba(0,0,0,0.3)`        |
| Selected   | `accent-orange`           | `surface-3` | `0 0 0 1px var(--accent-orange)`    |
| Dragging   | `accent-orange-60`        | `surface-4` | `0 4px 16px rgba(0,0,0,0.5)`       |
| Disabled   | `border-subtle`           | `surface-1` | none, opacity 0.5                   |

**Changes from v1:**
- Card padding increased 10px → 12px for breathing room.
- Status and model on same row always (no wrapping) — model badge is text-only to reduce visual competition.
- Dependency display compressed: "dep: 2 tasks" → "↗ 2 deps".
- Hover shadow added for lift effect.

---

### 5.6 StatusPill

```
  ● running     (filled bg, colored text)
  ○ todo        (no bg, hollow dot)
```

| Status           | Dot    | Text Color   | Background    |
|------------------|--------|--------------|----------------|
| `running`        | filled | `#3B82F6`    | `#0C1629`      |
| `done`           | filled | `#22C55E`    | `#0A1A10`      |
| `blocked`        | filled | `#EF4444`    | `#1C0A0A`      |
| `pending_approval` | filled | `#F59E0B`  | `#1A1005`      |
| `todo`           | hollow | `#6B7280`    | none           |
| `waiting`        | hollow | `#6B7280`    | none           |

- Padding: 2px 8px
- Border-radius: `radius-sm` (4px)
- Dot size: 5px
- Text: `micro` (10px), 400 weight
- Running dot has `blink` animation (1.2s)

---

### 5.7 TaskDrawer (Detail Panel)

```
┌──────────────────────────┐
│  Research Keywords    ✕   │
│  ────────────────────────│
│                           │
│  AGENT                    │
│  🔍 Research Agent        │
│                           │
│  MODEL                    │
│  [Claude] [Gemini] [Codex]│
│                           │
│  STATUS                   │
│  ● running                │
│                           │
│  STAGE                    │
│  Run 0                    │
│                           │
│  DEPENDENCIES             │
│  ☑ Task A                 │
│  ☐ Task B                 │
│                           │
│  INPUT                    │
│  "Find trending topics..."│
│                           │
│  OUTPUT                   │
│  "Results: ..."           │
│                           │
│  STATS                    │
│  Tokens: 1,240            │
│  Duration: 3.2s           │
└──────────────────────────┘
```

| Property         | Value                                          |
|------------------|------------------------------------------------|
| Width            | 360px                                          |
| Background       | `surface-1`                                    |
| Border           | left 1px `border-default`                      |
| Animation        | slide-in-right 200ms ease-out                  |
| Overflow-y       | auto                                           |

**Header:**
- Padding: `sp-4` (16px)
- Border-bottom: 1px `border-subtle`
- Task name: `heading` (14px), 600 weight, `text-primary`
- Close button: 24px, `text-muted`, hover `text-primary`

**Field Sections:**
- Padding: `sp-4` horizontal, `sp-3` vertical
- Separated by 1px `border-subtle` lines
- **Field label**: `nano` (9px), 500 weight, `text-dim`, uppercase, tracking 0.1em
- **Field value**: `body` (12px), `text-primary`
- Gap between label and value: `sp-1` (4px)

**Model Selection:**
- Horizontal button group
- Each: padding `sp-2` (6px 10px), `radius-sm`
- Default: border `border-default`, `text-muted`
- Selected: border model-color, bg model-bg-color, text model-color
- Hover: border `border-hover`

**Dependencies Checklist:**
- Each: flex row, gap `sp-2`
- Checkbox: 14px, `border-default`, `radius-sm`
- Checked: `accent-orange` fill, white check
- Label: `body` (12px), `text-secondary`

**Input/Output Fields:**
- Textarea/display: bg `surface-0`, border `border-default`, `radius-md`
- Padding: `sp-3` (12px)
- Text: `body` (12px), `text-secondary`, mono
- Output (read-only): slightly dimmer, `text-muted`

---

### 5.8 LogPanel

```
┌─────────────────────────────────────────────────────────────────┐
│  10:30:01  [info]   Pipeline started                            │
│  10:30:02  [model]  Claude → Research: 1,240 tokens             │
│  10:30:05  [done]   Research completed (3.2s)                   │
│  10:30:05  [warn]   Pending approval: Content Writing           │
└─────────────────────────────────────────────────────────────────┘
```

| Property         | Value                                          |
|------------------|------------------------------------------------|
| Max height       | 180px                                          |
| Background       | `surface-0`                                    |
| Border           | top 1px `border-subtle`                        |
| Padding          | `sp-3` (12px) horizontal                       |
| Animation        | fade-in 150ms                                  |
| Overflow-y       | auto                                           |

**Log Entry:**
- Layout: `flex items-start gap-sp-3`
- **Timestamp**: `nano` (9px), `text-dim`, fixed width 56px
- **Type badge**: `nano` (9px), 500 weight, type-specific color, no background
  - info → `text-muted`
  - success → `status-done`
  - warning → `status-pending`
  - error → `status-blocked`
  - model → `accent-orange`
- **Message**: `micro` (10px), `text-secondary`
- Row padding: `sp-1` (4px) vertical
- Separator: none (spacing sufficient)

---

### 5.9 NewPipelineModal

| Property         | Value                                          |
|------------------|------------------------------------------------|
| Width            | 480px                                          |
| Background       | `surface-2`                                    |
| Border           | 1px `border-default`                           |
| Border-radius    | `radius-lg` (8px)                              |
| Shadow           | `0 16px 48px rgba(0,0,0,0.5)`                 |
| Backdrop         | `rgba(0,0,0,0.6)`, blur 4px                   |
| Padding          | `sp-6` (24px)                                  |

**Title**: `heading` (14px), 600 weight, `text-primary`
**Input**: standard input (see Atoms below)
**Agent grid**: 3 columns, gap `sp-2`, each agent as selectable card
**Buttons**: right-aligned, gap `sp-2`

---

### 5.10 Button (Atom)

| Variant   | Border          | Text           | Bg (hover)     | Usage           |
|-----------|-----------------|----------------|----------------|-----------------|
| `ghost`   | none            | `text-muted`   | `surface-3`    | Secondary actions|
| `default` | `border-default`| `text-secondary`| `surface-3`   | Standard        |
| `primary` | `accent-orange` | `accent-orange`| orange @ 8%    | Primary CTAs    |
| `success` | `status-done`   | `status-done`  | green @ 8%     | Approve         |
| `danger`  | `status-blocked`| `status-blocked`| red @ 8%      | Reject/Delete   |

**Common properties:**
- Padding: `sp-2 sp-3` (8px 12px)
- Border-radius: `radius-md` (6px)
- Text: `caption` (11px), 500 weight
- Transition: colors 150ms
- **Small variant**: padding `sp-1 sp-2` (4px 8px), `micro` (10px)
- **Disabled**: opacity 0.4, cursor not-allowed
- **Focus**: outline 2px `accent-orange`, offset 2px

---

## 6. Interaction Patterns

### 6.1 Drag & Drop

| Phase     | Visual Feedback                                              |
|-----------|--------------------------------------------------------------|
| Grab      | Card: border `accent-orange-60`, bg `surface-4`, scale(1.02), elevated shadow |
| Drag over | Target column: border dashed `accent-orange-60`, bg orange @ 3% |
| Drop      | Card snaps to position, 150ms ease-out transition            |
| Invalid   | Column border flashes `status-blocked` briefly (200ms)       |

### 6.2 Card Selection

1. Click card → border `accent-orange`, glow shadow, TaskDrawer opens from right
2. Click same card or close → drawer closes, card deselects
3. Click different card → drawer updates in-place (no close/reopen animation)

### 6.3 Progressive Disclosure

**Level 1 — Scan (card compact view):**
- Agent icon + task name
- Status pill + model badge
- Left border color = status

**Level 2 — Hover (card hover state):**
- Subtle shadow lift
- Dependencies count becomes visible (if was clipped)
- Tooltip after 500ms: "Click to view details"

**Level 3 — Detail (TaskDrawer):**
- Full task configuration
- Input/output text
- Token/duration stats
- Dependency checkboxes
- Model selection

### 6.4 Transitions

| Trigger              | Animation                | Duration |
|----------------------|--------------------------|----------|
| Card hover           | bg + border transition   | 150ms    |
| Card select          | border + shadow          | 150ms    |
| Drawer open          | slide-in-right + fade    | 200ms    |
| Drawer close         | slide-out-right + fade   | 150ms    |
| Modal open           | fade-in + scale(0.98→1)  | 200ms    |
| Modal close          | fade-out                 | 150ms    |
| Log panel open       | fade-in + slide-up 8px   | 150ms    |
| Status change        | color cross-fade         | 300ms    |
| Progress bar update  | width transition         | 500ms    |
| Notification badge   | scale bounce             | 300ms    |

---

## 7. Layout Architecture

### Full Layout (≥ 1280px)

```
┌───────────────────────────────────────────────────────────────────────┐
│                            TopBar (48px)                              │
├────────┬──────────────────────────────────────────────┬───────────────┤
│        │          PipelineHeader                      │               │
│ Side   ├──────┬──────┬──────┬──────┤                  │  TaskDrawer   │
│ bar    │ Todo │ Run  │ Done │Block │                  │  (360px)      │
│(200px) │      │      │      │      │                  │  conditional  │
│        │      │      │      │      │                  │               │
│        │      │      │      │      │                  │               │
│        ├──────┴──────┴──────┴──────┤                  │               │
│        │          LogPanel (conditional, 180px max)    │               │
└────────┴──────────────────────────────────────────────┴───────────────┘
```

### Spacing Between Regions

- TopBar → Content: 0 (border separation only)
- Sidebar → KanbanBoard: 0 (border separation)
- KanbanBoard → TaskDrawer: 0 (border separation)
- Column gaps: `sp-3` (12px)
- Board padding: `sp-4` (16px)

---

## 8. Accessibility

### Contrast Ratios (WCAG AA)

All text tokens meet minimum contrast ratios against their backgrounds:

| Text Token      | On `surface-0` | On `surface-2` | Requirement |
|-----------------|-----------------|-----------------|-------------|
| `text-primary`  | 16.8:1          | 14.2:1          | 4.5:1 ✓     |
| `text-secondary`| 8.5:1           | 7.2:1           | 4.5:1 ✓     |
| `text-muted`    | 4.7:1           | 4.0:1           | 3:1 (large) ✓|
| `text-dim`      | 2.3:1           | 2.0:1           | decorative   |

`text-dim` is intentionally below AA — used only for non-essential decorative elements.

### Focus Management

- All interactive elements have visible focus rings: 2px `accent-orange`, offset 2px
- Tab order follows visual layout: TopBar → Sidebar → Board → Drawer
- Escape key closes drawers and modals
- Arrow keys navigate within kanban columns

### Screen Reader Support

- Columns: `role="region"` with `aria-label="Todo tasks, 4 items"`
- Cards: `role="button"` with `aria-selected` and `aria-grabbed`
- Status pill: `aria-label="Status: running"`
- Drag zones: `aria-dropeffect="move"`
- Live region for status changes: `aria-live="polite"`

---

## 9. Key Design Decisions Summary

| Problem                          | Solution                                                |
|----------------------------------|---------------------------------------------------------|
| Flat hierarchy, everything same weight | 4-tier text system (primary/secondary/muted/dim) + size scale |
| Pipeline stages unclear          | Stage groups with headers + dashed connectors in Todo column |
| Too much visual noise            | Mono-font only, fewer colors, model badge demoted to text |
| Cards hard to scan               | Status as left border color + compact pill + consistent layout |
| Sidebar not scannable            | Left accent on selected, smaller status, progress bar |
| Status colors ambiguous          | Brighter status colors, distinct from accent-orange (pending → amber) |
| No progressive disclosure        | 3-level system: scan → hover → drawer detail |
| Spacing inconsistent             | Strict 4px grid, named tokens                          |

---

## 10. Implementation Notes

### CSS Variable Updates

Replace the current `@theme` block in `index.css` with the new color tokens listed in Section 1. Key changes:

1. Surface colors: wider contrast steps
2. Status colors: brighter variants with distinct backgrounds
3. `pending` status: `#F59E0B` (amber) instead of `#D97706` (same as accent)
4. Drop `font-sans` from `@theme` — use `font-mono` exclusively

### Component Priority Order

1. **Update CSS variables** — cascading impact, unlocks all visual improvements
2. **TaskCard** — most visible component, most interaction
3. **KanbanColumn** — structural improvement with stage groups
4. **TopBar** — height reduction, nav styling
5. **PipelineSidebar** — selected state, compactness
6. **PipelineHeader** — chip layout, info hierarchy
7. **TaskDrawer** — field layout improvements
8. **LogPanel** — type colorization

### File Touch List

```
src/index.css              — color tokens, font config, animations
src/components/atoms/StatusPill.tsx
src/components/atoms/ModelBadge.tsx
src/components/atoms/Button.tsx
src/components/atoms/Chip.tsx
src/components/pipelines/TaskCard.tsx
src/components/pipelines/KanbanColumn.tsx
src/components/pipelines/StageGroup.tsx
src/components/pipelines/PipelineHeader.tsx
src/components/pipelines/PipelineSidebar.tsx
src/components/pipelines/TaskDrawer.tsx
src/components/pipelines/LogPanel.tsx
src/components/layout/TopBar.tsx
src/constants/index.ts     — status color mapping updates
```
