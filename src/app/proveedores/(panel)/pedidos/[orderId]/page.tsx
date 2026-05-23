export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSupplierContext } from "@/lib/supplier-auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import {
  SUPPLIER_ORDER_STATUS_LABELS,
  SUPPLIER_PAYMENT_STATUS_LABELS,
} from "@/lib/suppliers/types";
import { ORDER_STATUS_TONE, PAYMENT_STATUS_TONE } from "@/lib/suppliers/orders-shared";
import { OrderStatusActions } from "./order-status-actions";

export default async function SupplierOrderDetailPage({
  params,
}: {
  params: { orderId: string };
}) {
  const ctx = await getSupplierContext();
  if (!ctx) redirect("/proveedores/login");

  const order = await prisma.supplierOrder.findFirst({
    // Multi-tenant: el pedido debe pertenecer a este proveedor.
    where: { id: params.orderId, supplierId: ctx.supplierId },
    include: {
      clinic: { select: { name: true, city: true, state: true, phone: true, email: true } },
      items: { orderBy: { productName: "asc" } },
    },
  });
  if (!order) notFound();

  const created = new Date(order.createdAt).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const clinicLocation = [order.clinic.city, order.clinic.state].filter(Boolean).join(", ");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1000 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link
          href="/proveedores/pedidos"
          aria-label="Volver a pedidos"
          style={{
            padding: 8,
            borderRadius: 8,
            display: "grid",
            placeItems: "center",
            color: "var(--text-3)",
            border: "1px solid var(--border-soft)",
            background: "var(--bg-elev)",
            flexShrink: 0,
          }}
        >
          <ArrowLeft size={14} />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="mono" style={{ fontSize: 19, color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            {order.orderNumber}
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 12, marginTop: 4, marginBottom: 0 }}>
            Recibido el {created}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <BadgeNew tone={ORDER_STATUS_TONE[order.status]} dot>
            {SUPPLIER_ORDER_STATUS_LABELS[order.status]}
          </BadgeNew>
          <BadgeNew tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>
            {SUPPLIER_PAYMENT_STATUS_LABELS[order.paymentStatus]}
          </BadgeNew>
        </div>
      </div>

      {/* Cliente + acciones */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, alignItems: "start" }}>
        <CardNew title="Cliente (clínica)">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
            <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 15 }}>{order.clinic.name}</div>
            {clinicLocation && <div style={{ color: "var(--text-2)" }}>{clinicLocation}</div>}
            {order.clinic.phone && (
              <div style={{ color: "var(--text-2)" }}>
                <span style={{ color: "var(--text-3)" }}>Tel:</span> {order.clinic.phone}
              </div>
            )}
            {order.clinic.email && (
              <div style={{ color: "var(--text-2)", wordBreak: "break-word" }}>
                <span style={{ color: "var(--text-3)" }}>Email:</span> {order.clinic.email}
              </div>
            )}
          </div>
        </CardNew>

        <OrderStatusActions
          orderId={order.id}
          status={order.status}
          paymentStatus={order.paymentStatus}
        />
      </div>

      {/* Artículos */}
      <CardNew noPad title="Artículos del pedido">
        <div style={{ overflowX: "auto" }}>
          <table className="table-new">
            <thead>
              <tr>
                <th>Producto</th>
                <th style={{ textAlign: "right" }}>Precio unit.</th>
                <th style={{ textAlign: "right" }}>Cantidad</th>
                <th style={{ textAlign: "right" }}>Importe</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it) => (
                <tr key={it.id}>
                  <td style={{ color: "var(--text-1)", fontWeight: 500 }}>{it.productName}</td>
                  <td className="mono" style={{ color: "var(--text-2)", textAlign: "right" }}>
                    {formatCurrency(it.unitPrice)}
                  </td>
                  <td className="mono" style={{ color: "var(--text-2)", textAlign: "right" }}>{it.quantity}</td>
                  <td className="mono" style={{ color: "var(--text-1)", fontWeight: 500, textAlign: "right" }}>
                    {formatCurrency(it.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ textAlign: "right", color: "var(--text-3)" }}>Subtotal</td>
                <td className="mono" style={{ textAlign: "right", color: "var(--text-2)" }}>
                  {formatCurrency(order.subtotal)}
                </td>
              </tr>
              <tr>
                <td colSpan={3} style={{ textAlign: "right", color: "var(--text-1)", fontWeight: 600 }}>Total</td>
                <td className="mono" style={{ textAlign: "right", color: "var(--text-1)", fontWeight: 700, fontSize: 14 }}>
                  {formatCurrency(order.total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardNew>

      {/* Detalles adicionales */}
      {(order.paymentMethod || order.notes) && (
        <CardNew title="Detalles del pedido">
          <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
            {order.paymentMethod && (
              <div>
                <div style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 2 }}>Método de pago</div>
                <div style={{ color: "var(--text-1)" }}>{order.paymentMethod}</div>
              </div>
            )}
            {order.notes && (
              <div>
                <div style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 2 }}>Notas</div>
                <p style={{ color: "var(--text-1)", whiteSpace: "pre-wrap", margin: 0 }}>{order.notes}</p>
              </div>
            )}
          </div>
        </CardNew>
      )}
    </div>
  );
}
