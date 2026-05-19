import * as React from 'react';

import { cn } from '../../lib/utils';

export interface ToggleSwitchProps {
  checked: boolean;
  disabled?: boolean;
  label?: string;
  onChange: () => void;
}

export function ToggleSwitch({
  checked,
  disabled,
  label,
  onChange,
}: ToggleSwitchProps): React.JSX.Element {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/50',
        checked
          ? 'border-accent-orange bg-accent-orange/30'
          : 'border-border-secondary bg-surface-2',
        disabled && 'cursor-not-allowed opacity-50',
      )}
      disabled={disabled}
      onClick={onChange}
      role="switch"
      type="button"
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-5 w-5 rounded-full shadow-md ring-0 transition-transform duration-200 ease-in-out',
          checked
            ? 'translate-x-[22px] bg-accent-orange'
            : 'translate-x-[2px] bg-text-muted',
        )}
      />
    </button>
  );
}
