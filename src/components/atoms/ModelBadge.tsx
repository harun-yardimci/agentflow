import { useModels } from '@/context/ModelContext';

interface ModelBadgeProps {
  model: string;
}

export function ModelBadge({ model }: ModelBadgeProps) {
  const { getModel } = useModels();
  const m = getModel(model);

  if (!m) {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold whitespace-nowrap border border-border-secondary text-text-dim">
        {model}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold whitespace-nowrap border"
      style={{ background: m.bg, color: m.color, borderColor: `${m.color}40` }}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: m.color }}
      />
      {m.label}
    </span>
  );
}
