import { cn } from '@/lib/utils'
import EvalSmithMark from './EvalSmithMark'

interface BrandMarkProps {
  className?: string
  markClassName?: string
  logoClassName?: string
  subtitleClassName?: string
  compact?: boolean
  subtitle?: string
  variant?: 'light' | 'dark'
}

export default function BrandMark({
  className,
  markClassName,
  logoClassName,
  subtitleClassName,
  compact = false,
  subtitle = 'Agent evaluation platform',
  variant = 'light',
}: BrandMarkProps) {
  const logoSrc =
    variant === 'dark'
      ? '/brand/evalsmith-logo-horizontal-dark.png'
      : '/brand/evalsmith-logo-horizontal-light.png'

  if (compact) {
    return (
      <div className={cn('inline-flex items-center gap-3', className)}>
        <EvalSmithMark className={cn('h-14 w-14 rounded-[1.25rem]', markClassName)} variant="dark" />
      </div>
    )
  }

  return (
    <div className={cn('inline-flex min-w-0 flex-col items-start', className)}>
      <img
        src={logoSrc}
        alt="EvalSmith"
        className={cn('h-14 w-auto max-w-[18rem] object-contain', logoClassName)}
        draggable={false}
      />
      {subtitle && (
        <p
          className={cn(
            'mt-2 text-sm text-[color:rgba(16,36,59,0.7)]',
            subtitleClassName
          )}
        >
          {subtitle}
        </p>
      )}
    </div>
  )
}
