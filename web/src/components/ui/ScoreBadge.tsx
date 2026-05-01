import { cn, getScoreTone } from '@/lib/utils'

interface ScoreBadgeProps {
  score: number
  className?: string
}

const toneClasses = {
  success: 'bg-[rgba(23,114,69,0.12)] text-[color:var(--color-success)]',
  warning: 'bg-[rgba(182,106,14,0.12)] text-[color:var(--color-warning)]',
  danger: 'bg-[rgba(186,63,54,0.12)] text-[color:var(--color-danger)]',
}

export default function ScoreBadge({ score, className }: ScoreBadgeProps) {
  const tone = getScoreTone(score)
  return (
    <span
      className={cn(
        'inline-flex min-w-16 items-center justify-center rounded-full px-2.5 py-1 font-mono text-xs font-semibold',
        toneClasses[tone],
        className
      )}
    >
      {score.toFixed(2)}
    </span>
  )
}
