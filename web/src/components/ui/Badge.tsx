import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info'
  children: ReactNode
  className?: string
}

const variantClasses = {
  default: 'bg-[rgba(33,28,24,0.06)] text-[color:var(--color-text-soft)]',
  success: 'bg-[rgba(23,114,69,0.1)] text-[color:var(--color-success)]',
  warning: 'bg-[rgba(182,106,14,0.11)] text-[color:var(--color-warning)]',
  danger: 'bg-[rgba(186,63,54,0.11)] text-[color:var(--color-danger)]',
  info: 'bg-[rgba(186,91,42,0.11)] text-[color:var(--color-accent-strong)]',
}

export default function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.18em]',
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
