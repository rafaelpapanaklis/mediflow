export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupplierContext } from "@/lib/supplier-auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/format";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import {
  SUPPLIER_ORDER_STATUS_LABELS,
  SUPPLIER_PAYMENT_STATUS_LABELS,
} from "@/lib/suppliers/types";
import type { SupplierOrderStatus } from "@/lib/suppliers/types";
import { ORDER_STATUS_TONE, PAYMENT_STATUS_TONE } from "@/lib/suppliers/orders-shared";

const FILTERS: { value: SupplierOrderStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "PENDING", label: "Pendientes" },
  { value: "CONFIRMED", label: "Confirmados" },
  { value: "SHIPPED", label: "Enviados" },
  { value: "DELIVERED", label: "Entregados" },
  { value: "CANCELLED", label: "Cancelados" },
];

export default async function SupplierOrdersPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const ctx = await getSupplierContext();
  if (!ctx) redirect("/proveedores/login");

  const validValues = FILTERS.map((f) => f.value) as string[];
  const active = (
    searchParams.status && validValues.includes(searchParams.status) ? searchParams.status : "ALL"
  ) as SupplierOrderStatus | "ALL";

  const orders = await prisma.supplierOrder.findMany({
    // Multi-tenant: solo los pedidos de este proveedor.
    where: { supplierId: ctx.supplierId, ...(active !== "ALL" ? { status: active } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      clinic: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          Pedidos recibidos
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
          Gestiona los pedidos que las clínicas te han enviado.
        </p>
      </div>

      {/* Filtros por estado */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {FILTERS.map((f) => {
          const isActive = f.value === active;
          const href = f.value === "ALL" ? "/proveedores/pedidos" : `/proveedores/pedidos?status=${f.value}`;
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
                  <th>Artículos</th>
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
                        href={`/proveedores/pedidos/${o.id}`}
                        className="mono"
                        style={{ color: "var(--text-1)", fontWeight: 500, textDecoration: "none" }}
                      >
                        {o.orderNumber}
                      </Link>
                    </td>
                    <td style={{ color: "var(--text-1)" }}>{o.clinic.name}</td>
                    <td className="mono" style={{ color: "var(--text-2)" }}>{o._count.items}</td>
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
