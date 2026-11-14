"use client";

import { useMemo, useState } from "react";
import { RiExternalLinkLine, RiLinkedinFill, RiThreadsFill, RiTwitterXFill } from "@remixicon/react";
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { Chip, type ChipColor } from "@/components/base/badges/chip";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@/components/base/table/table";
import { ChevronSortDown } from "@/components/foundations/icons/chevrons";
import { CHANNELS, type PostRow } from "@/lib/ui-types";
import { cx } from "@/utils/cx";

const CHANNEL_ICON = { linkedin: RiLinkedinFill, x: RiTwitterXFill, threads: RiThreadsFill } as const;
const STATUS: Record<PostRow["status"], { label: string; color: ChipColor }> = {
  sent: { label: "Sent", color: "lime" },
  queued: { label: "Queued", color: "cyan" },
  error: { label: "Failed", color: "rose" },
};

type Filter = "all" | PostRow["status"];

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

const columns: ColumnDef<PostRow>[] = [
  {
    id: "post",
    header: "Post",
    accessorKey: "excerpt",
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex min-w-0 flex-col gap-0.5 py-1">
        <span className="line-clamp-2 text-body-medium text-text-primary">{row.original.excerpt}</span>
        <span className="text-caption-1-regular text-text-tertiary">{row.original.project}</span>
      </div>
    ),
  },
  {
    id: "channel",
    header: "Channel",
    accessorKey: "channel",
    cell: ({ row }) => {
      const Icon = CHANNEL_ICON[row.original.channel];
      return (
        <span className="flex items-center gap-1.5 text-body-medium text-text-secondary">
          <Icon className="size-4" aria-hidden /> {CHANNELS[row.original.channel].label}
        </span>
      );
    },
  },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    cell: ({ row }) => <Chip color={STATUS[row.original.status].color}>{STATUS[row.original.status].label}</Chip>,
  },
  {
    id: "at",
    header: "When (UTC)",
    accessorKey: "at",
    cell: ({ row }) => <span className="whitespace-nowrap text-body-medium text-text-secondary tabular-nums">{fmt(row.original.at)}</span>,
  },
  {
    id: "sources",
    header: "Source",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="flex flex-wrap gap-1">
        {row.original.sources.map((s) => (
          <a key={s.ref} href={s.url} target="_blank" rel="noreferrer" className="font-code rounded-md bg-background-tertiary-default px-1.5 py-0.5 text-caption-1-medium text-text-secondary hover:text-text-primary">
            {s.ref}
          </a>
        ))}
      </span>
    ),
  },
  {
    id: "buffer",
    header: "",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.bufferUrl ? (
        <a href={row.original.bufferUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-body-2-medium text-accent-600 hover:underline">
          {row.original.bufferUrl.includes("buffer.com") ? "Buffer" : "View post"} <RiExternalLinkLine className="size-3.5" aria-hidden />
        </a>
      ) : null,
  },
];

export function TimelineTable({ rows }: { rows: PostRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "at", desc: true }]);
  const data = useMemo(() => (filter === "all" ? rows : rows.filter((r) => r.status === filter)), [rows, filter]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <section className="flex flex-col rounded-3xl border border-border-table bg-background-primary-default pt-2">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
        <p className="text-body-medium text-text-secondary">
          <span className="text-text-primary">{data.length}</span> posts
        </p>
        <SegmentedControl
          aria-label="Filter by status"
          selectedKeys={new Set([filter])}
          onSelectionChange={(keys) => {
            const next = [...keys][0];
            if (next) setFilter(next as Filter);
          }}
        >
          <SegmentedControlItem id="all">All</SegmentedControlItem>
          <SegmentedControlItem id="sent">Sent</SegmentedControlItem>
          <SegmentedControlItem id="queued">Queued</SegmentedControlItem>
          <SegmentedControlItem id="error">Failed</SegmentedControlItem>
        </SegmentedControl>
      </div>
      <Table aria-label="Posts" size="md" className="min-w-[860px]">
        <TableHeader>
          {table.getHeaderGroups()[0].headers.map((header) => (
            <TableColumn key={header.id} id={header.id} isRowHeader={header.id === "post"} className={header.id === "post" ? "w-[38%]" : undefined}>
              {header.column.getCanSort() ? (
                <button type="button" onClick={header.column.getToggleSortingHandler()} className="flex cursor-pointer items-center gap-0.5">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  <ChevronSortDown className={cx("size-4 transition-transform", header.column.getIsSorted() === "asc" && "rotate-180", !header.column.getIsSorted() && "opacity-40")} />
                </button>
              ) : (
                flexRender(header.column.columnDef.header, header.getContext())
              )}
            </TableColumn>
          ))}
        </TableHeader>
        <TableBody renderEmptyState={() => <div className="flex h-32 items-center justify-center text-body-medium text-text-tertiary">Nothing here yet.</div>}>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} id={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
