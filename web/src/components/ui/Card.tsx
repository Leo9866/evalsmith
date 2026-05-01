import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface CardProps {
  children: ReactNode
  className?: string
  header?: ReactNode
  hover?: boolean
  onClick?: () => void
  style?: CSSProperties
}

export default function Card({ children, className, header, hover = false, onClick, style }: CardProps) {
  return (
    <section
      onClick={onClick}
      style={style}
      className={cn(
        'overflow-hidden rounded-[24px] border border-[color:var(--color-line)] bg-[color:var(--color-panel)] transition-colors',
        hover &&
          'duration-200 hover:border-[color:var(--color-line-strong)] hover:bg-[color:var(--color-panel-strong)]',
        onClick && 'cursor-pointer',
        className
      )}
    >
      {header && (
        <div className="border-b border-[color:var(--color-line)] px-5 py-4 text-sm font-semibold text-[color:var(--color-text)]">
          {header}
        </div>
      )}
      {children}
    </section>
  )
}
