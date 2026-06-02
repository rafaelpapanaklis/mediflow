export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CardNew, BadgeNew } from "@/components/ui/design-system";
import { fmtMXNdec } from "@/lib/format";
import {
  SUPPLIER_ORDER_STATUS_LABELS,
  SUPPLIER_PAYMENT_STATUS_LABELS,
  type SupplierOrderStatus,
  type SupplierPaymentStatus,
} from "@/lib/suppliers/types";
import { orderInclude, toSupplierOrderDTO } from "@/lib/suppliers/serializers";
import { B2B_PAYMENT_METHOD_LABELS, isB2BPaymentMethod } from "@/lib/payments-b2b";
import { PayWithMercadoPago } from "./pay-mercadopago";

export const metadata: Metadata = { title: "Pedido — MediFlow" };

type BadgeTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

const ORDER_STATUS_TONES: Record<SupplierOrderStatus, BadgeTone> = {
  PENDING: "warning",
  CONFIRMED: "info",
  SHIPPED: "brand",
  DELIVERED: "success",
  CANCELLED: "danger",
};

const PAYMENT_STATUS_TONES: Record<SupplierPaymentStatus, BadgeTone> = {
  UNPAID: "warning",
  PAID: "success",
};

const fmtFullDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });

export default async function Page({ params }: { params: { orderId: string } }) {
  const user = await getCurrentUser();

  const order = await prisma.supplierOrder.findFirst({
    where: { id: params.orderId, clinicId: user.clinicId },
    include: orderInclude,
  });

  if (!order) notFound();

  const dto = toSupplierOrderDTO(order);
  const supplierName = dto.supplier?.businessName ?? "Proveedor";

  // Datos para mostrar "cómo pagar" según el método elegido.
  const method = dto.paymentMethod;
  const methodLabel =
    method && isB2BPaymentMethod(method)
      ? B2B_PAYMENT_METHOD_LABELS[method]
      : (method ?? "Por acordar con el proveedor");
  const isPaid = dto.paymentStatus === "PAID";

  // Cuentas bancarias del proveedor (sólo se necesitan para transferencia).
  const bankAccounts =
    method === "TRANSFER"
      ? await prisma.supplierBankAccount.findMany({
          where: { supplierId: order.supplierId },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        })
      : [];

  const mpAvailable = Boolean(dto.supplier?.payMercadoPagoEnabled);
  const fmtPaidAt = dto.paidAt
    ? new Date(dto.paidAt).toLocaleString("es-MX", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 880 }}>
      <Link
        href="/dashboard/compras"
        style={{ fontSize: 13, color: "var(--text-3)", textDecoration: "none" }}
      >
        ← Volver a compras
      </Link>

      <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          Pedido {dto.orderNumber}
        </h1>
        <p style={{ fontSize: 14, color: "var(--text-3)", margin: 0 }}>
          {supplierName} · {fmtFullDate(dto.createdAt)}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <BadgeNew tone={ORDER_STATUS_TONES[dto.status]} dot>
            {SUPPLIER_ORDER_STATUS_LABELS[dto.status]}
          </BadgeNew>
          <BadgeNew tone={PAYMENT_STATUS_TONES[dto.paymentStatus]} dot>
            {SUPPLIER_PAYMENT_STATUS_LABELS[dto.paymentStatus]}
          </BadgeNew>
        </div>
      </header>

      <CardNew title="Productos">
        <div style={{ display: "flex", flexDirection: "column" }}>
          {dto.items.map((item) => (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 16,
                padding: "10px 0",
                borderBottom: "1px solid var(--border-soft)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, color: "var(--text-1)" }}>{item.productName}</div>
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                  {item.quantity} × {fmtMXNdec(item.unitPrice)}
                </div>
              </div>
              <div style={{ fontSize: 14, color: "var(--text-1)", whiteSpace: "nowrap" }}>
                {fmtMXNdec(item.lineTotal)}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--text-3)" }}>
            <span>Subtotal</span>
            <span>{fmtMXNdec(dto.subtotal)}</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text-1)",
            }}
          >
            <span>Total</span>
            <span>{fmtMXNdec(dto.total)}</span>
          </div>
        </div>
      </CardNew>

      <CardNew title="Detalles del pedido">
        <dl style={{ display: "flex", flexDirection: "column", gap: 14, margin: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <dt style={{ fontSize: 12, color: "var(--text-3)" }}>Método de pago</dt>
            <dd style={{ fontSize: 14, color: "var(--text-1)", margin: 0 }}>{methodLabel}</dd>
          </div>

          {dto.notes && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <dt style={{ fontSize: 12, color: "var(--text-3)" }}>Notas</dt>
              <dd style={{ fontSize: 14, color: "var(--text-1)", margin: 0, whiteSpace: "pre-wrap" }}>
                {dto.notes}
              </dd>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <dt style={{ fontSize: 12, color: "var(--text-3)" }}>Fecha de creación</dt>
            <dd style={{ fontSize: 14, color: "var(--text-1)", margin: 0 }}>{fmtFullDate(dto.createdAt)}</dd>
          </div>
        </dl>
      </CardNew>

      {/* ── Cómo pagar ── */}
      <CardNew title="Pago">
        {isPaid ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <BadgeNew tone="success" dot>
              Pagado
            </BadgeNew>
            {fmtPaidAt && (
              <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
                Pago registrado el {fmtPaidAt}.
              </p>
            )}
          </div>
        ) : method === "TRANSFER" ? (
          bankAccounts.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0, lineHeight: 1.5 }}>
                Transfiere el total de <strong>{fmtMXNdec(dto.total)}</strong> a la cuenta del
                proveedor y avísale por chat con tu comprobante.
              </p>
              {bankAccounts.map((a) => (
                <div
                  key={a.id}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: "1px solid var(--border-soft)",
                    background: "var(--bg-elev)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                    {a.bank}
                    {a.isPrimary ? " · Principal" : ""}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>Titular: {a.holderName}</div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
                    CLABE {a.clabe}
                  </div>
                  {a.accountNumber && (
                    <div className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
                      Cuenta {a.accountNumber}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
              El proveedor aún no ha registrado sus datos bancarios. Contáctalo por chat para
              coordinar la transferencia.
            </p>
          )
        ) : method === "CASH" ? (
          <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0, lineHeight: 1.5 }}>
            Paga en efectivo al recibir el pedido. El proveedor marcará la orden como pagada.
          </p>
        ) : method === "MERCADOPAGO" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0, lineHeight: 1.5 }}>
              Paga en línea con MercadoPago de forma segura. El cobro va directo al proveedor.
            </p>
            {mpAvailable ? (
              <div>
                <PayWithMercadoPago orderId={dto.id} />
              </div>
            ) : (
              <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
                El proveedor desactivó MercadoPago. Contáctalo por chat para otra forma de pago.
              </p>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
            Coordina el pago directamente con el proveedor.
          </p>
        )}
      </CardNew>

      <div>
        <Link href={`/dashboard/proveedor-chat/${dto.supplierId}`} className="btn-new btn-new--secondary">
          Contactar al proveedor
        </Link>
      </div>
    </div>
  );
}
