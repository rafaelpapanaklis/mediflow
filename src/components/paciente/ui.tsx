"use client";

// UI compartida del panel del paciente. Implementa A10.
// Las páginas A5-A9 importan ESTAS firmas — no las cambies.
// Estilo: dark, cards border-radius 14, borde rgba(255,255,255,0.08), fondo
// #121020/var(--ld-card), acento violeta. Responsive SIEMPRE (sin anchos fijos).
import type { PacienteClinica } from "@/lib/patient-portal/types";

/** Card base del portal (título opcional + children). */
export function PacienteCard({
  title,
  children,
  style,
}: {
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section
      style={{
        background: "#121020",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 14,
        padding: "clamp(14px, 2vw, 22px)",
        ...style,
      }}
    >
      {title && (
        <h2
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "rgba(245,245,247,0.85)",
            margin: "0 0 12px",
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

/** Estado vacío con icono/mensaje. */
export function PacienteEmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: 28,
        textAlign: "center",
        color: "rgba(245,245,247,0.55)",
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      {message}
    </div>
  );
}

/** Estilos compartidos de los chips de clínica. */
function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: "5px 12px",
    borderRadius: 999,
    fontSize: 12.5,
    fontWeight: 500,
    fontFamily: "inherit",
    cursor: "pointer",
    background: active ? "rgba(124,58,237,0.25)" : "rgba(255,255,255,0.05)",
    border: active ? "1px solid #8b5cf6" : "1px solid rgba(255,255,255,0.1)",
    color: active ? "#e9d5ff" : "rgba(245,245,247,0.7)",
    transition: "all .15s",
  };
}

/**
 * Chips para filtrar por clínica. value null = "Todas". Solo se muestra si
 * hay 2+ clínicas (con 0-1 devuelve null).
 */
export function ClinicFilterChips({
  clinics,
  value,
  onChange,
}: {
  clinics: PacienteClinica[];
  value: string | null;
  onChange: (clinicId: string | null) => void;
}) {
  if (!clinics || clinics.length < 2) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={value === null}
        style={chipStyle(value === null)}
      >
        Todas
      </button>
      {clinics.map((c) => (
        <button
          key={c.clinicId}
          type="button"
          onClick={() => onChange(c.clinicId)}
          aria-pressed={value === c.clinicId}
          style={chipStyle(value === c.clinicId)}
        >
          {clinicName(clinics, c.clinicId)}
        </button>
      ))}
    </div>
  );
}

/** Nombre de clínica para etiquetar items cuando hay varias. */
export function clinicName(clinics: PacienteClinica[], clinicId: string): string {
  const clinic = clinics.find((c) => c.clinicId === clinicId);
  return clinic?.clinicName || clinicId;
}

// ── StatusBadge ──────────────────────────────────────────────────────────────

type BadgeTone = "green" | "greenDim" | "amber" | "red" | "violet" | "gray";

const TONE_STYLES: Record<BadgeTone, { color: string; background: string }> = {
  green: { color: "#34d399", background: "rgba(52,211,153,0.12)" },
  greenDim: { color: "rgba(52,211,153,0.75)", background: "rgba(52,211,153,0.08)" },
  amber: { color: "#fbbf24", background: "rgba(251,191,36,0.12)" },
  red: { color: "#f87171", background: "rgba(248,113,113,0.12)" },
  violet: { color: "#a78bfa", background: "rgba(124,58,237,0.18)" },
  gray: { color: "rgba(245,245,247,0.6)", background: "rgba(255,255,255,0.07)" },
};

const STATUS_MAPS: Record<
  "cita" | "factura" | "tratamiento",
  Record<string, { label: string; tone: BadgeTone }>
> = {
  cita: {
    PENDING: { label: "Agendada", tone: "amber" },
    SCHEDULED: { label: "Agendada", tone: "amber" },
    CONFIRMED: { label: "Confirmada", tone: "green" },
    CHECKED_IN: { label: "En curso", tone: "violet" },
    IN_CHAIR: { label: "En curso", tone: "violet" },
    IN_PROGRESS: { label: "En curso", tone: "violet" },
    COMPLETED: { label: "Completada", tone: "greenDim" },
    CHECKED_OUT: { label: "Completada", tone: "greenDim" },
    CANCELLED: { label: "Cancelada", tone: "red" },
    NO_SHOW: { label: "No asististe", tone: "gray" },
  },
  factura: {
    PENDING: { label: "Pendiente", tone: "amber" },
    PARTIAL: { label: "Pago parcial", tone: "amber" },
    PAID: { label: "Pagada", tone: "green" },
    OVERDUE: { label: "Vencida", tone: "red" },
    CANCELLED: { label: "Cancelada", tone: "gray" },
    DRAFT: { label: "Borrador", tone: "gray" },
  },
  tratamiento: {
    ACTIVE: { label: "Activo", tone: "violet" },
    COMPLETED: { label: "Completado", tone: "green" },
    PAUSED: { label: "En pausa", tone: "amber" },
    ABANDONED: { label: "Abandonado", tone: "gray" },
  },
};

/** Badge de estatus (citas/facturas/tratamientos) con label en español. */
export function StatusBadge({ kind, value }: { kind: "cita" | "factura" | "tratamiento"; value: string }) {
  const entry = STATUS_MAPS[kind]?.[value];
  const tone = TONE_STYLES[entry?.tone || "gray"];

  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 10px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        color: tone.color,
        background: tone.background,
      }}
    >
      {entry?.label || value}
    </span>
  );
}

// ── Formateadores es-MX ──────────────────────────────────────────────────────

/** Formatea MXN: 1234.5 → "$1,234.50". */
export function formatMxn(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount);
}

/** Fecha corta es-MX desde ISO: "12 jun 2026". */
export function formatFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Fecha+hora es-MX desde ISO: "12 jun 2026, 10:30". */
export function formatFechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
