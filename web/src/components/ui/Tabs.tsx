import { cn } from '@/lib/utils'

interface Tab {
  key: string
  label: string
  count?: number
}

interface TabsProps {
  tabs: Tab[]
  active: string
  onChange: (key: string) => void
  className?: string
}

export default function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <div
      className={cn(
        'inline-flex flex-wrap gap-2 rounded-[1.2rem] border border-[color:var(--color-line)] bg-[color:var(--color-panel)] p-1.5',
        className
      )}
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={cn(
            'inline-flex items-center gap-2 rounded-[0.95rem] border px-4 py-2 text-sm font-medium transition-colors',
            active === tab.key
              ? 'border-[color:rgba(193,109,58,0.18)] bg-[rgba(193,109,58,0.11)] text-[color:var(--color-accent-strong)]'
              : 'border-transparent text-[color:var(--color-text-soft)] hover:border-[color:var(--color-line)] hover:bg-[color:var(--color-panel-strong)] hover:text-[color:var(--color-text)]'
          )}
        >
          <span>{tab.label}</span>
          {tab.count !== undefined && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[0.7rem] font-semibold',
                active === tab.key
                  ? 'bg-white/80 text-[color:var(--color-accent-strong)]'
                  : 'bg-[rgba(36,31,26,0.05)] text-[color:var(--color-text-soft)]'
              )}
            >
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
