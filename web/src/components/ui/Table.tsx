import type { ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Column<T> {
  key: string
  header: string
  sortable?: boolean
  className?: string
  render?: (item: T) => ReactNode
}

interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  sortKey?: string
  sortDir?: 'asc' | 'desc'
  onSort?: (key: string) => void
  onRowClick?: (item: T) => void
  loading?: boolean
  emptyMessage?: string
}

export default function Table<T>({
  columns,
  data,
  sortKey,
  sortDir,
  onSort,
  onRowClick,
  loading = false,
  emptyMessage = '暂无结果',
}: TableProps<T>) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-[color:var(--color-line)] bg-[color:var(--color-panel)]">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-[rgba(36,31,26,0.03)]">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={cn(
                    'px-5 py-4 text-left text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.72)]',
                    column.sortable && 'cursor-pointer select-none hover:text-[color:var(--color-text)]',
                    column.className
                  )}
                  onClick={() => column.sortable && onSort?.(column.key)}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {column.header}
                    {column.sortable && sortKey === column.key ? (
                      sortDir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
                    ) : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 5 }).map((_, rowIndex) => (
                <tr key={`loading-${rowIndex}`} className="border-t border-[color:var(--color-line)]">
                  {columns.map((column) => (
                    <td key={column.key} className="px-5 py-4">
                      <div className="h-4 animate-pulse rounded-full bg-[rgba(93,83,73,0.1)]" />
                    </td>
                  ))}
                </tr>
              ))}

            {!loading && data.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-5 py-16 text-center text-sm text-[color:var(--color-text-soft)]"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}

            {!loading &&
              data.map((item, index) => (
                <tr
                  key={index}
                  onClick={(event) => {
                    const target = event.target as HTMLElement | null
                    if (target?.closest('button, a, input, select, textarea, label, [role="button"], [data-interactive="true"]')) {
                      return
                    }
                    onRowClick?.(item)
                  }}
                  className={cn(
                    'border-t border-[color:var(--color-line)] transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-[rgba(36,31,26,0.03)]'
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn('px-5 py-4 align-top text-sm text-[color:var(--color-text)]', column.className)}
                    >
                      {column.render ? column.render(item) : ''}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
