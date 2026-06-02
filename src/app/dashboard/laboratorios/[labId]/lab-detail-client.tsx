"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
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
} from "lucide-react";
import { CardNew, ButtonNew, BadgeNew } from "@/components/ui/design-system";
import { fmtMXN } from "@/lib/format";
import { DENTAL_LAB_SERVICES } from "@/lib/laboratorios/types";

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

interface LabDetailClientProps {
  lab: LabData;
  services: ServiceData[];
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

function deliveryLabel(s: ServiceData): string | null {
  if (s.daysMin != null && s.daysMax != null) {
    return s.daysMin === s.daysMax ? `${s.daysMin} días` : `${s.daysMin}–${s.daysMax} días`;
  }
  if (s.daysMax != null) return `hasta ${s.daysMax} días`;
  if (s.daysMin != null) return `desde ${s.daysMin} días`;
  return null;
}

function ServiceCard({
  service,
  onSelect,
}: {
  service: ServiceData;
  onSelect: () => void;
}) {
  const delivery = deliveryLabel(service);

  return (
    <div
      className="card"
      style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14, height: "100%" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div
          style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14, lineHeight: 1.3 }}
          title={service.name}
        >
          {service.name}
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
        variant="secondary"
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

export function LabDetailClient({ lab, services }: LabDetailClientProps) {
  const [logoError, setLogoError] = useState(false);

  // Estado del formulario "Solicitar orden".
  const [serviceId, setServiceId] = useState<string>("");
  const [patientName, setPatientName] = useState("");
  const [internalRef, setInternalRef] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const formRef = useRef<HTMLDivElement>(null);

  const locationLabel = [lab.city, lab.state].filter(Boolean).join(", ");
  const showLogo = !!lab.logoUrl && !logoError;
  const showRating = lab.rating != null && lab.rating > 0 && lab.ratingCount > 0;

  function pickService(id: string) {
    setServiceId(id);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function submitOrder(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`/api/dental-labs/${lab.id}/ordenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: serviceId || undefined,
          patientName: patientName.trim() || undefined,
          internalRef: internalRef.trim() || undefined,
          notes: notes.trim() || undefined,
          priority,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "No se pudo solicitar la orden");
      }
      const j = await res.json().catch(() => ({}));
      toast.success(j.orderNumber ? `Orden ${j.orderNumber} solicitada` : "Orden solicitada");
      // Reset
      setServiceId("");
      setPatientName("");
      setInternalRef("");
      setNotes("");
      setPriority(false);
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
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <div
            style={{
              position: "relative",
              width: 64,
              height: 64,
              borderRadius: 12,
              overflow: "hidden",
              flexShrink: 0,
              background: "var(--bg-elev-2)",
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
              <span style={{ color: "var(--text-2)", fontWeight: 700, fontSize: 24 }}>
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

            {lab.services.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {lab.services.map((key) => (
                  <BadgeNew key={key} tone="brand">
                    {serviceLabel(key)}
                  </BadgeNew>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
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
          <ButtonNew
            variant="primary"
            icon={<Send size={14} />}
            onClick={() => pickService("")}
          >
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
            {lab.address && (
              <span style={contactItemStyle}>
                <MapPin size={14} style={{ color: "var(--text-3)" }} />
                {lab.address}
              </span>
            )}
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

      {/* Servicios */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
          <h2 style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 18, margin: 0 }}>
            Servicios
          </h2>
          <span style={{ color: "var(--text-3)", fontSize: 13 }}>({services.length})</span>
        </div>

        {services.length === 0 ? (
          <CardNew>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--text-3)",
              }}
            >
              <Layers size={36} style={{ color: "var(--text-4)" }} />
              <span style={{ fontSize: 14 }}>
                Este laboratorio aún no publicó servicios con precio. Puedes solicitar una orden
                general con el formulario de abajo.
              </span>
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
              <ServiceCard key={s.id} service={s} onSelect={() => pickService(s.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Solicitar orden */}
      <div ref={formRef} style={{ marginTop: 24 }}>
        <CardNew title="Solicitar orden" sub="La orden se crea en estado “Solicitada”. El pago se acuerda con el laboratorio.">
          <form onSubmit={submitOrder} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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

            <div>
              <ButtonNew
                type="submit"
                variant="primary"
                icon={<Send size={14} />}
                disabled={submitting}
              >
                {submitting ? "Enviando…" : "Solicitar orden"}
              </ButtonNew>
            </div>
          </form>
        </CardNew>
      </div>
    </div>
  );
}
