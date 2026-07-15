export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getServerT } from "@/i18n/server";
import { prisma } from "@/lib/prisma";
import { Landmark, Banknote, CreditCard, CheckCircle2, Info, ClipboardList, ArrowLeft } from "lucide-react";
import { CardNew, BadgeNew } from "@/components/ui/design-system";
import { fmtMXNdec } from "@/lib/format";
import {
  DENTAL_LAB_ORDER_STATUS,
  type DentalLabOrderStatus,
  type DentalLabPaymentStatus,
} from "@/lib/laboratorios/types";
import { B2B_PAYMENT_METHOD_LABELS, isB2BPaymentMethod } from "@/lib/payments-b2b";
import { CancelOrderButton } from "../ordenes-client";
import { PayWithMercadoPago } from "./pay-mercadopago-button";
import {
  OrderTrackingHero,
  OrderRouteMap,
  type OrderTrackingProps,
} from "@/components/laboratorios/order-route-map";
import { OrderChatDock } from "@/components/laboratorios/order-chat-dock";

export const metadata: Metadata = { title: "Orden — DaleControl" };

type BadgeTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

const PAYMENT_STATUS_TONES: Record<DentalLabPaymentStatus, BadgeTone> = {
  UNPAID: "warning",
  PAID: "success",
};

// id de estado de pago → translation-key (resuelta con t() al renderizar).
const PAYMENT_STATUS_LABEL_KEYS: Record<DentalLabPaymentStatus, string> = {
  UNPAID: "procurement.orderDetail.payUnpaid",
  PAID: "procurement.orderDetail.payPaid",
};

const orderInclude = {
  // select (no include): traemos SOLO lo que la página necesita — nunca el
  // mpAccessToken del lab. Las cuentas bancarias alimentan la transferencia;
  // logoUrl/trafficLevel/address/mapsUrl alimentan el mapa + hero + chat dock.
  lab: {
    select: {
      id: true,
      name: true,
      logoUrl: true,
      trafficLevel: true,
      address: true,
      mapsUrl: true,
      city: true,
      state: true,
      payMercadoPagoEnabled: true,
      bankAccounts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
    },
  },
  // La propia clínica (destino del recorrido) — solo datos de ubicación/logo.
  clinic: { select: { name: true, address: true, mapsUrl: true, logoUrl: true } },
  events: true,
  files: true,
} satisfies Prisma.DentalLabOrderInclude;

const fmtFullDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });

const fmtFullDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default async function Page({ params }: { params: { orderId: string } }) {
  const { t } = await getServerT();
  const user = await getCurrentUser();

  const order = await prisma.dentalLabOrder.findFirst({
    where: { id: params.orderId, clinicId: user.clinicId },
    include: orderInclude,
  });

  if (!order) notFound();

  const labName = order.lab?.name ?? t("procurement.orderDetail.labFallback");
  const status = order.status as DentalLabOrderStatus;
  const statusMeta = DENTAL_LAB_ORDER_STATUS[status];

  // Timeline ordenado igual que el flujo: por `at` (cronológico, nulls al final),
  // y como desempate por createdAt — espejo del orderBy de eventos.
  const timeline = [...order.events].sort((a, b) => {
    const ta = a.at ? a.at.getTime() : Number.POSITIVE_INFINITY;
    const tb = b.at ? b.at.getTime() : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  // ── Datos de pago para la sección "Cómo pagar". ──
  const method = order.paymentMethod;
  const methodLabel = method
    ? isB2BPaymentMethod(method)
      ? B2B_PAYMENT_METHOD_LABELS[method]
      : method
    : null;
  const isPaid = order.paymentStatus === "PAID";
  const bankAccounts = order.lab?.bankAccounts ?? [];
  // El lab puede cobrar por MP si lo tiene habilitado. La invariante del server
  // (PATCH /profile) garantiza que habilitado ⇒ hay token, así que no hace falta
  // cargar el token (sensible) en esta página solo para este chequeo.
  const mpReady = Boolean(order.lab?.payMercadoPagoEnabled);

  // ── Props del seguimiento (banda hero + mapa A→B: LAB → CLÍNICA). ──
  const tracking: OrderTrackingProps = {
    status,
    trafficLevel: order.lab?.trafficLevel ?? null,
    etaAt: order.etaAt ? order.etaAt.toISOString() : null,
    pickupAt: order.pickupAt ? order.pickupAt.toISOString() : null,
    courier: (order.courier as unknown as OrderTrackingProps["courier"]) ?? null,
    origin: { label: t("procurement.orderDetail.routeLab"), name: labName, mapsUrl: order.lab?.mapsUrl ?? null },
    destination: {
      label: t("procurement.orderDetail.routeClinic"),
      name: order.clinic?.name ?? t("procurement.orderDetail.yourClinic"),
      mapsUrl: order.clinic?.mapsUrl ?? null,
    },
  };
  const showTracking = status !== "CANCELADA";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 920 }}>
      <Link
        href="/dashboard/ordenes-laboratorio"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          color: "var(--text-3)",
          textDecoration: "none",
          width: "fit-content",
        }}
      >
        <ArrowLeft size={14} />
        {t("procurement.orderDetail.backToOrders")}
      </Link>

      {/* ── Hero / encabezado ── */}
      <header style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 13,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            color: "#fff",
            background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
            boxShadow: "0 10px 24px -8px rgba(124,58,237,0.7)",
          }}
        >
          <ClipboardList size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            className="mono"
            style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}
          >
            {order.orderNumber}
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-3)", margin: "4px 0 0" }}>
            {labName} · {fmtFullDate(order.createdAt.toISOString())}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            <BadgeNew tone={statusMeta.tone} dot>
              {statusMeta.label}
            </BadgeNew>
            <BadgeNew tone={PAYMENT_STATUS_TONES[order.paymentStatus]} dot>
              {t(PAYMENT_STATUS_LABEL_KEYS[order.paymentStatus])}
            </BadgeNew>
            {order.priority && <BadgeNew tone="warning">{t("procurement.orderDetail.priority")}</BadgeNew>}
          </div>
        </div>
      </header>

      {/* ── Banda de seguimiento (hero oscuro) + mapa A→B ── */}
      {showTracking && (
        <>
          <OrderTrackingHero {...tracking} />
          <CardNew title={t("procurement.orderDetail.courierRoute")} sub={t("procurement.orderDetail.courierRouteSub")}>
            <OrderRouteMap {...tracking} />
          </CardNew>
        </>
      )}

      <CardNew title={t("procurement.orderDetail.amount")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--text-3)" }}>
            <span>{t("procurement.orderDetail.basePrice")}</span>
            <span>{fmtMXNdec(order.basePrice)}</span>
          </div>
          {order.extrasTotal > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--text-3)" }}>
              <span>{t("procurement.orderDetail.extras")}</span>
              <span>{fmtMXNdec(order.extrasTotal)}</span>
            </div>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text-1)",
              marginTop: 4,
              padding: "10px 12px",
              borderRadius: "var(--radius)",
              background: "var(--brand-soft)",
              border: "1px solid var(--border-brand)",
            }}
          >
            <span>{t("common.total")}</span>
            <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--violet-400)" }}>
              {fmtMXNdec(order.total)}
            </span>
          </div>
        </div>
      </CardNew>

      <CardNew title={t("procurement.orderDetail.howToPay")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>{t("procurement.orderDetail.paymentMethod")}</span>
              <span style={{ fontSize: 14, color: "var(--text-1)", fontWeight: 500 }}>
                {methodLabel ?? t("procurement.orderDetail.toAgreeWithLab")}
              </span>
            </div>
            <BadgeNew tone={PAYMENT_STATUS_TONES[order.paymentStatus]} dot>
              {t(PAYMENT_STATUS_LABEL_KEYS[order.paymentStatus])}
            </BadgeNew>
          </div>

          {isPaid ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 10,
                background: "var(--success-soft)",
                border: "1px solid var(--success)",
                color: "var(--text-1)",
                fontSize: 13,
              }}
            >
              <CheckCircle2 size={18} style={{ color: "var(--success)", flexShrink: 0 }} />
              <span>
                {order.paidAt
                  ? t("procurement.orderDetail.paymentConfirmedOn", {
                      date: fmtFullDate(order.paidAt.toISOString()),
                    })
                  : t("procurement.orderDetail.paymentConfirmed")}
              </span>
            </div>
          ) : method === "TRANSFER" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-2)", fontSize: 13 }}>
                <Landmark size={15} style={{ color: "var(--violet-400)" }} />
                {t("procurement.orderDetail.transferSpei")}
              </div>
              {bankAccounts.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
                  {t("procurement.orderDetail.noBankAccounts")}
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {bankAccounts.map((acc) => (
                    <div
                      key={acc.id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        padding: "12px 14px",
                        borderRadius: 10,
                        border: "1px solid var(--border-soft)",
                        background: "var(--bg-elev)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                          {acc.bank}
                        </span>
                        {acc.isPrimary && (
                          <BadgeNew tone="brand" dot>
                            {t("procurement.orderDetail.primaryAccount")}
                          </BadgeNew>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-3)" }}>{acc.holderName}</div>
                      <div className="mono" style={{ fontSize: 13, color: "var(--text-1)" }}>
                        {t("procurement.orderDetail.clabe", { clabe: acc.clabe })}
                      </div>
                      {acc.accountNumber && (
                        <div className="mono" style={{ fontSize: 11, color: "var(--text-4)" }}>
                          {t("procurement.orderDetail.accountNumber", { account: acc.accountNumber })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p style={{ fontSize: 11, color: "var(--text-4)", margin: 0, lineHeight: 1.5 }}>
                {t("procurement.orderDetail.transferReference", { orderNumber: order.orderNumber })}
              </p>
            </div>
          ) : method === "CASH" ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 10,
                background: "var(--info-soft)",
                border: "1px solid var(--info)",
                color: "var(--text-1)",
                fontSize: 13,
              }}
            >
              <Banknote size={18} style={{ color: "var(--info)", flexShrink: 0 }} />
              <span>{t("procurement.orderDetail.payCashOnDelivery")}</span>
            </div>
          ) : method === "MERCADOPAGO" ? (
            mpReady ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-2)", fontSize: 13 }}>
                  <CreditCard size={15} style={{ color: "var(--violet-400)" }} />
                  {t("procurement.orderDetail.payOnlineMercadoPago")}
                </div>
                <PayWithMercadoPago orderId={order.id} />
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: 10,
                  background: "var(--warning-soft)",
                  border: "1px solid var(--warning)",
                  color: "var(--text-1)",
                  fontSize: 13,
                }}
              >
                <Info size={18} style={{ color: "var(--warning)", flexShrink: 0 }} />
                <span>{t("procurement.orderDetail.mpNotReady")}</span>
              </div>
            )
          ) : (
            <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
              {t("procurement.orderDetail.paymentToAgreeDirectly")}
            </p>
          )}
        </div>
      </CardNew>

      <CardNew title={t("procurement.orderDetail.tracking")}>
        {timeline.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
            {t("procurement.orderDetail.noEvents")}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {timeline.map((ev, i) => {
              const meta = DENTAL_LAB_ORDER_STATUS[ev.status as DentalLabOrderStatus];
              const reached = ev.at != null;
              const isLast = i === timeline.length - 1;
              return (
                <div key={ev.id} style={{ display: "flex", gap: 14 }}>
                  {/* Rail: conector + nodo de estado (completado = --success,
                      pendiente = hueco --text-4). */}
                  <div
                    style={{
                      position: "relative",
                      width: 14,
                      flexShrink: 0,
                      display: "flex",
                      justifyContent: "center",
                    }}
                  >
                    {!isLast && (
                      <span
                        aria-hidden
                        style={{
                          position: "absolute",
                          top: 16,
                          bottom: 0,
                          left: "50%",
                          width: 2,
                          transform: "translateX(-50%)",
                          background: "var(--border-soft)",
                        }}
                      />
                    )}
                    <span
                      aria-hidden
                      style={{
                        position: "relative",
                        zIndex: 1,
                        marginTop: 5,
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        background: reached ? "var(--success)" : "var(--bg-elev)",
                        border: reached ? "2px solid var(--bg-elev)" : "2px solid var(--text-4)",
                        boxShadow: reached ? "0 0 0 3px var(--success-soft)" : "none",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      paddingBottom: isLast ? 0 : 18,
                      opacity: reached ? 1 : 0.6,
                    }}
                  >
                    <BadgeNew tone={meta.tone} dot>
                      {meta.label}
                    </BadgeNew>
                    <div style={{ fontSize: 13, color: "var(--text-1)", marginTop: 6 }}>
                      {ev.at
                        ? fmtFullDateTime(ev.at.toISOString())
                        : ev.eta
                          ? t("procurement.orderDetail.estimated", {
                              date: fmtFullDateTime(ev.eta.toISOString()),
                            })
                          : t("procurement.orderDetail.pending")}
                    </div>
                    {ev.detail && (
                      <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2, whiteSpace: "pre-wrap" }}>
                        {ev.detail}
                      </div>
                    )}
                    {ev.actorName && (
                      <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 2 }}>
                        {ev.actorName}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardNew>

      <CardNew title={t("procurement.orderDetail.orderDetailsTitle")}>
        <dl style={{ display: "flex", flexDirection: "column", gap: 14, margin: 0 }}>
          {order.patientName && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <dt style={{ fontSize: 12, color: "var(--text-3)" }}>{t("procurement.orderDetail.patient")}</dt>
              <dd style={{ fontSize: 14, color: "var(--text-1)", margin: 0 }}>{order.patientName}</dd>
            </div>
          )}

          {order.internalRef && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <dt style={{ fontSize: 12, color: "var(--text-3)" }}>{t("procurement.orderDetail.internalRef")}</dt>
              <dd style={{ fontSize: 14, color: "var(--text-1)", margin: 0 }}>{order.internalRef}</dd>
            </div>
          )}

          {order.notes && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <dt style={{ fontSize: 12, color: "var(--text-3)" }}>{t("procurement.orderDetail.notes")}</dt>
              <dd style={{ fontSize: 14, color: "var(--text-1)", margin: 0, whiteSpace: "pre-wrap" }}>
                {order.notes}
              </dd>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <dt style={{ fontSize: 12, color: "var(--text-3)" }}>{t("procurement.orderDetail.createdDate")}</dt>
            <dd style={{ fontSize: 14, color: "var(--text-1)", margin: 0 }}>
              {fmtFullDate(order.createdAt.toISOString())}
            </dd>
          </div>
        </dl>
      </CardNew>

      <CardNew title={t("procurement.orderDetail.actions")}>
        <CancelOrderButton orderId={order.id} status={status} />
      </CardNew>

      {/* ── Chat embebido clínica↔laboratorio (minimizable a burbuja) ── */}
      <OrderChatDock
        side="CLINIC"
        counterpartId={order.labId}
        counterpartName={labName}
        counterpartLogoUrl={order.lab?.logoUrl ?? null}
        orderNumber={order.orderNumber}
      />
    </div>
  );
}
