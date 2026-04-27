"use client";

import { useMemo, useState, useTransition } from "react";
import * as Popover from "@radix-ui/react-popover";
import toast from "react-hot-toast";
import { MoreHorizontal } from "lucide-react";
import { useAgenda } from "./agenda-provider";
import { patchAppointmentStatus } from "@/lib/agenda/mutations";
import { offRailsStatuses, STATUS_LABELS } from "@/lib/agenda/status-pipeline";
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

interface Props {
  appointment: AgendaAppointmentDTO;
}

export function AgendaStatusPopover({ appointment }: Props) {
  const { dispatch } = useAgenda();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<AppointmentStatus | null>(null);
  const [, startTransition] = useTransition();

  const offRails = useMemo(() => offRailsStatuses(appointment.status), [appointment.status]);

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

  // Si no hay opciones off-rails, no renderizamos el chevron (la card ya tiene
  // su botón inline para forward states).
  if (offRails.length === 0) return null;

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
          aria-label="Más acciones de estado"
          title="Más acciones"
        >
          <MoreHorizontal size={10} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={styles.statusPopover}
          align="end"
          sideOffset={6}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.statusPopoverTitle}>Estados especiales</div>
          <div className={styles.statusPopoverList}>
            {offRails.map((status) => {
              const isPending = pending === status;
              const label =
                status === "SCHEDULED" &&
                (appointment.status === "CANCELLED" || appointment.status === "NO_SHOW")
                  ? "Re-abrir cita"
                  : STATUS_LABELS[status];
              return (
                <button
                  key={status}
                  type="button"
                  className={styles.statusPopoverItem}
                  style={
                    {
                      "--mf-status-color": STATUS_COLOR[status],
                    } as React.CSSProperties
                  }
                  disabled={pending !== null && !isPending}
                  onClick={() => void changeStatus(status)}
                >
                  <span
                    className={styles.statusPopoverDot}
                    style={{ background: STATUS_COLOR[status] }}
                    aria-hidden
                  />
                  <span>{label}</span>
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
