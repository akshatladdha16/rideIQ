"use client";

import { useMemo, useState } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate, formatDistance, formatDuration } from "@/lib/format";
import type { InvoiceRecord } from "@/lib/types";

interface InvoiceTableProps {
  invoices: InvoiceRecord[];
  paymentModes: string[];
  filters: {
    month: string;
    payment: string;
    query: string;
  };
  onFiltersChange: (filters: { month: string; payment: string; query: string }) => void;
  onSelectInvoice: (invoice: InvoiceRecord) => void;
}

function SortableHeader({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button variant="ghost" className="-ml-2" onClick={onClick}>
      {label}
      <ArrowUpDown className="ml-1 size-3" />
    </Button>
  );
}

export function InvoiceTable({
  invoices,
  paymentModes,
  filters,
  onFiltersChange,
  onSelectInvoice,
}: InvoiceTableProps): JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo<ColumnDef<InvoiceRecord>[]>(
    () => [
      {
        accessorKey: "ride_date",
        header: ({ column }) => (
          <SortableHeader label="Date" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")} />
        ),
        cell: ({ row }) => formatDate(row.original.ride_date),
      },
      {
        accessorKey: "ride_time",
        header: "Time",
        cell: ({ row }) => row.original.ride_time ?? "--",
      },
      {
        id: "route",
        header: "From -> To",
        cell: ({ row }) => `${row.original.pickup_area ?? "--"} -> ${row.original.dropoff_area ?? "--"}`,
      },
      {
        accessorKey: "distance_km",
        header: ({ column }) => (
          <SortableHeader
            label="Distance"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => formatDistance(row.original.distance_km),
      },
      {
        accessorKey: "duration_mins",
        header: "Duration",
        cell: ({ row }) => formatDuration(row.original.duration_mins),
      },
      {
        accessorKey: "total_fare",
        header: ({ column }) => (
          <SortableHeader label="Fare" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")} />
        ),
        cell: ({ row }) => formatCurrency(row.original.total_fare),
      },
      {
        accessorKey: "payment_mode",
        header: "Payment",
        cell: ({ row }) => row.original.payment_mode ?? "--",
      },
      {
        accessorKey: "captain_name",
        header: "Captain",
        cell: ({ row }) => row.original.captain_name ?? "--",
      },
    ],
    []
  );

  const table = useReactTable({
    data: invoices,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Input
          placeholder="Search by area"
          value={filters.query}
          onChange={(event) =>
            onFiltersChange({
              ...filters,
              query: event.target.value,
            })
          }
        />

        <Input
          type="month"
          value={filters.month}
          onChange={(event) =>
            onFiltersChange({
              ...filters,
              month: event.target.value,
            })
          }
        />

        <Select
          value={filters.payment}
          onValueChange={(value) =>
            onFiltersChange({
              ...filters,
              payment: value ?? "all",
            })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Payment mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payment modes</SelectItem>
            {paymentModes.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {mode}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => onSelectInvoice(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No invoices found for current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
