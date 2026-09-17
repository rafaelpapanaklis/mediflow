"use client";

/**
 * «Editar cita», abierta desde la pestaña Citas del expediente (ws1-t3).
 *
 * Es LA MISMA ventana de la agenda nueva (`AgendaEditAppointmentModal` con
 * `ROPA_EDITAR_CITA`), no una copia: fecha, hora, duración, doctor, unidad y
 * motivo se guardan con su mismo `rescheduleAppointment`, y los solapes, el
 * horario de la clínica y las vacaciones del doctor los valida el mismo
 * servidor, con el mismo aviso de choque y el mismo «forzar con motivo».
 *
 * ⛔ Aquí NO hay ni una regla. Lo que este archivo añade a la ventana son dos
 * cosas que en la agenda viven en el panel lateral, y las dos llaman a lo que
 * ya existe, igual que `agenda-nueva/panel-cita.tsx`:
 *   · cambiar de estado → `patchAppointmentStatus` (PATCH /api/appointments/:id/status)
 *   · qué estados caben → `possibleTransitions`, CON el rol (la máquina real)
 *   · eliminar          → el mismo PATCH a CANCELLED con motivo, tras
 *                         `confirmWithReason`. La API no borra citas: las
 *                         cancela, y la confirmación lo dice con esas palabras.
 * El servidor revalida permisos y transiciones en todos los casos.
 */

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Trash2 } from "lucide-react";
import type { Role } from "@prisma/client";
import { AgendaEditAppointmentModal } from "@/components/dashboard/agenda/agenda-edit-appointment-modal";
import { ROPA_EDITAR_CITA } from "@/components/dashboard/agenda-nueva/ropa";
import { useConfirmWithReason } from "@/components/ui/confirm-dialog";
import { patchAppointmentStatus } from "@/lib/agenda/mutations";
import { possibleTransitions } from "@/lib/agenda/transitions";
import { ESTADO_LEGACY_PENDIENTE, estadoNormalizado } from "@/lib/agenda-nueva/estados";
import type {
  AgendaAppointmentDTO,
  AppointmentStatus,
  DoctorColumnDTO,
  ResourceDTO,
} from "@/lib/agenda/types";
import { formatDate } from "@/lib/utils";
import s from "./citas-expediente.module.css";

/** Lo que la página del expediente carga en el servidor, solo con la bandera. */
export interface AgendaDelExpediente {
  timezone: string;
  doctors: DoctorColumnDTO[];
  resources: ResourceDTO[];
  /** Los mismos booleanos que baja /dashboard/agenda (`agenda.edit`, `agenda.delete`). */
  permisos: { canEdit: boolean; canCancel: boolean };
}

/**
 * Qué citas se abren: la MISMA regla con la que la agenda ofrece «Editar»
 * (`panel-cita.tsx`: `!terminal && permissions.canEdit`). Una cancelada o una
 * no asistida no se edita: se reagenda o se reabre, y eso sigue en la agenda.
 */
export function citaAbrible(status: string, permisos: AgendaDelExpediente["permisos"]): boolean {
  return permisos.canEdit && status !== "CANCELLED" && status !== "NO_SHOW";
}

export interface VentanaCitaProps {
  /** La fila de la tabla de Citas (la cita tal como la serializa la página), o null = cerrada. */
  cita: any | null;
  pacienteId: string;
  pacienteNombre: string;
  agenda: AgendaDelExpediente;
  userRole?: string;
  /** Etiqueta unificada del estado, la misma que pinta la tabla. */
  estado: (status: string) => { texto: string; tono: string };
  onClose: () => void;
}

export function VentanaCita({
  cita,
  pacienteId,
  pacienteNombre,
  agenda,
  userRole,
  estado,
  onClose,
}: VentanaCitaProps) {
  const router = useRouter();
  const confirmarConMotivo = useConfirmWithReason();
  const [enVuelo, setEnVuelo] = useState(false);
  // Mientras se confirma el borrado, el Escape es de la confirmación: la
  // ventana también lo escucha (en `window`) y sin esto se cerrarían las dos.
  const confirmando = useRef(false);

  // Solo lo que la ventana LEE para hidratar su formulario. El estado queda
  // fuera a propósito: al cambiarlo, la página se refresca y, si el DTO
  // cambiara de identidad, la ventana rehidrataría y se perdería una fecha a
  // medio editar.
  const id: string | null = cita?.id ?? null;
  const startsAt: string | null = cita?.startsAt ?? null;
  const endsAt: string | null = cita?.endsAt ?? null;
  const doctorId: string | null = cita?.doctor?.id ?? cita?.doctorId ?? null;
  const resourceId: string | null = cita?.resourceId ?? null;
  const motivo: string | null = cita?.type ?? null;
  const dto = useMemo<AgendaAppointmentDTO | null>(
    () =>
      id && startsAt
        ? ({
            id,
            startsAt,
            endsAt: endsAt ?? startsAt,
            status: "SCHEDULED",
            patient: { id: pacienteId, name: pacienteNombre },
            doctor: doctorId ? { id: doctorId, shortName: "" } : undefined,
            // La agenda llama `reason` a la columna `type` (appointmentToDTO).
            reason: motivo ?? undefined,
            resourceId,
          } as AgendaAppointmentDTO)
        : null,
    [id, startsAt, endsAt, doctorId, resourceId, motivo, pacienteId, pacienteNombre],
  );

  const prestado = useMemo(
    () => ({
      timezone: agenda.timezone,
      doctors: agenda.doctors,
      resources: agenda.resources,
      // La tabla sale de la página (servidor): se vuelve a pedir, igual que
      // hace «Cancelar» en esta misma pestaña.
      onGuardada: () => router.refresh(),
    }),
    [agenda.timezone, agenda.doctors, agenda.resources, router],
  );

  const estadoActual: string = cita?.status ?? "";
  // Sin memo a propósito: `now` decide si cabe «No asistió» (la gracia de
  // 15 min), y memoizado se quedaba en la hora a la que se abrió la ventana.
  const transiciones: AppointmentStatus[] =
      // Una fila legacy en PENDING se pinta como agendada pero el servidor la
      // rechaza con 409: no ofrece ningún cambio, como en la agenda.
      cita && estadoActual !== ESTADO_LEGACY_PENDIENTE
        ? possibleTransitions(estadoNormalizado(estadoActual as AppointmentStatus), {
            role: userRole as Role | undefined,
            now: new Date(),
            appointmentStart: new Date(cita.startsAt),
          })
        : [];
  const destinos = transiciones.filter((d) => d !== "CANCELLED");
  const puedeEliminar = agenda.permisos.canCancel && transiciones.includes("CANCELLED");

  function avisarError(err: unknown) {
    const e = err as { status?: number; reason?: string; error?: string; message?: string };
    const detalle = e?.reason ?? e?.error ?? e?.message ?? "No se pudo cambiar el estado.";
    toast.error(`${e?.status ? `[${e.status}] ` : ""}${detalle}`);
  }

  async function cambiarEstado(destino: AppointmentStatus) {
    if (!cita || enVuelo) return;
    setEnVuelo(true);
    try {
      await patchAppointmentStatus(cita.id, destino);
      toast.success(`Estado: ${estado(destino).texto}`);
      // Empezar la consulta lleva a la ficha con la consulta en curso, igual
      // que desde la agenda.
      if (destino === "IN_PROGRESS") {
        onClose();
        router.push(`/dashboard/patients/${pacienteId}?appointment=${cita.id}`);
      }
      // Una no asistida ya no se edita (misma regla que la agenda): la ventana
      // se cierra en vez de quedarse abierta sobre una cita terminal.
      if (!citaAbrible(destino, agenda.permisos)) onClose();
      router.refresh();
    } catch (err) {
      avisarError(err);
    } finally {
      setEnVuelo(false);
    }
  }

  async function eliminar() {
    if (!cita || enVuelo) return;
    const doctor = [cita.doctor?.firstName, cita.doctor?.lastName].filter(Boolean).join(" ");
    confirmando.current = true;
    const r = await confirmarConMotivo({
      title: "¿Eliminar esta cita?",
      description: (
        <>
          Se va a eliminar de la agenda la cita de <b>{pacienteNombre}</b> del{" "}
          <b>{formatDate(cita.date)}</b> a las <b>{cita.startTime}</b>
          {doctor ? <> con <b>{doctor}</b></> : null}
          {cita.type ? <> ({cita.type})</> : null}. Su horario queda libre y se anulan sus
          recordatorios pendientes. En el expediente se conserva como «Cancelada»: no se borra
          del historial.
        </>
      ),
      variant: "danger",
      withReason: true,
      reasonLabel: "Motivo (opcional)",
      reasonPlaceholder: "Ej.: el paciente pidió reagendar",
      confirmText: "Eliminar la cita",
    }).finally(() => {
      // En un `setTimeout`, no aquí mismo: la confirmación se resuelve DENTRO
      // del Escape (captura, en `document`), y este `finally` correría antes
      // de que ese mismo Escape llegue al oyente de la ventana (en `window`).
      setTimeout(() => {
        confirmando.current = false;
      }, 0);
    });
    if (!r.confirmed) return;

    setEnVuelo(true);
    try {
      const motivoCancelacion = r.reason?.trim();
      const res = await fetch(`/api/appointments/${cita.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "CANCELLED",
          ...(motivoCancelacion ? { reason: motivoCancelacion } : {}),
        }),
      });
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) throw { status: res.status, ...cuerpo };
      toast.success("Cita eliminada de la agenda.");
      onClose();
      router.refresh();
    } catch (err) {
      avisarError(err);
    } finally {
      setEnVuelo(false);
    }
  }

  const e = estado(estadoActual);

  return (
    <AgendaEditAppointmentModal
      appt={dto}
      isOpen={dto !== null}
      onClose={() => {
        if (!confirmando.current) onClose();
      }}
      ropa={ROPA_EDITAR_CITA}
      prestado={prestado}
      extra={
        <label className={ROPA_EDITAR_CITA.campo}>
          <span className={ROPA_EDITAR_CITA.campoRotulo}>Estado</span>
          <select
            className={ROPA_EDITAR_CITA.control}
            value={estadoActual}
            disabled={enVuelo || !agenda.permisos.canEdit || destinos.length === 0}
            onChange={(ev) => cambiarEstado(ev.target.value as AppointmentStatus)}
          >
            <option value={estadoActual}>{e.texto}</option>
            {destinos.map((d) => (
              <option key={d} value={d}>
                {estado(d).texto}
              </option>
            ))}
          </select>
          <span className={s.nota}>
            {destinos.length === 0
              ? "Desde este estado no hay ningún cambio disponible."
              : "El estado se guarda al elegirlo, sin pulsar «Guardar cambios»."}
          </span>
        </label>
      }
      pieExtra={
        puedeEliminar ? (
          <button type="button" className={s.eliminar} onClick={eliminar} disabled={enVuelo}>
            <Trash2 size={16} strokeWidth={1.75} aria-hidden />
            Eliminar cita
          </button>
        ) : null
      }
    />
  );
}
