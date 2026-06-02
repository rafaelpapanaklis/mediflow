export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getDentalLabContext } from "@/lib/lab-auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/format";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ClipboardList, Package } from "lucide-react";
import {
  DENTAL_LAB_ORDER_STATUS,
  type DentalLabOrderStatus,
  type DentalLabPaymentStatus,
} from "@/lib/laboratorios/types";

const PAYMENT_LABELS: Record<DentalLabPaymentStatus, string> = {
  UNPAID: "Sin pagar",
  PAID: "Pagado",
};
const PAYMENT_TONE: Record<DentalLabPaymentStatus, "warning" | "success"> = {
  UNPAID: "warning",
  PAID: "success",
};

const FILTERS: { value: DentalLabOrderStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "SOLICITADA", label: "Solicitadas" },
  { value: "RECIBIDA", label: "Recibidas" },
  { value: "ATENDIENDO", label: "Atendiendo" },
  { value: "ENVIADA", label: "Enviadas" },
  { value: "ENTREGADA", label: "Entregadas" },
  { value: "CANCELADA", label: "Canceladas" },
];

export default async function LabOrdersPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const ctx = await getDentalLabContext();
  if (!ctx) redirect("/laboratorios/login");

  const validValues = FILTERS.map((f) => f.value) as string[];
  const active = (
    searchParams.status && validValues.includes(searchParams.status) ? searchParams.status : "ALL"
  ) as DentalLabOrderStatus | "ALL";

  const orders = await prisma.dentalLabOrder.findMany({
    // Multi-tenant: solo los pedidos de este laboratorio.
    where: { labId: ctx.labId, ...(active !== "ALL" ? { status: active } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      clinic: { select: { name: true } },
      service: { select: { name: true } },
    },
  });

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
          <ClipboardList size={22} />
        </div>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Pedidos recibidos
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            Gestiona las órdenes que las clínicas te han enviado.
          </p>
        </div>
      </div>

      {/* Filtros por estado */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {FILTERS.map((f) => {
          const isActive = f.value === active;
          const href = f.value === "ALL" ? "/laboratorios/pedidos" : `/laboratorios/pedidos?status=${f.value}`;
          return (
            <Link
              key={f.value}
              href={href}
              className="tag-new"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                textDecoration: "none",
                cursor: "pointer",
                ...(isActive
                  ? {
                      background: "var(--brand-soft)",
                      color: "#c4b5fd",
                      borderColor: "var(--border-brand)",
                      fontWeight: 600,
                      boxShadow: "0 0 0 1px var(--border-brand), 0 4px 12px -6px rgba(124,58,237,0.5)",
                    }
                  : {}),
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  flexShrink: 0,
                  background: isActive ? "var(--violet-400)" : "var(--text-4)",
                  boxShadow: isActive ? "0 0 8px var(--violet-400)" : "none",
                }}
              />
              {f.label}
            </Link>
          );
        })}
      </div>

      <CardNew noPad>
        {orders.length === 0 ? (
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
              {active === "ALL" ? <Package size={26} /> : <ClipboardList size={26} />}
            </div>
            <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>
              {active === "ALL" ? "Aún no has recibido pedidos" : "Sin pedidos en este estado"}
            </div>
            <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0, maxWidth: 340, lineHeight: 1.5 }}>
              {active === "ALL"
                ? "Cuando una clínica te envíe una orden, aparecerá aquí lista para que la gestiones."
                : "No hay pedidos con este estado por ahora. Prueba con otro filtro para ver más órdenes."}
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
                {orders.map((o) => (
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
                    <td style={{ color: "var(--text-1)" }}>{o.clinic.name}</td>
                    <td style={{ color: "var(--text-2)" }}>{o.service?.name ?? "—"}</td>
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
