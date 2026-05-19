import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  children: ReactNode;
}

export function Field({ label, children }: FieldProps) {
  return (
    <div className="mb-4">
      <div className="mb-2 font-mono text-[10px] tracking-widest text-text-muted uppercase">
        {label}
      </div>
      {children}
    </div>
  );
}
