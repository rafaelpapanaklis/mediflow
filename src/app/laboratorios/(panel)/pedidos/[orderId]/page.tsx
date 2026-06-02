export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, MapPin, FileText, Download, ClipboardList, Receipt, Clock, FlaskConical, Navigation } from "lucide-react";
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
import { B2B_PAYMENT_METHOD_LABELS, isB2BPaymentMethod } from "@/lib/payments-b2b";
import { OrderStatusActions } from "./order-status-actions";
import {
  OrderTrackingHero,
  OrderRouteMap,
  type OrderTrackingProps,
} from "@/components/laboratorios/order-route-map";
import { OrderChatDock } from "@/components/laboratorios/order-chat-dock";

// Etiqueta legible del método de pago: usa el catálogo B2B si el valor es
// uno de los métodos canónicos; si no, muestra el texto crudo guardado.
function paymentMethodLabel(method: string): string {
  return isB2BPaymentMethod(method) ? B2B_PAYMENT_METHOD_LABELS[method] : method;
}

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

// Color del riel/punto del timeline según el tono semántico del estado.
// (solo presentación — el mapeo tono↔estado lo define DENTAL_LAB_ORDER_STATUS)
const TIMELINE_TONE_VARS: Record<
  "info" | "brand" | "warning" | "success" | "neutral",
  string
> = {
  info: "var(--info)",
  brand: "var(--brand)",
  warning: "var(--warning)",
  success: "var(--success)",
  neutral: "var(--text-3)",
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
        select: { name: true, city: true, state: true, address: true, mapsUrl: true, phone: true, email: true, logoUrl: true },
      },
      // El propio laboratorio (origen del recorrido) — datos de ubicación/logo + tráfico.
      lab: { select: { name: true, logoUrl: true, trafficLevel: true, address: true, mapsUrl: true } },
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

  // ── Props del seguimiento (banda hero + mapa A→B: LAB → CLÍNICA). ──
  const tracking: OrderTrackingProps = {
    status: order.status,
    trafficLevel: order.lab?.trafficLevel ?? null,
    etaAt: order.etaAt ? order.etaAt.toISOString() : null,
    pickupAt: order.pickupAt ? order.pickupAt.toISOString() : null,
    courier: (order.courier as unknown as OrderTrackingProps["courier"]) ?? null,
    origin: { label: "LAB", name: order.lab?.name ?? "Tu laboratorio", mapsUrl: order.lab?.mapsUrl ?? null },
    destination: { label: "CLÍNICA", name: order.clinic.name, mapsUrl: order.clinic.mapsUrl ?? null },
  };
  const showTracking = order.status !== "CANCELADA";

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
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            color: "#fff",
            background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
            boxShadow: "0 8px 20px -8px rgba(124,58,237,0.6)",
          }}
        >
          <ClipboardList size={20} />
        </div>
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

      {/* Banda de seguimiento (hero oscuro) + mapa A→B */}
      {showTracking && (
        <>
          <OrderTrackingHero {...tracking} />
          <CardNew title="Ruta del mensajero" sub="LAB → CLÍNICA · vista ilustrativa del recorrido">
            <OrderRouteMap {...tracking} />
          </CardNew>
        </>
      )}

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
                  marginTop: 4,
                  padding: "12px 12px",
                  borderRadius: "var(--radius)",
                  background: "var(--info-soft)",
                  border: "1px solid rgba(59,130,246,0.2)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    color: "var(--text-2)",
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                  }}
                >
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 8,
                      flexShrink: 0,
                      display: "grid",
                      placeItems: "center",
                      background: "rgba(59,130,246,0.15)",
                      color: "var(--info)",
                    }}
                  >
                    <MapPin size={14} />
                  </span>
                  Dónde recoger el producto
                </div>
                {order.clinic.address && (
                  <div style={{ color: "var(--text-1)", fontSize: 13 }}>{order.clinic.address}</div>
                )}
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
                      color: "var(--info)",
                      fontWeight: 600,
                      fontSize: 13,
                      textDecoration: "none",
                    }}
                  >
                    <Navigation size={13} />
                    Ver en Google Maps
                  </a>
                )}
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

      {/* Servicio + paciente + desglose */}
      <CardNew title="Servicio solicitado">
        <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
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
                color: "var(--violet-400)",
              }}
            >
              <FlaskConical size={18} />
            </span>
            <div>
              <div style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 2 }}>Servicio</div>
              <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 15 }}>
                {order.service?.name ?? "Servicio no especificado"}
              </div>
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
                marginBottom: 2,
              }}
            >
              <Receipt size={13} style={{ color: "var(--violet-400)" }} />
              Desglose de precio
            </div>
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
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                color: "var(--text-1)",
                fontWeight: 600,
                marginTop: 4,
                padding: "10px 12px",
                borderRadius: "var(--radius)",
                background: "var(--brand-soft)",
                border: "1px solid var(--border-brand)",
              }}
            >
              <span>Total</span>
              <span
                className="mono"
                style={{ fontWeight: 700, fontSize: 16, color: "var(--violet-400)" }}
              >
                {formatCurrency(order.total)}
              </span>
            </div>
          </div>
        </div>
      </CardNew>

      {/* Archivos adjuntos */}
      <CardNew title="Archivos adjuntos">
        {order.files.length === 0 ? (
          <div
            style={{
              padding: "48px 24px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                display: "grid",
                placeItems: "center",
                background: "var(--brand-soft)",
                border: "1px solid var(--border-brand)",
                color: "var(--violet-400)",
              }}
            >
              <FileText size={26} />
            </div>
            <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>Sin archivos adjuntos</div>
            <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0, maxWidth: 340, lineHeight: 1.5 }}>
              La clínica no adjuntó archivos a este pedido. Si los envía, aparecerán aquí listos para descargar.
            </p>
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
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    flexShrink: 0,
                    color: "var(--violet-400)",
                    background: "var(--brand-soft)",
                    border: "1px solid var(--border-brand)",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
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
          <div
            style={{
              padding: "48px 24px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                display: "grid",
                placeItems: "center",
                background: "var(--brand-soft)",
                border: "1px solid var(--border-brand)",
                color: "var(--violet-400)",
              }}
            >
              <Clock size={26} />
            </div>
            <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>Aún no hay movimientos</div>
            <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0, maxWidth: 340, lineHeight: 1.5 }}>
              El historial de este pedido se irá registrando aquí conforme cambie de estado.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {order.events.map((ev, idx) => {
              const meta = DENTAL_LAB_ORDER_STATUS[ev.status];
              const dotColor = TIMELINE_TONE_VARS[meta.tone];
              const when = ev.at ?? ev.createdAt;
              const isLast = idx === order.events.length - 1;
              const actorRoleLabel = ev.actorRole ? ACTOR_LABELS[ev.actorRole] : null;
              const who =
                ev.actorName && actorRoleLabel
                  ? `${ev.actorName} · ${actorRoleLabel}`
                  : ev.actorName ?? actorRoleLabel ?? "—";
              return (
                <div key={ev.id} style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
                  {/* Riel vertical + punto coloreado por tono del estado */}
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
                        style={{
                          position: "absolute",
                          top: 14,
                          bottom: 0,
                          width: 2,
                          background: "var(--border-soft)",
                        }}
                      />
                    )}
                    <span
                      style={{
                        position: "relative",
                        marginTop: 4,
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        background: dotColor,
                        border: "2px solid var(--bg-elev)",
                        boxShadow: `0 0 0 3px color-mix(in srgb, ${dotColor} 22%, transparent)`,
                        flexShrink: 0,
                        alignSelf: "flex-start",
                      }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : 16 }}>
                    <div style={{ marginBottom: 4 }}>
                      <BadgeNew tone={meta.tone} dot>{meta.label}</BadgeNew>
                    </div>
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
                  <Receipt size={12} style={{ color: "var(--violet-400)" }} />
                  Método de pago
                </div>
                <div style={{ color: "var(--text-1)" }}>{paymentMethodLabel(order.paymentMethod)}</div>
                {order.paidAt && (
                  <div className="mono" style={{ color: "var(--text-3)", fontSize: 11, marginTop: 2 }}>
                    Pagado el{" "}
                    {new Date(order.paidAt).toLocaleDateString("es-MX", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </div>
                )}
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
                  <FileText size={12} style={{ color: "var(--violet-400)" }} />
                  Notas
                </div>
                <p style={{ color: "var(--text-1)", whiteSpace: "pre-wrap", margin: 0 }}>{order.notes}</p>
              </div>
            )}
          </div>
        </CardNew>
      )}

      {/* Chat embebido laboratorio↔clínica (minimizable a burbuja) */}
      <OrderChatDock
        side="LAB"
        counterpartId={order.clinicId}
        counterpartName={order.clinic.name}
        counterpartLogoUrl={order.clinic.logoUrl ?? null}
        orderNumber={order.orderNumber}
      />
    </div>
  );
}
