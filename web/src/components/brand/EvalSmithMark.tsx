import { cn } from '@/lib/utils'

interface EvalSmithMarkProps {
  className?: string
  imageClassName?: string
  variant?: 'light' | 'dark'
}

const markSources = {
  light: '/brand/evalsmith-icon-mark-light.png',
  dark: '/brand/evalsmith-icon-mark-dark.png',
}

export default function EvalSmithMark({
  className,
  imageClassName,
  variant = 'dark',
}: EvalSmithMarkProps) {
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[0.95rem]',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_16px_34px_rgba(15,23,42,0.16)]',
        className
      )}
      aria-hidden="true"
    >
      <img
        src={markSources[variant]}
        alt=""
        className={cn('h-full w-full object-cover', imageClassName)}
        draggable={false}
      />
    </span>
  )
}
