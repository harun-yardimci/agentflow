# Attachment UI Specifications

This document defines the UI/UX specifications for the attachment integration in `TaskDrawer`, `ExecutionPlanView` (if applicable), and `AddTaskDrawer` (Planner tab), following the AgentFlow design system.

## 1. Design Tokens & Styling Rules

All components must adhere to the existing dark theme and IBM Plex Mono typography.

- **Backgrounds:** `bg-surface-0` through `bg-surface-4`
- **Text:** `text-primary`, `text-secondary`, `text-muted`
- **Borders:** `border-subtle`, `border-default`, `border-hover`, `border-active`
- **Accent:** `text-accent-orange`, `bg-accent-orange/10`
- **Radii:** `rounded-sm` (4px), `rounded-md` (6px), `rounded-lg` (8px)
- **Typography:** `text-body` (12px), `text-caption` (11px), `text-micro` (10px)

---

## 2. TaskDrawer Attachment Section

Located in `src/components/pipelines/TaskDrawer.tsx`. Displayed as a distinct section within the Drawer, potentially collapsible or visually grouped.

### 2.1. Section Header
- **Title:** "ATTACHMENTS" (`text-caption font-semibold text-text-secondary uppercase tracking-wider`)
- **Badge:** Count of attachments (e.g., `3`) using `bg-surface-2 text-text-muted text-nano px-1.5 py-0.5 rounded-sm`.

### 2.2. Empty State
When no attachments exist:
- **Layout:** Centered content, `min-h-[100px] border border-dashed border-border-default rounded-md bg-surface-1 flex flex-col items-center justify-center p-4`.
- **Icon:** `LucideFileUp` or similar, `w-6 h-6 text-text-muted mb-2`.
- **Text:** "No attachments yet" (`text-body text-text-secondary`).
- **Action:** "Drag & drop files or click to browse" (`text-micro text-text-muted mt-1`).
- **Hover State:** `hover:border-accent-orange/50 hover:bg-surface-2 transition-colors cursor-pointer`.

### 2.3. Upload Area (FileDropZone)
When files exist, the drop zone becomes a compact target or a button to add more:
- **Compact Upload Button:** A full-width dashed button `border border-dashed border-border-default hover:border-accent-orange/50 text-text-secondary hover:text-accent-orange text-body py-2 rounded-md flex items-center justify-center gap-2`.
- **Drag Active State:** `bg-accent-orange/10 border-accent-orange text-accent-orange`.

### 2.4. File List View (AttachmentList)
A vertical stack of attached files.
- **Container:** `flex flex-col gap-2 mt-3`.
- **Item Layout:** `flex items-center justify-between p-2 rounded-md border border-border-subtle bg-surface-1 hover:bg-surface-2 group`.
- **Left Side (Info):**
  - **Icon:** File type specific icon, `w-4 h-4 text-text-muted`.
    - *Image:* `LucideImage` (text-blue-400)
    - *PDF:* `LucideFileText` (text-red-400)
    - *Code:* `LucideCode` (text-green-400)
    - *Generic:* `LucideFile` (text-text-muted)
  - **Name:** `text-body text-text-primary truncate max-w-[200px]`.
  - **Meta (Size/Date):** `text-micro text-text-muted`. (e.g., "1.2 MB • Today 14:30")
- **Right Side (Actions):**
  - Appears on hover (`opacity-0 group-hover:opacity-100 transition-opacity`).
  - **Preview/Download:** `LucideDownload` icon button, `text-text-muted hover:text-text-primary p-1`.
  - **Delete:** `LucideTrash2` icon button, `text-text-muted hover:text-red-400 p-1`.
- **Loading/Progress State:**
  - When uploading, show a progress bar at the bottom of the item (`h-1 bg-surface-3 rounded-full overflow-hidden`).
  - Progress fill: `h-full bg-accent-orange transition-all duration-300`.

---

## 3. Planner (Breakdown) Attachment

Located in `src/components/pipelines/AddTaskDrawer.tsx` under the Planner tab.

### 3.1. Context Files Area (PlannerAttachments)
Below the description textarea, an area to attach files specifically for context injection.

- **Header:** "CONTEXT FILES" (`text-caption text-text-secondary mt-4 mb-2 block`).
- **Hint Text:** "These files will be read by the AI to help plan the tasks." (`text-micro text-text-muted mb-3`).

### 3.2. Selected Files (Chip/Tag View)
For files selected to be sent to the planner.
- **Container:** `flex flex-wrap gap-2 mb-3`.
- **Chip Component (`AttachmentChip`):**
  - `inline-flex items-center gap-1.5 px-2 py-1 rounded-sm bg-surface-2 border border-border-subtle`.
  - **Icon:** Small file type icon (`w-3 h-3 text-text-muted`).
  - **Text:** Truncated filename (`text-micro text-text-primary max-w-[120px] truncate`).
  - **Remove Action:** `LucideX` icon (`w-3 h-3 text-text-muted hover:text-red-400 cursor-pointer`).

### 3.3. File Selection & Upload
- **Upload New File:** Compact dropzone similar to TaskDrawer (dashed border, centered text).
- **Select Existing:** "Choose from pipeline" button opening a small popover or inline list if pipeline attachments already exist.
  - *Inline List:* A scrollable list `max-h-[150px] overflow-y-auto` showing existing pipeline attachments with a checkbox or `+` button to include them in the current breakdown.
  - *State:* Included files have `bg-accent-orange/10 border-accent-orange` selection state.

### 3.4. AI Context Indicator
- Shows exactly what will be sent to the planner.
- **Indicator:** Text below the chips: "2 files selected (45 KB total) — will be injected into prompt."
- **Color:** `text-micro text-text-muted`. If size approaches the 128KB limit, turn text to warning color (`text-amber-500`).

---

## 4. Component Hierarchy

### `TaskDrawer.tsx` (Integration)
```tsx
<TaskDrawer>
  {/* Existing content */}
  <Section title="ATTACHMENTS" count={attachments.length}>
    <AttachmentList 
      items={attachments} 
      onDelete={handleDelete} 
      onDownload={handleDownload} 
    />
    <FileDropZone 
      onUpload={handleUpload} 
      compact={attachments.length > 0} 
    />
  </Section>
</TaskDrawer>
```

### `PlannerAttachments.tsx`
```tsx
<PlannerAttachments>
  <div className="flex flex-col">
    <Label>CONTEXT FILES</Label>
    <Hint>These files will be read by the AI to help plan the tasks.</Hint>
    
    {/* Selected Files */}
    <div className="flex flex-wrap gap-2">
      {selectedFiles.map(file => (
        <AttachmentChip key={file.id} file={file} onRemove={handleRemove} />
      ))}
    </div>

    {/* Size Indicator */}
    <SizeIndicator totalSize={calculateSize(selectedFiles)} />

    {/* Actions: Upload new or select existing */}
    <FileDropZone onUpload={handleUpload} />
  </div>
</PlannerAttachments>
```

---

## 5. Interaction States

1. **Hover:**
   - List items: `bg-surface-2`.
   - Buttons/Icons: `text-text-primary` or `text-accent-orange`.
   - Dropzone: `border-accent-orange/50 bg-surface-2`.

2. **Drag Active (File over dropzone):**
   - Background changes to `bg-accent-orange/10`.
   - Border becomes solid `border-accent-orange`.
   - Text prompts: "Drop files here...".

3. **Loading/Uploading:**
   - Disable delete actions.
   - Show infinite loading spinner or progress bar.
   - Opacity reduced for items currently uploading (`opacity-70`).

4. **Error State:**
   - If an upload fails, show the item with a red border `border-red-900 bg-red-950/20`.
   - Error icon (`LucideAlertCircle` text-red-500).
   - "Retry" text button on hover.
   - For prompt injection limits (e.g., over 128KB), show inline warning text in `text-amber-500`.