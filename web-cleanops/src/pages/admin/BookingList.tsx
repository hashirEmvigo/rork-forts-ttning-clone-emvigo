import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck2, Database, Search } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApp } from "@/context/AppContext";
import { listBookingLedgerEntriesFromSupabase } from "@/lib/data";
import { formatDate, formatTimeRange } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BookingLedgerEntry } from "@/types";

function statusLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function StatusPill({ value, tone }: { value: string; tone: "green" | "blue" | "slate" | "amber" }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "whitespace-nowrap border text-[11px]",
        tone === "green" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "blue" && "border-sky-200 bg-sky-50 text-sky-700",
        tone === "amber" && "border-amber-200 bg-amber-50 text-amber-700",
        tone === "slate" && "border-slate-200 bg-slate-50 text-slate-700",
      )}
    >
      {statusLabel(value)}
    </Badge>
  );
}

function matchesQuery(booking: BookingLedgerEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    booking.bookingId,
    booking.bookingSeriesId,
    booking.customerId,
    booking.workOrderId,
    booking.serviceRowId,
    booking.bookingDate,
  ].some((value) => value.toLowerCase().includes(needle));
}

/** Read-only Booking List backed by the generated booking ledger. */
export default function BookingList() {
  const { currentUser } = useApp();
  const [query, setQuery] = useState<string>("");
  const companyScope = currentUser?.role === "super_admin" ? undefined : currentUser?.companyId ?? null;

  const ledgerQuery = useQuery({
    queryKey: ["bookingLedger", companyScope ?? "all"],
    queryFn: () => listBookingLedgerEntriesFromSupabase(companyScope),
  });

  const bookings = useMemo<BookingLedgerEntry[]>(() => {
    return (ledgerQuery.data ?? []).filter((booking) => matchesQuery(booking, query));
  }, [ledgerQuery.data, query]);

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Booking List"
        description="Generated actual booking jobs from AO / WorkOrder service rows. This page reads the new booking ledger, not the legacy Booking Queue snapshots."
      />

      <div className="mb-4 grid gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm md:grid-cols-[1fr_auto] md:items-center">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search booking, series, customer, AO, service row…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Database className="h-4 w-4" />
          <span>{bookings.length} generated booking{bookings.length === 1 ? "" : "s"}</span>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Booking</TableHead>
              <TableHead>Series</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>AO</TableHead>
              <TableHead>Service row</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Planning</TableHead>
              <TableHead>Execution</TableHead>
              <TableHead>Billing</TableHead>
              <TableHead>Payroll</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledgerQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={12} className="h-32 text-center text-muted-foreground">
                  Loading generated bookings…
                </TableCell>
              </TableRow>
            ) : ledgerQuery.isError ? (
              <TableRow>
                <TableCell colSpan={12} className="h-32 text-center text-destructive">
                  Unable to load generated bookings from Supabase.
                </TableCell>
              </TableRow>
            ) : bookings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12}>
                  <div className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground">
                    <CalendarCheck2 className="h-9 w-9 opacity-40" />
                    <p className="text-sm font-medium text-foreground">No generated bookings found</p>
                    <p className="max-w-md text-sm">
                      Add a demo/test service row to an AO / WorkOrder to generate Booking List ledger rows.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              bookings.map((booking) => (
                <TableRow key={booking.bookingId}>
                  <TableCell className="font-mono text-xs font-medium">{booking.bookingId}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{booking.bookingSeriesId}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(booking.bookingDate)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatTimeRange(booking.plannedStartTime, booking.plannedEndTime) ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{booking.customerId}</TableCell>
                  <TableCell className="font-mono text-xs">{booking.workOrderId}</TableCell>
                  <TableCell className="font-mono text-xs">{booking.serviceRowId}</TableCell>
                  <TableCell><StatusPill value={booking.bookingStatus} tone="green" /></TableCell>
                  <TableCell><StatusPill value={booking.planningStatus} tone="amber" /></TableCell>
                  <TableCell><StatusPill value={booking.executionStatus} tone="slate" /></TableCell>
                  <TableCell><StatusPill value={booking.billingStatus} tone="blue" /></TableCell>
                  <TableCell><StatusPill value={booking.payrollStatus} tone="blue" /></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </DashboardLayout>
  );
}
