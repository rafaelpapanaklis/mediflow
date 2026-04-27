"use client";

import { useState, useTransition } from "react";
import * as Popover from "@radix-ui/react-popover";
import toast from "react-hot-toast";
import { ChevronDown } from "lucide-react";
import { useAgenda } from "./agenda-provider";
import { patchAppointmentStatus } from "@/lib/agenda/mutations";
import type { AgendaAppointmentDTO, AppointmentStatus } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

const STATUS_COLOR: Record<AppointmentStatus, string> = {
  SCHEDULED:   "var(--warning)",
  CONFIRMED:   "var(--info)",
  CHECKED_IN:  "var(--brand)",
  IN_PROGRESS: "var(--success)",
  COMPLETED:   "var(--text-3)",
  CANCELLED:   "var(--text-4)",
  NO_SHOW:     "var(--danger)",
};

const STATUS_OPTIONS: { value: AppointmentStatus; label: string }[] = [
  { value: "SCHEDULED",   label: "Programada" },
  { value: "CONFIRMED",   label: "Confirmada" },
  { value: "CHECKED_IN",  label: "Llegó" },
  { value: "IN_PROGRESS", label: "En consulta" },
  { value: "COMPLETED",   label: "Terminó" },
  { value: "NO_SHOW",     label: "No vino" },
];

interface Props {
  appointment: AgendaAppointmentDTO;
}

export function AgendaStatusPopover({ appointment }: Props) {
  const { dispatch } = useAgenda();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<AppointmentStatus | null>(null);
  const [, startTransition] = useTransition();

  async function changeStatus(target: AppointmentStatus) {
    if (appointment.status === target) {
      setOpen(false);
      return;
    }
    if (pending) return;

    const original = appointment;
    setPending(target);
    dispatch({ type: "OPTIMISTIC_STATUS", id: appointment.id, status: target });

    try {
      const updated = await patchAppointmentStatus(appointment.id, target);
      startTransition(() => {
        dispatch({ type: "REPLACE_APPOINTMENT", appointment: updated });
      });
      setOpen(false);
    } catch (err) {
      dispatch({ type: "ROLLBACK_STATUS", original });
      const reason =
        (err as { reason?: string; error?: string })?.reason ??
        (err as { error?: string })?.error ??
        "No se pudo cambiar";
      toast.error(reason);
    } finally {
      setPending(null);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={styles.apptStatusTrigger}
          onClick={(e) => {
            e.stopPropagation();
          }}
          onPointerDown={(e) => {
            // Evitar que dnd-kit capture este pointerdown como inicio de drag
            e.stopPropagation();
          }}
          aria-label="Cambiar estado"
        >
          <ChevronDown size={10} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={styles.statusPopover}
          align="end"
          sideOffset={6}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.statusPopoverTitle}>Cambiar estado</div>
          <div className={styles.statusPopoverList}>
            {STATUS_OPTIONS.map((opt) => {
              const isActive = appointment.status === opt.value;
              const isPending = pending === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={`${styles.statusPopoverItem} ${isActive ? styles.active : ""}`}
                  style={
                    {
                      "--mf-status-color": STATUS_COLOR[opt.value],
                    } as React.CSSProperties
                  }
                  disabled={pending !== null && !isPending}
                  onClick={() => void changeStatus(opt.value)}
                >
                  <span
                    className={styles.statusPopoverDot}
                    style={{ background: STATUS_COLOR[opt.value] }}
                    aria-hidden
                  />
                  <span>{opt.label}</span>
                  {isPending && <span className={styles.statusPopoverSpin}>…</span>}
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
