import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'max-w-lg',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
}

export default function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return undefined
    const previousBodyOverflow = document.body.style.overflow
    const previousHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)

    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousHtmlOverflow
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[140] overflow-y-auto px-4 py-6 sm:px-6 sm:py-8"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="fixed inset-0 bg-[rgba(36,31,26,0.18)] backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative flex min-h-full items-center justify-center">
        <div
          className={cn(
            'animate-wash-in relative z-10 my-auto flex w-full max-h-[calc(100dvh-3rem)] flex-col overflow-hidden rounded-[24px] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] shadow-[0_24px_60px_rgba(48,35,25,0.14)] sm:max-h-[calc(100dvh-4rem)]',
            sizeClasses[size]
          )}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--color-line)] px-6 py-5">
            <div>
              <p className="text-[0.68rem] uppercase tracking-[0.3em] text-[color:rgba(93,83,73,0.58)]">工作区操作</p>
              <h3 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-text)]">{title}</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-[color:var(--color-line)] p-2 text-[color:var(--color-text-soft)] transition hover:border-[color:var(--color-line-strong)] hover:text-[color:var(--color-text)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="shrink-0 border-t border-[color:var(--color-line)] px-6 py-4">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body
  )
}
