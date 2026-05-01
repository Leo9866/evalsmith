import Button from '@/components/ui/Button'

interface PaginationProps {
  page: number
  totalPages: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  className?: string
}

export default function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  className = '',
}: PaginationProps) {
  if (total <= 0 || totalPages <= 1) {
    return null
  }

  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  return (
    <div className={`flex flex-col gap-3 rounded-[1.25rem] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${className}`.trim()}>
      <p className="text-sm text-[color:var(--color-text-soft)]">
        第 {start}-{end} 条，共 {total} 条
      </p>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          上一页
        </Button>
        <span className="min-w-[5.5rem] text-center text-sm font-medium text-[color:var(--color-text)]">
          {page} / {totalPages}
        </span>
        <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          下一页
        </Button>
      </div>
    </div>
  )
}
