"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  FlaskConical,
  MapPin,
  Layers,
  Star,
  Bike,
  Truck,
  Car,
  Gauge,
  Building2,
  ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BadgeNew, KpiCard } from "@/components/ui/design-system";
import { useT } from "@/i18n/i18n-provider";
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

// Icono de vehículo del mensajero según el tráfico del lab. Mapea el campo
// vehicle del catálogo (bike → Bike, motorcycle → Truck, car → Car) a un
// icono lucide existente, reforzando el color-coding [F].
const TRAFFIC_VEHICLE_ICON: Record<"bike" | "motorcycle" | "car", LucideIcon> = {
  bike: Bike,
  motorcycle: Truck,
  car: Car,
};

// Color-coding del tráfico: tint suave + color base por tono semántico.
function trafficVars(tone: "success" | "warning" | "danger"): { soft: string; base: string } {
  return { soft: `var(--${tone}-soft)`, base: `var(--${tone})` };
}

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
          width: 52,
          height: 52,
          borderRadius: 12,
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
        width: 52,
        height: 52,
        borderRadius: 12,
        background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
        border: "1px solid var(--border-brand)",
        boxShadow: "0 6px 16px -8px rgba(124,58,237,0.55)",
        display: "grid",
        placeItems: "center",
        color: "#fff",
        fontWeight: 700,
        fontSize: 20,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

function LabCard({ lab }: { lab: Lab }) {
  const t = useT();
  const [hover, setHover] = useState(false);
  const location = [lab.city, lab.state].filter(Boolean).join(", ");
  const showRating = lab.rating != null && lab.rating > 0;
  const traffic = DENTAL_LAB_TRAFFIC[lab.trafficLevel];
  const tv = trafficVars(traffic.tone);
  const VehicleIcon = TRAFFIC_VEHICLE_ICON[traffic.vehicle];

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
          position: "relative",
          overflow: "hidden",
          transition:
            "transform .14s ease, box-shadow .14s ease, border-color .14s ease",
          borderColor: hover ? "var(--border-brand)" : undefined,
          transform: hover ? "translateY(-2px)" : undefined,
          boxShadow: hover ? "0 12px 28px -16px rgba(124,58,237,0.55)" : undefined,
        }}
      >
        {/* Acento superior de la card */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "linear-gradient(90deg, var(--violet-400), var(--brand))",
            opacity: hover ? 1 : 0.85,
            transition: "opacity .14s ease",
          }}
        />

        <div
          className="card__body"
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <LabLogo lab={lab} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  color: "var(--text-1)",
                  fontWeight: 600,
                  fontSize: 15,
                  letterSpacing: "-0.01em",
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
                  marginTop: 3,
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
                    <MapPin size={12} style={{ color: "var(--violet-400)", flexShrink: 0 }} />
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
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
                      fontWeight: 600,
                    }}
                  >
                    <Star size={12} style={{ color: "#f5a623", fill: "#f5a623" }} />
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
                <BadgeNew key={key} tone="brand">
                  {serviceLabel(key)}
                </BadgeNew>
              ))}
              {lab.services.length > 3 && (
                <BadgeNew tone="neutral">+{lab.services.length - 3}</BadgeNew>
              )}
            </div>
          )}

          {/* Panel de tráfico color-coded: tint + borde + icono de vehículo */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              borderRadius: 10,
              background: tv.soft,
              border: `1px solid ${tv.base}`,
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
                background: tv.soft,
                border: `1px solid ${tv.base}`,
                color: tv.base,
                boxShadow: `0 0 12px -4px ${tv.base}`,
              }}
            >
              <VehicleIcon size={15} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--text-1)",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                <Gauge size={13} style={{ color: tv.base, flexShrink: 0 }} />
                {trafficEtaLabel(lab)}
              </div>
              <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 1 }}>
                {traffic.label}
              </div>
            </div>
            <BadgeNew tone={traffic.tone} dot>
              {traffic.label.replace("Tráfico ", "")}
            </BadgeNew>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              marginTop: "auto",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: "var(--text-3)",
                fontSize: 12,
              }}
            >
              <Layers size={12} style={{ color: "var(--violet-400)" }} />
              {t("procurement.labsClient.serviceCount", { count: lab.serviceCount })}
            </span>
            {/* CTA visual: <span> (no <button>) para no anidar interactivos
                dentro del <Link> que envuelve la card; la navegación la
                resuelve ese Link a /dashboard/laboratorios/[labId]. */}
            <span
              className={`btn-new btn-new--${hover ? "primary" : "secondary"} btn-new--sm`}
              style={{ flexShrink: 0 }}
            >
              {t("procurement.labsClient.viewLab")}
              <ChevronRight size={14} />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function LaboratoriosClient({ initialLabs }: { initialLabs: Lab[] }) {
  const t = useT();
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

  // KPIs derivados solo de datos YA disponibles (sin queries nuevas).
  const kpis = useMemo(() => {
    let fast = 0;
    let rated = 0;
    let ratingSum = 0;
    for (const l of initialLabs) {
      if (l.trafficLevel === "LOW") fast++;
      if (l.rating != null && l.rating > 0) {
        rated++;
        ratingSum += l.rating;
      }
    }
    return {
      total: initialLabs.length,
      categories: services.length,
      fast,
      avgRating: rated > 0 ? ratingSum / rated : null,
    };
  }, [initialLabs, services]);

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
      {/* HERO */}
      <div style={{ position: "relative", marginBottom: 22 }}>
        {/* Glow violeta de fondo */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -40,
            left: -20,
            width: 320,
            height: 180,
            borderRadius: "50%",
            pointerEvents: "none",
            background:
              "radial-gradient(closest-side, rgba(124,58,237,0.16), transparent)",
            filter: "blur(8px)",
            zIndex: 0,
          }}
        />
        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
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
            <FlaskConical size={22} />
          </div>
          <div>
            <h1
              style={{
                fontSize: 22,
                color: "var(--text-1)",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                margin: 0,
              }}
            >
              {t("procurement.labsClient.heroTitle")}
            </h1>
            <p style={{ color: "var(--text-3)", fontSize: 14, marginTop: 4 }}>
              {t("procurement.labsClient.heroSubtitle")}
            </p>
          </div>
        </div>
      </div>

      {/* KPIs — solo con datos ya disponibles */}
      {initialLabs.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 14,
            marginBottom: 20,
          }}
        >
          <KpiCard label={t("procurement.labsClient.kpiLabs")} value={String(kpis.total)} icon={Building2} />
          <KpiCard label={t("procurement.labsClient.kpiServiceTypes")} value={String(kpis.categories)} icon={Layers} />
          <KpiCard label={t("procurement.labsClient.kpiFastDelivery")} value={String(kpis.fast)} icon={Bike} />
          <KpiCard
            label={t("procurement.labsClient.kpiAvgRating")}
            value={kpis.avgRating != null ? kpis.avgRating.toFixed(1) : "—"}
            icon={Star}
          />
        </div>
      )}

      {/* Filtros */}
      {initialLabs.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div className="search-field" style={{ maxWidth: 380 }}>
            <Search size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("procurement.labsClient.searchPlaceholder")}
            />
          </div>

          {services.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              <ServiceChip
                label={t("common.all")}
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

      {/* Contenido */}
      {initialLabs.length === 0 ? (
        <EmptyState
          icon={<FlaskConical size={26} />}
          title={t("procurement.labsClient.emptyTitle")}
          text={t("procurement.labsClient.emptyText")}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search size={26} />}
          title={t("common.noResults")}
          text={t("procurement.labsClient.noResultsText")}
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
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
