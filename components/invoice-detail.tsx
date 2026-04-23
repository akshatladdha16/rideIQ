"use client";

import Link from "next/link";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate, formatDistance, formatDuration } from "@/lib/format";
import type { InvoiceRecord } from "@/lib/types";

interface InvoiceDetailProps {
  invoice: InvoiceRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

export function InvoiceDetail({
  invoice,
  open,
  onOpenChange,
}: InvoiceDetailProps): JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-xl">
        {invoice ? (
          <>
            <SheetHeader className="border-b">
              <div className="flex items-center gap-2">
                <SheetTitle>Ride Invoice Detail</SheetTitle>
                {invoice.payment_mode && <Badge variant="outline">{invoice.payment_mode}</Badge>}
              </div>
              <SheetDescription>
                Ride ID: {invoice.ride_id ?? "--"} | Invoice: {invoice.invoice_no ?? "--"}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4 p-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date" value={formatDate(invoice.ride_date)} />
                <Field label="Time" value={invoice.ride_time ?? "--"} />
                <Field label="Distance" value={formatDistance(invoice.distance_km)} />
                <Field label="Duration" value={formatDuration(invoice.duration_mins)} />
              </div>

              <Field
                label="Route"
                value={`${invoice.pickup_area ?? "--"} to ${invoice.dropoff_area ?? "--"}`}
              />
              <Field label="Pickup Address" value={invoice.pickup ?? "--"} />
              <Field label="Dropoff Address" value={invoice.dropoff ?? "--"} />

              <div className="grid grid-cols-2 gap-3">
                <Field label="Total Fare" value={formatCurrency(invoice.total_fare)} />
                <Field label="Ride Charge" value={formatCurrency(invoice.ride_charge)} />
                <Field label="Booking Fee" value={formatCurrency(invoice.booking_fee)} />
                <Field
                  label="Convenience Charges"
                  value={formatCurrency(invoice.convenience_charges)}
                />
                <Field label="CGST (Ride)" value={formatCurrency(invoice.cgst_ride)} />
                <Field label="SGST (Ride)" value={formatCurrency(invoice.sgst_ride)} />
                <Field label="CGST (Platform)" value={formatCurrency(invoice.cgst_platform)} />
                <Field label="SGST (Platform)" value={formatCurrency(invoice.sgst_platform)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Captain" value={invoice.captain_name ?? "--"} />
                <Field label="Vehicle" value={invoice.vehicle_number ?? "--"} />
                <Field label="Customer" value={invoice.customer_name ?? "--"} />
                <Field label="File" value={invoice.file_name ?? "--"} />
              </div>

              <Link
                href={`/chat?ride_id=${encodeURIComponent(invoice.ride_id ?? "")}`}
                className={cn(buttonVariants(), "w-full")}
              >
                Ask AI about this ride
              </Link>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
