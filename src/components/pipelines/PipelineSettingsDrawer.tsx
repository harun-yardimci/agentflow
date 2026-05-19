import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Pipeline } from '@/types';
import { Field } from '@/components/atoms/Field';
import { Button } from '@/components/atoms/Button';
import { DirectoryPicker } from '@/components/atoms/DirectoryPicker';
import * as api from '@/lib/api';

/* ─── Markdown Textarea with Preview Toggle ─── */

function MarkdownField({
  label,
  value,
  onChange,
  placeholder,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  rows: number;
}) {
  const [preview, setPreview] = useState(false);

  return (
    <Field label={label}>
      <div className="space-y-1">
        <div className="flex items-center justify-end gap-1">
          <button
            className={`rounded px-2 py-0.5 font-mono text-[9px] transition-colors ${!preview ? 'bg-surface-3 text-text-primary' : 'text-text-dim hover:text-text-secondary'}`}
            onClick={() => setPreview(false)}
          >
            Edit
          </button>
          <button
            className={`rounded px-2 py-0.5 font-mono text-[9px] transition-colors ${preview ? 'bg-surface-3 text-text-primary' : 'text-text-dim hover:text-text-secondary'}`}
            onClick={() => setPreview(true)}
          >
            Preview
          </button>
        </div>
        {preview ? (
          <div className="min-h-[100px] rounded border border-border-secondary bg-surface-2 p-3">
            {value.trim() ? (
              <div className="prose-invert prose-sm max-w-none font-mono text-[11px] leading-relaxed text-text-secondary [&_pre]:rounded-md [&_pre]:bg-surface-1 [&_pre]:p-2 [&_code]:text-accent-orange [&_h1]:text-sm [&_h2]:text-xs [&_a]:text-accent-blue">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
              </div>
            ) : (
              <p className="font-mono text-[11px] text-text-dim italic">No content</p>
            )}
          </div>
        ) : (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={rows}
            className="w-full resize-y rounded border border-border-secondary bg-surface-2 px-3 py-2 font-mono text-[11px] leading-relaxed text-text-primary placeholder:text-text-dim outline-none focus:border-accent-orange"
          />
        )}
      </div>
    </Field>
  );
}

/* ─── Main Component ─── */

interface PipelineSettingsDrawerProps {
  pipeline: Pipeline;
  onClose: () => void;
  onUpdated: () => void;
  onDelete: () => void;
}

export function PipelineSettingsDrawer({ pipeline, onClose, onUpdated, onDelete }: PipelineSettingsDrawerProps) {
  const [name, setName] = useState(pipeline.name);
  const [description, setDescription] = useState(pipeline.description);
  const [rules, setRules] = useState(pipeline.rules);
  const [workingDir, setWorkingDir] = useState(pipeline.workingDir ?? '');
  const [gitBranch, setGitBranch] = useState(pipeline.gitBranch ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync when pipeline changes
  useEffect(() => {
    setName(pipeline.name);
    setDescription(pipeline.description);
    setRules(pipeline.rules);
    setWorkingDir(pipeline.workingDir ?? '');
    setGitBranch(pipeline.gitBranch ?? '');
  }, [
    pipeline.description,
    pipeline.gitBranch,
    pipeline.id,
    pipeline.name,
    pipeline.rules,
    pipeline.workingDir,
  ]);

  const normalizedName = name.trim();
  const normalizedDescription = description.trim();
  const normalizedRules = rules.trim();
  const normalizedWorkingDir = workingDir.trim();
  const normalizedGitBranch = gitBranch.trim() || null;

  const hasChanges =
    normalizedName !== pipeline.name ||
    normalizedDescription !== pipeline.description ||
    normalizedRules !== pipeline.rules ||
    normalizedWorkingDir !== (pipeline.workingDir ?? '') ||
    normalizedGitBranch !== (pipeline.gitBranch ?? null);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Parameters<typeof api.updatePipeline>[1] = {};

      if (normalizedName !== pipeline.name) payload.name = normalizedName;
      if (normalizedDescription !== pipeline.description) {
        payload.description = normalizedDescription;
      }
      if (normalizedRules !== pipeline.rules) payload.rules = normalizedRules;
      if (!normalizedWorkingDir) {
        throw new Error('Working directory is required');
      }
      if (normalizedWorkingDir !== (pipeline.workingDir ?? '')) {
        payload.workingDir = normalizedWorkingDir;
      }
      if (normalizedGitBranch !== (pipeline.gitBranch ?? null)) {
        payload.gitBranch = normalizedGitBranch;
      }

      await api.updatePipeline(pipeline.id, payload);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [
    normalizedDescription,
    normalizedGitBranch,
    normalizedName,
    normalizedRules,
    normalizedWorkingDir,
    onUpdated,
    pipeline.description,
    pipeline.gitBranch,
    pipeline.id,
    pipeline.name,
    pipeline.rules,
    pipeline.workingDir,
  ]);

  return (
    <div className="flex w-[520px] shrink-0 flex-col border-l border-border-primary bg-surface-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-primary px-5 py-3">
        <span className="font-sans text-sm font-semibold text-text-primary">
          Pipeline Settings
        </span>
        <button
          onClick={onClose}
          className="text-text-dim transition-colors hover:text-text-secondary"
        >
          &times;
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-border-secondary bg-surface-2 px-3 py-2.5 font-mono text-xs text-text-primary placeholder:text-text-dim outline-none focus:border-accent-orange"
          />
        </Field>

        <Field label="Working Directory">
          <DirectoryPicker
            value={workingDir}
            onChange={setWorkingDir}
            placeholder="Select project directory"
          />
          <div className="mt-1 font-mono text-[9px] text-text-dim">
            All tasks will execute in this directory.
          </div>
        </Field>

        <Field label="Default Code Line">
          <input
            value={gitBranch}
            onChange={(e) => setGitBranch(e.target.value)}
            placeholder="main"
            className="w-full rounded border border-border-secondary bg-surface-2 px-3 py-2.5 font-mono text-xs text-text-primary placeholder:text-text-dim outline-none focus:border-accent-orange"
          />
          <div className="mt-1 font-mono text-[9px] text-text-dim">
            New isolated workspaces start from this branch when the task does
            not continue another code line. Leave it empty to auto-try
            <span className="text-text-secondary"> main </span>
            and then
            <span className="text-text-secondary"> master</span>.
          </div>
        </Field>

        <MarkdownField
          label="Description"
          value={description}
          onChange={setDescription}
          placeholder="Project description — supports **markdown**"
          rows={6}
        />

        <MarkdownField
          label="Rules & Constraints"
          value={rules}
          onChange={setRules}
          placeholder="Rules for agents — supports **markdown**, lists, code blocks"
          rows={8}
        />

        {error && (
          <div className="mb-3 rounded border border-accent-red/30 bg-accent-red/10 px-3 py-2 font-mono text-[10px] text-accent-red">
            {error}
          </div>
        )}

        {/* Danger Zone */}
        <div className="mt-6 rounded border border-accent-red/20 bg-accent-red/5 p-4">
          <h3 className="font-mono text-[11px] font-semibold text-accent-red">Danger Zone</h3>
          <p className="mt-1 font-mono text-[10px] text-text-dim">
            Permanently delete this pipeline and all its tasks.
          </p>
          <Button
            variant="danger"
            onClick={onDelete}
            className="mt-3"
          >
            Delete Pipeline
          </Button>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 border-t border-border-primary px-5 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={!hasChanges || saving || !normalizedName || !normalizedWorkingDir}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
