"use client";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Video, Calendar } from "lucide-react";
import { HomeSection } from "../home-section";
import { formatShortTime } from "@/lib/home/greet";
import type { AppointmentStatus } from "@/lib/home/types";

interface UpcomingItem {
  id: string;
  startsAt: string;
  status: AppointmentStatus;
  patientId: string;
  patientName: string;
  doctorShortName: string | null;
  reason: string | null;
  isTeleconsult: boolean;
}

// Mismo color-coding de estatus que la agenda / today-appointment-row.
const STATUS_DOT: Record<AppointmentStatus, string> = {
  SCHEDULED:   "var(--warning)",
  CONFIRMED:   "var(--info)",
  CHECKED_IN:  "var(--brand)",
  IN_CHAIR:    "var(--brand)",
  IN_PROGRESS: "var(--success)",
  COMPLETED:   "var(--text-3)",
  CHECKED_OUT: "var(--text-3)",
  NO_SHOW:     "var(--danger)",
  CANCELLED:   "var(--text-4)",
};

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  SCHEDULED:   "Programada",
  CONFIRMED:   "Confirmada",
  CHECKED_IN:  "En sala",
  IN_CHAIR:    "En sillón",
  IN_PROGRESS: "En consulta",
  COMPLETED:   "Completada",
  CHECKED_OUT: "Salió",
  NO_SHOW:     "No vino",
  CANCELLED:   "Cancelada",
};

export function UpcomingAppointmentsCard({ limit = 5 }: { limit?: number }) {
  const router = useRouter();
  const [items, setItems] = useState<UpcomingItem[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/dashboard/home/upcoming?limit=${limit}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { items?: UpcomingItem[] };
        if (alive) setItems(Array.isArray(json.items) ? json.items : []);
      } catch {
        if (alive) {
          setItems([]);
          setError(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [limit]);

  return (
    <HomeSection title="Próximas citas" subtitle={`Las ${limit} más cercanas`} noPad>
      {items === null ? (
        <Skeleton />
      ) : error ? (
        <EmptyMsg text="No se pudieron cargar las citas." />
      ) : items.length === 0 ? (
        <EmptyMsg text="No tienes citas próximas." />
      ) : (
        <div role="list">
          {items.map((it, i) => (
            <Row
              key={it.id}
              item={it}
              last={i === items.length - 1}
              onOpen={() => router.push(`/dashboard/appointments/${it.id}`)}
              onPatient={() => router.push(`/dashboard/patients/${it.patientId}`)}
            />
          ))}
        </div>
      )}
    </HomeSection>
  );
}

function Row({
  item,
  last,
  onOpen,
  onPatient,
}: {
  item: UpcomingItem;
  last: boolean;
  onOpen: () => void;
  onPatient: () => void;
}) {
  const color = STATUS_DOT[item.status];
  const when = formatWhen(item.startsAt);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Abrir cita de ${item.patientName} · ${when}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 16px",
        borderBottom: last ? "none" : "1px solid var(--border-soft)",
        cursor: "pointer",
        transition: "background 0.12s",
        outline: "none",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      onFocus={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onBlur={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span
        aria-hidden
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: color,
          marginTop: 5,
          flexShrink: 0,
          boxShadow: item.status === "IN_PROGRESS" ? "0 0 6px var(--success)" : "none",
        }}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minWidth: 0,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--brand)",
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {when}
            {item.isTeleconsult && (
              <Video
                size={11}
                aria-label="Teleconsulta"
                style={{ color: "var(--info)", flexShrink: 0 }}
              />
            )}
          </span>
          <span style={chipStyle(color)}>{STATUS_LABEL[item.status]}</span>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPatient();
          }}
          onKeyDown={(e) => {
            // El click ya se detiene con stopPropagation, pero el keydown
            // burbujearía a la fila (role="button") y dispararía onOpen además
            // de onPatient. Lo cortamos para que el teclado abra el paciente.
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
            }
          }}
          aria-label={`Ver expediente de ${item.patientName}`}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            marginTop: 3,
            cursor: "pointer",
            textAlign: "left",
            fontSize: 13.5,
            fontWeight: 600,
            color: "var(--text-1)",
            fontFamily: "inherit",
            display: "block",
            maxWidth: "100%",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            transition: "color 0.12s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--brand)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-1)")}
        >
          {item.patientName}
        </button>

        <div
          style={{
            fontSize: 11.5,
            color: "var(--text-2)",
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {[item.reason ?? "Consulta", item.doctorShortName]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
    </div>
  );
}

function chipStyle(color: string): CSSProperties {
  return {
    flexShrink: 0,
    fontSize: 10,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 999,
    color,
    background: "var(--bg-elev-2)",
    border: "1px solid var(--border-soft)",
    whiteSpace: "nowrap",
    letterSpacing: "0.01em",
  };
}

/**
 * Hora relativa legible en la zona del navegador:
 * "Hoy 14:30" · "Mañana 09:00" · "Lun 12 jun · 10:00".
 */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  const time = formatShortTime(iso);

  if (dayDiff <= 0) return `Hoy ${time}`;
  if (dayDiff === 1) return `Mañana ${time}`;

  const wd = cap(
    new Intl.DateTimeFormat("es-MX", { weekday: "short" }).format(d).replace(".", ""),
  );
  const dm = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" })
    .format(d)
    .replace(".", "");
  return `${wd} ${dm} · ${time}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Skeleton() {
  return (
    <div style={{ opacity: 0.6 }} aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderBottom: i === 4 ? "none" : "1px solid var(--border-soft)",
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: "var(--bg-elev-2)",
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              style={{
                height: 9,
                width: "42%",
                background: "var(--bg-elev-2)",
                borderRadius: 4,
              }}
            />
            <span
              style={{
                height: 11,
                width: "68%",
                background: "var(--bg-elev-2)",
                borderRadius: 4,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyMsg({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "40px 16px",
        textAlign: "center",
        color: "var(--text-2)",
        fontSize: 13,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      <Calendar size={20} aria-hidden style={{ color: "var(--text-4)" }} />
      {text}
    </div>
  );
}
