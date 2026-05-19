# Attachment System Architecture

> File/image attachment support for task inputs and interactive mode follow-up questions.

## Overview

Users can attach files (any type) and images to:
1. **Task input** — when creating or editing a task (AddTaskDrawer, TaskDrawer)
2. **Interactive messages** — when responding to follow-up questions (TaskDrawer conversation view)

Files are stored locally in `data/uploads/`, referenced in SQLite, and passed to CLI agents during execution via provider-specific mechanisms.

---

## 1. Database Schema

### 1.1 `attachments` table (unified)

A single `attachments` table with a polymorphic `target_type` + `target_id` pattern. This avoids table proliferation while cleanly separating task-level attachments from message-level ones.

```sql
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,          -- 'task' | 'message'
  target_id TEXT NOT NULL,            -- task.id or control_requests.id
  pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,             -- stored filename (uuid + ext)
  original_name TEXT NOT NULL,        -- user-facing original filename
  mime_type TEXT NOT NULL,            -- e.g. 'image/png', 'text/plain'
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_target ON attachments(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_attachments_pipeline ON attachments(pipeline_id);
```

**Design decisions:**
- **Polymorphic target** instead of separate tables: tasks and messages share identical attachment metadata. A `target_type` discriminator keeps queries simple and avoids JOIN complexity.
- **`pipeline_id`** denormalized for cascade delete — when a pipeline is deleted, all its attachments (files + DB rows) are cleaned up.
- **`filename`** is the stored name on disk (`{uuid}.{ext}`), never the user's original filename, to avoid collisions and path traversal.
- **No `task_id` FK constraint** — `target_id` references either `tasks.id` or `control_requests.id` depending on `target_type`. Cleanup is handled via `pipeline_id` cascade + application-level hooks.

### 1.2 Migration SQL (for `schema.ts`)

```typescript
// Migration: attachments table
db.exec(`
  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_attachments_target ON attachments(target_type, target_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_pipeline ON attachments(pipeline_id);
`);
```

---

## 2. File Storage

### 2.1 Directory Layout

```
data/
  uploads/
    {pipeline_id}/
      {uuid}.png
      {uuid}.txt
      {uuid}.pdf
```

- Files organized by `pipeline_id` subdirectory for easy bulk cleanup.
- Filename on disk: `{nanoid/uuid}.{original_extension}` — no user-supplied filenames touch the filesystem.
- `data/uploads/` must be added to `.gitignore`.

### 2.2 Limits

| Limit | Value |
|-------|-------|
| Max file size | 10 MB per file |
| Max total per task | 50 MB |
| Max total per message response | 10 MB |
| Max files per upload request | 10 |
| Allowed MIME types | All (no restriction) |

### 2.3 Cleanup Strategy

- **Pipeline deletion**: `ON DELETE CASCADE` removes DB rows. Application-level hook in `pipeline-service.ts` `deletePipeline()` calls `rmSync(data/uploads/{pipelineId})`.
- **Task deletion**: Application-level — query `attachments WHERE target_type='task' AND target_id=?`, delete files, then delete rows.
- **Orphan cleanup**: Optional periodic job (not in v1) to scan `data/uploads/` for files not referenced in `attachments` table.

---

## 3. REST API Contracts

### 3.1 Upload Files

```
POST /api/uploads
Content-Type: multipart/form-data
```

**Form fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `files` | File[] | Yes | One or more files (field name: `files`) |
| `targetType` | string | Yes | `'task'` or `'message'` |
| `targetId` | string | Yes | Task ID or control_request ID |
| `pipelineId` | string | Yes | Pipeline ID (for storage organization + cascade) |

**Response (201):**
```json
{
  "attachments": [
    {
      "id": "att_abc123",
      "targetType": "task",
      "targetId": "task_xyz",
      "pipelineId": "pipe_123",
      "filename": "a1b2c3d4.png",
      "originalName": "screenshot.png",
      "mimeType": "image/png",
      "sizeBytes": 245000,
      "createdAt": "2026-03-18T10:30:00.000Z"
    }
  ]
}
```

**Error responses:**
- `400` — Missing required fields, no files provided
- `413` — File too large (>10MB) or total exceeds task limit (>50MB)
- `404` — Target (task/control_request) or pipeline not found

**Implementation notes:**
- Use `multer` with `diskStorage` strategy (write directly to `data/uploads/{pipelineId}/`).
- Generate `id` with `nanoid()` prefix `att_`.
- Generate `filename` with `nanoid()` + original extension.
- Validate `targetType` is `'task'` | `'message'` with Zod.
- Check cumulative size: `SELECT COALESCE(SUM(size_bytes), 0) FROM attachments WHERE target_type = ? AND target_id = ?`.

### 3.2 Get/Download File

```
GET /api/uploads/:id
```

**Response:** File stream with correct `Content-Type` and `Content-Disposition: inline` headers.

**Query param `?download=true`:** Sets `Content-Disposition: attachment; filename="original_name"`.

**Error responses:**
- `404` — Attachment not found or file missing from disk

### 3.3 Delete Attachment

```
DELETE /api/uploads/:id
```

**Response (200):**
```json
{ "ok": true }
```

**Behavior:** Deletes DB row and removes file from disk. Idempotent — returns 200 even if file already missing from disk.

**Error responses:**
- `404` — Attachment row not found in DB

### 3.4 List Attachments for Target

```
GET /api/uploads?targetType=task&targetId=task_xyz
```

**Response (200):**
```json
{
  "attachments": [
    { "id": "att_abc", "originalName": "design.png", "mimeType": "image/png", "sizeBytes": 245000, "createdAt": "..." },
    { "id": "att_def", "originalName": "spec.md", "mimeType": "text/markdown", "sizeBytes": 1200, "createdAt": "..." }
  ]
}
```

### 3.5 Zod Schemas (for `server/types/api.ts`)

```typescript
import { z } from 'zod';

export const UploadQuerySchema = z.object({
  targetType: z.enum(['task', 'message']),
  targetId: z.string().min(1),
  pipelineId: z.string().min(1),
});

export const ListAttachmentsSchema = z.object({
  targetType: z.enum(['task', 'message']),
  targetId: z.string().min(1),
});
```

---

## 4. CLI Integration Strategy

### 4.1 Core Approach: Copy Files to Worktree

Before execution, copy all task attachments into the worktree at a well-known path:

```
{worktreePath}/.attachments/
  screenshot.png        (original_name preserved for agent readability)
  design-spec.md
  data.csv
```

This makes files accessible to all three CLIs through their natural working-directory file access. The `.attachments/` directory is:
- Created by `task-runner.ts` before spawning the executor
- Referenced in the prompt via injected instructions
- Cleaned up with the worktree (no extra cleanup needed)

For tasks without worktrees (`use_worktree=false`), files are copied to a temp directory and the path is injected into the prompt.

### 4.2 Prompt Injection

Prepend attachment context to the task prompt. The `task-runner.ts` assembles the final prompt:

```typescript
function buildPromptWithAttachments(
  taskInput: string,
  attachments: Attachment[],
  provider: string
): string {
  if (attachments.length === 0) return taskInput;

  const fileList = attachments.map(a => {
    const ref = formatFileReference(a, provider);
    return `- ${ref} (${a.mimeType}, ${formatBytes(a.sizeBytes)})`;
  }).join('\n');

  const header = `The following files are attached in the .attachments/ directory:\n${fileList}\n\n`;
  return header + taskInput;
}
```

### 4.3 Provider-Specific File References

Each CLI has a different optimal way to reference files:

#### Claude CLI
- **Strategy**: Mention file paths in prompt text. Claude Code reads files from cwd using its built-in Read tool.
- **Reference format**: `.attachments/filename.ext`
- **Images**: Same — mention path in prompt, Claude reads it.
- **No special flags needed.** Claude automatically has access to the worktree cwd.

```
The following files are attached in the .attachments/ directory:
- .attachments/screenshot.png (image/png, 245 KB)
- .attachments/spec.md (text/markdown, 1.2 KB)

<original task input here>
```

#### Gemini CLI
- **Strategy**: Use `@path` syntax to directly inject file content into the prompt.
- **Reference format**: `@.attachments/filename.ext`
- **Images/PDFs**: Same `@` syntax works for binary files.
- **Important**: The `@` references must be embedded in the prompt string itself.

```
The following files are attached:
- @.attachments/screenshot.png (image/png, 245 KB)
- @.attachments/spec.md (text/markdown, 1.2 KB)

<original task input here>
```

#### Codex CLI
- **Strategy**: Mention file paths in prompt text (same as Claude). For images, use `--image` flag.
- **Reference format (text files)**: `.attachments/filename.ext`
- **Reference format (images)**: Add `--image .attachments/filename.ext` to CLI args.
- **Multiple images**: Repeat `--image` flag or comma-separate.

```
The following files are attached in the .attachments/ directory:
- .attachments/spec.md (text/markdown, 1.2 KB)

<original task input here>
```
Plus CLI args: `--image .attachments/screenshot.png`

### 4.4 CLI Template Changes

Add an `imageFlags` field to `CLITemplate` and extend `buildCliArgs()`:

```typescript
// In CLITemplate interface — add:
/** How to pass image files to the CLI */
imageFlag: string | null;  // '--image' for codex, null for others

// In CLI_TEMPLATES:
claude: { ..., imageFlag: null },
gemini: { ..., imageFlag: null },
codex:  { ..., imageFlag: '--image' },
```

Extend `buildCliArgs()` signature:

```typescript
export function buildCliArgs(
  template: CLITemplate,
  prompt: string,
  options: {
    // ... existing options ...
    imageFiles?: string[];  // absolute paths to image attachments
  }
): string[] {
  // ... existing logic ...

  // Append image flags for providers that need them (Codex)
  if (options.imageFiles?.length && template.imageFlag) {
    for (const img of options.imageFiles) {
      args.push(template.imageFlag, img);
    }
  }

  return args;
}
```

### 4.5 ExecutorInput Changes

```typescript
// In ExecutorInput interface — add:
/** File attachments for this execution */
attachments?: {
  /** Directory where attachments are copied (absolute path) */
  dir: string;
  /** List of attachment metadata */
  files: Array<{
    filename: string;      // stored filename in attachments dir
    originalName: string;  // original user filename
    mimeType: string;
    sizeBytes: number;
  }>;
};
```

### 4.6 Interactive Mode Message Attachments

When a user responds to an `AskUserQuestion` control request with attached files:

1. Files are uploaded via `POST /api/uploads` with `targetType: 'message'`, `targetId: {controlRequestId}`.
2. Before sending the Allow response via stdin, copy new attachments to the existing `.attachments/` directory in the worktree.
3. Include file references in the `updatedInput` field of the Allow response:

```typescript
// In execution route's respond handler:
const allowResponse = buildAllowResponse(requestId, {
  text: userAnswer + '\n\nAttached files:\n' + fileRefs,
});
```

This piggybacks on the existing control protocol — no new protocol extensions needed.

---

## 5. TypeScript Interfaces

### 5.1 Shared Type (`src/types/index.ts`)

```typescript
export interface Attachment {
  id: string;
  targetType: 'task' | 'message';
  targetId: string;
  pipelineId: string;
  filename: string;        // stored filename on disk
  originalName: string;    // user-facing name
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}
```

### 5.2 API Client (`src/lib/api.ts`)

```typescript
// Upload files
async function uploadFiles(
  files: File[],
  targetType: 'task' | 'message',
  targetId: string,
  pipelineId: string
): Promise<Attachment[]>;

// List attachments
async function listAttachments(
  targetType: 'task' | 'message',
  targetId: string
): Promise<Attachment[]>;

// Delete attachment
async function deleteAttachment(id: string): Promise<void>;

// Get download URL
function getAttachmentUrl(id: string, download?: boolean): string;
```

---

## 6. Frontend Component Hierarchy

### 6.1 Components

```
src/components/shared/
  FileDropZone.tsx       — drag-and-drop + click-to-upload area
  AttachmentChip.tsx     — single file pill (icon + name + size + delete)
  AttachmentList.tsx     — horizontal/vertical list of AttachmentChips
  AttachmentPreview.tsx  — image thumbnail / file icon based on MIME type
```

### 6.2 FileDropZone

```typescript
interface FileDropZoneProps {
  /** Called when files are selected/dropped */
  onFiles: (files: File[]) => void;
  /** Max file size in bytes (default: 10MB) */
  maxFileSize?: number;
  /** Max number of files (default: 10) */
  maxFiles?: number;
  /** Accepted MIME types (default: all) */
  accept?: string;
  /** Whether upload is in progress */
  uploading?: boolean;
  /** Compact mode for inline use (conversation input) */
  compact?: boolean;
  /** Disabled state */
  disabled?: boolean;
}
```

**Behavior:**
- Drag-and-drop zone with dashed border, "Drop files here or click to browse" text.
- `compact` mode: small icon button (paperclip) instead of full drop zone — for conversation input bar.
- Validates file size client-side before upload.
- Shows upload progress indicator.

### 6.3 AttachmentChip

```typescript
interface AttachmentChipProps {
  attachment: Attachment;
  /** Show delete button */
  onDelete?: (id: string) => void;
  /** Compact mode (name only, no size) */
  compact?: boolean;
}
```

**Behavior:**
- Pill-shaped chip: `[icon] filename.ext (245 KB) [x]`
- Icon based on MIME type (image, code, document, generic file).
- Click opens preview/download. Delete button calls `onDelete`.
- Images show small thumbnail preview on hover.

### 6.4 AttachmentList

```typescript
interface AttachmentListProps {
  attachments: Attachment[];
  onDelete?: (id: string) => void;
  /** Layout direction */
  direction?: 'horizontal' | 'vertical';
}
```

### 6.5 Integration Points

#### AddTaskDrawer (Manual tab)
- Add `<FileDropZone>` below the input textarea.
- Store pending files in local state, upload on task creation.
- Show `<AttachmentList>` below the drop zone for already-uploaded files.
- After `createTask()` succeeds, upload files with `targetType: 'task'`, `targetId: newTask.id`.

#### TaskDrawer (Detail tab)
- Show `<AttachmentList>` in the task detail section (below input text).
- Add small "Attach files" button to add more attachments to existing task.
- Attachments are read-only when task is `running` or `completed`.

#### TaskDrawer (Conversation/Questions tab)
- Add `<FileDropZone compact>` (paperclip icon) in the response input bar.
- Show `<AttachmentList compact>` below input for staged files.
- On "Send" response, upload files with `targetType: 'message'`, `targetId: controlRequest.id`, then send control response.

---

## 7. Data Flow Summary

### Task Execution Flow

```
1. User creates task with attachments
   → POST /api/uploads (targetType=task, targetId=taskId)
   → Files saved to data/uploads/{pipelineId}/
   → Rows inserted into attachments table

2. Task starts execution (task-runner.ts)
   → Query: SELECT * FROM attachments WHERE target_type='task' AND target_id=?
   → Create {worktreePath}/.attachments/ directory
   → Copy files from data/uploads/{pipelineId}/ to .attachments/ (using original_name)
   → Build prompt with file references (provider-specific format)
   → For Codex: extract image attachments, pass via --image flag
   → Spawn CLI process with modified prompt

3. CLI agent reads files from .attachments/ in its working directory
```

### Interactive Mode Flow

```
1. Agent asks a question (AskUserQuestion)
   → control_request row inserted in DB
   → Frontend polls and shows question in conversation view

2. User types response + attaches files
   → POST /api/uploads (targetType=message, targetId=controlRequestId)
   → Files saved to data/uploads/{pipelineId}/

3. User clicks "Send"
   → POST /api/execution/tasks/:id/respond
   → Backend copies new files to existing .attachments/ in worktree
   → Includes file references in the Allow response updatedInput
   → Agent receives response with file paths it can read
```

---

## 8. Dependencies to Add

```json
{
  "multer": "^2.0.0"
}
```

Plus `@types/multer` as devDependency (if types not bundled in v2).

**Note:** multer v2 supports Express 5. If compatibility issues arise, use `busboy` directly or `express-fileupload`.

---

## 9. File Manifest

| File | Action | Description |
|------|--------|-------------|
| `server/db/schema.ts` | MODIFY | Add `attachments` table + indexes |
| `server/types/api.ts` | MODIFY | Add `UploadQuerySchema`, `ListAttachmentsSchema` |
| `server/routes/uploads.ts` | CREATE | New route file for upload/download/delete/list |
| `server/services/attachment-service.ts` | CREATE | Business logic: save, list, delete, copy-to-worktree |
| `server/index.ts` | MODIFY | Register upload routes, configure multer |
| `server/executor/cli-templates.ts` | MODIFY | Add `imageFlag` field, extend `buildCliArgs` |
| `server/executor/types.ts` | MODIFY | Add `attachments` to `ExecutorInput` |
| `server/engine/task-runner.ts` | MODIFY | Copy attachments to worktree, build prompt with references |
| `server/routes/execution.ts` | MODIFY | Handle attachments in respond endpoint |
| `server/services/pipeline-service.ts` | MODIFY | Delete upload dir on pipeline deletion |
| `server/services/task-service.ts` | MODIFY | Delete attachments on task deletion |
| `src/types/index.ts` | MODIFY | Add `Attachment` interface |
| `src/lib/api.ts` | MODIFY | Add upload/list/delete API functions |
| `src/components/shared/FileDropZone.tsx` | CREATE | Drag-and-drop upload component |
| `src/components/shared/AttachmentChip.tsx` | CREATE | File pill component |
| `src/components/shared/AttachmentList.tsx` | CREATE | List of chips |
| `src/components/shared/AttachmentPreview.tsx` | CREATE | Thumbnail/icon preview |
| `src/components/pipelines/AddTaskDrawer.tsx` | MODIFY | Integrate FileDropZone + AttachmentList |
| `src/components/pipelines/TaskDrawer.tsx` | MODIFY | Show attachments in detail + conversation tabs |
| `.gitignore` | MODIFY | Add `data/uploads/` |
| `package.json` | MODIFY | Add `multer` dependency |

---

## 10. Trade-offs & Decisions

| Decision | Alternative | Rationale |
|----------|-------------|-----------|
| Single `attachments` table with `target_type` | Separate `task_attachments` + `message_attachments` tables | Less schema duplication, simpler queries, same cleanup semantics. Polymorphic FK is fine for this scale. |
| Copy files to worktree `.attachments/` | Symlink or absolute path references | Copies are self-contained — worktree cleanup removes everything. Symlinks can break across git worktree boundaries. |
| Store files on local disk | S3/cloud storage | AgentFlow is a local-first tool. Local storage is simplest, fastest, and matches the SQLite philosophy. Cloud storage can be a future enhancement. |
| Multer for multipart parsing | busboy, formidable | Multer is the de-facto Express middleware, well-tested, supports disk storage natively. v2 works with Express 5. |
| Provider-specific prompt formatting | Generic "files attached" message | Claude, Gemini, and Codex each have different optimal ways to reference files. Tailored formatting maximizes agent effectiveness. |
| Original filenames in `.attachments/` | UUID filenames | Agents need human-readable filenames to understand context. UUID is only used for disk storage in `data/uploads/`. |
| No file type restrictions | Whitelist MIME types | Agents may need any file type (configs, data files, images, PDFs). Restricting MIME types would limit utility. Size limits provide sufficient safety. |
