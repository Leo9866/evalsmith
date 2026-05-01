import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string | null
  icon?: ReactNode
  containerClassName?: string
  labelClassName?: string
  iconClassName?: string
  errorClassName?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      label,
      error,
      icon,
      containerClassName,
      labelClassName,
      iconClassName,
      errorClassName,
      ...props
    },
    ref
  ) => (
    <div className={cn('space-y-2', containerClassName)}>
      {label && (
        <label
          className={cn(
            'text-[0.74rem] font-semibold uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.7)]',
            labelClassName
          )}
        >
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div
            className={cn(
              'absolute left-4 top-1/2 -translate-y-1/2 text-[color:rgba(93,83,73,0.68)]',
              iconClassName
            )}
          >
            {icon}
          </div>
        )}
        <input
          ref={ref}
          className={cn(
            'h-12 w-full rounded-[1rem] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 text-sm text-[color:var(--color-text)] outline-none transition',
            'placeholder:text-[color:rgba(93,83,73,0.55)] focus:border-[color:rgba(193,109,58,0.34)] focus:bg-[color:var(--color-panel-strong)] focus:shadow-[0_0_0_3px_rgba(193,109,58,0.12)]',
            icon && 'pl-11',
            error && 'border-[color:rgba(186,63,54,0.4)] focus:shadow-[0_0_0_3px_rgba(186,63,54,0.12)]',
            className
          )}
          {...props}
        />
      </div>
      {error && <p className={cn('text-sm text-[color:var(--color-danger)]', errorClassName)}>{error}</p>}
    </div>
  )
)

Input.displayName = 'Input'

export default Input
