export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  DollarSign,
  ClipboardList,
  Package,
  ArrowRight,
  LayoutDashboard,
  ChevronRight,
} from "lucide-react";
import { getSupplierContext } from "@/lib/supplier-auth";
import { getSupplierDashboardData } from "@/lib/suppliers/dashboard";
import { formatCurrency } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/format";
import { CardNew } from "@/components/ui/design-system/card-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import {
  SUPPLIER_ORDER_STATUS_LABELS,
  SUPPLIER_PAYMENT_STATUS_LABELS,
} from "@/lib/suppliers/types";
import { ORDER_STATUS_TONE, PAYMENT_STATUS_TONE } from "@/lib/suppliers/orders-shared";

export default async function SupplierHomePage() {
  const ctx = await getSupplierContext();
  if (!ctx) redirect("/proveedores/login");

  const data = await getSupplierDashboardData(ctx.supplierId);

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
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14 }}>
        {/* Glow violeta de fondo del hero */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -40,
            left: -30,
            width: 280,
            height: 180,
            pointerEvents: "none",
            background:
              "radial-gradient(60% 70% at 20% 30%, rgba(124,58,237,0.18), transparent 70%)",
          }}
        />
        <div
          style={{
            position: "relative",
            width: 44,
            height: 44,
            borderRadius: 14,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            color: "#fff",
            background: "var(--brand-grad)",
            boxShadow: "0 8px 20px -8px rgba(124,58,237,0.6)",
          }}
        >
          <LayoutDashboard size={22} />
        </div>
        <div style={{ position: "relative" }}>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Hola, {ctx.supplier.businessName}
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0, textTransform: "capitalize" }}>
            {fechaStr}
          </p>
        </div>
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
        <KpiCard label="Pedidos pendientes" value={String(data.pendingOrders)} icon={ClipboardList} />
        <KpiCard label="Productos activos" value={String(data.activeProducts)} icon={Package} />
      </div>

      {/* Pedidos recientes */}
      <CardNew
        noPad
        title="Pedidos recientes"
        sub={`${data.totalOrders} pedido${data.totalOrders === 1 ? "" : "s"} en total`}
        action={
          <Link href="/proveedores/pedidos" style={{ textDecoration: "none" }}>
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
                color: "var(--brand)",
              }}
            >
              <Package size={26} />
            </div>
            <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>
              Aún no has recibido pedidos
            </div>
            <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0, maxWidth: 340, lineHeight: 1.5 }}>
              Cuando una clínica te envíe una solicitud de compra, aparecerá aquí para que la atiendas.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table-new">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Clínica</th>
                  <th>Artículos</th>
                  <th>Total</th>
                  <th>Estado</th>
                  <th>Pago</th>
                  <th>Fecha</th>
                  <th aria-label="Abrir" />
                </tr>
              </thead>
              <tbody>
                {data.recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link
                        href={`/proveedores/pedidos/${o.id}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          textDecoration: "none",
                        }}
                      >
                        <span
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 9,
                            flexShrink: 0,
                            display: "grid",
                            placeItems: "center",
                            background: "var(--brand-soft)",
                            border: "1px solid var(--border-brand)",
                            color: "var(--brand)",
                          }}
                        >
                          <Package size={15} />
                        </span>
                        <span className="mono" style={{ color: "var(--text-1)", fontWeight: 500 }}>
                          {o.orderNumber}
                        </span>
                      </Link>
                    </td>
                    <td style={{ color: "var(--text-1)" }}>{o.clinicName}</td>
                    <td className="mono" style={{ color: "var(--text-2)" }}>{o.itemCount}</td>
                    <td className="mono" style={{ color: "var(--text-1)", fontWeight: 500 }}>
                      {formatCurrency(o.total)}
                    </td>
                    <td>
                      <BadgeNew tone={ORDER_STATUS_TONE[o.status]} dot>
                        {SUPPLIER_ORDER_STATUS_LABELS[o.status]}
                      </BadgeNew>
                    </td>
                    <td>
                      <BadgeNew tone={PAYMENT_STATUS_TONE[o.paymentStatus]}>
                        {SUPPLIER_PAYMENT_STATUS_LABELS[o.paymentStatus]}
                      </BadgeNew>
                    </td>
                    <td className="mono" style={{ color: "var(--text-3)" }}>
                      {formatRelativeDate(o.createdAt)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link
                        href={`/proveedores/pedidos/${o.id}`}
                        aria-label={`Abrir pedido ${o.orderNumber}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          color: "var(--text-4)",
                          textDecoration: "none",
                        }}
                      >
                        <ChevronRight size={16} />
                      </Link>
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
