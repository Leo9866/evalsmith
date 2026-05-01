import type { PaginatedData } from '@/types'

export function asItems<T>(value: PaginatedData<T> | T[] | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value
  }
  return Array.isArray(value?.items) ? value.items : []
}

export function asPaginated<T>(
  value: PaginatedData<T> | T[] | null | undefined,
  fallbackPage = 1,
  fallbackPageSize = 0
): PaginatedData<T> {
  const items = asItems(value)
  const total = Array.isArray(value) ? items.length : (value?.total ?? items.length)
  const page = Array.isArray(value) ? fallbackPage : (value?.page ?? fallbackPage)
  const pageSize = Array.isArray(value)
    ? (fallbackPageSize || items.length || 0)
    : (value?.page_size ?? fallbackPageSize)
  const totalPages =
    Array.isArray(value)
      ? (total === 0 || pageSize <= 0 ? 0 : Math.ceil(total / pageSize))
      : (value?.total_pages ?? (total === 0 || pageSize <= 0 ? 0 : Math.ceil(total / pageSize)))

  return {
    items,
    total,
    page,
    page_size: pageSize,
    total_pages: totalPages,
  }
}
