export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, MapPin, FileText, Download } from "lucide-react";
import { getDentalLabContext } from "@/lib/lab-auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { formatBytes } from "@/lib/plans";
import { formatRelativeDate } from "@/lib/format";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import {
  DENTAL_LAB_ORDER_STATUS,
  type DentalLabPaymentStatus,
  type DentalLabOrderActor,
} from "@/lib/laboratorios/types";
import { OrderStatusActions } from "./order-status-actions";

const PAYMENT_LABELS: Record<DentalLabPaymentStatus, string> = {
  UNPAID: "Sin pagar",
  PAID: "Pagado",
};
const PAYMENT_TONE: Record<DentalLabPaymentStatus, "warning" | "success"> = {
  UNPAID: "warning",
  PAID: "success",
};

const ACTOR_LABELS: Record<DentalLabOrderActor, string> = {
  CLINIC: "Clínica",
  LAB: "Laboratorio",
  SYSTEM: "Sistema",
};

export default async function LabOrderDetailPage({
  params,
}: {
  params: { orderId: string };
}) {
  const ctx = await getDentalLabContext();
  if (!ctx) redirect("/laboratorios/login");

  const order = await prisma.dentalLabOrder.findFirst({
    // Multi-tenant: el pedido debe pertenecer a este laboratorio.
    where: { id: params.orderId, labId: ctx.labId },
    include: {
      clinic: {
        select: { name: true, city: true, state: true, address: true, mapsUrl: true, phone: true, email: true },
      },
      service: { select: { name: true, unit: true } },
      events: { orderBy: { createdAt: "asc" } },
      files: { orderBy: { uploadedAt: "asc" } },
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
          href="/laboratorios/pedidos"
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
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {order.priority && <BadgeNew tone="warning">Prioritario</BadgeNew>}
          <BadgeNew tone={DENTAL_LAB_ORDER_STATUS[order.status].tone} dot>
            {DENTAL_LAB_ORDER_STATUS[order.status].label}
          </BadgeNew>
          <BadgeNew tone={PAYMENT_TONE[order.paymentStatus]}>
            {PAYMENT_LABELS[order.paymentStatus]}
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
            {(order.clinic.address || order.clinic.mapsUrl) && (
              <div
                style={{
                  borderTop: "1px solid var(--border-soft)",
                  paddingTop: 8,
                  marginTop: 2,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div style={{ color: "var(--text-3)", fontSize: 11 }}>Dónde recoger el producto</div>
                {order.clinic.address && <div style={{ color: "var(--text-2)" }}>{order.clinic.address}</div>}
                {order.clinic.mapsUrl && (
                  <a
                    href={order.clinic.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      width: "fit-content",
                      color: "var(--brand)",
                      fontWeight: 500,
                      textDecoration: "none",
                    }}
                  >
                    <MapPin size={13} />
                    Ver en Google Maps
                  </a>
                )}
              </div>
            )}
          </div>
        </CardNew>

        <OrderStatusActions orderId={order.id} status={order.status} />
      </div>

      {/* Servicio + paciente + desglose */}
      <CardNew title="Servicio solicitado">
        <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13 }}>
          <div>
            <div style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 2 }}>Servicio</div>
            <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 15 }}>
              {order.service?.name ?? "Servicio no especificado"}
            </div>
          </div>

          {(order.patientName || order.internalRef) && (
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
              {order.patientName && (
                <div>
                  <div style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 2 }}>Paciente</div>
                  <div style={{ color: "var(--text-1)" }}>{order.patientName}</div>
                </div>
              )}
              {order.internalRef && (
                <div>
                  <div style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 2 }}>Ref. interna</div>
                  <div className="mono" style={{ color: "var(--text-1)" }}>{order.internalRef}</div>
                </div>
              )}
            </div>
          )}

          {/* Desglose de precio */}
          <div
            style={{
              borderTop: "1px solid var(--border-soft)",
              paddingTop: 12,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-2)" }}>
              <span>Precio base</span>
              <span className="mono">{formatCurrency(order.basePrice)}</span>
            </div>
            {order.extrasTotal > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-2)" }}>
                <span>Extras</span>
                <span className="mono">{formatCurrency(order.extrasTotal)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-1)", fontWeight: 600 }}>
              <span>Total</span>
              <span className="mono" style={{ fontWeight: 700, fontSize: 14 }}>{formatCurrency(order.total)}</span>
            </div>
          </div>
        </div>
      </CardNew>

      {/* Archivos adjuntos */}
      <CardNew title="Archivos adjuntos">
        {order.files.length === 0 ? (
          <div style={{ color: "var(--text-3)", fontSize: 13 }}>
            La clínica no adjuntó archivos a este pedido.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {order.files.map((file) => (
              <div
                key={file.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border-soft)",
                  background: "var(--bg-elev)",
                }}
              >
                <div style={{ flexShrink: 0, color: "var(--text-3)", display: "grid", placeItems: "center" }}>
                  <FileText size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      color: "var(--text-1)",
                      fontSize: 13,
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {file.name}
                  </div>
                  {file.sizeBytes != null && (
                    <div className="mono" style={{ color: "var(--text-3)", fontSize: 11, marginTop: 2 }}>
                      {formatBytes(file.sizeBytes)}
                    </div>
                  )}
                </div>
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={file.name}
                  style={{
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--border-soft)",
                    background: "var(--bg-elev)",
                    color: "var(--text-1)",
                    fontSize: 12,
                    fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  <Download size={13} />
                  Descargar
                </a>
              </div>
            ))}
          </div>
        )}
      </CardNew>

      {/* Seguimiento (timeline de eventos) */}
      <CardNew title="Seguimiento del pedido">
        {order.events.length === 0 ? (
          <div style={{ color: "var(--text-3)", fontSize: 13 }}>Sin eventos registrados todavía.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {order.events.map((ev) => {
              const meta = DENTAL_LAB_ORDER_STATUS[ev.status];
              const when = ev.at ?? ev.createdAt;
              const actorRoleLabel = ev.actorRole ? ACTOR_LABELS[ev.actorRole] : null;
              const who =
                ev.actorName && actorRoleLabel
                  ? `${ev.actorName} · ${actorRoleLabel}`
                  : ev.actorName ?? actorRoleLabel ?? "—";
              return (
                <div key={ev.id} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ marginTop: 2, flexShrink: 0 }}>
                    <BadgeNew tone={meta.tone} dot>{meta.label}</BadgeNew>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: "var(--text-2)", fontSize: 12 }}>{who}</div>
                    {ev.detail && (
                      <div style={{ color: "var(--text-2)", fontSize: 13, marginTop: 2 }}>{ev.detail}</div>
                    )}
                    <div className="mono" style={{ color: "var(--text-3)", fontSize: 11, marginTop: 2 }}>
                      {formatRelativeDate(when)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
