export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getDentalLabContext } from "@/lib/lab-auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/format";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
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
      <div>
        <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          Pedidos recibidos
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
          Gestiona las órdenes que las clínicas te han enviado.
        </p>
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
                textDecoration: "none",
                cursor: "pointer",
                ...(isActive
                  ? {
                      background: "var(--brand-soft)",
                      color: "#c4b5fd",
                      borderColor: "rgba(124,58,237,0.4)",
                    }
                  : {}),
              }}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <CardNew noPad>
        {orders.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            {active === "ALL"
              ? "Aún no has recibido pedidos."
              : "No hay pedidos con este estado."}
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
