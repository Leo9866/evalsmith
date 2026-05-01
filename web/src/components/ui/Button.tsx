import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'brand'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
}

const variantClasses = {
  primary:
    'border border-[rgba(150,75,36,0.22)] bg-[linear-gradient(180deg,#cb7a49_0%,#bc6734_100%)] text-white shadow-[0_10px_20px_rgba(150,75,36,0.16)] hover:-translate-y-px hover:border-[rgba(150,75,36,0.3)] hover:shadow-[0_14px_28px_rgba(150,75,36,0.18)] active:translate-y-0 active:scale-[0.985]',
  secondary:
    'border border-[color:var(--color-line)] bg-[linear-gradient(180deg,#fffdfa_0%,#f6efe6_100%)] text-[color:var(--color-text)] shadow-[0_8px_16px_rgba(63,46,33,0.06)] hover:-translate-y-px hover:border-[color:var(--color-line-strong)] hover:shadow-[0_12px_22px_rgba(63,46,33,0.09)] active:translate-y-0 active:scale-[0.985]',
  ghost:
    'border border-transparent bg-transparent text-[color:var(--color-text-soft)] hover:border-[rgba(36,31,26,0.08)] hover:bg-[rgba(36,31,26,0.04)] hover:text-[color:var(--color-text)] active:scale-[0.985]',
  danger:
    'border border-[color:rgba(186,63,54,0.18)] bg-[linear-gradient(180deg,rgba(186,63,54,0.11)_0%,rgba(186,63,54,0.06)_100%)] text-[color:var(--color-danger)] hover:-translate-y-px hover:border-[color:rgba(186,63,54,0.3)] hover:bg-[rgba(186,63,54,0.12)] active:translate-y-0 active:scale-[0.985]',
  brand:
    'border border-[rgba(29,115,232,0.14)] bg-[linear-gradient(180deg,#2b7ef0_0%,#1d73e8_100%)] text-white shadow-[0_18px_36px_rgba(29,115,232,0.22)] hover:-translate-y-px hover:border-[rgba(29,115,232,0.22)] hover:shadow-[0_22px_40px_rgba(29,115,232,0.26)] active:translate-y-0 active:scale-[0.985]',
}

const sizeClasses = {
  sm: 'h-9 rounded-[0.95rem] px-3.5 text-sm',
  md: 'h-11 rounded-[1.05rem] px-4.5 text-sm',
  lg: 'h-12 rounded-[1.1rem] px-5 text-sm',
}

const focusRingClasses = {
  primary: 'focus-visible:ring-[rgba(193,109,58,0.14)]',
  secondary: 'focus-visible:ring-[rgba(193,109,58,0.14)]',
  ghost: 'focus-visible:ring-[rgba(193,109,58,0.14)]',
  danger: 'focus-visible:ring-[rgba(186,63,54,0.16)]',
  brand: 'focus-visible:ring-[rgba(29,115,232,0.18)]',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading = false,
      icon,
      disabled,
      children,
      ...props
    },
    ref
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold tracking-[-0.01em] transition-[transform,border-color,background-color,box-shadow,color] duration-200 focus-visible:outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-55 disabled:shadow-none',
        focusRingClasses[variant],
        sizeClasses[size],
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  )
)

Button.displayName = 'Button'

export default Button
