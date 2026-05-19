import { cn } from '@/lib/utils';
import type { Attachment } from '@/types';
import { AttachmentChip } from './AttachmentChip';

interface AttachmentListProps {
  attachments: Attachment[];
  onDelete?: (id: string) => void;
  className?: string;
}

export function AttachmentList({ attachments, onDelete, className }: AttachmentListProps) {
  if (attachments.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {attachments.map((att) => (
        <AttachmentChip
          key={att.id}
          attachment={att}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
