export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  ClipboardList,
  Building2,
  MapPin,
  Phone,
  Mail,
  Package,
  Receipt,
  FileText,
  CheckCircle2,
  Clock,
  Truck,
  PackageCheck,
} from "lucide-react";
import { getSupplierContext } from "@/lib/supplier-auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import {
  SUPPLIER_ORDER_STATUS_LABELS,
  SUPPLIER_PAYMENT_STATUS_LABELS,
} from "@/lib/suppliers/types";
import type { SupplierOrderStatus } from "@/lib/suppliers/types";
import { ORDER_STATUS_TONE, PAYMENT_STATUS_TONE } from "@/lib/suppliers/orders-shared";
import { OrderStatusActions } from "./order-status-actions";

// Pasos del stepper horizontal — puramente presentacional, derivado SOLO de
// order.status. NO consulta nada (no hay relación events en este módulo).
const FLOW_STEPS: { key: SupplierOrderStatus; label: string; icon: typeof Clock }[] = [
  { key: "PENDING", label: "Pendiente", icon: Clock },
  { key: "CONFIRMED", label: "Confirmado", icon: CheckCircle2 },
  { key: "SHIPPED", label: "Enviado", icon: Truck },
  { key: "DELIVERED", label: "Entregado", icon: PackageCheck },
];

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

  // Índice del estado actual en el flujo lineal (−1 si está cancelado/fuera).
  const isCancelled = order.status === "CANCELLED";
  const currentStepIdx = FLOW_STEPS.findIndex((s) => s.key === order.status);
  const itemCount = order.items.reduce((acc, it) => acc + it.quantity, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1000 }}>
      {/* Header con icon-chip gradiente + glow */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -40,
            left: -30,
            width: 280,
            height: 180,
            pointerEvents: "none",
            background: "radial-gradient(60% 70% at 20% 30%, rgba(124,58,237,0.18), transparent 70%)",
          }}
        />
        <Link
          href="/proveedores/pedidos"
          aria-label="Volver a pedidos"
          style={{
            position: "relative",
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
          <ClipboardList size={22} />
        </div>
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <h1
            className="mono"
            style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}
          >
            {order.orderNumber}
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            Recibido el {created}
          </p>
        </div>
        <div style={{ position: "relative", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <BadgeNew tone={ORDER_STATUS_TONE[order.status]} dot>
            {SUPPLIER_ORDER_STATUS_LABELS[order.status]}
          </BadgeNew>
          <BadgeNew tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>
            {SUPPLIER_PAYMENT_STATUS_LABELS[order.paymentStatus]}
          </BadgeNew>
        </div>
      </div>

      {/* Stepper horizontal de estatus (presentacional, derivado de order.status) */}
      <CardNew title="Estado del pedido" sub={isCancelled ? "Este pedido fue cancelado." : "Avance del ciclo de vida del pedido."}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            insetInline: 0,
            top: 0,
            height: 3,
            background: "linear-gradient(90deg, var(--violet-400), var(--brand))",
            pointerEvents: "none",
          }}
        />
        {isCancelled ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderRadius: "var(--radius)",
              background: "var(--danger-soft)",
              border: "1px solid var(--danger)",
            }}
          >
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                flexShrink: 0,
                display: "grid",
                placeItems: "center",
                background: "var(--danger-soft-strong)",
                color: "var(--danger)",
              }}
            >
              <Package size={18} />
            </span>
            <div>
              <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>Pedido cancelado</div>
              <div style={{ color: "var(--text-3)", fontSize: 12, marginTop: 2 }}>
                Este pedido no continuará por el flujo de envío.
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 0, overflowX: "auto" }}>
            {FLOW_STEPS.map((step, idx) => {
              const Icon = step.icon;
              const done = idx < currentStepIdx;
              const active = idx === currentStepIdx;
              const reached = idx <= currentStepIdx;
              const isLast = idx === FLOW_STEPS.length - 1;
              return (
                <div key={step.key} style={{ display: "flex", alignItems: "center", flex: isLast ? "0 0 auto" : 1, minWidth: 0 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <span
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 12,
                        display: "grid",
                        placeItems: "center",
                        flexShrink: 0,
                        background: reached
                          ? active
                            ? "var(--brand-grad)"
                            : "var(--brand-soft)"
                          : "var(--bg-elev-2)",
                        border: reached ? "1px solid var(--border-brand)" : "1px solid var(--border-soft)",
                        color: active ? "#fff" : reached ? "var(--brand)" : "var(--text-3)",
                        boxShadow: active ? "0 8px 20px -8px rgba(124,58,237,0.6)" : undefined,
                      }}
                    >
                      {done ? <CheckCircle2 size={18} /> : <Icon size={18} />}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: active ? 600 : 500,
                        color: active ? "var(--text-1)" : reached ? "var(--text-2)" : "var(--text-3)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {step.label}
                    </span>
                  </div>
                  {!isLast && (
                    <span
                      style={{
                        flex: 1,
                        height: 2,
                        minWidth: 24,
                        margin: "0 8px",
                        marginBottom: 22,
                        borderRadius: 2,
                        background: idx < currentStepIdx ? "var(--brand)" : "var(--border-soft)",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardNew>

      {/* Cliente + acciones */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, alignItems: "start" }}>
        <CardNew title="Cliente (clínica)">
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  background: "var(--brand-soft)",
                  border: "1px solid var(--border-brand)",
                  color: "var(--brand)",
                }}
              >
                <Building2 size={18} />
              </span>
              <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 15 }}>{order.clinic.name}</div>
            </div>
            {clinicLocation && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-2)" }}>
                <MapPin size={13} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                {clinicLocation}
              </div>
            )}
            {order.clinic.phone && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-2)" }}>
                <Phone size={13} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                {order.clinic.phone}
              </div>
            )}
            {order.clinic.email && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-2)", wordBreak: "break-word" }}>
                <Mail size={13} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                {order.clinic.email}
              </div>
            )}
          </div>
        </CardNew>

        <OrderStatusActions
          orderId={order.id}
          status={order.status}
          paymentStatus={order.paymentStatus}
          paymentMethod={order.paymentMethod}
        />
      </div>

      {/* Artículos */}
      <CardNew noPad title="Artículos del pedido" sub={`${itemCount} ${itemCount === 1 ? "unidad" : "unidades"} en total`}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            insetInline: 0,
            top: 0,
            height: 3,
            background: "linear-gradient(90deg, var(--violet-400), var(--brand))",
            pointerEvents: "none",
          }}
        />
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
                  <td style={{ color: "var(--text-1)", fontWeight: 500 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 10,
                          flexShrink: 0,
                          display: "grid",
                          placeItems: "center",
                          background: "var(--brand-soft)",
                          border: "1px solid var(--border-brand)",
                          color: "var(--brand)",
                        }}
                      >
                        <Package size={18} />
                      </span>
                      <span>{it.productName}</span>
                    </div>
                  </td>
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
                <td
                  colSpan={3}
                  style={{
                    textAlign: "right",
                    color: "var(--text-1)",
                    fontWeight: 600,
                    background: "var(--brand-soft)",
                    borderTop: "1px solid var(--border-brand)",
                  }}
                >
                  Total
                </td>
                <td
                  className="mono"
                  style={{
                    textAlign: "right",
                    color: "var(--brand)",
                    fontWeight: 700,
                    fontSize: 16,
                    background: "var(--brand-soft)",
                    borderTop: "1px solid var(--border-brand)",
                  }}
                >
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
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13 }}>
            {order.paymentMethod && (
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    color: "var(--text-3)",
                    fontSize: 11,
                    marginBottom: 2,
                  }}
                >
                  <Receipt size={12} style={{ color: "var(--brand)" }} />
                  Método de pago
                </div>
                <div style={{ color: "var(--text-1)" }}>{order.paymentMethod}</div>
              </div>
            )}
            {order.notes && (
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    color: "var(--text-3)",
                    fontSize: 11,
                    marginBottom: 2,
                  }}
                >
                  <FileText size={12} style={{ color: "var(--brand)" }} />
                  Notas
                </div>
                <p style={{ color: "var(--text-1)", whiteSpace: "pre-wrap", margin: 0 }}>{order.notes}</p>
              </div>
            )}
          </div>
        </CardNew>
      )}
    </div>
  );
}
