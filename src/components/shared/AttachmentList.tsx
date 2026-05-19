import type { Attachment } from '@/types';
import { cn } from '@/lib/utils';
import { AttachmentChip } from './AttachmentChip';

interface AttachmentListProps {
  attachments: Attachment[];
  onDelete?: (id: string) => void;
  direction?: 'horizontal' | 'vertical';
  compact?: boolean;
}

export function AttachmentList({
  attachments,
  onDelete,
  direction = 'horizontal',
  compact = false,
}: AttachmentListProps) {
  if (attachments.length === 0) return null;

  return (
    <div
      className={cn(
        'flex gap-1.5',
        direction === 'horizontal' ? 'flex-wrap' : 'flex-col items-start',
      )}
    >
      {attachments.map((attachment) => (
        <AttachmentChip
          key={attachment.id}
          attachment={attachment}
          onDelete={onDelete}
          compact={compact}
        />
      ))}
    </div>
  );
}
