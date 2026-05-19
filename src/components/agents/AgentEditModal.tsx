import { useEffect, useState, type JSX } from 'react';
import type { Agent, ModelKey } from '@/types';
import { AVATAR_SEED_PRESETS } from '@/constants';
import {
  Button,
  Input,
  Modal,
  Textarea,
} from '@/components/ui';
import { CrewAvatar } from '@/components/atoms/CrewAvatar';
import { ModelSelector } from '@/components/atoms/ModelSelector';
import { cn } from '@/lib/utils';

interface AgentDraft {
  defaultModel: ModelKey;
  icon: string;
  title: string;
  avatarSeed: string;
  name: string;
  prompt: string;
}

interface AgentEditModalProps {
  agent: Agent;
  onClose: () => void;
  onDelete: (id: string) => void;
  onSave: (id: string, draft: AgentDraft) => Promise<void>;
  saving: boolean;
}

export function AgentEditModal({
  agent,
  onClose,
  onDelete,
  onSave,
  saving,
}: AgentEditModalProps): JSX.Element {
  const [draft, setDraft] = useState<AgentDraft>({
    defaultModel: agent.defaultModel,
    icon: agent.icon,
    title: agent.title,
    avatarSeed: agent.avatarSeed,
    name: agent.name,
    prompt: agent.prompt,
  });

  useEffect(() => {
    setDraft({
      defaultModel: agent.defaultModel,
      icon: agent.icon,
      title: agent.title,
      avatarSeed: agent.avatarSeed,
      name: agent.name,
      prompt: agent.prompt,
    });
  }, [agent]);

  const isDirty =
    agent.name !== draft.name ||
    agent.icon !== draft.icon ||
    agent.title !== draft.title ||
    agent.avatarSeed !== draft.avatarSeed ||
    agent.defaultModel !== draft.defaultModel ||
    agent.prompt !== draft.prompt;

  return (
    <Modal
      className="max-w-[680px]"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
      title={
        <span className="inline-flex items-center gap-2.5">
          <CrewAvatar seed={draft.avatarSeed || draft.name} size="sm" />
          Edit Crew Member
        </span>
      }
      footer={
        <div className="flex items-center justify-between">
          <Button onClick={() => onDelete(agent.id)} size="sm" variant="danger">
            Delete
          </Button>
          <div className="flex items-center gap-2">
            <Button onClick={onClose} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={!isDirty || saving}
              onClick={() => void onSave(agent.id, draft)}
              size="sm"
              variant="primary"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* ── Avatar Preview + Picker ── */}
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-text-muted">
            Avatar
          </p>
          <div className="flex items-start gap-4">
            <div className="flex flex-col items-center gap-1.5">
              <CrewAvatar
                className="ring-2 ring-border-secondary"
                seed={draft.avatarSeed || draft.name}
                size="lg"
              />
              <span className="font-mono text-[9px] text-text-dim">preview</span>
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap gap-1.5">
                {AVATAR_SEED_PRESETS.map((seed) => (
                  <button
                    className={cn(
                      'rounded-lg border p-1 transition-colors',
                      draft.avatarSeed === seed
                        ? 'border-accent-orange bg-accent-orange-bg'
                        : 'border-border-secondary bg-surface-2 hover:border-border-hover',
                    )}
                    key={seed}
                    onClick={() => setDraft((prev) => ({ ...prev, avatarSeed: seed }))}
                    title={seed}
                    type="button"
                  >
                    <CrewAvatar seed={seed} size="xs" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Name + Title ── */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label
              className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-text-muted"
              htmlFor="modal-agent-name"
            >
              Crew Name
            </label>
            <Input
              id="modal-agent-name"
              onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Atlas, Nova..."
              value={draft.name}
            />
          </div>
          <div>
            <label
              className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-text-muted"
              htmlFor="modal-agent-title"
            >
              Title
            </label>
            <Input
              id="modal-agent-title"
              onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="e.g. Senior Developer"
              value={draft.title}
            />
          </div>
        </div>

        {/* ── Default Model ── */}
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-text-muted">
            Default Model
          </p>
          <ModelSelector
            onChange={(model) => setDraft((prev) => ({ ...prev, defaultModel: model }))}
            value={draft.defaultModel}
          />
        </div>

        {/* ── Job Description (System Prompt) ── */}
        <div>
          <label
            className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-text-muted"
            htmlFor="modal-agent-prompt"
          >
            Job Description (System Prompt)
          </label>
          <Textarea
            id="modal-agent-prompt"
            onChange={(e) => setDraft((prev) => ({ ...prev, prompt: e.target.value }))}
            resize="vertical"
            rows={8}
            size="md"
            value={draft.prompt}
          />
          <div className="mt-1 flex items-center justify-end">
            <span className="font-mono text-[10px] text-text-muted">
              {draft.prompt.length.toLocaleString()} chars
            </span>
          </div>
        </div>

        <div className="rounded-md border border-border-secondary bg-surface-1 p-3">
          <p className="font-mono text-[10px] text-text-dim">
            ID: <span className="text-text-secondary">{agent.id}</span>
          </p>
        </div>
      </div>
    </Modal>
  );
}
