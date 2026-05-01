import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string | number
  className?: string
}

export default function StatCard({ label, value, className }: StatCardProps) {
  return (
    <div
      className={cn(
        'rounded-[20px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] p-4',
        className
      )}
    >
      <p className="text-[0.7rem] uppercase tracking-[0.22em] text-[color:rgba(93,83,73,0.66)]">{label}</p>
      <p className="mt-2 font-mono text-xl font-semibold text-[color:var(--color-text)]">{value}</p>
    </div>
  )
}
