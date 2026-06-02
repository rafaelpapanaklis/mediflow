"use client";

// ═══════════════════════════════════════════════════════════════════════
// Seguimiento de entrega de una orden de laboratorio (LAB → CLÍNICA).
//
// Dos piezas presentacionales (data-aware, SIN Google Maps en vivo):
//   • <OrderTrackingHero>  — banda oscura con gradiente: "Próxima llegada
//     estimada" (hora) + "Faltan" (cuenta regresiva) + nivel de tráfico.
//   • <OrderRouteMap>      — mapa ilustrativo A→B con trazo punteado animado,
//     mensajero en camino y burbuja de ETA, color según el tráfico.
//
// Se alimentan SOLO de datos que ya existen en la orden (etaAt/pickupAt,
// trafficLevel del lab, courier). Degradan con gracia si faltan datos.
// Es ilustrativo: se puede subir a un mapa real después.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import {
  Navigation,
  Timer,
  Clock,
  MapPin,
  FlaskConical,
  Building2,
  Bike,
  Truck,
  Car,
  PackageCheck,
  type LucideIcon,
} from "lucide-react";
import {
  DENTAL_LAB_TRAFFIC,
  type DentalLabOrderStatus,
  type DentalLabTrafficLevel,
} from "@/lib/laboratorios/types";

type Tone = "success" | "warning" | "danger";

// Vehículo (bici → despejado, moto → moderado, coche → denso). Mismo mapeo
// que el panel de tráfico del lab (traffic-control.tsx).
const VEHICLE_ICON: Record<"bike" | "motorcycle" | "car", LucideIcon> = {
  bike: Bike,
  motorcycle: Truck,
  car: Car,
};

const TONE_COLOR: Record<Tone, string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

// Endpoint de la ruta (un extremo: laboratorio o clínica).
export interface RouteEndpoint {
  /** Etiqueta corta del extremo: "LAB" / "CLÍNICA". */
  label?: string;
  /** Nombre legible (lab o clínica). */
  name: string;
  /** Enlace a Google Maps si existe. */
  mapsUrl?: string | null;
}

export interface OrderTrackingProps {
  status: DentalLabOrderStatus;
  /** Nivel de tráfico del laboratorio (define el color del trazo). */
  trafficLevel?: DentalLabTrafficLevel | null;
  /** ISO — hora estimada de llegada. */
  etaAt?: string | null;
  /** ISO — hora de recolección. */
  pickupAt?: string | null;
  /** Datos del mensajero (nombre/vehículo/minutos). */
  courier?: {
    name?: string | null;
    vehicle?: string | null;
    etaMinutes?: number | null;
    plate?: string | null;
  } | null;
  /** Origen del recorrido (laboratorio). */
  origin: RouteEndpoint;
  /** Destino del recorrido (clínica). */
  destination: RouteEndpoint;
}

// ── Helpers de presentación ──────────────────────────────────────────────

function trafficMeta(level?: DentalLabTrafficLevel | null) {
  return level ? DENTAL_LAB_TRAFFIC[level] : null;
}

// Fracción del recorrido (0..1) según el estado de la orden.
function progressFor(status: DentalLabOrderStatus): number {
  switch (status) {
    case "SOLICITADA":
      return 0.06;
    case "RECIBIDA":
      return 0.16;
    case "ATENDIENDO":
      return 0.24;
    case "ENVIADA":
      return 0.62;
    case "ENTREGADA":
      return 1;
    default:
      return 0.5;
  }
}

// Punto sobre la curva Bézier cúbica en t∈[0,1] (espacio 0..100).
const P0 = { x: 10, y: 70 };
const P1 = { x: 38, y: 26 };
const P2 = { x: 64, y: 30 };
const P3 = { x: 90, y: 42 };
const ROUTE_D = `M${P0.x},${P0.y} C${P1.x},${P1.y} ${P2.x},${P2.y} ${P3.x},${P3.y}`;

function bezier(t: number): { x: number; y: number } {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * P0.x + b * P1.x + c * P2.x + d * P3.x,
    y: a * P0.y + b * P1.y + c * P2.y + d * P3.y,
  };
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

// Cuenta regresiva legible a partir de milisegundos restantes.
function fmtRemaining(ms: number): string {
  if (ms <= 0) return "Llegando";
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// Hook: instante actual en cliente (evita hydration mismatch — null en SSR).
function useNow(intervalMs = 30000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ── Banda de seguimiento (hero oscuro con gradiente) ─────────────────────

export function OrderTrackingHero(props: OrderTrackingProps) {
  const { status, trafficLevel, etaAt, courier, origin, destination } = props;
  const now = useNow();
  const meta = trafficMeta(trafficLevel);
  const tone: Tone = meta?.tone ?? "warning";
  const VehicleIcon = meta ? VEHICLE_ICON[meta.vehicle] : Truck;

  const delivered = status === "ENTREGADA";
  const cancelled = status === "CANCELADA";
  const enRoute = status === "ENVIADA";

  // Llegada estimada: hora real (etaAt) o, si falta, el rango del tráfico.
  // fmtClock usa toLocaleTimeString → se difiere a cliente (now != null) para
  // evitar cualquier hydration mismatch de formato de hora server↔browser.
  const etaLabel = etaAt ? (now != null ? fmtClock(etaAt) : "—") : meta?.rangeLabel ?? "—";
  const remainingMs = etaAt && now != null ? new Date(etaAt).getTime() - now : null;
  const countdown = delivered
    ? "Entregada"
    : cancelled
      ? "—"
      : remainingMs != null
        ? fmtRemaining(remainingMs)
        : courier?.etaMinutes
          ? `${courier.etaMinutes} min`
          : "—";

  const phase = delivered
    ? "Entrega completada"
    : cancelled
      ? "Orden cancelada"
      : enRoute
        ? "Mensajero en camino"
        : "Preparando envío";

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: "var(--radius-lg)",
        background: "linear-gradient(135deg, var(--lab-eta-from), var(--lab-eta-to))",
        border: "1px solid var(--border-soft)",
        boxShadow: "0 18px 40px -24px rgba(124,58,237,0.55)",
        padding: "18px 20px",
        color: "#E8E8EC",
      }}
    >
      {/* glow violeta de fondo */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -70,
          right: -50,
          width: 220,
          height: 220,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(124,58,237,0.35), transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            color: "#fff",
            background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
            boxShadow: "0 8px 20px -6px rgba(124,58,237,0.8)",
          }}
        >
          {delivered ? <PackageCheck size={20} /> : <Navigation size={19} />}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>{phase}</div>
          <div style={{ fontSize: 12, color: "rgba(232,232,236,0.6)", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {origin.name}
            </span>
            <span aria-hidden>→</span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {destination.name}
            </span>
          </div>
        </div>
      </div>

      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
        }}
      >
        {/* Próxima llegada estimada */}
        <HeroStat
          icon={<Clock size={13} />}
          label="Próxima llegada estimada"
          value={etaLabel}
          accent="rgba(167,139,250,1)"
        />
        {/* Cuenta regresiva */}
        <HeroStat
          icon={<Timer size={13} />}
          label="Faltan"
          value={countdown}
          mono
          accent={delivered ? "var(--success)" : "#fff"}
        />
        {/* Nivel de tráfico */}
        <HeroStat
          icon={<VehicleIcon size={13} />}
          label="Nivel de tráfico"
          value={meta?.label ?? "Sin datos"}
          sub={meta?.rangeLabel}
          accent={TONE_COLOR[tone]}
          dot={TONE_COLOR[tone]}
        />
      </div>
    </div>
  );
}

function HeroStat({
  icon,
  label,
  value,
  sub,
  mono,
  accent,
  dot,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  accent: string;
  dot?: string;
}) {
  return (
    <div
      style={{
        borderRadius: 12,
        padding: "12px 14px",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "rgba(232,232,236,0.55)",
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          marginBottom: 7,
        }}
      >
        <span style={{ color: accent, display: "inline-flex" }}>{icon}</span>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        {dot && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: dot,
              boxShadow: `0 0 8px ${dot}`,
              flexShrink: 0,
            }}
          />
        )}
        <span
          className={mono ? "mono" : undefined}
          style={{
            fontSize: 20,
            fontWeight: 700,
            lineHeight: 1.1,
            color: accent === "#fff" ? "#fff" : "#fff",
          }}
        >
          {value}
        </span>
      </div>
      {sub && (
        <div className="mono" style={{ fontSize: 11, color: "rgba(232,232,236,0.5)", marginTop: 3 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ── Mapa ilustrativo A → B ───────────────────────────────────────────────

export function OrderRouteMap(props: OrderTrackingProps) {
  const { status, trafficLevel, courier, etaAt, origin, destination } = props;
  const now = useNow();
  const meta = trafficMeta(trafficLevel);
  const tone: Tone = meta?.tone ?? "warning";
  const roadColor = TONE_COLOR[tone];
  const VehicleIcon = meta ? VEHICLE_ICON[meta.vehicle] : Truck;

  const delivered = status === "ENTREGADA";
  const p = progressFor(status);
  const pos = bezier(p);

  // Minutos en la burbuja del mensajero: courier.etaMinutes, o derivado de etaAt.
  const remainMin =
    etaAt && now != null ? Math.max(0, Math.round((new Date(etaAt).getTime() - now) / 60000)) : null;
  const bubbleLabel = delivered
    ? "Entregado"
    : courier?.etaMinutes != null
      ? `${courier.etaMinutes} min`
      : remainMin != null
        ? `${remainMin} min`
        : meta?.rangeLabel ?? "En ruta";

  const mapsUrl = origin.mapsUrl || destination.mapsUrl || null;
  const courierName = courier?.name?.trim();

  return (
    <div>
      <div
        style={{
          position: "relative",
          width: "100%",
          height: 190,
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
          background: "linear-gradient(135deg, var(--lab-map-from), var(--lab-map-to))",
          border: "1px solid var(--border-soft)",
        }}
      >
        {/* keyframes locales (no tocamos globals.css) */}
        <style>{`
          @keyframes lab-route-flow { to { stroke-dashoffset: -28; } }
          @keyframes lab-courier-pulse {
            0%,100% { transform: translate(-50%,-50%) scale(1); }
            50%     { transform: translate(-50%,-50%) scale(1.08); }
          }
        `}</style>

        {/* retícula sutil de fondo */}
        <svg
          aria-hidden
          width="100%"
          height="100%"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0 }}
        >
          <defs>
            <pattern id="lab-grid" width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M8 0 H0 V8" fill="none" stroke="var(--lab-map-grid)" strokeWidth="0.4" />
            </pattern>
            <linearGradient id="lab-road-fade" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={roadColor} stopOpacity="0.35" />
              <stop offset="100%" stopColor={roadColor} stopOpacity="1" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="100" height="100" fill="url(#lab-grid)" />

          {/* track base */}
          <path
            d={ROUTE_D}
            fill="none"
            stroke="var(--lab-map-road)"
            strokeOpacity="0.4"
            strokeWidth="3.5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* tramo recorrido (sólido, color de tráfico) */}
          <path
            d={ROUTE_D}
            fill="none"
            stroke={roadColor}
            strokeWidth="3.5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - p}
            style={{ opacity: 0.9 }}
          />
          {/* overlay punteado animado (flujo hacia el destino) */}
          <path
            d={ROUTE_D}
            fill="none"
            stroke="url(#lab-road-fade)"
            strokeWidth="2"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            strokeDasharray="2 9"
            style={{ animation: "lab-route-flow 1.1s linear infinite" }}
          />
        </svg>

        {/* Nodo LAB (origen) */}
        <RouteNode x={P0.x} y={P0.y} label={origin.label ?? "LAB"} name={origin.name} icon={FlaskConical} />
        {/* Nodo CLÍNICA (destino) */}
        <RouteNode
          x={P3.x}
          y={P3.y}
          label={destination.label ?? "CLÍNICA"}
          name={destination.name}
          icon={Building2}
          align="right"
        />

        {/* Mensajero en camino */}
        {!delivered && (
          <div
            style={{
              position: "absolute",
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              transform: "translate(-50%,-50%)",
              zIndex: 3,
            }}
          >
            {/* burbuja de ETA */}
            <div
              style={{
                position: "absolute",
                bottom: "calc(100% + 8px)",
                left: "50%",
                transform: "translateX(-50%)",
                whiteSpace: "nowrap",
                padding: "3px 9px",
                borderRadius: 999,
                background: "var(--bg-elev)",
                border: `1px solid ${roadColor}`,
                color: "var(--text-1)",
                fontSize: 11,
                fontWeight: 700,
                boxShadow: `0 6px 16px -8px ${roadColor}`,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Timer size={11} style={{ color: roadColor }} />
              {bubbleLabel}
            </div>
            {/* pin del mensajero */}
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                color: "#fff",
                background: roadColor,
                border: "2px solid var(--bg-elev)",
                boxShadow: `0 0 0 4px color-mix(in srgb, ${roadColor} 28%, transparent), 0 6px 16px -4px ${roadColor}`,
                animation: "lab-courier-pulse 1.8s ease-in-out infinite",
              }}
            >
              <VehicleIcon size={18} />
            </span>
          </div>
        )}
      </div>

      {/* Pie: mensajero + enlace a Maps */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 10,
        }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--text-3)", fontSize: 12 }}>
          <span style={{ color: roadColor, display: "inline-flex" }}>
            <VehicleIcon size={14} />
          </span>
          {courierName ? (
            <span>
              <span style={{ color: "var(--text-2)" }}>Mensajero:</span> {courierName}
              {courier?.plate ? ` · ${courier.plate}` : ""}
            </span>
          ) : meta ? (
            <span>{meta.desc}</span>
          ) : (
            <span>Mensajero por asignar</span>
          )}
        </div>
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: "var(--info)",
              fontWeight: 600,
              fontSize: 12,
              textDecoration: "none",
            }}
          >
            <Navigation size={13} />
            Ver en Google Maps
          </a>
        )}
      </div>
    </div>
  );
}

function RouteNode({
  x,
  y,
  label,
  name,
  icon: Icon,
  align = "left",
}: {
  x: number;
  y: number;
  label: string;
  name: string;
  icon: LucideIcon;
  align?: "left" | "right";
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%,-50%)",
        zIndex: 2,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 5,
      }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 11,
          display: "grid",
          placeItems: "center",
          color: "#fff",
          background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
          boxShadow: "0 8px 18px -8px rgba(124,58,237,0.7)",
          border: "2px solid var(--bg-elev)",
        }}
      >
        <Icon size={18} />
      </span>
      <div
        style={{
          textAlign: align === "right" ? "right" : "left",
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 8,
          padding: "3px 8px",
          maxWidth: 120,
        }}
      >
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: "var(--violet-400)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            justifyContent: "center",
          }}
        >
          <MapPin size={9} />
          {label}
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-1)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 108,
          }}
          title={name}
        >
          {name}
        </div>
      </div>
    </div>
  );
}
