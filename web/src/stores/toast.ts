import { create } from 'zustand'

export type ToastVariant = 'info' | 'success' | 'error'

export interface ToastItem {
  id: string
  title?: string
  message: string
  variant: ToastVariant
}

interface ToastState {
  items: ToastItem[]
  push: (toast: Omit<ToastItem, 'id'>, durationMs?: number) => string
  dismiss: (id: string) => void
}

const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
  info: 3600,
  success: 3200,
  error: 5200,
}

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (toast, durationMs) => {
    const id = resolveToastId()
    set((state) => ({ items: [...state.items, { ...toast, id }] }))

    const timeout = durationMs ?? DEFAULT_DURATIONS[toast.variant]
    if (timeout > 0 && typeof window !== 'undefined') {
      window.setTimeout(() => {
        useToastStore.getState().dismiss(id)
      }, timeout)
    }

    return id
  },
  dismiss: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
}))

function showToast(variant: ToastVariant, message: string, title?: string) {
  return useToastStore.getState().push({ variant, message, title })
}

function resolveToastId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `toast_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export const toast = {
  info: (message: string, title?: string) => showToast('info', message, title),
  success: (message: string, title?: string) => showToast('success', message, title),
  error: (message: string, title?: string) => showToast('error', message, title),
}
