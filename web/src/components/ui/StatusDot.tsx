import { cn, getStatusTone } from '@/lib/utils'

interface StatusDotProps {
  status: string
  className?: string
}

const toneClasses = {
  success: 'bg-[color:var(--color-success)]',
  warning: 'bg-[color:var(--color-warning)]',
  danger: 'bg-[color:var(--color-danger)]',
  neutral: 'bg-[color:rgba(93,83,73,0.45)]',
}

export default function StatusDot({ status, className }: StatusDotProps) {
  const tone = getStatusTone(status)
  return (
    <span
      className={cn(
        'inline-flex h-2.5 w-2.5 rounded-full shadow-[0_0_0_4px_rgba(255,255,255,0.38)]',
        toneClasses[tone],
        className
      )}
    />
  )
}
