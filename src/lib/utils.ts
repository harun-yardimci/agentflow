import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function mkId(): string {
  return Math.random().toString(36).slice(2, 9);
}

export function now(): string {
  return new Date().toTimeString().slice(0, 8);
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

export function statusToTone(
  status: string,
): 'active' | 'error' | 'idle' | 'success' | 'warning' {
  if (status === 'running') return 'active';
  if (status === 'completed') return 'success';
  if (status === 'awaiting_approval' || status === 'paused') return 'warning';
  if (status === 'blocked' || status === 'failed' || status === 'rejected')
    return 'error';
  return 'idle';
}

export function formatStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'An unexpected error occurred. Please retry.';
}

export type StatusTone = ReturnType<typeof statusToTone>;
