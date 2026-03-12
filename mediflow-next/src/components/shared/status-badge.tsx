import { Badge } from "@/components/ui/badge";
import type { AppointmentStatus, InvoiceStatus } from "@/types";

/* ── Appointment status ── */
const appointmentMap: Record<AppointmentStatus, {
  label: string;
  variant: "confirmed" | "pending" | "progress" | "cancelled" | "secondary";
}> = {
  confirmed:   { label: "Confirmada",  variant: "confirmed" },
  pending:     { label: "Pendiente",   variant: "pending"   },
  in_progress: { label: "En curso",    variant: "progress"  },
  completed:   { label: "Completada",  variant: "confirmed" },
  cancelled:   { label: "Cancelada",   variant: "cancelled" },
  no_show:     { label: "No-show",     variant: "cancelled" },
};

export function AppointmentBadge({ status }: { status: AppointmentStatus }) {
  const { label, variant } = appointmentMap[status];
  return <Badge variant={variant}>{label}</Badge>;
}

/* ── Invoice status ── */
const invoiceMap: Record<InvoiceStatus, {
  label: string;
  variant: "paid" | "partial" | "unpaid" | "cancelled";
}> = {
  paid:    { label: "Pagada",    variant: "paid"    },
  pending: { label: "Pendiente", variant: "unpaid"  },
  partial: { label: "Parcial",   variant: "partial" },
  overdue: { label: "Vencida",   variant: "cancelled"},
};

export function InvoiceBadge({ status }: { status: InvoiceStatus }) {
  const { label, variant } = invoiceMap[status];
  return <Badge variant={variant}>{label}</Badge>;
}
