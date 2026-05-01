import { forwardRef, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: { value: string; label: string }[]
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, options, ...props }, ref) => (
    <div className="space-y-2">
      {label && (
        <label className="text-[0.74rem] font-semibold uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.7)]">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            'h-12 w-full appearance-none rounded-[1.05rem] border border-[color:var(--color-line)] bg-[linear-gradient(180deg,#fffdfa_0%,#f6efe6_100%)] px-4 pr-11 text-sm font-medium text-[color:var(--color-text)] shadow-[0_8px_16px_rgba(63,46,33,0.05)] outline-none transition-[transform,border-color,box-shadow] duration-200 hover:border-[color:var(--color-line-strong)] focus:border-[color:rgba(193,109,58,0.34)] focus:shadow-[0_0_0_3px_rgba(193,109,58,0.12)]',
            className
          )}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[color:rgba(93,83,73,0.72)]">
          <ChevronDown className="h-4 w-4" />
        </div>
      </div>
    </div>
  )
)

Select.displayName = 'Select'

export default Select
