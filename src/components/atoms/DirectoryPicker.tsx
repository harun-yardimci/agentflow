import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import * as api from '@/lib/api';
import type { DirEntry } from '@/lib/api';
import { Button, Input } from '@/components/ui';

interface DirectoryPickerProps {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
}

export function DirectoryPicker({ value, onChange, placeholder = '/path/to/project' }: DirectoryPickerProps) {
  const [showBrowser, setShowBrowser] = useState(false);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [currentDir, setCurrentDir] = useState('');
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [valid, setValid] = useState<boolean | null>(null);
  const [validating, setValidating] = useState(false);
  const validateTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close browser on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowBrowser(false);
      }
    }
    if (showBrowser) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [showBrowser]);

  // Debounced validation
  useEffect(() => {
    if (validateTimer.current) clearTimeout(validateTimer.current);
    if (!value.trim()) {
      setValid(null);
      return;
    }
    setValidating(true);
    validateTimer.current = setTimeout(async () => {
      try {
        const result = await api.validateDirectory(value);
        setValid(result.valid);
      } catch {
        setValid(false);
      } finally {
        setValidating(false);
      }
    }, 500);
    return () => {
      if (validateTimer.current) clearTimeout(validateTimer.current);
    };
  }, [value]);

  const browse = useCallback(async (dir?: string) => {
    setLoading(true);
    try {
      const result = await api.browseDirectory(dir);
      setEntries(result.entries);
      setCurrentDir(result.current);
      setParentDir(result.parent);
    } catch {
      // ignore browse errors
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpenBrowser = useCallback(() => {
    setShowBrowser(true);
    browse(value.trim() || undefined);
  }, [browse, value]);

  const handleSelect = useCallback((path: string) => {
    onChange(path);
    setShowBrowser(false);
  }, [onChange]);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="pr-7"
          />
          {/* Validation indicator */}
          {value.trim() && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2">
              {validating ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-text-dim border-t-transparent" />
              ) : valid === true ? (
                <span className="text-accent-green text-xs">{'\u2713'}</span>
              ) : valid === false ? (
                <span className="text-accent-red text-xs">{'\u2717'}</span>
              ) : null}
            </span>
          )}
        </div>
        <Button
          type="button"
          onClick={handleOpenBrowser}
          variant="secondary"
          size="md"
          className="shrink-0"
        >
          Browse
        </Button>
      </div>

      {/* Directory browser dropdown */}
      {showBrowser && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded border border-border-secondary bg-surface-1 shadow-lg">
          {/* Current path */}
          <div className="sticky top-0 flex items-center gap-2 border-b border-border-primary bg-surface-1 px-3 py-2">
            <span className="flex-1 truncate font-mono text-[10px] text-text-dim">
              {currentDir}
            </span>
            <button
              type="button"
              onClick={() => handleSelect(currentDir)}
              className="shrink-0 rounded bg-accent-orange px-2 py-0.5 font-mono text-[9px] font-semibold text-black transition-opacity hover:opacity-80"
            >
              Select
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-6">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent-orange border-t-transparent" />
            </div>
          ) : (
            <div>
              {/* Parent directory */}
              {parentDir && (
                <button
                  type="button"
                  onClick={() => browse(parentDir)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] text-text-secondary transition-colors hover:bg-surface-2"
                >
                  <span className="text-text-dim">{'\u2190'}</span>
                  <span className="text-text-dim">..</span>
                </button>
              )}

              {/* Directory entries */}
              {entries.length === 0 ? (
                <div className="px-3 py-3 text-center font-mono text-[10px] text-text-dim">
                  No subdirectories
                </div>
              ) : (
                entries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => browse(entry.path)}
                    onDoubleClick={() => handleSelect(entry.path)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] transition-colors hover:bg-surface-2',
                      'text-text-secondary',
                    )}
                  >
                    <span className="text-accent-orange">{'\ud83d\udcc1'}</span>
                    <span className="truncate">{entry.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
