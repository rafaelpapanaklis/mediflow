export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Landmark, Banknote, CreditCard, CheckCircle2, Info } from "lucide-react";
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

export const metadata: Metadata = { title: "Orden — MediFlow" };

type BadgeTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

const PAYMENT_STATUS_TONES: Record<DentalLabPaymentStatus, BadgeTone> = {
  UNPAID: "warning",
  PAID: "success",
};

const PAYMENT_STATUS_LABELS: Record<DentalLabPaymentStatus, string> = {
  UNPAID: "Sin pagar",
  PAID: "Pagado",
};

const orderInclude = {
  // select (no include): traemos SOLO lo que la página necesita — nunca el
  // mpAccessToken del lab. Las cuentas bancarias alimentan la transferencia.
  lab: {
    select: {
      name: true,
      payMercadoPagoEnabled: true,
      bankAccounts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
    },
  },
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
  const user = await getCurrentUser();

  const order = await prisma.dentalLabOrder.findFirst({
    where: { id: params.orderId, clinicId: user.clinicId },
    include: orderInclude,
  });

  if (!order) notFound();

  const labName = order.lab?.name ?? "Laboratorio";
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 880 }}>
      <Link
        href="/dashboard/ordenes-laboratorio"
        style={{ fontSize: 13, color: "var(--text-3)", textDecoration: "none" }}
      >
        ← Volver a órdenes de laboratorio
      </Link>

      <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          Orden {order.orderNumber}
        </h1>
        <p style={{ fontSize: 14, color: "var(--text-3)", margin: 0 }}>
          {labName} · {fmtFullDate(order.createdAt.toISOString())}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <BadgeNew tone={statusMeta.tone} dot>
            {statusMeta.label}
          </BadgeNew>
          <BadgeNew tone={PAYMENT_STATUS_TONES[order.paymentStatus]} dot>
            {PAYMENT_STATUS_LABELS[order.paymentStatus]}
          </BadgeNew>
        </div>
      </header>

      <CardNew title="Importe">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--text-3)" }}>
            <span>Precio base</span>
            <span>{fmtMXNdec(order.basePrice)}</span>
          </div>
          {order.extrasTotal > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--text-3)" }}>
              <span>Extras</span>
              <span>{fmtMXNdec(order.extrasTotal)}</span>
            </div>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text-1)",
              paddingTop: 6,
              borderTop: "1px solid var(--border-soft)",
            }}
          >
            <span>Total</span>
            <span>{fmtMXNdec(order.total)}</span>
          </div>
        </div>
      </CardNew>

      <CardNew title="Cómo pagar">
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
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>Método de pago</span>
              <span style={{ fontSize: 14, color: "var(--text-1)", fontWeight: 500 }}>
                {methodLabel ?? "Por acordar con el laboratorio"}
              </span>
            </div>
            <BadgeNew tone={PAYMENT_STATUS_TONES[order.paymentStatus]} dot>
              {PAYMENT_STATUS_LABELS[order.paymentStatus]}
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
                Pago confirmado
                {order.paidAt ? ` el ${fmtFullDate(order.paidAt.toISOString())}` : ""}.
              </span>
            </div>
          ) : method === "TRANSFER" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-2)", fontSize: 13 }}>
                <Landmark size={15} style={{ color: "var(--violet-400)" }} />
                Transfiere por SPEI a la cuenta del laboratorio:
              </div>
              {bankAccounts.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
                  El laboratorio aún no registró sus cuentas bancarias. Escríbele para coordinar el pago.
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
                            Principal
                          </BadgeNew>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-3)" }}>{acc.holderName}</div>
                      <div className="mono" style={{ fontSize: 13, color: "var(--text-1)" }}>
                        CLABE {acc.clabe}
                      </div>
                      {acc.accountNumber && (
                        <div className="mono" style={{ fontSize: 11, color: "var(--text-4)" }}>
                          Cuenta {acc.accountNumber}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p style={{ fontSize: 11, color: "var(--text-4)", margin: 0, lineHeight: 1.5 }}>
                Usa el número de orden {order.orderNumber} como referencia de tu transferencia.
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
              <span>Paga en efectivo al recibir el trabajo.</span>
            </div>
          ) : method === "MERCADOPAGO" ? (
            mpReady ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-2)", fontSize: 13 }}>
                  <CreditCard size={15} style={{ color: "var(--violet-400)" }} />
                  Paga en línea de forma segura con MercadoPago.
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
                <span>El laboratorio aún no terminó de configurar MercadoPago. Escríbele para coordinar el pago.</span>
              </div>
            )
          ) : (
            <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
              El método de pago se acordará directamente con el laboratorio.
            </p>
          )}
        </div>
      </CardNew>

      <CardNew title="Seguimiento">
        {timeline.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
            Aún no hay eventos para esta orden.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {timeline.map((ev, i) => {
              const meta = DENTAL_LAB_ORDER_STATUS[ev.status as DentalLabOrderStatus];
              const reached = ev.at != null;
              return (
                <div
                  key={ev.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "12px 0",
                    borderBottom:
                      i < timeline.length - 1 ? "1px solid var(--border-soft)" : "none",
                    opacity: reached ? 1 : 0.55,
                  }}
                >
                  <div style={{ flexShrink: 0, marginTop: 2 }}>
                    <BadgeNew tone={meta.tone} dot>
                      {meta.label}
                    </BadgeNew>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--text-1)" }}>
                      {ev.at
                        ? fmtFullDateTime(ev.at.toISOString())
                        : ev.eta
                          ? `Estimado: ${fmtFullDateTime(ev.eta.toISOString())}`
                          : "Pendiente"}
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

      <CardNew title="Detalles de la orden">
        <dl style={{ display: "flex", flexDirection: "column", gap: 14, margin: 0 }}>
          {order.patientName && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <dt style={{ fontSize: 12, color: "var(--text-3)" }}>Paciente</dt>
              <dd style={{ fontSize: 14, color: "var(--text-1)", margin: 0 }}>{order.patientName}</dd>
            </div>
          )}

          {order.internalRef && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <dt style={{ fontSize: 12, color: "var(--text-3)" }}>Referencia interna</dt>
              <dd style={{ fontSize: 14, color: "var(--text-1)", margin: 0 }}>{order.internalRef}</dd>
            </div>
          )}

          {order.notes && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <dt style={{ fontSize: 12, color: "var(--text-3)" }}>Notas</dt>
              <dd style={{ fontSize: 14, color: "var(--text-1)", margin: 0, whiteSpace: "pre-wrap" }}>
                {order.notes}
              </dd>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <dt style={{ fontSize: 12, color: "var(--text-3)" }}>Fecha de creación</dt>
            <dd style={{ fontSize: 14, color: "var(--text-1)", margin: 0 }}>
              {fmtFullDate(order.createdAt.toISOString())}
            </dd>
          </div>
        </dl>
      </CardNew>

      <CardNew title="Acciones">
        <CancelOrderButton orderId={order.id} status={status} />
      </CardNew>
    </div>
  );
}
