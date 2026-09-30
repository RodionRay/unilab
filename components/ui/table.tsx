"use client"

import * as React from "react"
import { ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"
import type { SortDirection } from "@/lib/table-sort"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function SortableTableHead({
  columnKey,
  sortKey,
  sortDir,
  onSort,
  className,
  children,
  ...props
}: React.ComponentProps<"th"> & {
  columnKey: string
  sortKey: string | null
  sortDir: SortDirection
  onSort: (key: string) => void
}) {
  const active = sortKey === columnKey
  return (
    <TableHead className={cn("table-sort-th", className)} {...props}>
      <button
        type="button"
        className={cn(
          "table-sort-btn",
          active && "is-active",
          typeof className === "string" &&
            className.includes("text-right") &&
            "w-full justify-end"
        )}
        onClick={() => onSort(columnKey)}
        aria-sort={
          active ? (sortDir === "asc" ? "ascending" : "descending") : "none"
        }
      >
        <span>{children}</span>
        <span className="table-sort-carets" aria-hidden>
          <ChevronUp
            size={12}
            className={cn(
              "table-sort-caret",
              active && sortDir === "asc" && "is-on"
            )}
          />
          <ChevronDown
            size={12}
            className={cn(
              "table-sort-caret",
              active && sortDir === "desc" && "is-on"
            )}
          />
        </span>
      </button>
    </TableHead>
  )
}

/** Clickable sort control for non-`<th>` list headers (groups, leads). */
function SortHeaderButton({
  columnKey,
  sortKey,
  sortDir,
  onSort,
  className,
  children,
}: {
  columnKey: string
  sortKey: string | null
  sortDir: SortDirection
  onSort: (key: string) => void
  className?: string
  children: React.ReactNode
}) {
  const active = sortKey === columnKey
  return (
    <button
      type="button"
      className={cn("table-sort-btn table-sort-btn--plain", active && "is-active", className)}
      onClick={() => onSort(columnKey)}
      aria-sort={
        active ? (sortDir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <span>{children}</span>
      <span className="table-sort-carets" aria-hidden>
        <ChevronUp
          size={12}
          className={cn(
            "table-sort-caret",
            active && sortDir === "asc" && "is-on"
          )}
        />
        <ChevronDown
          size={12}
          className={cn(
            "table-sort-caret",
            active && sortDir === "desc" && "is-on"
          )}
        />
      </span>
    </button>
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  SortableTableHead,
  SortHeaderButton,
}
