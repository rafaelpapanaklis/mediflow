"use client";

import { useCallback, useEffect, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import toast from "react-hot-toast";
import { Calendar, X, Trash2, Clock, AlertTriangle } from "lucide-react";
import { useAgenda } from "./agenda-provider";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { fetchWaitlist, updateWaitlist } from "@/lib/agenda/mutations";
import type { WaitlistEntryDTO, WaitlistPriority } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

const PRIORITY_LABEL: Record<WaitlistPriority, string> = {
  HIGH: "Alta",
  NORMAL: "Normal",
  LOW: "Baja",
};

const PRIORITY_COLOR: Record<WaitlistPriority, string> = {
  HIGH: "var(--danger)",
  NORMAL: "var(--text-3)",
  LOW: "var(--text-4)",
};

function patientInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

function relativeDate(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  if (days < 30) return `hace ${Math.floor(days / 7)} sem`;
  return `hace ${Math.floor(days / 30)} mes`;
}

export function AgendaWaitlistSidebar() {
  const { state, toggleWaitlist } = useAgenda();
  const [entries, setEntries] = useState<WaitlistEntryDTO[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchWaitlist();
      setEntries(list);
    } catch {
      toast.error("No se pudo cargar la lista de espera");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (state.waitlistOpen) void refresh();
  }, [state.waitlistOpen, refresh]);

  if (!state.waitlistOpen) return null;

  return (
    <aside className={styles.waitlistSidebar} aria-label="Lista de espera">
      <div className={styles.waitlistHeader}>
        <div className={styles.waitlistTitle}>
          Lista de espera
          <span className={styles.waitlistBadge}>{entries.length}</span>
        </div>
        <button
          type="button"
          className={styles.waitlistClose}
          onClick={() => toggleWaitlist(false)}
          aria-label="Cerrar lista de espera"
        >
          <X size={14} />
        </button>
      </div>
      <div className={styles.waitlistBody}>
        {loading && entries.length === 0 ? (
          <div className={styles.waitlistEmpty}>Cargando…</div>
        ) : entries.length === 0 ? (
          <div className={styles.waitlistEmpty}>
            No hay pacientes en espera.
          </div>
        ) : (
          entries.map((e) => (
            <WaitlistRow
              key={e.id}
              entry={e}
              onRemove={() =>
                setEntries((prev) => prev.filter((x) => x.id !== e.id))
              }
            />
          ))
        )}
      </div>
    </aside>
  );
}

interface WaitlistRowProps {
  entry: WaitlistEntryDTO;
  onRemove: () => void;
}

function WaitlistRow({ entry, onRemove }: WaitlistRowProps) {
  const { open: openNew } = useNewAppointmentDialog();
  const [busy, setBusy] = useState(false);

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `waitlist:${entry.id}`,
      data: {
        kind: "waitlist",
        entryId: entry.id,
        patient: entry.patient,
        reason: entry.reason,
        preferredDoctorId: entry.preferredDoctor?.id ?? null,
      },
      disabled: busy,
    });

  async function schedule() {
    if (busy) return;
    setBusy(true);
    openNew({
      initialPatient: { id: entry.patient.id, name: entry.patient.name },
      initialDoctorId: entry.preferredDoctor?.id ?? undefined,
      initialReason: entry.reason ?? undefined,
      openAgendaAfter: true,
      onCreated: async (appt) => {
        try {
          await updateWaitlist(entry.id, {
            status: "FULFILLED",
            appointmentId: appt.id,
          });
          toast.success(`${entry.patient.name} agendado`);
          onRemove();
        } catch {
          toast.error(
            "Cita creada, pero no se pudo marcar la entrada como agendada",
          );
        } finally {
          setBusy(false);
        }
      },
    });
    // Si el dialog se cierra sin crear, liberamos
    setTimeout(() => setBusy(false), 30_000);
  }

  async function discard() {
    if (busy) return;
    if (!confirm(`¿Descartar a ${entry.patient.name} de la lista?`)) return;
    setBusy(true);
    try {
      await updateWaitlist(entry.id, { status: "DISCARDED" });
      toast.success("Descartado");
      onRemove();
    } catch {
      toast.error("No se pudo descartar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={setNodeRef}
      className={`${styles.waitlistItem} ${isDragging ? styles.dragging : ""}`}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : undefined,
        zIndex: isDragging ? 50 : undefined,
        cursor: isDragging ? "grabbing" : "grab",
        touchAction: "none",
      }}
      {...listeners}
      {...attributes}
    >
      <div className={styles.waitlistItemHead}>
        <span className={styles.waitlistAvatar} aria-hidden>
          {patientInitials(entry.patient.name)}
        </span>
        <div className={styles.waitlistItemMain}>
          <div className={styles.waitlistItemName}>{entry.patient.name}</div>
          <div className={styles.waitlistItemReason}>
            {entry.reason ?? "Consulta"}
          </div>
        </div>
        <span
          className={styles.waitlistPriority}
          style={{ color: PRIORITY_COLOR[entry.priority] }}
          title={`Prioridad: ${PRIORITY_LABEL[entry.priority]}`}
        >
          {entry.priority === "HIGH" && <AlertTriangle size={11} aria-hidden />}
          {PRIORITY_LABEL[entry.priority]}
        </span>
      </div>
      <div className={styles.waitlistItemMeta}>
        <Clock size={10} aria-hidden /> {relativeDate(entry.createdAt)}
        {entry.preferredWindow && <span>· {entry.preferredWindow}</span>}
        {entry.preferredDoctor && (
          <span>· {entry.preferredDoctor.shortName}</span>
        )}
      </div>
      <div className={styles.waitlistItemActions}>
        <button
          type="button"
          className={styles.waitlistAction}
          onClick={schedule}
          disabled={busy}
        >
          <Calendar size={11} aria-hidden /> Agendar
        </button>
        <button
          type="button"
          className={`${styles.waitlistAction} ${styles.danger}`}
          onClick={discard}
          disabled={busy}
        >
          <Trash2 size={11} aria-hidden /> Descartar
        </button>
      </div>
    </div>
  );
}
