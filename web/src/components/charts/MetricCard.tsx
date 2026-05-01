import type { ReactNode } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MetricCardProps {
  label: string
  value: string
  change?: number
  changeLabel?: string
  icon?: ReactNode
}

export default function MetricCard({ label, value, change, changeLabel, icon }: MetricCardProps) {
  const positive = change !== undefined && change >= 0

  return (
    <div className="overflow-hidden rounded-[24px] border border-[color:var(--color-line)] bg-[color:var(--color-panel)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">{label}</p>
          <p className="mt-3 text-3xl font-bold tracking-[-0.05em] text-[color:var(--color-text)]">{value}</p>
        </div>
        {icon && (
          <div className="rounded-[1rem] border border-[color:rgba(193,109,58,0.14)] bg-[rgba(193,109,58,0.08)] p-3 text-[color:var(--color-accent-strong)]">
            {icon}
          </div>
        )}
      </div>
      {change !== undefined && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          {positive ? (
            <TrendingUp className="h-4 w-4 text-[color:var(--color-success)]" />
          ) : (
            <TrendingDown className="h-4 w-4 text-[color:var(--color-danger)]" />
          )}
          <span
            className={cn(
              'font-medium',
              positive ? 'text-[color:var(--color-success)]' : 'text-[color:var(--color-danger)]'
            )}
          >
            {positive ? '+' : ''}
            {change.toFixed(1)}%
          </span>
          {changeLabel && <span className="text-[color:var(--color-text-soft)]">{changeLabel}</span>}
        </div>
      )}
    </div>
  )
}
