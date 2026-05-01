import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { useToastStore, type ToastItem } from '@/stores/toast'

const TOAST_STYLES: Record<ToastItem['variant'], { icon: typeof Info; className: string }> = {
  info: {
    icon: Info,
    className: 'border-[rgba(47,105,166,0.16)] bg-[rgba(244,248,252,0.96)] text-[color:var(--color-text)]',
  },
  success: {
    icon: CheckCircle2,
    className: 'border-[rgba(23,114,69,0.18)] bg-[rgba(241,249,244,0.96)] text-[color:var(--color-text)]',
  },
  error: {
    icon: TriangleAlert,
    className: 'border-[rgba(186,63,54,0.18)] bg-[rgba(253,245,244,0.98)] text-[color:var(--color-text)]',
  },
}

export default function ToastViewport() {
  const items = useToastStore((state) => state.items)
  const dismiss = useToastStore((state) => state.dismiss)

  if (items.length === 0) {
    return null
  }

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3" aria-live="polite">
      {items.map((item) => {
        const style = TOAST_STYLES[item.variant]
        const Icon = style.icon

        return (
          <div
            key={item.id}
            className={`pointer-events-auto animate-rise-in rounded-[1.2rem] border px-4 py-3 shadow-[0_18px_48px_rgba(58,43,32,0.12)] backdrop-blur ${style.className}`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-[rgba(255,255,255,0.72)] p-1.5">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                {item.title ? <p className="text-sm font-semibold">{item.title}</p> : null}
                <p className={`text-sm leading-6 ${item.title ? 'mt-1' : ''}`}>{item.message}</p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="rounded-full p-1 text-[color:var(--color-text-soft)] transition hover:bg-[rgba(36,31,26,0.06)] hover:text-[color:var(--color-text)]"
                aria-label="关闭提示"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
