export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CardNew, BadgeNew } from "@/components/ui/design-system";
import { fmtMXNdec } from "@/lib/format";
import {
  DENTAL_LAB_ORDER_STATUS,
  type DentalLabOrderStatus,
  type DentalLabPaymentStatus,
} from "@/lib/laboratorios/types";
import { CancelOrderButton } from "../ordenes-client";

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
  lab: true,
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
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <dt style={{ fontSize: 12, color: "var(--text-3)" }}>Método de pago</dt>
            <dd style={{ fontSize: 14, color: "var(--text-1)", margin: 0 }}>
              {order.paymentMethod ?? "Por acordar con el laboratorio"}
            </dd>
          </div>

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

        <p style={{ fontSize: 12, color: "var(--text-3)", margin: "16px 0 0", lineHeight: 1.5 }}>
          El pago se coordina directamente con el laboratorio; no hay cobro en línea.
        </p>
      </CardNew>

      <CardNew title="Acciones">
        <CancelOrderButton orderId={order.id} status={status} />
      </CardNew>
    </div>
  );
}
