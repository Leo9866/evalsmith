export type SearchParamValue = string | number | boolean | null | undefined

export function applySearchParamPatch(
  current: URLSearchParams,
  updates: Record<string, SearchParamValue>,
  options?: { resetPage?: boolean; resetPageKeys?: string[] }
) {
  const next = new URLSearchParams(current)

  if (options?.resetPage) {
    next.delete('page')
  }
  options?.resetPageKeys?.forEach((key) => next.delete(key))

  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      next.delete(key)
      return
    }
    next.set(key, String(value))
  })

  return next
}

export function readPositiveIntParam(value: string | null, fallback = 1) {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
