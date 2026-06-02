"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  MapPin,
  Phone,
  Mail,
  Globe,
  MessageCircle,
  Layers,
  Clock,
  Star,
  Send,
  ClipboardList,
  X,
  Upload,
  FileText,
  Trash2,
  Navigation,
  Gauge,
  Truck,
  Bike,
  Car,
  FlaskConical,
  DollarSign,
  Package,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CardNew, ButtonNew, BadgeNew } from "@/components/ui/design-system";
import { fmtMXN } from "@/lib/format";
import {
  DENTAL_LAB_SERVICES,
  DENTAL_LAB_TRAFFIC,
  DENTAL_LAB_FILE_ACCEPT,
  DENTAL_LAB_FILE_MAX_MB,
  type DentalLabTrafficLevel,
} from "@/lib/laboratorios/types";
import { B2B_PAYMENT_METHOD_LABELS, type B2BPaymentMethod } from "@/lib/payments-b2b";

// services en el header son keys del catálogo (s1..s9). Label corto + fallback.
function serviceLabel(key: string): string {
  const found = DENTAL_LAB_SERVICES.find((s) => s.key === key);
  return found ? found.short : key;
}

interface LabData {
  id: string;
  name: string;
  logoUrl: string | null;
  description: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  mapsUrl: string | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  email: string;
  services: string[];
  coverageZones: string[];
  rating: number | null;
  ratingCount: number;
  onTimePct: number | null;
  totalOrders: number;
  founded: number | null;
  trafficLevel: DentalLabTrafficLevel;
  trafficManualMin: number | null;
  trafficManualMax: number | null;
  trafficNote: string | null;
  trafficUpdatedAt: string;
  // Métodos de pago B2B habilitados por el lab (orden canónico).
  paymentMethods: B2BPaymentMethod[];
}

interface ServiceData {
  id: string;
  serviceKey: string;
  name: string;
  description: string | null;
  priceFrom: number;
  unit: string;
  daysMin: number | null;
  daysMax: number | null;
  imageUrl: string | null;
}

interface ClinicInfo {
  address: string | null;
  mapsUrl: string | null;
}

interface LabDetailClientProps {
  lab: LabData;
  services: ServiceData[];
  clinic: ClinicInfo;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border-soft)",
  background: "var(--bg-elev)",
  color: "var(--text-1)",
  fontSize: 13,
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  color: "var(--text-2)",
  fontSize: 12,
  fontWeight: 500,
  marginBottom: 5,
};

const contactItemStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  color: "var(--text-2)",
  fontSize: 13,
};

// Extensiones aceptadas (lowercase). jpeg ≡ jpg.
const ACCEPT_EXT = DENTAL_LAB_FILE_ACCEPT.map((e) => e.toLowerCase()).concat("jpeg");
const ACCEPT_ATTR = ACCEPT_EXT.map((e) => `.${e}`).join(",");
const MAX_BYTES = DENTAL_LAB_FILE_MAX_MB * 1024 * 1024;

function fileExt(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function deliveryLabel(s: ServiceData): string | null {
  if (s.daysMin != null && s.daysMax != null) {
    return s.daysMin === s.daysMax ? `${s.daysMin} días` : `${s.daysMin}–${s.daysMax} días`;
  }
  if (s.daysMax != null) return `hasta ${s.daysMax} días`;
  if (s.daysMin != null) return `desde ${s.daysMin} días`;
  return null;
}

// Rango de recolección/entrega del mensajero derivado del tráfico del lab.
// Si hay override manual (min/max en minutos) lo mostramos; si no, el rango
// sugerido del nivel de tráfico.
function trafficEtaLabel(lab: LabData): string {
  const { trafficManualMin: lo, trafficManualMax: hi } = lab;
  if (lo != null && hi != null) {
    return lo === hi ? `${lo} min` : `${lo}–${hi} min`;
  }
  return DENTAL_LAB_TRAFFIC[lab.trafficLevel].rangeLabel;
}

function TrafficBadge({ lab }: { lab: LabData }) {
  const t = DENTAL_LAB_TRAFFIC[lab.trafficLevel];
  return (
    <BadgeNew tone={t.tone} dot>
      {t.label} · {trafficEtaLabel(lab)}
    </BadgeNew>
  );
}

// Color-coding del tráfico (refuerzo visual [F]): tint suave de fondo, borde y
// color de icono según el tono semántico del nivel (success / warning / danger).
function trafficVars(tone: "success" | "warning" | "danger"): {
  soft: string;
  base: string;
} {
  return { soft: `var(--${tone}-soft)`, base: `var(--${tone})` };
}

// Icono de vehículo por nivel de tráfico (color-coding [F]): el mensajero usa
// bici en tráfico bajo, moto en medio, coche en alto. Mapea
// DENTAL_LAB_TRAFFIC[level].vehicle → icono lucide.
const TRAFFIC_VEHICLE_ICON: Record<"bike" | "motorcycle" | "car", LucideIcon> = {
  bike: Bike,
  motorcycle: Truck,
  car: Car,
};

function trafficVehicleIcon(level: DentalLabTrafficLevel): LucideIcon {
  return TRAFFIC_VEHICLE_ICON[DENTAL_LAB_TRAFFIC[level].vehicle] ?? Gauge;
}

function ServiceCard({
  service,
  onSelect,
}: {
  service: ServiceData;
  onSelect: () => void;
}) {
  const delivery = deliveryLabel(service);
  const [hover, setHover] = useState(false);

  return (
    <div
      className="card"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 14,
        height: "100%",
        borderColor: hover ? "var(--border-brand)" : undefined,
        boxShadow: hover ? "0 12px 28px -16px rgba(124,58,237,0.55)" : undefined,
        transform: hover ? "translateY(-2px)" : "translateY(0)",
        transition: "transform .14s ease, box-shadow .14s ease, border-color .14s ease",
      }}
    >
      {/* Acento superior que se revela al hacer hover (consistencia con la card destacada) */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: "linear-gradient(90deg, var(--violet-400), var(--brand))",
          opacity: hover ? 1 : 0,
          transition: "opacity .14s ease",
        }}
      />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "flex-start",
            gap: 8,
            color: "var(--text-1)",
            fontWeight: 600,
            fontSize: 14,
            lineHeight: 1.3,
            minWidth: 0,
          }}
          title={service.name}
        >
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "var(--brand-soft)",
              border: "1px solid var(--border-brand)",
              color: "var(--violet-400)",
            }}
          >
            <FlaskConical size={14} />
          </span>
          <span style={{ minWidth: 0 }}>{service.name}</span>
        </div>
        <BadgeNew tone="neutral">{serviceLabel(service.serviceKey)}</BadgeNew>
      </div>

      {service.description && (
        <div style={{ color: "var(--text-3)", fontSize: 12, lineHeight: 1.45 }}>
          {service.description}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: "auto" }}>
        <span style={{ color: "var(--text-3)", fontSize: 12 }}>desde</span>
        <span style={{ color: "var(--text-1)", fontWeight: 700, fontSize: 18 }}>
          {fmtMXN(service.priceFrom)}
        </span>
        <span style={{ color: "var(--text-3)", fontSize: 12 }}>/ {service.unit}</span>
      </div>

      {delivery && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            color: "var(--text-3)",
            fontSize: 12,
          }}
        >
          <Clock size={12} />
          Entrega {delivery}
        </div>
      )}

      <ButtonNew
        variant={hover ? "primary" : "secondary"}
        size="sm"
        icon={<Send size={14} />}
        onClick={onSelect}
        style={{ width: "100%", marginTop: 4 }}
      >
        Solicitar este servicio
      </ButtonNew>
    </div>
  );
}

export function LabDetailClient({ lab, services, clinic }: LabDetailClientProps) {
  const router = useRouter();
  const [logoError, setLogoError] = useState(false);

  // Modal "Solicitar servicio" (A3).
  const [modalOpen, setModalOpen] = useState(false);
  const [serviceId, setServiceId] = useState<string>("");
  const [patientName, setPatientName] = useState("");
  const [internalRef, setInternalRef] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState(false);
  // Método de pago: por defecto el primero habilitado por el lab (si hay).
  const [paymentMethod, setPaymentMethod] = useState<string>(lab.paymentMethods[0] ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const locationLabel = [lab.city, lab.state].filter(Boolean).join(", ");
  const showLogo = !!lab.logoUrl && !logoError;
  const showRating = lab.rating != null && lab.rating > 0 && lab.ratingCount > 0;
  const hasLocation = !!(lab.address || lab.mapsUrl);

  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId],
  );
  const traffic = DENTAL_LAB_TRAFFIC[lab.trafficLevel];
  // Icono de vehículo del mensajero según el nivel de tráfico (color-coding [F]).
  const TrafficVehicle = trafficVehicleIcon(lab.trafficLevel);

  function openModal(id: string) {
    setServiceId(id);
    setModalOpen(true);
  }

  function resetForm() {
    setServiceId("");
    setPatientName("");
    setInternalRef("");
    setNotes("");
    setPriority(false);
    setPaymentMethod(lab.paymentMethods[0] ?? "");
    setFiles([]);
    setDragOver(false);
  }

  function handleOpenChange(next: boolean) {
    setModalOpen(next);
    if (!next && !submitting) resetForm();
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    const accepted: File[] = [];
    for (let i = 0; i < incoming.length; i++) {
      const f = incoming[i];
      const ext = fileExt(f.name);
      if (!ext || !ACCEPT_EXT.includes(ext)) {
        toast.error(`"${f.name}": formato no permitido`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        toast.error(`"${f.name}" supera ${DENTAL_LAB_FILE_MAX_MB} MB`);
        continue;
      }
      if (f.size <= 0) {
        toast.error(`"${f.name}" está vacío`);
        continue;
      }
      accepted.push(f);
    }
    if (accepted.length) setFiles((prev) => prev.concat(accepted));
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submitOrder(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      // 1) Crear la orden.
      const res = await fetch(`/api/dental-labs/${lab.id}/ordenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: serviceId || undefined,
          patientName: patientName.trim() || undefined,
          internalRef: internalRef.trim() || undefined,
          notes: notes.trim() || undefined,
          priority,
          paymentMethod: paymentMethod || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "No se pudo solicitar la orden");
      }
      const created = await res.json().catch(() => ({}));
      const orderId: string | undefined = created.orderId;

      // 2) Subir archivos (si hay) en multipart, uno por uno.
      let failed = 0;
      if (files.length > 0) {
        if (!orderId) {
          // La orden se creó pero no recuperamos su id → no podemos adjuntar.
          failed = files.length;
        } else {
          for (let i = 0; i < files.length; i++) {
            const fd = new FormData();
            fd.append("file", files[i]);
            const up = await fetch(
              `/api/dental-labs/${lab.id}/ordenes/${orderId}/files`,
              { method: "POST", body: fd },
            );
            if (!up.ok) failed++;
          }
        }
      }

      if (failed > 0) {
        toast.error(
          `Orden creada, pero ${failed} archivo${failed === 1 ? "" : "s"} no se pudo subir`,
        );
      } else {
        toast.success(
          created.orderNumber ? `Orden ${created.orderNumber} solicitada` : "Orden solicitada",
        );
      }

      resetForm();
      setModalOpen(false);
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al solicitar la orden";
      toast.error(msg || "Error al solicitar la orden");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ padding: "clamp(14px,1.6vw,28px)", maxWidth: 1200, margin: "0 auto" }}>
      {/* Volver */}
      <Link
        href="/dashboard/laboratorios"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--text-3)",
          fontSize: 13,
          textDecoration: "none",
          marginBottom: 16,
        }}
      >
        <ArrowLeft size={14} />
        Laboratorios
      </Link>

      {/* Encabezado de la ficha */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        {/* Glow violeta de fondo (decorativo) */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -40,
            left: -30,
            width: 260,
            height: 160,
            pointerEvents: "none",
            background:
              "radial-gradient(closest-side, color-mix(in srgb, var(--brand) 16%, transparent), transparent)",
            filter: "blur(6px)",
            zIndex: 0,
          }}
        />
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <div
            style={{
              position: "relative",
              width: 64,
              height: 64,
              borderRadius: 12,
              overflow: "hidden",
              flexShrink: 0,
              background: showLogo
                ? "var(--bg-elev-2)"
                : "linear-gradient(135deg, var(--violet-400), var(--brand))",
              boxShadow: showLogo ? undefined : "0 8px 20px -10px rgba(124,58,237,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {showLogo ? (
              <img
                src={lab.logoUrl as string}
                alt={lab.name}
                onError={() => setLogoError(true)}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            ) : (
              <span style={{ color: "#fff", fontWeight: 700, fontSize: 24 }}>
                {lab.name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>

          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                color: "var(--text-1)",
                fontWeight: 600,
                fontSize: "clamp(18px,1.6vw,24px)",
                margin: 0,
              }}
            >
              {lab.name}
            </h1>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "4px 14px",
                marginTop: 4,
                color: "var(--text-3)",
                fontSize: 13,
              }}
            >
              {locationLabel && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <MapPin size={13} />
                  {locationLabel}
                </span>
              )}
              {showRating && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-2)" }}>
                  <Star size={13} style={{ color: "#f5a623" }} />
                  {lab.rating!.toFixed(1)}
                  <span style={{ color: "var(--text-3)" }}>({lab.ratingCount})</span>
                </span>
              )}
              {lab.onTimePct != null && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <Clock size={13} />
                  {lab.onTimePct}% a tiempo
                </span>
              )}
              {lab.totalOrders > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <ClipboardList size={13} />
                  {lab.totalOrders} órdenes
                </span>
              )}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, alignItems: "center" }}>
              <TrafficBadge lab={lab} />
              {lab.services.map((key) => (
                <BadgeNew key={key} tone="brand">
                  {serviceLabel(key)}
                </BadgeNew>
              ))}
            </div>
          </div>
        </div>

        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {/* Chat clínica↔laboratorio (espejo del botón de proveedores). La ruta
              /dashboard/lab-chat/[labId] la provee el módulo de chat de labs. */}
          <Link
            href={`/dashboard/lab-chat/${lab.id}`}
            className="btn-new btn-new--secondary"
            style={{ textDecoration: "none" }}
          >
            <MessageCircle size={14} />
            Chatear
          </Link>
          <ButtonNew variant="primary" icon={<Send size={14} />} onClick={() => openModal("")}>
            Solicitar orden
          </ButtonNew>
        </div>
      </div>

      {/* Datos de contacto */}
      <CardNew>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {lab.description && (
            <p style={{ color: "var(--text-2)", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
              {lab.description}
            </p>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px" }}>
            {lab.phone && (
              <span style={contactItemStyle}>
                <Phone size={14} style={{ color: "var(--text-3)" }} />
                {lab.phone}
              </span>
            )}
            {lab.whatsapp && (
              <span style={contactItemStyle}>
                <MessageCircle size={14} style={{ color: "var(--text-3)" }} />
                {lab.whatsapp}
              </span>
            )}
            <span style={contactItemStyle}>
              <Mail size={14} style={{ color: "var(--text-3)" }} />
              {lab.email}
            </span>
            {lab.website && (
              <a
                href={lab.website.startsWith("http") ? lab.website : `https://${lab.website}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...contactItemStyle, color: "var(--brand)", textDecoration: "none" }}
              >
                <Globe size={14} style={{ color: "var(--text-3)" }} />
                {lab.website}
              </a>
            )}
          </div>

          {lab.coverageZones.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <span style={{ color: "var(--text-3)", fontSize: 13 }}>Cobertura:</span>
              {lab.coverageZones.map((z) => (
                <BadgeNew key={z} tone="neutral">
                  {z}
                </BadgeNew>
              ))}
            </div>
          )}
        </div>
      </CardNew>

      {/* Ubicación del laboratorio + tráfico */}
      <div style={{ marginTop: 16 }}>
        <CardNew>
          {/* Acento superior [E] — única card destacada de la pantalla */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: "linear-gradient(90deg, var(--violet-400), var(--brand))",
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
              color: "var(--text-1)",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 9,
                flexShrink: 0,
                display: "grid",
                placeItems: "center",
                background: "var(--brand-soft)",
                border: "1px solid var(--border-brand)",
                color: "var(--violet-400)",
              }}
            >
              <MapPin size={15} />
            </span>
            Ubicación del laboratorio
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {hasLocation ? (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 20px" }}>
                {lab.address && (
                  <span style={contactItemStyle}>
                    <MapPin size={14} style={{ color: "var(--text-3)" }} />
                    {lab.address}
                  </span>
                )}
                {lab.mapsUrl && (
                  <a
                    href={lab.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ ...contactItemStyle, color: "var(--brand)", textDecoration: "none" }}
                  >
                    <Navigation size={14} />
                    Ver en Google Maps
                  </a>
                )}
              </div>
            ) : (
              <span style={{ color: "var(--text-3)", fontSize: 13 }}>
                Este laboratorio aún no publicó su dirección.
              </span>
            )}

            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 10,
                overflow: "hidden",
                background:
                  "linear-gradient(135deg, var(--lab-map-from), var(--lab-map-to))",
                border: `1px solid ${trafficVars(traffic.tone).base}`,
                boxShadow: `inset 0 0 0 9999px ${trafficVars(traffic.tone).soft}`,
              }}
            >
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  flexShrink: 0,
                  marginTop: 1,
                  display: "grid",
                  placeItems: "center",
                  background: trafficVars(traffic.tone).soft,
                  border: `1px solid ${trafficVars(traffic.tone).base}`,
                  color: trafficVars(traffic.tone).base,
                  boxShadow: `0 0 12px -4px ${trafficVars(traffic.tone).base}`,
                }}
              >
                <TrafficVehicle size={16} />
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <TrafficBadge lab={lab} />
                  <span style={{ color: "var(--text-3)", fontSize: 12 }}>
                    tiempo estimado de recolección / entrega
                  </span>
                </div>
                <span style={{ color: "var(--text-2)", fontSize: 12, lineHeight: 1.45 }}>
                  {lab.trafficNote || traffic.desc}
                </span>
              </div>
            </div>
          </div>
        </CardNew>
      </div>

      {/* Servicios */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 9,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "var(--brand-soft)",
              border: "1px solid var(--border-brand)",
              color: "var(--violet-400)",
            }}
          >
            <Layers size={15} />
          </span>
          <h2 style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 18, margin: 0 }}>
            Servicios
          </h2>
          <span style={{ color: "var(--text-3)", fontSize: 13 }}>({services.length})</span>
        </div>

        {services.length === 0 ? (
          <CardNew>
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
                <Layers size={26} />
              </div>
              <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>
                Aún sin servicios con precio
              </div>
              <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0, maxWidth: 340, lineHeight: 1.5 }}>
                Este laboratorio aún no publicó servicios con precio. Puedes solicitar una orden
                general con el botón “Solicitar orden”.
              </p>
            </div>
          </CardNew>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 16,
            }}
          >
            {services.map((s) => (
              <ServiceCard key={s.id} service={s} onSelect={() => openModal(s.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Modal: Solicitar servicio (A3) */}
      <Dialog.Root open={modalOpen} onOpenChange={handleOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="modal-overlay" />
          <Dialog.Content
            className="modal modal--wide"
            aria-describedby={undefined}
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "calc(100vw - 32px)",
              maxHeight: "90vh",
              zIndex: 101,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div className="modal__header">
              <Dialog.Title
                className="modal__title"
                style={{ display: "inline-flex", alignItems: "center", gap: 9 }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 9,
                    flexShrink: 0,
                    display: "grid",
                    placeItems: "center",
                    color: "#fff",
                    background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
                    boxShadow: "0 6px 16px -8px rgba(124,58,237,0.6)",
                  }}
                >
                  <Send size={15} />
                </span>
                Solicitar servicio
              </Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label="Cerrar">
                  <X size={14} />
                </button>
              </Dialog.Close>
            </div>

            <form
              onSubmit={submitOrder}
              style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}
            >
              <div className="modal__body" style={{ overflowY: "auto" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={labelStyle} htmlFor="lab-order-service">
                      Servicio
                    </label>
                    <select
                      id="lab-order-service"
                      value={serviceId}
                      onChange={(e) => setServiceId(e.target.value)}
                      style={inputStyle}
                    >
                      <option value="">Sin servicio específico</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} — desde {fmtMXN(s.priceFrom)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Método de pago: entre los habilitados por el lab. */}
                  {lab.paymentMethods.length > 0 ? (
                    <div>
                      <label style={labelStyle} htmlFor="lab-order-payment">
                        Método de pago
                      </label>
                      <select
                        id="lab-order-payment"
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        style={inputStyle}
                      >
                        {lab.paymentMethods.map((m) => (
                          <option key={m} value={m}>
                            {B2B_PAYMENT_METHOD_LABELS[m]}
                          </option>
                        ))}
                      </select>
                      <span style={{ display: "block", color: "var(--text-4)", fontSize: 11, marginTop: 4 }}>
                        La orden se crea sin pagar; coordinas el pago según el método elegido.
                      </span>
                    </div>
                  ) : (
                    <div style={{ color: "var(--text-3)", fontSize: 12, lineHeight: 1.5 }}>
                      Este laboratorio aún no configuró métodos de pago; se acuerda directamente con él.
                    </div>
                  )}

                  {/* Resumen: costo + ETA + recolección */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        background: "var(--brand-soft)",
                        border: "1px solid var(--border-brand)",
                      }}
                    >
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          color: "var(--violet-400)",
                          fontSize: 11,
                          marginBottom: 4,
                        }}
                      >
                        <DollarSign size={12} />
                        Costo estimado
                      </div>
                      <div style={{ color: "var(--text-1)", fontWeight: 700, fontSize: 18 }}>
                        {selectedService ? fmtMXN(selectedService.priceFrom) : "Por cotizar"}
                      </div>
                      {selectedService && (
                        <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 2 }}>
                          desde · / {selectedService.unit}
                        </div>
                      )}
                    </div>

                    <div
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        background: trafficVars(traffic.tone).soft,
                        border: `1px solid ${trafficVars(traffic.tone).base}`,
                      }}
                    >
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          color: trafficVars(traffic.tone).base,
                          fontSize: 11,
                          marginBottom: 4,
                        }}
                      >
                        <TrafficVehicle size={12} />
                        Entrega estimada (ETA)
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <TrafficVehicle size={14} style={{ color: trafficVars(traffic.tone).base }} />
                        <span style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>
                          {trafficEtaLabel(lab)}
                        </span>
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <BadgeNew tone={traffic.tone} dot>
                          {traffic.label}
                        </BadgeNew>
                      </div>
                    </div>
                  </div>

                  {/* Recolección en la dirección de la clínica */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: "var(--info-soft)",
                      border: "1px solid var(--info)",
                    }}
                  >
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 9,
                        flexShrink: 0,
                        marginTop: 1,
                        display: "grid",
                        placeItems: "center",
                        background: "var(--info-soft)",
                        border: "1px solid var(--info)",
                        color: "var(--info)",
                      }}
                    >
                      <Package size={15} />
                    </span>
                    <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                      <span style={{ color: "var(--text-2)" }}>Recolección: </span>
                      {clinic.address ? (
                        <span style={{ color: "var(--text-1)" }}>
                          el laboratorio recoge en tu clínica — {clinic.address}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-3)" }}>
                          aún no registras la dirección de tu clínica.{" "}
                          <Link
                            href="/dashboard/settings"
                            style={{ color: "var(--brand)", textDecoration: "none" }}
                          >
                            Configúrala en Ajustes
                          </Link>
                        </span>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                      gap: 14,
                    }}
                  >
                    <div>
                      <label style={labelStyle} htmlFor="lab-order-patient">
                        Paciente (opcional)
                      </label>
                      <input
                        id="lab-order-patient"
                        value={patientName}
                        onChange={(e) => setPatientName(e.target.value)}
                        placeholder="Nombre del paciente"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle} htmlFor="lab-order-ref">
                        Referencia interna (opcional)
                      </label>
                      <input
                        id="lab-order-ref"
                        value={internalRef}
                        onChange={(e) => setInternalRef(e.target.value)}
                        placeholder="Ej. REF-1234"
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={labelStyle} htmlFor="lab-order-notes">
                      Notas / instrucciones (opcional)
                    </label>
                    <textarea
                      id="lab-order-notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Color, material, indicaciones especiales…"
                      rows={3}
                      style={{ ...inputStyle, resize: "vertical" }}
                    />
                  </div>

                  {/* Archivos */}
                  <div>
                    <label style={labelStyle}>Archivos (escaneos, diseños, radiografías)</label>
                    <label
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(false);
                        addFiles(e.dataTransfer.files);
                      }}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        padding: "18px 14px",
                        borderRadius: 10,
                        border: `1px dashed ${dragOver ? "var(--border-brand)" : "var(--border-soft)"}`,
                        background: dragOver ? "var(--brand-soft)" : "var(--bg-elev)",
                        color: "var(--text-3)",
                        cursor: "pointer",
                        textAlign: "center",
                        transition: "all .12s",
                      }}
                    >
                      <input
                        type="file"
                        multiple
                        accept={ACCEPT_ATTR}
                        onChange={(e) => {
                          addFiles(e.target.files);
                          e.target.value = "";
                        }}
                        style={{ display: "none" }}
                      />
                      <span
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 10,
                          display: "grid",
                          placeItems: "center",
                          background: "var(--brand-soft)",
                          border: "1px solid var(--border-brand)",
                          color: "var(--violet-400)",
                          marginBottom: 2,
                        }}
                      >
                        <Upload size={18} />
                      </span>
                      <span style={{ fontSize: 13, color: "var(--text-2)" }}>
                        Arrastra o haz clic para subir
                      </span>
                      <span style={{ fontSize: 11 }}>
                        {DENTAL_LAB_FILE_ACCEPT.join(", ")} · máx {DENTAL_LAB_FILE_MAX_MB} MB c/u
                      </span>
                    </label>

                    {files.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                        {files.map((f, i) => (
                          <div
                            key={`${f.name}-${i}`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "6px 10px",
                              borderRadius: 8,
                              background: "var(--bg-elev)",
                              border: "1px solid var(--border-soft)",
                            }}
                          >
                            <FileText size={14} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                color: "var(--text-1)",
                                fontSize: 12,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                              title={f.name}
                            >
                              {f.name}
                            </span>
                            <span style={{ color: "var(--text-3)", fontSize: 11, flexShrink: 0 }}>
                              {formatBytes(f.size)}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeFile(i)}
                              aria-label={`Quitar ${f.name}`}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                background: "transparent",
                                border: "none",
                                color: "var(--text-3)",
                                cursor: "pointer",
                                padding: 2,
                                flexShrink: 0,
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      color: "var(--text-2)",
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={priority}
                      onChange={(e) => setPriority(e.target.checked)}
                      style={{ width: 15, height: 15, cursor: "pointer" }}
                    />
                    Marcar como orden prioritaria
                  </label>

                  <p style={{ color: "var(--text-4)", fontSize: 11, margin: 0, lineHeight: 1.5 }}>
                    La orden se crea en estado “Solicitada”. El pago se acuerda con el laboratorio.
                  </p>
                </div>
              </div>

              <div className="modal__footer">
                <ButtonNew type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                  Cancelar
                </ButtonNew>
                <ButtonNew type="submit" variant="primary" icon={<Send size={14} />} disabled={submitting}>
                  {submitting ? "Enviando…" : "Solicitar orden"}
                </ButtonNew>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
