import * as React from 'react';

import { cn } from '../../lib/utils';

interface TabsContextValue {
  setValue: (nextValue: string) => void;
  value: string;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext(componentName: string): TabsContextValue {
  const context = React.useContext(TabsContext);

  if (!context) {
    throw new Error(`${componentName} must be used within <Tabs>.`);
  }

  return context;
}

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  value?: string;
}

export function Tabs({
  children,
  className,
  defaultValue = '',
  onValueChange,
  value: controlledValue,
  ...props
}: TabsProps): React.JSX.Element {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue);
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : uncontrolledValue;

  const setValue = React.useCallback(
    (nextValue: string) => {
      if (!isControlled) {
        setUncontrolledValue(nextValue);
      }
      onValueChange?.(nextValue);
    },
    [isControlled, onValueChange],
  );

  const contextValue = React.useMemo(
    () => ({
      setValue,
      value,
    }),
    [setValue, value],
  );

  return (
    <TabsContext.Provider value={contextValue}>
      <div className={cn('w-full', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps extends React.HTMLAttributes<HTMLDivElement> {}

export function TabsList({ className, ...props }: TabsListProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md border border-border-primary bg-surface-1 p-1',
        className,
      )}
      role="tablist"
      {...props}
    />
  );
}

export interface TabsTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export function TabsTrigger({
  children,
  className,
  value,
  ...props
}: TabsTriggerProps): React.JSX.Element {
  const { setValue, value: currentValue } = useTabsContext('TabsTrigger');
  const isActive = currentValue === value;

  return (
    <button
      aria-selected={isActive}
      className={cn(
        'rounded px-3 py-1.5 font-mono text-[11px] transition-colors',
        isActive
          ? 'bg-surface-3 text-text-primary'
          : 'text-text-secondary hover:text-text-primary',
        className,
      )}
      onClick={() => setValue(value)}
      role="tab"
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  forceMount?: boolean;
  value: string;
}

export function TabsContent({
  children,
  className,
  forceMount = false,
  value,
  ...props
}: TabsContentProps): React.JSX.Element | null {
  const { value: currentValue } = useTabsContext('TabsContent');
  const isActive = currentValue === value;

  if (!isActive && !forceMount) {
    return null;
  }

  return (
    <div
      className={cn(!isActive && 'hidden', className)}
      data-state={isActive ? 'active' : 'inactive'}
      role="tabpanel"
      {...props}
    >
      {children}
    </div>
  );
}
