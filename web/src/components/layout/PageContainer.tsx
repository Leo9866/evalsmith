import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageContainerProps {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}

export default function PageContainer({
  title,
  description,
  actions,
  children,
  className,
}: PageContainerProps) {
  return (
    <section className={cn('animate-rise-in space-y-6', className)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <p className="text-[0.74rem] uppercase tracking-[0.34em] text-[color:rgba(93,83,73,0.65)]">
            EvalSmith
          </p>
          <div>
            <h1 className="text-3xl font-bold tracking-[-0.04em] text-[color:var(--color-text)] sm:text-[2.6rem]">
              {title}
            </h1>
            {description && (
              <p className="mt-2 max-w-3xl text-sm leading-7 text-[color:var(--color-text-soft)] sm:text-[0.98rem]">
                {description}
              </p>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
      {children}
    </section>
  )
}
