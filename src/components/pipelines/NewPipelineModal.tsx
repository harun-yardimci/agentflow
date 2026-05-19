import { useMemo, useState } from 'react';
import type { Agent, Pipeline } from '@/types';
import { DEFAULT_PIPELINE_STAGES } from '@/constants';
import { mkId } from '@/lib/utils';
import { Badge, Button, Card, CardBody, Input, Modal, Textarea } from '@/components/ui';
import { DirectoryPicker } from '@/components/atoms/DirectoryPicker';

interface StageEntry {
  color: string;
  maxParallel: number;
  name: string;
}

interface NewPipelineModalProps {
  agents: Agent[];
  onClose: () => void;
  onCreate: (pipeline: Pipeline) => Promise<void> | void;
}

export function NewPipelineModal({ agents, onClose, onCreate }: NewPipelineModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');
  const [workingDir, setWorkingDir] = useState('');
  const [gitBranch, setGitBranch] = useState('');
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [stages, setStages] = useState<StageEntry[]>(() => {
    return DEFAULT_PIPELINE_STAGES.map((stage, index) => {
      return { ...stage, maxParallel: index + 1 };
    });
  });
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    return (
      name.trim().length > 0
      && workingDir.trim().length > 0
      && selectedAgents.length > 0
    );
  }, [name, selectedAgents, workingDir]);

  const toggleAgent = (agentId: string) => {
    setError(null);
    setSelectedAgents((prev) => {
      if (prev.includes(agentId)) {
        return prev.filter((id) => id !== agentId);
      }

      return [...prev, agentId];
    });
  };

  const updateStage = (
    index: number,
    field: keyof StageEntry,
    value: string | number,
  ) => {
    setStages((prev) => {
      return prev.map((stage, stageIndex) => {
        if (stageIndex !== index) return stage;

        return { ...stage, [field]: value };
      });
    });
  };

  const addStage = () => {
    const fallbackColor = DEFAULT_PIPELINE_STAGES[stages.length % DEFAULT_PIPELINE_STAGES.length]?.color;
    setStages((prev) => {
      return [...prev, { color: fallbackColor ?? '#6B7280', maxParallel: prev.length + 1, name: '' }];
    });
  };

  const removeStage = (index: number) => {
    setStages((prev) => prev.filter((_, stageIndex) => stageIndex !== index));
  };

  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Pipeline name is required.');
      return;
    }

    if (selectedAgents.length === 0) {
      setError('Select at least one crew member.');
      return;
    }

    if (!workingDir.trim()) {
      setError('Working directory is required.');
      return;
    }

    const activeStages = stages.filter((stage) => stage.name.trim());

    const pipeline: Pipeline = {
      id: mkId(),
      name: name.trim(),
      status: 'queued',
      created: new Date().toISOString().slice(0, 16).replace('T', ' '),
      description: description.trim(),
      rules: rules.trim(),
      enabledAgents: selectedAgents,
      workingDir: workingDir.trim(),
      gitBranch: gitBranch.trim() || null,
      stages: activeStages.map((stage, index) => {
        return {
          id: mkId(),
          name: stage.name.trim(),
          sortOrder: index,
          color: stage.color,
          maxParallel: stage.maxParallel,
        };
      }),
      logs: [
        {
          id: Date.now(),
          time: new Date().toTimeString().slice(0, 8),
          type: 'info',
          msg: 'Pipeline initialized',
        },
      ],
      tasks: [],
      totalTokensUsed: 0,
      tokensByModel: {},
    };

    setSubmitting(true);
    try {
      await onCreate(pipeline);
    } catch {
      setError('Failed to create pipeline.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      className="max-h-[85vh]"
      description="Configure a new pipeline with crew members and stage layout."
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
      title="New Pipeline"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button disabled={!canSubmit || submitting} onClick={handleCreate} variant="primary">
            {submitting ? 'Creating...' : 'Create Pipeline'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <Card className="border-accent-red/35 bg-accent-red-bg">
            <CardBody className="py-2 text-xs text-accent-red">{error}</CardBody>
          </Card>
        )}

        <section aria-labelledby="pipeline-details" className="space-y-3">
          <h3 className="font-mono text-[11px] font-semibold tracking-[0.1em] text-text-secondary uppercase" id="pipeline-details">
            Pipeline Details
          </h3>
          <Input
            aria-label="Pipeline name"
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. SaaS Landing Page"
            value={name}
          />
          <Textarea
            aria-label="Pipeline description"
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Short goal and expected output for this pipeline"
            rows={3}
            value={description}
          />
          <Textarea
            aria-label="Pipeline rules"
            onChange={(event) => setRules(event.target.value)}
            placeholder="Coding rules, security constraints, delivery expectations"
            rows={3}
            value={rules}
          />
          <DirectoryPicker
            onChange={setWorkingDir}
            placeholder="Working directory"
            value={workingDir}
          />
          <Input
            aria-label="Default code line"
            onChange={(event) => setGitBranch(event.target.value)}
            placeholder="Default code line (optional, e.g. main)"
            value={gitBranch}
          />
          <p className="font-mono text-[10px] text-text-dim">
            Leave empty to auto-try
            <span className="text-text-secondary"> main </span>
            and then
            <span className="text-text-secondary"> master</span>.
          </p>
        </section>

        <section aria-labelledby="pipeline-agents" className="space-y-2">
          <h3 className="font-mono text-[11px] font-semibold tracking-[0.1em] text-text-secondary uppercase" id="pipeline-agents">
            Crew Members
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {agents.map((agent) => {
              const selected = selectedAgents.includes(agent.id);

              return (
                <button
                  aria-pressed={selected}
                  className={`rounded-md border px-3 py-2 text-left transition-colors ${
                    selected
                      ? 'border-accent-orange/45 bg-accent-orange-bg text-accent-orange'
                      : 'border-border-secondary bg-surface-2 text-text-secondary hover:border-border-hover'
                  }`}
                  key={agent.id}
                  onClick={() => toggleAgent(agent.id)}
                  type="button"
                >
                  <span className="font-mono text-xs">
                    {agent.name}{agent.title ? ` — ${agent.title}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
          {selectedAgents.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedAgents.map((agentId, index) => {
                const agent = agents.find((item) => item.id === agentId);
                return (
                  <Badge key={agentId} size="sm" tone="warning">
                    {index + 1}. {agent?.name ?? agentId}
                  </Badge>
                );
              })}
            </div>
          )}
        </section>

        <section aria-labelledby="pipeline-stages" className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-[11px] font-semibold tracking-[0.1em] text-text-secondary uppercase" id="pipeline-stages">
              Stages
            </h3>
            <Button onClick={addStage} size="sm" variant="secondary">
              + Add Stage
            </Button>
          </div>

          <div className="space-y-2">
            {stages.map((stage, index) => (
              <div className="flex items-center gap-2 rounded-md border border-border-secondary bg-surface-2 p-2" key={`${stage.name}-${index}`}>
                <span className="shrink-0 font-mono text-[11px] font-bold text-text-muted w-5 text-center">
                  {index + 1}
                </span>
                <input
                  aria-label={`Stage ${index + 1} color`}
                  className="h-8 w-8 cursor-pointer rounded border border-border-primary bg-transparent"
                  onChange={(event) => updateStage(index, 'color', event.target.value)}
                  type="color"
                  value={stage.color}
                />
                <Input
                  aria-label={`Stage ${index + 1} name`}
                  className="h-8"
                  onChange={(event) => updateStage(index, 'name', event.target.value)}
                  placeholder={`Stage ${index + 1}`}
                  value={stage.name}
                />
                <Input
                  aria-label={`Stage ${index + 1} max parallel`}
                  className="h-8 w-20"
                  min={0}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    updateStage(index, 'maxParallel', Number.isNaN(parsed) ? 0 : parsed);
                  }}
                  type="number"
                  value={String(stage.maxParallel)}
                />
                <Button
                  aria-label={`Remove stage ${index + 1}`}
                  onClick={() => removeStage(index)}
                  size="sm"
                  variant="ghost"
                >
                  x
                </Button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}
