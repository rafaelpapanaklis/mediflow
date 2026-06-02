"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, FlaskConical, MapPin, Layers, Star } from "lucide-react";
import { BadgeNew } from "@/components/ui/design-system";
import {
  DENTAL_LAB_SERVICES,
  DENTAL_LAB_TRAFFIC,
  type DentalLabTrafficLevel,
} from "@/lib/laboratorios/types";

// services es un String[] de keys del catálogo fijo (s1..s9). Mostramos el
// label corto; si la key no estuviera en el catálogo, caemos a la key cruda.
function serviceLabel(key: string): string {
  const found = DENTAL_LAB_SERVICES.find((s) => s.key === key);
  return found ? found.short : key;
}

// Orden canónico del catálogo, para ordenar los chips de filtro de forma estable.
const SERVICE_ORDER: string[] = DENTAL_LAB_SERVICES.map((s) => s.key);

interface Lab {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  city: string | null;
  state: string | null;
  services: string[];
  description: string | null;
  rating: number | null;
  onTimePct: number | null;
  trafficLevel: DentalLabTrafficLevel;
  trafficManualMin: number | null;
  trafficManualMax: number | null;
  serviceCount: number;
}

// Rango ETA del mensajero según tráfico (override manual en minutos si existe).
function trafficEtaLabel(lab: Lab): string {
  const lo = lab.trafficManualMin;
  const hi = lab.trafficManualMax;
  if (lo != null && hi != null) {
    return lo === hi ? `${lo} min` : `${lo}–${hi} min`;
  }
  return DENTAL_LAB_TRAFFIC[lab.trafficLevel].rangeLabel;
}

function LabLogo({ lab }: { lab: Lab }) {
  const [err, setErr] = useState(false);
  const initial = lab.name.trim().charAt(0).toUpperCase() || "?";

  if (lab.logoUrl && !err) {
    return (
      <img
        src={lab.logoUrl}
        alt={lab.name}
        onError={() => setErr(true)}
        style={{
          width: 48,
          height: 48,
          borderRadius: 10,
          objectFit: "cover",
          background: "var(--bg-elev-2)",
          border: "1px solid var(--border-soft)",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: 48,
        height: 48,
        borderRadius: 10,
        background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
        border: "1px solid var(--border-brand)",
        boxShadow: "0 6px 16px -8px rgba(124,58,237,0.55)",
        display: "grid",
        placeItems: "center",
        color: "#fff",
        fontWeight: 600,
        fontSize: 18,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

function LabCard({ lab }: { lab: Lab }) {
  const [hover, setHover] = useState(false);
  const location = [lab.city, lab.state].filter(Boolean).join(", ");
  const showRating = lab.rating != null && lab.rating > 0;

  return (
    <Link
      href={`/dashboard/laboratorios/${lab.id}`}
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <div
        className="card"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          cursor: "pointer",
          height: "100%",
          transition: "border-color .12s, transform .12s, box-shadow .12s",
          borderColor: hover ? "var(--border-brand)" : undefined,
          transform: hover ? "translateY(-2px)" : undefined,
          boxShadow: hover ? "0 12px 28px -14px rgba(124,58,237,0.55)" : undefined,
        }}
      >
        <div className="card__body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <LabLogo lab={lab} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  color: "var(--text-1)",
                  fontWeight: 600,
                  fontSize: 14,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {lab.name}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 2,
                  color: "var(--text-3)",
                  fontSize: 12,
                }}
              >
                {location && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      minWidth: 0,
                    }}
                  >
                    <MapPin size={12} />
                    <span
                      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {location}
                    </span>
                  </span>
                )}
                {showRating && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      flexShrink: 0,
                      color: "var(--text-2)",
                    }}
                  >
                    <Star size={12} style={{ color: "#f5a623" }} />
                    {lab.rating!.toFixed(1)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {lab.description && (
            <p
              style={{
                color: "var(--text-3)",
                fontSize: 12,
                margin: 0,
                lineHeight: 1.45,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {lab.description}
            </p>
          )}

          {lab.services.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {lab.services.slice(0, 3).map((key) => (
                <BadgeNew key={key} tone="neutral">
                  {serviceLabel(key)}
                </BadgeNew>
              ))}
              {lab.services.length > 3 && (
                <BadgeNew tone="neutral">+{lab.services.length - 3}</BadgeNew>
              )}
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              color: "var(--text-3)",
              fontSize: 12,
              marginTop: "auto",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Layers size={12} style={{ color: "var(--violet-400)" }} />
              {lab.serviceCount} {lab.serviceCount === 1 ? "servicio" : "servicios"}
            </span>
            <BadgeNew tone={DENTAL_LAB_TRAFFIC[lab.trafficLevel].tone} dot>
              {trafficEtaLabel(lab)}
            </BadgeNew>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function LaboratoriosClient({ initialLabs }: { initialLabs: Lab[] }) {
  const [search, setSearch] = useState("");
  const [activeService, setActiveService] = useState<string | null>(null);

  // Universo de servicios = unión de las keys de todos los labs, ordenado por
  // el catálogo canónico (s1..s9).
  const services = useMemo(() => {
    const set = new Set<string>();
    for (const l of initialLabs) {
      for (const s of l.services) set.add(s);
    }
    return Array.from(set).sort((a, b) => {
      const ia = SERVICE_ORDER.indexOf(a);
      const ib = SERVICE_ORDER.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  }, [initialLabs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialLabs.filter((l) => {
      if (activeService && !l.services.includes(activeService)) return false;
      if (!q) return true;
      const haystack = [l.name, l.city ?? "", l.state ?? "", ...l.services.map(serviceLabel)]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [initialLabs, search, activeService]);

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            color: "#fff",
            background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
            boxShadow: "0 8px 20px -8px rgba(124,58,237,0.6)",
          }}
        >
          <FlaskConical size={22} />
        </div>
        <div>
          <h1
            style={{
              fontSize: "clamp(16px, 1.4vw, 22px)",
              color: "var(--text-1)",
              fontWeight: 600,
              margin: 0,
            }}
          >
            Laboratorios
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
            {initialLabs.length}{" "}
            {initialLabs.length === 1 ? "laboratorio disponible" : "laboratorios disponibles"}
          </p>
        </div>
      </div>

      {/* Filters */}
      {initialLabs.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div className="search-field" style={{ maxWidth: 360 }}>
            <Search size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar laboratorio…"
            />
          </div>

          {services.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              <ServiceChip
                label="Todos"
                active={activeService === null}
                onClick={() => setActiveService(null)}
              />
              {services.map((key) => (
                <ServiceChip
                  key={key}
                  label={serviceLabel(key)}
                  active={activeService === key}
                  onClick={() => setActiveService(activeService === key ? null : key)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      {initialLabs.length === 0 ? (
        <EmptyState
          icon={<FlaskConical size={26} />}
          title="Aún no hay laboratorios disponibles"
          text="En cuanto haya laboratorios dados de alta aparecerán aquí para que puedas explorarlos y solicitar órdenes."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search size={26} />}
          title="Sin resultados"
          text="No encontramos laboratorios con esos criterios. Prueba con otra búsqueda o quita los filtros de servicio."
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {filtered.map((l) => (
            <LabCard key={l.id} lab={l} />
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 12px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
        color: active ? "var(--violet-400)" : "var(--text-2)",
        background: active ? "var(--brand-soft)" : "var(--bg-elev)",
        border: `1px solid ${active ? "var(--border-brand)" : "var(--border-soft)"}`,
        boxShadow: active ? "0 0 0 3px var(--brand-softer)" : undefined,
        transition: "all .12s",
      }}
    >
      {label}
    </button>
  );
}

function EmptyState({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
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
        {icon}
      </div>
      <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>{title}</div>
      <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0, maxWidth: 340, lineHeight: 1.5 }}>
        {text}
      </p>
    </div>
  );
}
