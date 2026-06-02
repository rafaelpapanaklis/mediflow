export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  DollarSign,
  ClipboardList,
  Wrench,
  ArrowRight,
  LayoutDashboard,
  Gauge,
  Layers,
  Package,
} from "lucide-react";
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
import { TrafficControl } from "./traffic-control";

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

  const canEditTraffic =
    ctx.status === "APPROVED" && (ctx.role === "OWNER" || ctx.role === "MANAGER");
  const trafficUpdatedLabel = ctx.lab.trafficUpdatedAt
    ? new Date(ctx.lab.trafficUpdatedAt).toLocaleString("es-MX", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            color: "#fff",
            background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
            boxShadow: "0 8px 20px -8px rgba(124,58,237,0.6)",
          }}
        >
          <LayoutDashboard size={22} />
        </div>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Hola, {ctx.lab.name}
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0, textTransform: "capitalize" }}>
            {fechaStr}
          </p>
        </div>
      </div>

      {/* Control de tráfico del día */}
      <CardNew>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "linear-gradient(90deg, var(--violet-400), var(--brand))",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "linear-gradient(135deg, var(--lab-map-from), var(--lab-map-to))",
              border: "1px solid var(--border-brand)",
              color: "var(--violet-400)",
            }}
          >
            <Gauge size={18} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", letterSpacing: "-0.01em" }}>
              Nivel de tráfico hoy
            </div>
            <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>
              Ajusta el tiempo estimado de entrega que ven las clínicas.
            </div>
          </div>
        </div>
        <TrafficControl
          canEdit={canEditTraffic}
          initialLevel={ctx.lab.trafficLevel}
          initialManualMin={ctx.lab.trafficManualMin}
          initialManualMax={ctx.lab.trafficManualMax}
          initialNote={ctx.lab.trafficNote ?? ""}
          updatedAtLabel={trafficUpdatedLabel}
        />
      </CardNew>

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
      <CardNew>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "var(--brand-soft)",
              border: "1px solid var(--border-brand)",
              color: "var(--violet-400)",
            }}
          >
            <Layers size={18} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", letterSpacing: "-0.01em" }}>
              Pedidos por estatus
            </div>
            <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>
              {`${data.totalOrders} pedido${data.totalOrders === 1 ? "" : "s"} en total`}
            </div>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            gap: 10,
          }}
        >
          {STATUS_ORDER.map((s) => (
            <div
              key={s}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "12px 14px",
                borderRadius: "var(--radius)",
                background: "var(--bg-elev-2)",
                border: "1px solid var(--border-soft)",
              }}
            >
              <BadgeNew tone={DENTAL_LAB_ORDER_STATUS[s].tone} dot>
                {DENTAL_LAB_ORDER_STATUS[s].label}
              </BadgeNew>
              <span style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)", letterSpacing: "-0.02em" }}>
                {data.statusCounts[s]}
              </span>
            </div>
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
          <div
            style={{
              padding: "48px 24px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                display: "grid",
                placeItems: "center",
                background: "var(--brand-soft)",
                border: "1px solid var(--border-brand)",
                color: "var(--violet-400)",
              }}
            >
              <Package size={26} />
            </div>
            <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>
              Aún no has recibido pedidos
            </div>
            <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0, maxWidth: 340, lineHeight: 1.5 }}>
              Cuando una clínica te envíe una solicitud, aparecerá aquí para que la atiendas.
            </p>
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
