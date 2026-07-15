export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Receipt,
  Store,
  Package,
  ClipboardList,
  Truck,
  CheckCircle2,
  Building2,
  Clock,
  FileText,
  DollarSign,
} from "lucide-react";
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
import { getServerT } from "@/i18n/server";
import { PayWithMercadoPago } from "./pay-mercadopago";
import { OrderActions } from "./order-actions";

export const metadata: Metadata = { title: "Pedido — DaleControl" };

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

// Pasos del stepper de avance del pedido (derivado de order.status — sin query).
// CANCELLED es terminal y se trata aparte (no forma parte del riel).
const STATUS_STEPS: { key: SupplierOrderStatus; labelKey: string; Icon: typeof Package }[] = [
  { key: "PENDING", labelKey: "procurement.orderDetail.stepPending", Icon: ClipboardList },
  { key: "CONFIRMED", labelKey: "procurement.orderDetail.stepConfirmed", Icon: CheckCircle2 },
  { key: "SHIPPED", labelKey: "procurement.orderDetail.stepShipped", Icon: Truck },
  { key: "DELIVERED", labelKey: "procurement.orderDetail.stepDelivered", Icon: Package },
];

const fmtFullDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });

export default async function Page({ params }: { params: { orderId: string } }) {
  const { t } = await getServerT();
  const user = await getCurrentUser();

  const order = await prisma.supplierOrder.findFirst({
    where: { id: params.orderId, clinicId: user.clinicId },
    include: orderInclude,
  });

  if (!order) notFound();

  const dto = toSupplierOrderDTO(order);
  const supplierName = dto.supplier?.businessName ?? t("procurement.orderDetail.supplierFallback");

  // Datos para mostrar "cómo pagar" según el método elegido.
  const method = dto.paymentMethod;
  const methodLabel =
    method && isB2BPaymentMethod(method)
      ? B2B_PAYMENT_METHOD_LABELS[method]
      : (method ?? t("procurement.orderDetail.methodTBD"));
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

  // Índice del paso actual dentro del riel del stepper (−1 si está cancelado).
  const isCancelled = dto.status === "CANCELLED";
  const currentStepIdx = STATUS_STEPS.findIndex((s) => s.key === dto.status);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 880 }}>
      <Link
        href="/dashboard/compras"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          width: "fit-content",
          fontSize: 13,
          color: "var(--text-3)",
          textDecoration: "none",
        }}
      >
        <ArrowLeft size={14} />
        {t("procurement.orderDetail.backToPurchases")}
      </Link>

      {/* ── Hero con glow violeta + icon-chip gradiente + número mono + badges ── */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
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
              "radial-gradient(60% 70% at 20% 30%, color-mix(in srgb, var(--brand) 18%, transparent), transparent 70%)",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "relative",
            width: 44,
            height: 44,
            borderRadius: 14,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            color: "#fff",
            background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
            boxShadow: "0 8px 20px -8px color-mix(in srgb, var(--brand) 60%, transparent)",
          }}
        >
          <Receipt size={22} />
        </div>
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <h1
            className="mono"
            style={{
              fontSize: 22,
              letterSpacing: "-0.02em",
              color: "var(--text-1)",
              fontWeight: 600,
              margin: 0,
            }}
          >
            {dto.orderNumber}
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            {supplierName} · {fmtFullDate(dto.createdAt)}
          </p>
        </div>
        <div
          style={{
            position: "relative",
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <BadgeNew tone={ORDER_STATUS_TONES[dto.status]} dot>
            {SUPPLIER_ORDER_STATUS_LABELS[dto.status]}
          </BadgeNew>
          <BadgeNew tone={PAYMENT_STATUS_TONES[dto.paymentStatus]} dot>
            {SUPPLIER_PAYMENT_STATUS_LABELS[dto.paymentStatus]}
          </BadgeNew>
        </div>
      </div>

      {/* ── Stepper horizontal de avance (derivado de order.status, sin query) ── */}
      <CardNew title={t("procurement.orderDetail.orderStatusTitle")}>
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
              border: "1px solid var(--danger-border-strong)",
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
              <Clock size={18} />
            </span>
            <div>
              <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>
                {t("procurement.orderDetail.cancelledTitle")}
              </div>
              <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0 }}>
                {t("procurement.orderDetail.cancelledDesc")}
              </p>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 0,
              overflowX: "auto",
            }}
          >
            {STATUS_STEPS.map((step, idx) => {
              const done = idx < currentStepIdx;
              const active = idx === currentStepIdx;
              const reached = done || active;
              const StepIcon = step.Icon;
              const isLast = idx === STATUS_STEPS.length - 1;
              return (
                <div
                  key={step.key}
                  style={{
                    flex: 1,
                    minWidth: 88,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    position: "relative",
                  }}
                >
                  {/* Línea de conexión hacia el siguiente paso */}
                  {!isLast && (
                    <span
                      aria-hidden
                      style={{
                        position: "absolute",
                        top: 18,
                        left: "50%",
                        right: "-50%",
                        height: 2,
                        background: done ? "var(--brand)" : "var(--border-soft)",
                      }}
                    />
                  )}
                  <span
                    style={{
                      position: "relative",
                      zIndex: 1,
                      width: 38,
                      height: 38,
                      borderRadius: "50%",
                      display: "grid",
                      placeItems: "center",
                      background: reached ? "var(--brand-soft)" : "var(--bg-elev)",
                      border: `1px solid ${reached ? "var(--border-brand)" : "var(--border-soft)"}`,
                      color: reached ? "var(--violet-400)" : "var(--text-3)",
                      boxShadow: active
                        ? "0 0 0 4px color-mix(in srgb, var(--violet-400) 18%, transparent)"
                        : "none",
                    }}
                  >
                    <StepIcon size={17} />
                  </span>
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      textAlign: "center",
                      fontWeight: active ? 600 : 500,
                      color: reached ? "var(--text-1)" : "var(--text-3)",
                    }}
                  >
                    {t(step.labelKey)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardNew>

      {/* ── Proveedor ── */}
      <CardNew title={t("procurement.orderDetail.supplierTitle")}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "var(--brand-soft)",
              border: "1px solid var(--border-brand)",
              color: "var(--violet-400)",
            }}
          >
            <Store size={20} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 15 }}>
              {supplierName}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: "var(--text-3)",
                fontSize: 12,
                marginTop: 2,
              }}
            >
              <Building2 size={12} />
              {t("procurement.orderDetail.marketplaceSupplier")}
            </div>
          </div>
        </div>
      </CardNew>

      {/* ── Artículos ── */}
      <CardNew title={t("procurement.orderDetail.itemsTitle")} sub={t("procurement.orderDetail.productCount", { count: dto.items.length })}>
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
                <th>{t("procurement.orderDetail.colProduct")}</th>
                <th style={{ textAlign: "center" }}>{t("procurement.orderDetail.colQuantity")}</th>
                <th style={{ textAlign: "right" }}>{t("procurement.orderDetail.colUnitPrice")}</th>
                <th style={{ textAlign: "right" }}>{t("procurement.orderDetail.colAmount")}</th>
              </tr>
            </thead>
            <tbody>
              {dto.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 9,
                          flexShrink: 0,
                          display: "grid",
                          placeItems: "center",
                          background: "var(--brand-soft)",
                          border: "1px solid var(--border-brand)",
                          color: "var(--violet-400)",
                        }}
                      >
                        <Package size={16} />
                      </span>
                      <span style={{ color: "var(--text-1)" }}>{item.productName}</span>
                    </div>
                  </td>
                  <td style={{ textAlign: "center", color: "var(--text-2)" }}>{item.quantity}</td>
                  <td className="mono" style={{ textAlign: "right", color: "var(--text-2)" }}>
                    {fmtMXNdec(item.unitPrice)}
                  </td>
                  <td className="mono" style={{ textAlign: "right", color: "var(--text-1)" }}>
                    {fmtMXNdec(item.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer destacado Subtotal / Total */}
        <div
          style={{
            marginTop: 14,
            padding: "14px 16px",
            borderRadius: "var(--radius)",
            background: "var(--brand-soft)",
            border: "1px solid var(--border-brand)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              color: "var(--text-2)",
            }}
          >
            <span>{t("procurement.orderDetail.subtotal")}</span>
            <span className="mono">{fmtMXNdec(dto.subtotal)}</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              color: "var(--text-1)",
              fontWeight: 600,
            }}
          >
            <span>{t("common.total")}</span>
            <span className="mono" style={{ fontWeight: 700, fontSize: 17, color: "var(--violet-400)" }}>
              {fmtMXNdec(dto.total)}
            </span>
          </div>
        </div>
      </CardNew>

      {/* ── Detalles del pedido (método de pago / notas) ── */}
      <CardNew title={t("procurement.orderDetail.detailsTitle")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13 }}>
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: "var(--text-3)",
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 0.4,
                marginBottom: 3,
              }}
            >
              <DollarSign size={12} style={{ color: "var(--violet-400)" }} />
              {t("procurement.orderDetail.paymentMethod")}
            </div>
            <div style={{ color: "var(--text-1)", fontSize: 14 }}>{methodLabel}</div>
          </div>

          {dto.notes && (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--text-3)",
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                  marginBottom: 3,
                }}
              >
                <FileText size={12} style={{ color: "var(--violet-400)" }} />
                {t("procurement.orderDetail.notes")}
              </div>
              <p
                style={{
                  color: "var(--text-1)",
                  fontSize: 14,
                  margin: 0,
                  whiteSpace: "pre-wrap",
                }}
              >
                {dto.notes}
              </p>
            </div>
          )}

          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: "var(--text-3)",
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 0.4,
                marginBottom: 3,
              }}
            >
              <Clock size={12} style={{ color: "var(--violet-400)" }} />
              {t("procurement.orderDetail.createdDate")}
            </div>
            <div style={{ color: "var(--text-1)", fontSize: 14 }}>{fmtFullDate(dto.createdAt)}</div>
          </div>
        </div>
      </CardNew>

      {/* ── Cómo pagar ── */}
      <CardNew title={t("procurement.orderDetail.paymentTitle")}>
        {isPaid ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderRadius: "var(--radius)",
              background: "var(--success-soft)",
              border: "1px solid color-mix(in srgb, var(--success) 28%, transparent)",
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
                background: "color-mix(in srgb, var(--success) 16%, transparent)",
                color: "var(--success)",
              }}
            >
              <CheckCircle2 size={18} />
            </span>
            <div>
              <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>{t("procurement.orderDetail.orderPaid")}</div>
              {fmtPaidAt && (
                <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
                  {t("procurement.orderDetail.paymentRecordedOn", { date: fmtPaidAt })}
                </p>
              )}
            </div>
          </div>
        ) : method === "TRANSFER" ? (
          bankAccounts.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0, lineHeight: 1.5 }}>
                {t("procurement.orderDetail.transferIntroBefore")} <strong>{fmtMXNdec(dto.total)}</strong>{" "}
                {t("procurement.orderDetail.transferIntroAfter")}
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
                    {a.isPrimary ? ` · ${t("procurement.orderDetail.primaryAccount")}` : ""}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>{t("procurement.orderDetail.accountHolder", { name: a.holderName })}</div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
                    {t("procurement.orderDetail.clabeLabel", { clabe: a.clabe })}
                  </div>
                  {a.accountNumber && (
                    <div className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
                      {t("procurement.orderDetail.accountLabel", { account: a.accountNumber })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
              {t("procurement.orderDetail.noBankData")}
            </p>
          )
        ) : method === "CASH" ? (
          <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0, lineHeight: 1.5 }}>
            {t("procurement.orderDetail.cashInfo")}
          </p>
        ) : method === "MERCADOPAGO" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0, lineHeight: 1.5 }}>
              {t("procurement.orderDetail.mpInfo")}
            </p>
            {mpAvailable ? (
              <div>
                <PayWithMercadoPago orderId={dto.id} />
              </div>
            ) : (
              <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
                {t("procurement.orderDetail.mpDisabled")}
              </p>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
            {t("procurement.orderDetail.coordinateDirectly")}
          </p>
        )}
      </CardNew>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <OrderActions orderId={dto.id} />
        <Link
          href={`/dashboard/proveedor-chat/${dto.supplierId}`}
          className="btn-new btn-new--secondary"
        >
          {t("procurement.orderDetail.contactSupplier")}
        </Link>
      </div>
    </div>
  );
}
