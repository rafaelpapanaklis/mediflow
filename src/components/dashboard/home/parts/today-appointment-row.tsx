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

const STATUS_DOT: Record<AppointmentStatus, string> = {
  SCHEDULED:    "var(--warning)",
  CONFIRMED:    "var(--info)",
  CHECKED_IN:   "var(--brand)",
  IN_CHAIR:     "var(--brand)",
  IN_PROGRESS:  "var(--success)",
  COMPLETED:    "var(--text-3)",
  CHECKED_OUT:  "var(--text-3)",
  NO_SHOW:      "var(--danger)",
  CANCELLED:    "var(--text-4)",
};

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  SCHEDULED:    "Programada",
  CONFIRMED:    "Confirmada",
  CHECKED_IN:   "En sala",
  IN_CHAIR:     "En sillón",
  IN_PROGRESS:  "En consulta",
  COMPLETED:    "Completada",
  CHECKED_OUT:  "Salió",
  NO_SHOW:      "No vino",
  CANCELLED:    "Cancelada",
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
  const canCheckIn = appt.status === "SCHEDULED" || appt.status === "CONFIRMED";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderBottom: "1px solid var(--border-soft)",
        transition: "background 0.12s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span
          aria-label={STATUS_LABEL[appt.status]}
          title={STATUS_LABEL[appt.status]}
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: STATUS_DOT[appt.status],
            boxShadow: appt.status === "IN_PROGRESS"
              ? "0 0 6px var(--success)"
              : "none",
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-jetbrains-mono, monospace)",
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text-1)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatShortTime(appt.startsAt)}
        </span>
      </div>

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
            fontSize: 13,
            fontWeight: 500,
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
            fontSize: 11,
            color: "var(--text-2)",
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
            <Video size={10} aria-hidden style={{ color: "var(--info)" }} />
          )}
          {appt.isWalkIn && (
            <Footprints size={10} aria-hidden style={{ color: "var(--warning)" }} />
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {appt.reason ?? "Consulta"}
            {appt.doctor && ` · ${appt.doctor.shortName}`}
          </span>
        </div>
      </div>

      {appt.status === "CHECKED_IN" && appt.minutesWaiting != null && (
        <span
          style={{
            fontSize: 10,
            padding: "2px 6px",
            borderRadius: 4,
            background: "var(--brand-soft)",
            color: "var(--trial-accent-calm)",
            fontFamily: "var(--font-jetbrains-mono, monospace)",
            fontWeight: 500,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {appt.minutesWaiting} min esp.
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
            label="Llamar"
            onClick={() => onCall?.(appt.id)}
          />
          <IconButton
            icon={MessageCircle}
            label="Enviar WhatsApp"
            onClick={() => onWhatsApp?.(appt.id)}
          />
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label="Más acciones"
                style={iconBtnStyle}
              >
                <MoreHorizontal size={14} />
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
                  Ver cita
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  style={dropdownItemStyle}
                  onSelect={() =>
                    router.push(`/dashboard/appointments/${appt.id}?edit=1`)
                  }
                >
                  Reagendar
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  style={{ ...dropdownItemStyle, color: "var(--danger)" }}
                  onSelect={() =>
                    router.push(`/dashboard/appointments/${appt.id}?cancel=1`)
                  }
                >
                  Cancelar cita
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
  borderRadius: 6,
  color: "var(--text-2)",
  cursor: "pointer",
  transition: "all 0.15s",
};

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
      <Icon size={14} />
    </button>
  );
}

const dropdownStyle: React.CSSProperties = {
  minWidth: 160,
  background: "var(--bg-elev)",
  border: "1px solid var(--border-strong)",
  borderRadius: 10,
  padding: 4,
  boxShadow:
    "0 20px 50px -10px rgba(15,10,30,0.25), 0 8px 20px -8px rgba(15,10,30,0.15)",
  zIndex: 50,
  fontFamily: "var(--font-sora, 'Sora', sans-serif)",
};

const dropdownItemStyle: React.CSSProperties = {
  padding: "7px 10px",
  fontSize: 12,
  borderRadius: 6,
  cursor: "pointer",
  outline: "none",
  color: "var(--text-1)",
};
