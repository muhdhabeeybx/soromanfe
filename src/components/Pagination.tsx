import { Button } from '#/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '#/components/ui/select'

interface PaginationProps {
  currentPage: number
  totalPages: number
  pageSize: number
  totalItems: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  pageSizeOptions?: number[]
}

export function Pagination({
  currentPage,
  totalPages,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  // Whole-book first: these lists are worked through, not browsed, and
  // clicking ten pages to find one row was the complaint. 1000 matches the
  // server's own per-request ceiling (schemas/fields.js).
  pageSizeOptions = [100, 250, 500, 1000],
}: PaginationProps) {
  const startItem = totalItems > 0 ? (currentPage - 1) * pageSize + 1 : 0
  const endItem = Math.min(currentPage * pageSize, totalItems)

  return (
    <div className="mt-4 flex flex-col items-center justify-between gap-4 border-t border-border pt-4 sm:flex-row">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Rows per page:</span>
        <Select
          value={pageSize.toString()}
          onValueChange={(val) => {
            onPageSizeChange(Number(val))
          }}
        >
          <SelectTrigger size="sm" className="w-[70px]">
            <SelectValue placeholder={pageSize.toString()} />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((size) => (
              <SelectItem key={size} value={size.toString()}>{size}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="ml-4 text-xs text-muted-foreground">
          Showing {startItem} to {endItem} of {totalItems} entries
        </p>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(Math.max(currentPage - 1, 1))}
          >
            Previous
          </Button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
            .map((p, idx, arr) => {
              const showEllipsis = idx > 0 && p - arr[idx - 1] > 1
              return (
                <div key={p} className="flex items-center">
                  {showEllipsis && <span className="px-2 text-xs text-muted-foreground">…</span>}
                  <Button
                    variant={currentPage === p ? 'default' : 'outline'}
                    size="icon-sm"
                   
                    onClick={() => onPageChange(p)}
                    aria-current={currentPage === p ? 'page' : undefined}
                  >
                    {p}
                  </Button>
                </div>
              )
            })}
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(Math.min(currentPage + 1, totalPages))}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
