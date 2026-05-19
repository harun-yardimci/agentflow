# Attachment Integration: AI Planner & TaskDrawer

> Architecture design for integrating the existing file attachment system into the AI planner (breakdown) flow and enhancing the TaskDrawer attachment UX.

## Status Quo

### What Exists

| Layer | Status | Files |
|-------|--------|-------|
| **DB Schema** | `attachments` table with `target_type` + `target_id` polymorphic FK | `server/db/schema.ts:178-188` |
| **Backend Service** | CRUD ops, worktree copy, prompt injection per provider | `server/services/attachment-service.ts` |
| **Upload Route** | `POST /api/uploads`, `GET /api/uploads`, `GET /api/uploads/:id`, `DELETE /api/uploads/:id` | `server/routes/uploads.ts` |
| **Frontend API** | `uploadFiles()`, `listAttachments()`, `deleteAttachment()`, `getAttachmentUrl()` | `src/lib/api.ts:220-256` |
| **TaskDrawer** | Upload/list/delete attachments on task overview tab | `src/components/pipelines/TaskDrawer.tsx:846-868, 1211-1232` |
| **AddTaskDrawer** | Staged files on manual tab only; planner tab has no attachment support | `src/components/pipelines/AddTaskDrawer.tsx:628-643` |
| **Execution** | `copyToWorktree()` + `buildPromptWithAttachments()` inject files at runtime | `server/services/attachment-service.ts:38-71, 133-150` |

### What's Missing

1. **Planner has no attachment awareness** — `generateBreakdown()` receives only `description` + `agentIds`. No mechanism to pass files or file context to the LLM.
2. **AddTaskDrawer planner tab has no file upload** — Only the manual tab supports `FileDropZone`.
3. **Pipeline-level attachments** — Attachments are task-scoped (`target_type='task'`). There's no way to attach files at the pipeline/breakdown level before tasks exist.
4. **Breakdown prompt doesn't reference attached content** — `buildSystemPrompt()` and `userPrompt` in `breakdown-service.ts` have no file injection.

---

## Design

### 1. New Target Type: `pipeline` Attachments

Introduce `target_type = 'pipeline'` for attachments that belong to the pipeline breakdown context (before tasks are created).

**No schema migration needed** — the `attachments` table already uses a free-text `target_type` column. We just need to:
- Allow `'pipeline'` as a valid `target_type` in upload validation
- Update `UploadQuerySchema` in `server/types/api.ts` to accept `'pipeline'`

```typescript
// server/types/api.ts — update UploadQuerySchema
target_type: z.enum(['task', 'message', 'pipeline'])
```

**Upload validation change** in `server/routes/uploads.ts`:
- For `target_type = 'pipeline'`, validate that `targetId` is a valid pipeline ID (not a task).
- Remove the "running task" guard for pipeline uploads.

### 2. API Contracts

#### Existing Endpoints (no changes needed)

These already work for pipeline attachments once the `target_type` validation is relaxed:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /api/uploads` | POST | Upload files — set `targetType='pipeline'`, `targetId=<pipelineId>` |
| `GET /api/uploads?targetType=pipeline&targetId=<pid>` | GET | List pipeline-level attachments |
| `DELETE /api/uploads/:id` | DELETE | Remove an attachment |
| `GET /api/uploads/:id` | GET | Download/preview a file |

#### New Endpoint: Attachment Content for Planner

```
GET /api/uploads/:id/content
```

Returns the **text content** of an attachment for prompt injection. Only works for text-based files.

**Response:**
```json
{
  "id": "att_xxx",
  "originalName": "requirements.md",
  "mimeType": "text/markdown",
  "content": "# Requirements\n...",
  "truncated": false
}
```

**Rules:**
- Text files (`text/*`, `application/json`, `application/xml`, etc.) — return raw content, truncated to 32KB
- Images — return `null` content with a note: `"content": null, "note": "Image file — will be copied to worktree for agent access"`
- Binary files — return `null` content with a note: `"content": null, "note": "Binary file — not readable as text"`
- Set `truncated: true` if content exceeds 32KB limit

**Why a separate endpoint?** The existing `GET /api/uploads/:id` streams the raw file (for download/preview). The `/content` endpoint parses text and enforces size limits for safe prompt injection.

#### Modified Endpoint: Breakdown with Attachments

```
POST /api/breakdown/stream
```

Add optional `attachmentIds` to the request body:

```typescript
// Updated BreakdownRequestSchema
{
  description: string;
  agentIds: string[];
  model?: string;
  attachmentIds?: string[];  // NEW — IDs of pipeline-level attachments to include as context
}
```

The backend reads the text content of referenced attachments and injects them into the planner prompt.

### 3. Data Flow: Planner Attachment Context

```
User uploads files to pipeline ──► POST /api/uploads (targetType=pipeline)
                                         │
                                         ▼
User clicks "Generate Plan"  ──► POST /api/breakdown/stream
                                   { description, agentIds, attachmentIds }
                                         │
                                         ▼
                              breakdown-service.ts:
                              1. Fetch attachment rows by IDs
                              2. Read text content (≤32KB each)
                              3. Build context block
                              4. Inject into userPrompt
                                         │
                                         ▼
                              LLM receives:
                              "## Attached Files\n
                               ### requirements.md (text/markdown, 2.1 KB)\n
                               ```\n<content>\n```\n
                               ### design.png (image/png, 450 KB)\n
                               [Image file — agents will access via .attachments/ directory]\n\n
                               ## Task Description\n
                               <user description>"
                                         │
                                         ▼
                              Plan JSON returned to frontend
                                         │
                                         ▼
                              User creates tasks from plan
                                         │
                                         ▼
                              Pipeline attachments auto-propagated:
                              Each created task inherits pipeline
                              attachments (copied as task attachments)
```

#### Prompt Injection Strategy

**Text files** — inject full content (up to 32KB per file, 128KB total across all files) directly into the prompt wrapped in markdown code fences. This gives the planner full context.

**Images** — mention the filename and note that agents will have access via `.attachments/` directory. The planner can reference them in task instructions.

**Binary files** — mention filename and size only. The planner can instruct tasks to process them.

**Implementation in `breakdown-service.ts`:**

```typescript
// In generateBreakdown(), after building userPrompt:
function buildAttachmentContext(attachmentIds: string[]): string {
  if (attachmentIds.length === 0) return '';

  const db = getDb();
  const blocks: string[] = [];
  let totalSize = 0;
  const MAX_TOTAL = 128 * 1024; // 128KB total text budget

  for (const id of attachmentIds) {
    const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
    if (!row) continue;

    const isText = isTextMime(row.mime_type);
    const isImage = row.mime_type.startsWith('image/');

    if (isText && totalSize < MAX_TOTAL) {
      const content = readFileSync(getFilePath(row.pipeline_id, row.filename), 'utf-8');
      const truncated = content.slice(0, Math.min(32 * 1024, MAX_TOTAL - totalSize));
      totalSize += truncated.length;
      blocks.push(
        `### ${row.original_name} (${row.mime_type}, ${formatBytes(row.size_bytes)})\n` +
        '```\n' + truncated + '\n```'
      );
    } else if (isImage) {
      blocks.push(
        `### ${row.original_name} (${row.mime_type}, ${formatBytes(row.size_bytes)})\n` +
        '[Image file — agents will access this via .attachments/ directory at runtime]'
      );
    } else {
      blocks.push(
        `### ${row.original_name} (${row.mime_type}, ${formatBytes(row.size_bytes)})\n` +
        '[Binary file — available in .attachments/ directory at runtime]'
      );
    }
  }

  return blocks.length > 0
    ? '## Attached Reference Files\n\n' + blocks.join('\n\n') + '\n\n---\n\n'
    : '';
}
```

#### Text MIME Detection

```typescript
function isTextMime(mime: string): boolean {
  if (mime.startsWith('text/')) return true;
  const textTypes = [
    'application/json',
    'application/xml',
    'application/javascript',
    'application/typescript',
    'application/x-yaml',
    'application/toml',
    'application/sql',
    'application/graphql',
    'application/x-sh',
  ];
  return textTypes.includes(mime);
}
```

### 4. Pipeline Attachment Propagation to Tasks

When the user creates tasks from the breakdown plan (`POST /pipelines/:pid/tasks/batch`), pipeline-level attachments should be **automatically copied** as task attachments for each created task.

**Implementation in `server/services/task-service.ts` → `batchCreateTasks()`:**

```typescript
// After creating all tasks in the batch:
const pipelineAttachments = getAttachmentsByTarget('pipeline', pipelineId);
if (pipelineAttachments.length > 0) {
  for (const task of createdTasks) {
    for (const att of pipelineAttachments) {
      // Create a new attachment row pointing to the SAME file (no copy)
      db.prepare(`
        INSERT INTO attachments (id, target_type, target_id, pipeline_id, filename, original_name, mime_type, size_bytes, created_at)
        VALUES (?, 'task', ?, ?, ?, ?, ?, ?, ?)
      `).run(generateId(), task.id, att.pipeline_id, att.filename, att.original_name, att.mime_type, att.size_bytes, logTimestamp());
    }
  }
}
```

**Why not copy files?** The files are stored in `data/uploads/<pipelineId>/`. Since all tasks belong to the same pipeline, they can reference the same physical file. Only the DB rows are duplicated (different `target_id`).

### 5. File Size & Type Constraints

| Constraint | Value | Rationale |
|-----------|-------|-----------|
| Max file size | **10 MB** per file | Already enforced by multer config |
| Max files per upload | **10 files** | Already enforced |
| Max text content for planner prompt | **32 KB** per file, **128 KB** total | Prevent token budget explosion in breakdown LLM call |
| Accepted MIME types | **All** | No restriction — binary files are stored but not injected as text |
| Max pipeline attachments | **20 files** | Soft limit — frontend validation only |

**File categories for planner prompt injection:**

| Category | MIME Pattern | Planner Behavior |
|----------|-------------|-----------------|
| Text/Code | `text/*`, `application/json`, `application/xml`, `application/javascript`, etc. | Full content injected (up to 32KB) |
| Images | `image/*` | Filename + size noted; agents access via `.attachments/` |
| Documents | `application/pdf`, `application/msword`, etc. | Filename + size only; future: OCR/extraction |
| Binary | Everything else | Filename + size only |

### 6. DB Schema Changes

**No migration needed.** The existing `attachments` table handles this with:
- `target_type = 'pipeline'` (new value, no schema change)
- `target_id = <pipeline_id>` (same column)

The only change is validation-level: update `UploadQuerySchema` to accept `'pipeline'`.

### 7. Component Hierarchy: AddTaskDrawer Planner Tab

```
AddTaskDrawer
├── TabsContent[planner]
│   ├── Textarea (description)
│   ├── ── NEW: PlannerAttachments ──────────────────
│   │   ├── AttachmentList (pipeline-level attachments)
│   │   │   └── AttachmentChip[] (with delete)
│   │   └── FileDropZone (compact mode)
│   │       └── Uploads to targetType='pipeline'
│   ├── ─────────────────────────────────────────────
│   ├── Agent selector grid
│   ├── Generate / Stop buttons
│   ├── Stream output
│   └── Plan result (PlanTaskCard[])
└── TabsContent[manual]
    └── (existing — already has FileDropZone)
```

**Placement:** The attachment section goes directly below the description textarea, before the agent selector. This is because:
1. Files are context for the description — they logically group together
2. The user flow is: describe → attach references → select agents → generate
3. Keeping it above the agent grid avoids visual clutter in the plan result area

**Component: `PlannerAttachments`** (new, ~60 lines)

```tsx
// src/components/pipelines/PlannerAttachments.tsx
interface PlannerAttachmentsProps {
  pipelineId: string;
  attachments: Attachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
  disabled?: boolean;
}
```

- Fetches pipeline attachments on mount via `listAttachments('pipeline', pipelineId)`
- Upload via `uploadFiles(files, 'pipeline', pipelineId, pipelineId)`
- Delete via `deleteAttachment(id)`
- Passes attachment IDs to parent for breakdown request

### 8. Component Hierarchy: TaskDrawer

**No structural changes needed.** The existing TaskDrawer already has:
- `AttachmentList` with delete support
- `FileDropZone` for upload
- Lock when task is running

The only enhancement: after batch task creation propagates pipeline attachments, the TaskDrawer will automatically show them (fetched via existing `listAttachments('task', taskId)` call).

### 9. Frontend API Changes

```typescript
// src/lib/api.ts — update streamBreakdown data type
export async function streamBreakdown(
  data: {
    description: string;
    agentIds: string[];
    model?: string;
    attachmentIds?: string[];  // NEW
  },
  callbacks: BreakdownStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> { ... }

// No new API functions needed — uploadFiles, listAttachments, deleteAttachment
// already support arbitrary targetType strings
```

---

## Implementation Tasks (for downstream agents)

### Task 1: Backend — Pipeline Attachment Support
**Agent:** developer
**Scope:** `server/types/api.ts`, `server/routes/uploads.ts`
- Update `UploadQuerySchema` to accept `target_type = 'pipeline'`
- Add pipeline existence validation in upload route
- Add `GET /api/uploads/:id/content` endpoint

### Task 2: Backend — Planner Attachment Injection
**Agent:** developer
**Scope:** `server/services/breakdown-service.ts`, `server/routes/breakdown.ts`
- Add `attachmentIds?: string[]` to `BreakdownRequestSchema`
- Implement `buildAttachmentContext()` in breakdown-service
- Inject attachment context into `userPrompt` before LLM call
- Pass `attachmentIds` through `generateBreakdown()` signature

### Task 3: Backend — Attachment Propagation on Batch Create
**Agent:** developer
**Scope:** `server/services/task-service.ts`
- In `batchCreateTasks()`, after creating tasks, copy pipeline attachment rows as task attachments
- No physical file copy — reuse same `filename` since same `pipeline_id`

### Task 4: Frontend — PlannerAttachments Component
**Agent:** developer
**Scope:** `src/components/pipelines/PlannerAttachments.tsx` (new), `src/components/pipelines/AddTaskDrawer.tsx`
- Create `PlannerAttachments` component with upload/list/delete
- Integrate into AddTaskDrawer planner tab below description textarea
- Pass `attachmentIds` to `streamBreakdown()` call
- Update `api.streamBreakdown` type signature

### Task 5: QA — Integration Tests
**Agent:** qa
**Scope:** `server/services/__tests__/`
- Test pipeline attachment upload + list + delete
- Test breakdown with attachment context injection
- Test batch create propagates pipeline attachments to tasks
- Test text content extraction with size limits

---

## Trade-offs & Decisions

| Decision | Alternative Considered | Rationale |
|----------|----------------------|-----------|
| Inject text content directly into prompt | Summarize with a separate LLM call | Simpler, no extra API call, 128KB budget is sufficient for most reference docs |
| Reuse same physical file for propagated task attachments | Copy files per task | Same pipeline = same upload dir; avoids disk waste |
| 32KB per file / 128KB total limit | No limit | Prevents token budget explosion; 128KB ≈ 40K tokens which is reasonable for context |
| No new DB migration | Add `pipeline_id` FK to attachments | Already exists — `pipeline_id` column is already on the attachments table |
| Frontend-only 20 file soft limit | Backend hard limit | Avoids breaking existing upload flows; sufficient guardrail |
| `target_type='pipeline'` reuses existing table | New `pipeline_attachments` table | Polymorphic target pattern is already established; adding a table adds complexity |
