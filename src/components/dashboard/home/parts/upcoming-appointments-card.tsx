"use client";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Video, Calendar } from "lucide-react";
import { HomeSection } from "../home-section";
import { formatShortTime } from "@/lib/home/greet";
import type { AppointmentStatus } from "@/lib/home/types";
import { useT } from "@/i18n/i18n-provider";
import type { TFunction } from "@/i18n/t";

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
// Pills del sistema (prototipo variante-a): fondo *-soft + dot currentColor
// + tinta *-strong 11/600. Texto sobre --brand-soft usa --trial-accent-calm
// (violet-700 en light / violet-300 en dark — AA en ambos).
const STATUS_PILL: Record<
  AppointmentStatus,
  { bg: string; fg: string; italic?: boolean }
> = {
  SCHEDULED:   { bg: "var(--warning-soft)", fg: "var(--warning-strong)" },
  CONFIRMED:   { bg: "var(--info-soft)",    fg: "var(--info-strong)" },
  CHECKED_IN:  { bg: "var(--brand-soft)",   fg: "var(--trial-accent-calm)" },
  IN_CHAIR:    { bg: "var(--brand-soft)",   fg: "var(--trial-accent-calm)" },
  IN_PROGRESS: { bg: "var(--success-soft)", fg: "var(--success-strong)" },
  COMPLETED:   { bg: "var(--bg-elev-2)",    fg: "var(--text-3)" },
  CHECKED_OUT: { bg: "var(--bg-elev-2)",    fg: "var(--text-3)" },
  NO_SHOW:     { bg: "var(--danger-soft)",  fg: "var(--danger-strong)" },
  CANCELLED:   { bg: "var(--bg-elev-2)",    fg: "var(--text-4)", italic: true },
};

const STATUS_LABEL_KEY: Record<AppointmentStatus, string> = {
  SCHEDULED:   "home.upcoming.statusScheduled",
  CONFIRMED:   "home.upcoming.statusConfirmed",
  CHECKED_IN:  "home.upcoming.statusCheckedIn",
  IN_CHAIR:    "home.upcoming.statusInChair",
  IN_PROGRESS: "home.upcoming.statusInProgress",
  COMPLETED:   "home.upcoming.statusCompleted",
  CHECKED_OUT: "home.upcoming.statusCheckedOut",
  NO_SHOW:     "home.upcoming.statusNoShow",
  CANCELLED:   "home.upcoming.statusCancelled",
};

export function UpcomingAppointmentsCard({ limit = 5 }: { limit?: number }) {
  const router = useRouter();
  const t = useT();
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
    <HomeSection
      title={t("home.upcoming.title")}
      subtitle={t("home.upcoming.subtitle", { count: limit })}
      noPad
    >
      {items === null ? (
        <Skeleton />
      ) : error ? (
        <EmptyMsg text={t("home.upcoming.loadError")} />
      ) : items.length === 0 ? (
        <EmptyMsg text={t("home.upcoming.empty")} />
      ) : (
        <div role="list">
          {items.map((it, i) => (
            <Row
              key={it.id}
              item={it}
              last={i === items.length - 1}
              t={t}
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
  t,
  onOpen,
  onPatient,
}: {
  item: UpcomingItem;
  last: boolean;
  t: TFunction;
  onOpen: () => void;
  onPatient: () => void;
}) {
  const when = formatWhen(item.startsAt, t);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t("home.upcoming.openAppointmentAria", {
        name: item.patientName,
        when,
      })}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderBottom: last ? "none" : "1px solid var(--border-soft)",
        cursor: "pointer",
        transition: "background var(--dur-1) var(--ease)",
        outline: "none",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      onFocus={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onBlur={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span
        style={{
          flex: "none",
          minWidth: 82,
          textAlign: "center",
          padding: "4px 8px",
          borderRadius: 8,
          background: "var(--brand-soft)",
          color: "var(--trial-accent-calm)",
          fontSize: 12,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {when}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
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
          aria-label={t("home.upcoming.viewRecordAria", { name: item.patientName })}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
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
            transition: "color var(--dur-1) var(--ease)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--brand)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-1)")}
        >
          {item.patientName}
        </button>

        <div
          style={{
            fontSize: 12,
            color: "var(--text-3)",
            marginTop: 1,
            display: "flex",
            alignItems: "center",
            gap: 5,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.isTeleconsult && (
            <Video
              size={12}
              strokeWidth={1.75}
              aria-label={t("home.upcoming.teleconsult")}
              style={{ color: "var(--info)", flexShrink: 0 }}
            />
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {[item.reason ?? t("home.upcoming.defaultReason"), item.doctorShortName]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      </div>

      <span style={chipStyle(item.status)}>
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: "currentColor",
            flexShrink: 0,
          }}
        />
        {t(STATUS_LABEL_KEY[item.status])}
      </span>
    </div>
  );
}

function chipStyle(status: AppointmentStatus): CSSProperties {
  const c = STATUS_PILL[status];
  return {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    fontWeight: 600,
    padding: "3px 9px",
    borderRadius: 999,
    color: c.fg,
    background: c.bg,
    fontStyle: c.italic ? "italic" : "normal",
    whiteSpace: "nowrap",
    letterSpacing: "0.01em",
  };
}

/**
 * Hora relativa legible en la zona del navegador:
 * "Hoy 14:30" · "Mañana 09:00" · "Lun 12 jun · 10:00".
 */
function formatWhen(iso: string, t: TFunction): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  const time = formatShortTime(iso);
  const intlLocale = t("home.upcoming.intlLocale");

  if (dayDiff <= 0) return t("home.upcoming.whenToday", { time });
  if (dayDiff === 1) return t("home.upcoming.whenTomorrow", { time });

  const wd = cap(
    new Intl.DateTimeFormat(intlLocale, { weekday: "short" }).format(d).replace(".", ""),
  );
  const dm = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short" })
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
              width: 82,
              height: 24,
              borderRadius: 8,
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
      <Calendar size={20} strokeWidth={1.75} aria-hidden style={{ color: "var(--text-4)" }} />
      {text}
    </div>
  );
}
