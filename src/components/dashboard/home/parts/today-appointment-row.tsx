// src/components/dashboard/home/parts/today-appointment-row.tsx
"use client";
import { useRouter } from "next/navigation";
import {
  CheckCircle2, Phone, MessageCircle, MoreHorizontal, Video, Footprints,
  type LucideIcon,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { AppointmentDTO, AppointmentStatus } from "@/lib/home/types";
import { formatShortTime } from "@/lib/home/greet";
import { useT } from "@/i18n/i18n-provider";

// Pills de estado del sistema (prototipo variante-a: fondo *-soft + dot 6px
// currentColor + tinta *-strong 11/600). Texto sobre --brand-soft usa
// --trial-accent-calm (violet-700 en light / violet-300 en dark — AA).
const STATUS_PILL: Record<
  AppointmentStatus,
  { bg: string; fg: string; italic?: boolean }
> = {
  SCHEDULED:    { bg: "var(--warning-soft)", fg: "var(--warning-strong)" },
  CONFIRMED:    { bg: "var(--info-soft)",    fg: "var(--info-strong)" },
  CHECKED_IN:   { bg: "var(--brand-soft)",   fg: "var(--trial-accent-calm)" },
  IN_CHAIR:     { bg: "var(--brand-soft)",   fg: "var(--trial-accent-calm)" },
  IN_PROGRESS:  { bg: "var(--success-soft)", fg: "var(--success-strong)" },
  COMPLETED:    { bg: "var(--bg-elev-2)",    fg: "var(--text-3)" },
  CHECKED_OUT:  { bg: "var(--bg-elev-2)",    fg: "var(--text-3)" },
  NO_SHOW:      { bg: "var(--danger-soft)",  fg: "var(--danger-strong)" },
  CANCELLED:    { bg: "var(--bg-elev-2)",    fg: "var(--text-4)", italic: true },
};

const STATUS_LABEL_KEY: Record<AppointmentStatus, string> = {
  SCHEDULED:    "home.apptRow.statusScheduled",
  CONFIRMED:    "home.apptRow.statusConfirmed",
  CHECKED_IN:   "home.apptRow.statusCheckedIn",
  IN_CHAIR:     "home.apptRow.statusInChair",
  IN_PROGRESS:  "home.apptRow.statusInProgress",
  COMPLETED:    "home.apptRow.statusCompleted",
  CHECKED_OUT:  "home.apptRow.statusCheckedOut",
  NO_SHOW:      "home.apptRow.statusNoShow",
  CANCELLED:    "home.apptRow.statusCancelled",
};

interface Props {
  appt: AppointmentDTO;
  compact?: boolean;
  onCheckIn?: (id: string) => void;
  onCall?: (id: string) => void;
  onWhatsApp?: (id: string) => void;
}

export function TodayAppointmentRow({
  appt,
  compact,
  onCheckIn,
  onCall,
  onWhatsApp,
}: Props) {
  const router = useRouter();
  const t = useT();
  const canCheckIn = appt.status === "SCHEDULED" || appt.status === "CONFIRMED";
  const statusLabel = t(STATUS_LABEL_KEY[appt.status]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderBottom: "1px solid var(--border-soft)",
        transition: "background var(--dur-1) var(--ease)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span
        style={{
          flex: "none",
          minWidth: 72,
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
        {formatShortTime(appt.startsAt)}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <button
          type="button"
          onClick={() => router.push(`/dashboard/patients/${appt.patient.id}`)}
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
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "block",
            maxWidth: "100%",
          }}
        >
          {appt.patient.name}
        </button>
        <div
          style={{
            fontSize: 12,
            color: "var(--text-3)",
            marginTop: 2,
            display: "flex",
            alignItems: "center",
            gap: 6,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {appt.isTeleconsult && (
            <Video size={12} strokeWidth={1.75} aria-hidden style={{ color: "var(--info)" }} />
          )}
          {appt.isWalkIn && (
            <Footprints size={12} strokeWidth={1.75} aria-hidden style={{ color: "var(--warning)" }} />
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {appt.reason ?? t("home.apptRow.defaultReason")}
            {appt.doctor && ` · ${appt.doctor.shortName}`}
          </span>
        </div>
      </div>

      <span style={statusPillStyle(appt.status)}>
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
        {statusLabel}
      </span>

      {appt.status === "CHECKED_IN" && appt.minutesWaiting != null && (
        <span
          style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 999,
            background: "var(--brand-soft)",
            color: "var(--trial-accent-calm)",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {t("home.apptRow.minutesWaiting", { count: appt.minutesWaiting })}
        </span>
      )}

      {!compact && (
        <div
          style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}
        >
          {canCheckIn && (
            <IconButton
              icon={CheckCircle2}
              label="Check-in"
              onClick={() => onCheckIn?.(appt.id)}
              tone="success"
            />
          )}
          <IconButton
            icon={Phone}
            label={t("home.apptRow.call")}
            onClick={() => onCall?.(appt.id)}
          />
          <IconButton
            icon={MessageCircle}
            label={t("home.apptRow.sendWhatsApp")}
            onClick={() => onWhatsApp?.(appt.id)}
          />
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label={t("home.apptRow.moreActions")}
                style={iconBtnStyle}
              >
                <MoreHorizontal size={16} strokeWidth={1.75} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                style={dropdownStyle}
              >
                <DropdownMenu.Item
                  style={dropdownItemStyle}
                  onSelect={() =>
                    router.push(`/dashboard/appointments/${appt.id}`)
                  }
                >
                  {t("home.apptRow.viewAppointment")}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  style={dropdownItemStyle}
                  onSelect={() =>
                    router.push(`/dashboard/appointments/${appt.id}?edit=1`)
                  }
                >
                  {t("home.apptRow.reschedule")}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  style={{ ...dropdownItemStyle, color: "var(--danger)" }}
                  onSelect={() =>
                    router.push(`/dashboard/appointments/${appt.id}?cancel=1`)
                  }
                >
                  {t("home.apptRow.cancelAppointment")}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      )}
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-2)",
  cursor: "pointer",
  transition:
    "background var(--dur-1) var(--ease), color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease)",
};

// Pill de estado: fondo *-soft + dot currentColor + texto 11/600 radius 99.
function statusPillStyle(status: AppointmentStatus): React.CSSProperties {
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
    background: c.bg,
    color: c.fg,
    fontStyle: c.italic ? "italic" : "normal",
    whiteSpace: "nowrap",
  };
}

function IconButton({
  icon: Icon,
  label,
  onClick,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  tone?: "success";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        ...iconBtnStyle,
        color: tone === "success" ? "var(--success)" : "var(--text-2)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-hover)";
        e.currentTarget.style.borderColor = "var(--border-soft)";
        e.currentTarget.style.color = tone === "success"
          ? "var(--success)"
          : "var(--text-1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "transparent";
        e.currentTarget.style.color = tone === "success"
          ? "var(--success)"
          : "var(--text-2)";
      }}
    >
      <Icon size={16} strokeWidth={1.75} />
    </button>
  );
}

const dropdownStyle: React.CSSProperties = {
  minWidth: 160,
  background: "var(--bg-elev)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius)",
  padding: 4,
  boxShadow: "var(--shadow-3)",
  zIndex: 50,
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
};

const dropdownItemStyle: React.CSSProperties = {
  padding: "7px 10px",
  fontSize: 12,
  borderRadius: 6,
  cursor: "pointer",
  outline: "none",
  color: "var(--text-1)",
};
