import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-[24px] border border-dashed border-[color:var(--color-line-strong)] bg-[color:var(--color-panel)] px-6 py-14 text-center',
        className
      )}
    >
      <div className="mb-4 rounded-2xl bg-[rgba(186,91,42,0.08)] p-4 text-[color:var(--color-accent-strong)]">
        {icon}
      </div>
      <h3 className="text-lg font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">{title}</h3>
      {description && <p className="mt-2 max-w-md text-sm leading-7 text-[color:var(--color-text-soft)]">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
