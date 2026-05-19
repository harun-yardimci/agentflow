import { useEffect, useRef } from 'react';
import { useModels } from '@/context/ModelContext';
import { cn } from '@/lib/utils';

interface ModelSelectorProps {
  className?: string;
  disabled?: boolean;
  onChange: (model: string) => void;
  size?: 'sm' | 'md';
  value: string;
}

export function ModelSelector({
  className,
  disabled = false,
  onChange,
  size = 'md',
  value,
}: ModelSelectorProps) {
  const { providers, models, getProviderModels, getProviderKey, getModel } = useModels();

  const activeProviderId = getProviderKey(value);

  // Stable ref for onChange to avoid infinite effect loops from inline callbacks
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Auto-normalize: if value is a provider-only key (e.g. "claude") that doesn't
  // match any model id, auto-select the first sub-model of that provider.
  useEffect(() => {
    if (!value || models.length === 0) return;
    if (getModel(value)) return; // value already matches a valid model
    const subModels = getProviderModels(activeProviderId);
    if (subModels.length > 0) {
      onChangeRef.current(subModels[0]!.id);
    }
  }, [value, models, activeProviderId, getModel, getProviderModels]);

  const handleProviderChange = (providerId: string) => {
    if (disabled) return;
    // When switching provider, pick its first sub-model
    const subModels = getProviderModels(providerId);
    if (subModels.length > 0) {
      onChange(subModels[0]!.id);
    }
  };

  const handleSubModelChange = (modelId: string) => {
    if (disabled) return;
    onChange(modelId);
  };

  const isSmall = size === 'sm';
  const subModels = getProviderModels(activeProviderId);

  return (
    <div className={cn('space-y-1.5', className)}>
      {/* Provider tabs */}
      <div className="flex gap-1">
        {providers.map((provider) => {
          const isActive = activeProviderId === provider.id;

          return (
            <button
              key={provider.id}
              type="button"
              disabled={disabled}
              onClick={() => handleProviderChange(provider.id)}
              className={cn(
                'rounded-md border font-mono font-semibold transition-all',
                isSmall ? 'px-2 py-0.5 text-[9px]' : 'px-3 py-1 text-[10px]',
                isActive
                  ? 'border-current'
                  : 'border-border-secondary text-text-dim hover:border-border-hover',
                disabled && 'pointer-events-none opacity-50',
              )}
              style={isActive ? { color: provider.color, backgroundColor: provider.bg } : undefined}
            >
              {provider.label}
            </button>
          );
        })}
      </div>

      {/* Sub-model chips */}
      <div className="flex flex-wrap gap-1">
        {subModels.map((model) => {
          const isActive = value === model.id;
          const provider = providers.find((p) => p.id === activeProviderId);
          // Strip provider prefix for chip display (e.g. "Claude Sonnet" -> "Sonnet")
          const providerLabel = provider?.label ?? '';
          const shortLabel = model.label.replace(providerLabel + ' ', '');

          return (
            <button
              key={model.id}
              type="button"
              disabled={disabled}
              onClick={() => handleSubModelChange(model.id)}
              className={cn(
                'rounded border font-mono transition-all',
                isSmall ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-0.5 text-[9px]',
                isActive
                  ? 'border-current font-semibold'
                  : 'border-border-secondary text-text-dim hover:border-border-hover',
                disabled && 'pointer-events-none opacity-50',
              )}
              style={isActive ? { color: model.color, backgroundColor: model.bg } : undefined}
            >
              {shortLabel}
              {!isSmall && (
                <span className="ml-1 opacity-50">
                  ${model.costPer1k}/1k
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
