export interface RapidoInvoiceData {
  ride_id: string | null;
  invoice_no: string | null;
  ride_date: string | null;
  ride_time: string | null;
  pickup: string | null;
  dropoff: string | null;
  pickup_area: string | null;
  dropoff_area: string | null;
  distance_km: number | null;
  duration_mins: number | null;
  ride_charge: number | null;
  booking_fee: number | null;
  convenience_charges: number | null;
  total_fare: number | null;
  cgst_ride: number | null;
  sgst_ride: number | null;
  cgst_platform: number | null;
  sgst_platform: number | null;
  payment_mode: string | null;
  captain_name: string | null;
  vehicle_number: string | null;
  customer_name: string | null;
  raw_markdown: string;
}

export interface InvoiceRecord extends RapidoInvoiceData {
  id: string;
  uploaded_at: string;
  file_name: string | null;
}

export interface InvoiceChunkMatch {
  id: string;
  invoice_id: string;
  chunk_text: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
}

export interface DashboardStats {
  totalSpend: number;
  totalRides: number;
  avgFare: number;
  totalGstPaid: number;
}
