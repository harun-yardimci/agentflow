# Screen Designs — Agents, Models & Settings

**File**: `designs/design-system.pen` (Pencil editor)
**Stitch Project**: `projects/17926681783577676578` — "AgentFlow — Agents, Models & Settings"

## Screens Designed

### 1. Agents Page (Desktop 1440px)
- **Frame ID**: `qk0Kr`
- **Structure**: TopBar → Body (Sidebar + Main)
- **Features**:
  - Page header with title, subtitle, search box, "New Agent" CTA
  - 4 stat cards: Total Agents (10), Active Now (3), Tasks Completed (247), Error Rate (2.1%)
  - Agent table with columns: Agent (emoji + name), Status (active/idle pills), Model (color-coded), Actions (settings icon)
  - 6 agent rows: research, product, architect, designer, developer, qa
- **Sidebar**: Agent categories (All Agents, Active, Idle, By Model)

### 2. Models Page (Desktop 1440px)
- **Frame ID**: `BNb7y`
- **Structure**: TopBar → Body (Sidebar + Main)
- **Features**:
  - 3 model cards in horizontal grid: Claude (amber), Gemini (blue), Codex (green)
  - Each card: provider name, status pill, usage stats (tasks completed, avg duration, success rate)
  - "Recent Usage" table showing agent → model → task → duration

### 3. Settings Page (Desktop 1440px)
- **Frame ID**: `Uzilv`
- **Structure**: TopBar → Body (Sidebar + Main)
- **Features**:
  - General section: Server Port (3100), Database Path, Polling Interval (2000ms)
  - Execution section: Default Approval (auto), Task Timeout (300s), Max Workers (3)
  - Horizontal label-description + input layout
  - Reset / Save Changes buttons

### 4. Log Panel (Desktop 1440px)
- **Frame ID**: `RIFtc`
- **Structure**: TopBar → Body (Sidebar + Main)
- **Features**:
  - Terminal-style log container with monospace entries
  - Each line: timestamp | level badge | message
  - Color-coded levels: INFO (blue), WARN (amber bg tint), ERR (red bg tint), OK (green)
  - Realistic pipeline execution log entries (start, cascade, retry, timeout warning, error)
  - Filter badge + Clear button in header

### 5. Activity/History View (Desktop 1440px)
- **Frame ID**: `09brY`
- **Structure**: TopBar → Body (Sidebar + Main)
- **Features**:
  - History table: Pipeline name, Run # , Status (completed/failed pills), Duration
  - Search box for filtering runs
  - 5 run entries with mixed statuses

## Responsive Variants

### Agents — Tablet (768px)
- **Frame ID**: `0XC5I`
- No sidebar, full-width layout
- Compact 2-stat row (Total, Active)
- Table with 3 columns (Actions column hidden)

### Agents — Mobile (480px)
- **Frame ID**: `2uPzB`
- TopBar simplified (no tab navigation, title replaces tabs)
- Card-based agent list instead of table
- Each card: agent name + status pill + model/task metadata

### Models — Tablet (768px)
- **Frame ID**: `NQI0W`
- 2-up card grid + stacked Codex card below
- Compact model info (provider + task count in single line)

### Settings — Mobile (480px)
- **Frame ID**: `Z8wqj`
- Single column stacked sections
- Full-width Save button at bottom
- Labels above inputs (vertical layout)

## Empty States

### Agents Empty State (Desktop)
- **Frame ID**: `qzjzn`
- Centered: bot icon (48px) + "No agents configured" + description + "Create Agent" CTA

### History Empty State (Desktop)
- **Frame ID**: `GNJRG`
- Centered: history icon (48px) + "No pipeline runs yet" + description + "Go to Pipelines" CTA

## Design Tokens Used
- All screens use design system variables (`$--surface-*`, `$--text-*`, `$--accent`, `$--status-*`, `$--model-*`)
- Components used: TopBar, Sidebar, SidebarItem, TableHeaderRow, TableDataRow, InputGroup, SelectGroup, Button/Primary, Button/Ghost, Badge, StatusPill, TabBar

## Key Design Decisions
- **No sidebar on tablet/mobile**: Sidebar collapses, navigation moves to topbar
- **Cards replace tables on mobile**: Better touch targets, scannable on small screens
- **Log panel**: Terminal aesthetic with color-coded severity, subtle background tints for warnings/errors
- **Settings**: Horizontal label+input on desktop, vertical stacked on mobile
- **Empty states**: Always include icon + title + description + CTA button
- **Model color coding**: Consistent across all screens (claude=amber, gemini=blue, codex=green)
