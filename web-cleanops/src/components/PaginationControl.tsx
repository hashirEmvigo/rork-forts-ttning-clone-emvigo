import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DEFAULT_PAGE_SIZE_OPTIONS } from "@/hooks/use-pagination";

export interface PaginationControlProps {
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  /** 0-based index of the first item on the current page. */
  startIndex: number;
  /** Exclusive end index of the current page window. */
  endIndex: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  /** Selectable page sizes. Defaults to the standard [20,40,60,80,100]. */
  pageSizeOptions?: readonly number[];
  /** Noun shown in the summary, e.g. "customers". Defaults to "items". */
  itemLabel?: string;
}

/**
 * Reusable list pagination footer: a "showing X–Y of N" summary, a page-size
 * selector and prev/next controls. Pairs with {@link usePagination} and is
 * shared across every paginated list so the UX stays consistent.
 */
export function PaginationControl({
  page,
  pageSize,
  totalPages,
  totalItems,
  startIndex,
  endIndex,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  itemLabel = "items",
}: PaginationControlProps) {
  const from = totalItems === 0 ? 0 : startIndex + 1;
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <p className="text-sm text-muted-foreground">
          {totalItems === 0
            ? `No ${itemLabel}`
            : `Showing ${from}–${endIndex} of ${totalItems} ${itemLabel}`}
        </p>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Rows</span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => onPageSizeChange(Number(v))}
          >
            <SelectTrigger className="h-8 w-[72px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onPageChange(page - 1)}
          disabled={!canPrev}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onPageChange(page + 1)}
          disabled={!canNext}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
