export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { DollarSign, ClipboardList, Wrench, ArrowRight } from "lucide-react";
import { getDentalLabContext } from "@/lib/lab-auth";
import { getDentalLabDashboardData } from "@/lib/laboratorios/dashboard";
import { formatCurrency } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/format";
import { CardNew } from "@/components/ui/design-system/card-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import {
  DENTAL_LAB_ORDER_STATUS,
  type DentalLabOrderStatus,
  type DentalLabPaymentStatus,
} from "@/lib/laboratorios/types";

// Etiquetas/tonos de pago: no viven en el contrato, se definen aquí (inline).
const PAYMENT_LABELS: Record<DentalLabPaymentStatus, string> = {
  UNPAID: "Sin pagar",
  PAID: "Pagado",
};
const PAYMENT_TONE: Record<DentalLabPaymentStatus, "warning" | "success"> = {
  UNPAID: "warning",
  PAID: "success",
};

const STATUS_ORDER: DentalLabOrderStatus[] = [
  "SOLICITADA",
  "RECIBIDA",
  "ATENDIENDO",
  "ENVIADA",
  "ENTREGADA",
  "CANCELADA",
];

export default async function LabHomePage() {
  const ctx = await getDentalLabContext();
  if (!ctx) redirect("/laboratorios/login");

  const data = await getDentalLabDashboardData(ctx.labId);

  const growth =
    data.salesPrevMonth > 0
      ? Math.round(((data.salesThisMonth - data.salesPrevMonth) / data.salesPrevMonth) * 100)
      : null;

  const fechaStr = new Date().toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          Hola, {ctx.lab.name}
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0, textTransform: "capitalize" }}>
          {fechaStr}
        </p>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
        <KpiCard
          label="Ventas del mes"
          value={formatCurrency(data.salesThisMonth)}
          icon={DollarSign}
          delta={
            growth !== null
              ? { value: `${Math.abs(growth)}% vs mes anterior`, direction: growth >= 0 ? "up" : "down" }
              : undefined
          }
        />
        <KpiCard label="Pedidos por atender" value={String(data.pendingOrders)} icon={ClipboardList} />
        <KpiCard label="Servicios activos" value={String(data.activeServices)} icon={Wrench} />
      </div>

      {/* Pedidos por estatus */}
      <CardNew
        title="Pedidos por estatus"
        sub={`${data.totalOrders} pedido${data.totalOrders === 1 ? "" : "s"} en total`}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STATUS_ORDER.map((s) => (
            <BadgeNew key={s} tone={DENTAL_LAB_ORDER_STATUS[s].tone} dot>
              {DENTAL_LAB_ORDER_STATUS[s].label}: {data.statusCounts[s]}
            </BadgeNew>
          ))}
        </div>
      </CardNew>

      {/* Pedidos recientes */}
      <CardNew
        noPad
        title="Pedidos recientes"
        action={
          <Link href="/laboratorios/pedidos" style={{ textDecoration: "none" }}>
            <ButtonNew size="sm" variant="ghost" icon={<ArrowRight size={14} />}>
              Ver todos
            </ButtonNew>
          </Link>
        }
      >
        {data.recentOrders.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            Aún no has recibido pedidos.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table-new">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Clínica</th>
                  <th>Servicio</th>
                  <th>Total</th>
                  <th>Estado</th>
                  <th>Pago</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {data.recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link
                        href={`/laboratorios/pedidos/${o.id}`}
                        className="mono"
                        style={{ color: "var(--text-1)", fontWeight: 500, textDecoration: "none" }}
                      >
                        {o.orderNumber}
                      </Link>
                    </td>
                    <td style={{ color: "var(--text-1)" }}>{o.clinicName}</td>
                    <td style={{ color: "var(--text-2)" }}>{o.serviceName ?? "—"}</td>
                    <td className="mono" style={{ color: "var(--text-1)", fontWeight: 500 }}>
                      {formatCurrency(o.total)}
                    </td>
                    <td>
                      <BadgeNew tone={DENTAL_LAB_ORDER_STATUS[o.status].tone} dot>
                        {DENTAL_LAB_ORDER_STATUS[o.status].label}
                      </BadgeNew>
                    </td>
                    <td>
                      <BadgeNew tone={PAYMENT_TONE[o.paymentStatus]}>
                        {PAYMENT_LABELS[o.paymentStatus]}
                      </BadgeNew>
                    </td>
                    <td className="mono" style={{ color: "var(--text-3)" }}>
                      {formatRelativeDate(o.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardNew>
    </div>
  );
}
