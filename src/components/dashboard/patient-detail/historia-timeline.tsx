"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Stethoscope,
  Pill,
  CalendarCheck,
  Image as ImageIcon,
  ListChecks,
  ArrowUpRight,
  ArrowDownLeft,
  FileSearch,
  Loader2,
} from "lucide-react";

type TimelineEventType =
  | "soap"
  | "appointment"
  | "prescription"
  | "xray"
  | "treatment"
  | "referral"
  | "diagnosis";

interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  date: string;
  title: string;
  summary: string;
  doctorName: string | null;
  link?: string;
  meta?: Record<string, unknown>;
}

interface Props {
  patientId: string;
  onOpenSoap?: (recordId: string) => void;
  onOpenXray?: (entityId: string) => void;
  onOpenAppointment?: (entityId: string) => void;
  onOpenTreatment?: (entityId: string) => void;
  onOpenReferral?: (entityId: string) => void;
}

const TYPE_META: Record<TimelineEventType, { label: string; icon: React.ElementType; bg: string; fg: string; border: string }> = {
  soap:         { label: "Notas",        icon: Stethoscope,  bg: "rgba(124, 58, 237, 0.10)", fg: "#7c3aed", border: "rgba(124, 58, 237, 0.30)" },
  prescription: { label: "Recetas",      icon: Pill,         bg: "rgba(217, 119, 6, 0.10)",  fg: "#b45309", border: "rgba(217, 119, 6, 0.30)" },
  appointment:  { label: "Citas",        icon: CalendarCheck,bg: "rgba(37, 99, 235, 0.10)",  fg: "#1d4ed8", border: "rgba(37, 99, 235, 0.30)" },
  xray:         { label: "Radiografías", icon: ImageIcon,    bg: "rgba(15, 118, 110, 0.10)", fg: "#0f766e", border: "rgba(15, 118, 110, 0.30)" },
  treatment:    { label: "Tratamientos", icon: ListChecks,   bg: "rgba(16, 185, 129, 0.10)", fg: "#059669", border: "rgba(16, 185, 129, 0.30)" },
  referral:     { label: "Referencias",  icon: ArrowUpRight, bg: "rgba(220, 38, 38, 0.08)",  fg: "#b91c1c", border: "rgba(220, 38, 38, 0.30)" },
  diagnosis:    { label: "Diagnósticos", icon: FileSearch,   bg: "rgba(100, 116, 139, 0.10)", fg: "#475569", border: "rgba(100, 116, 139, 0.30)" },
};

const TYPE_ORDER: TimelineEventType[] = ["soap", "prescription", "appointment", "diagnosis", "xray", "treatment", "referral"];

const RANGE_PRESETS = [
  { id: "30",   label: "30 días",  days: 30 },
  { id: "90",   label: "90 días",  days: 90 },
  { id: "365",  label: "12 meses", days: 365 },
  { id: "all",  label: "Todo",     days: 0 },
] as const;
type RangePreset = typeof RANGE_PRESETS[number]["id"];

function relativeDate(dateStr: string): string {
  const d = new Date(dateStr).getTime();
  const diff = Date.now() - d;
  const days = Math.floor(diff / 86400000);
  if (days < 0) return new Date(dateStr).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
  if (days === 0) {
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return "hace minutos";
    if (hours === 1) return "hace 1 hora";
    return `hace ${hours} horas`;
  }
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  if (days < 30) return `hace ${Math.floor(days / 7)} sem`;
  if (days < 365) return `hace ${Math.floor(days / 30)} meses`;
  return `hace ${Math.floor(days / 365)} años`;
}

function exactDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("es-MX", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function HistoriaTimeline({
  patientId,
  onOpenSoap,
  onOpenXray,
  onOpenAppointment,
  onOpenTreatment,
  onOpenReferral,
}: Props) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangePreset>("365");
  const [enabledTypes, setEnabledTypes] = useState<Set<TimelineEventType>>(new Set(TYPE_ORDER));

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    const preset = RANGE_PRESETS.find((p) => p.id === range);
    if (preset && preset.days > 0) {
      const from = new Date(Date.now() - preset.days * 86400000).toISOString();
      params.set("from", from);
    }
    fetch(`/api/patients/${patientId}/timeline?${params}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? "timeline_failed");
        }
        return r.json();
      })
      .then((data: { events: TimelineEvent[] }) => {
        setEvents(data.events ?? []);
        setLoading(false);
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setError(String(e.message ?? e));
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [patientId, range]);

  const filtered = useMemo(() => events.filter((e) => enabledTypes.has(e.type)), [events, enabledTypes]);
  const counts = useMemo(() => {
    const c: Record<TimelineEventType, number> = {
      soap: 0, prescription: 0, appointment: 0, xray: 0, treatment: 0, referral: 0, diagnosis: 0,
    };
    for (const e of events) c[e.type]++;
    return c;
  }, [events]);

  function toggleType(t: TimelineEventType) {
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      // Si quedó vacío, restaurar todos (evita pantalla vacía sin acción).
      if (next.size === 0) return new Set(TYPE_ORDER);
      return next;
    });
  }

  function handleClickEvent(e: TimelineEvent) {
    const entityId = typeof e.meta?.entityId === "string" ? e.meta.entityId : null;
    const recordId = typeof e.meta?.recordId === "string" ? e.meta.recordId : null;

    if (e.type === "soap" && onOpenSoap && recordId) {
      onOpenSoap(recordId);
      return;
    }
    if (e.type === "diagnosis" && onOpenSoap && recordId) {
      onOpenSoap(recordId);
      return;
    }
    if (e.type === "xray" && onOpenXray && entityId) {
      onOpenXray(entityId);
      return;
    }
    if (e.type === "appointment" && onOpenAppointment && entityId) {
      onOpenAppointment(entityId);
      return;
    }
    if (e.type === "treatment" && onOpenTreatment && entityId) {
      onOpenTreatment(entityId);
      return;
    }
    if (e.type === "referral" && onOpenReferral && entityId) {
      onOpenReferral(entityId);
      return;
    }
    if (e.link) {
      window.open(e.link, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="space-y-4">
      {/* Range picker */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Rango:</span>
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setRange(p.id)}
            className={`px-3 py-1 text-xs font-semibold rounded-lg border ${
              range === p.id ? "bg-brand-600 text-white border-brand-600" : "bg-card text-foreground border-border hover:bg-muted"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Type filter chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {TYPE_ORDER.map((t) => {
          const meta = TYPE_META[t];
          const enabled = enabledTypes.has(t);
          const count = counts[t];
          const Icon = meta.icon;
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggleType(t)}
              aria-pressed={enabled}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full border transition-all"
              style={{
                background: enabled ? meta.bg : "transparent",
                color: enabled ? meta.fg : "var(--text-3, #94a3b8)",
                borderColor: enabled ? meta.border : "var(--border-soft, #e2e8f0)",
                opacity: enabled ? 1 : 0.55,
              }}
            >
              <Icon size={12} aria-hidden />
              {meta.label}
              {count > 0 && (
                <span className="text-[10px] font-bold opacity-70">({count})</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Cargando timeline…
        </div>
      ) : error ? (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
          Error al cargar timeline: {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-6 bg-card border border-border rounded-xl text-center text-xs text-muted-foreground">
          {events.length === 0
            ? "Sin eventos clínicos registrados en este rango."
            : "Ningún evento coincide con los filtros seleccionados."}
        </div>
      ) : (
        <ol className="relative ml-3 space-y-3 border-l-2 border-border">
          {filtered.map((e) => {
            const meta = TYPE_META[e.type];
            const Icon = meta.icon;
            const hasEntity = typeof e.meta?.entityId === "string";
            const clickable =
              (e.type === "soap" && !!onOpenSoap) ||
              (e.type === "diagnosis" && !!onOpenSoap) ||
              (e.type === "xray" && !!onOpenXray && hasEntity) ||
              (e.type === "appointment" && !!onOpenAppointment && hasEntity) ||
              (e.type === "treatment" && !!onOpenTreatment && hasEntity) ||
              (e.type === "referral" && !!onOpenReferral && hasEntity) ||
              !!e.link;
            return (
              <li key={e.id} className="relative pl-6">
                {/* Dot */}
                <span
                  className="absolute -left-[9px] top-3 w-4 h-4 rounded-full border-2 flex items-center justify-center"
                  style={{ background: meta.bg, color: meta.fg, borderColor: meta.border }}
                  aria-hidden
                >
                  <Icon size={9} />
                </span>
                {/* Card */}
                <button
                  type="button"
                  onClick={clickable ? () => handleClickEvent(e) : undefined}
                  disabled={!clickable}
                  className={`w-full text-left p-3 rounded-xl border border-border bg-card transition-colors ${
                    clickable ? "hover:bg-muted cursor-pointer" : "cursor-default"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full"
                      style={{ background: meta.bg, color: meta.fg }}
                    >
                      <Icon size={10} aria-hidden />
                      {e.title}
                    </span>
                    {e.type === "referral" && (e.meta?.type as string) === "INCOMING" && (
                      <ArrowDownLeft size={10} className="text-violet-600" aria-hidden />
                    )}
                    <span
                      className="text-[11px] text-muted-foreground"
                      title={exactDate(e.date)}
                    >
                      {relativeDate(e.date)}
                    </span>
                    {e.doctorName && (
                      <span className="text-[11px] text-muted-foreground ml-auto">{e.doctorName}</span>
                    )}
                  </div>
                  <p className="text-xs text-foreground leading-relaxed">{e.summary}</p>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
