import { forwardRef, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string | null
  icon?: ReactNode
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, icon, ...props }, ref) => (
    <div className="space-y-2">
      {label && (
        <label className="text-[0.74rem] font-semibold uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.7)]">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && <div className="absolute left-4 top-4 text-[color:rgba(93,83,73,0.68)]">{icon}</div>}
        <textarea
          ref={ref}
          className={cn(
            'min-h-[9rem] w-full rounded-[1rem] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-3 text-sm text-[color:var(--color-text)] outline-none transition',
            'placeholder:text-[color:rgba(93,83,73,0.55)] focus:border-[color:rgba(193,109,58,0.34)] focus:bg-[color:var(--color-panel-strong)] focus:shadow-[0_0_0_3px_rgba(193,109,58,0.12)]',
            icon && 'pl-11',
            error && 'border-[color:rgba(186,63,54,0.4)] focus:shadow-[0_0_0_3px_rgba(186,63,54,0.12)]',
            className
          )}
          {...props}
        />
      </div>
      {error && <p className="text-sm text-[color:var(--color-danger)]">{error}</p>}
    </div>
  )
)

Textarea.displayName = 'Textarea'

export default Textarea
