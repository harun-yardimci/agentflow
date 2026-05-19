interface ChipProps {
  label: string;
  value: string;
}

export function Chip({ label, value }: ChipProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border-primary bg-surface-2 px-3 py-2">
      <span className="font-mono text-[10px] text-text-muted">{label}</span>
      <span className="font-mono text-xs font-semibold text-text-primary">{value}</span>
    </div>
  );
}
