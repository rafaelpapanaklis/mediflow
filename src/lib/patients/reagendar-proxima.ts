// «Reagendar próxima» y «Nuevo plan de tratamiento» de la ficha (ws1-t1, auditoría BEVADENT, F7).
//
// EL FALLO: «Reagendar próxima» abría «Nueva cita» en blanco —el primer doctor de la lista
// (`doctorQueRecibeCitas` cae a `lista[0]`), sin consultorio y con la fecha de hoy— aunque el paciente YA
// tuviera una cita futura: recepción creaba una segunda cita en vez de mover la que había. Y «Nuevo plan de
// tratamiento» preseleccionaba `doctors[0]`, que no tiene nada que ver con el paciente.
//
// LA REGLA:
//   · Con una cita pendiente por delante (agendada o confirmada; la de hoy aún sin atender cuenta), «Reagendar
//     próxima» abre ESA cita para moverla. Una en la que el paciente ya está (llegó, en sillón, en consulta) no
//     se reagenda: se atiende.
//   · Sin ella, «Nueva cita» llega prellenada con lo de su última cita (doctor, consultorio y motivo); si nunca
//     tuvo una, con su doctor tratante.
//   · El plan nuevo propone al doctor de su última cita; si no, a quien está en sesión si atiende; si no, el
//     primero de la lista (lo de antes: el selector no tiene opción vacía y lo que enseña es lo que se envía).

import { proximaCitaDeLaFicha } from "./proxima-cita";
import type { AgendaAppointmentDTO } from "@/lib/agenda/types";

/** Lo que la ficha sabe de cada cita (la fila serializada por `patients/[id]/page.tsx`). */
export interface CitaDeLaFicha {
  id: string;
  status: string;
  startsAt: string | Date;
  doctorId?: string | null;
  doctor?: { id?: string | null } | null;
  resourceId?: string | null;
  type?: string | null;
}

const PACIENTE_PRESENTE = new Set(["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"]);
const NO_CUENTA_COMO_ULTIMA = new Set(["CANCELLED"]);

function doctorDe(cita: CitaDeLaFicha): string | null {
  return cita.doctor?.id ?? cita.doctorId ?? null;
}

/** La cita que «Reagendar próxima» abre para mover, o null si no hay ninguna por delante. */
export function citaParaReagendar<T extends CitaDeLaFicha>(citas: readonly T[], ahora: Date, zona: string): T | null {
  return proximaCitaDeLaFicha(
    citas.filter((c) => !PACIENTE_PRESENTE.has(c.status)),
    ahora,
    zona,
  );
}

/** La cita más reciente que ya empezó (no cancelada) y tiene doctor: de ella sale el prellenado. */
export function ultimaCitaDelPaciente<T extends CitaDeLaFicha>(citas: readonly T[], ahora: Date): T | null {
  let mejor: { cita: T; inicio: number } | null = null;
  for (const cita of citas) {
    if (NO_CUENTA_COMO_ULTIMA.has(cita.status) || !doctorDe(cita)) continue;
    const inicio = new Date(cita.startsAt).getTime();
    if (Number.isNaN(inicio) || inicio > ahora.getTime()) continue;
    if (!mejor || inicio > mejor.inicio) mejor = { cita, inicio };
  }
  return mejor?.cita ?? null;
}

export interface PrellenadoNuevaCita {
  /** Candidatos a doctor, en orden: el de su última cita y luego el tratante. «Nueva cita» toma el primero que reciba citas. */
  initialDoctorIds: string[];
  initialResourceId?: string;
  initialReason?: string;
}

export function prellenadoDeNuevaCita(
  citas: readonly CitaDeLaFicha[],
  opciones: { ahora: Date; tratanteId?: string | null },
): PrellenadoNuevaCita {
  const ultima = ultimaCitaDelPaciente(citas, opciones.ahora);
  const candidatos = [ultima ? doctorDe(ultima) : null, opciones.tratanteId ?? null].filter(
    (id, i, todos): id is string => !!id && todos.indexOf(id) === i,
  );
  const motivo = ultima?.type?.trim();
  return {
    initialDoctorIds: candidatos,
    ...(ultima?.resourceId ? { initialResourceId: ultima.resourceId } : {}),
    ...(motivo ? { initialReason: motivo } : {}),
  };
}

/** El doctor con el que nace «Nuevo plan de tratamiento». Siempre uno de `doctorIds` (o "" si la lista está vacía). */
export function doctorParaNuevoPlan(
  citas: readonly CitaDeLaFicha[],
  opciones: { ahora: Date; usuarioId?: string | null; doctorIds: readonly string[] },
): string {
  const { doctorIds } = opciones;
  const ultima = ultimaCitaDelPaciente(citas, opciones.ahora);
  for (const id of [ultima ? doctorDe(ultima) : null, opciones.usuarioId ?? null]) {
    if (id && doctorIds.includes(id)) return id;
  }
  return doctorIds[0] ?? "";
}

/**
 * La cita de la ficha en la forma que lee la ventana de mover/editar (`AgendaEditAppointmentModal`). Es lo mismo
 * que arma `VentanaCita` del expediente rediseñado; aquí para la ficha de siempre, que la abre sin envoltorio.
 */
export function dtoParaMoverCita(
  cita: (CitaDeLaFicha & { endsAt?: string | Date | null }) | null,
  paciente: { id: string; nombre: string },
): AgendaAppointmentDTO | null {
  if (!cita) return null;
  const inicio = new Date(cita.startsAt);
  if (Number.isNaN(inicio.getTime())) return null;
  const fin = cita.endsAt ? new Date(cita.endsAt) : inicio;
  const doctorId = doctorDe(cita);
  return {
    id: cita.id,
    startsAt: inicio.toISOString(),
    endsAt: (Number.isNaN(fin.getTime()) ? inicio : fin).toISOString(),
    status: "SCHEDULED",
    patient: { id: paciente.id, name: paciente.nombre },
    doctor: doctorId ? { id: doctorId, shortName: "" } : undefined,
    // La agenda llama `reason` a la columna `type` (appointmentToDTO).
    reason: cita.type ?? undefined,
    resourceId: cita.resourceId ?? null,
  } as AgendaAppointmentDTO;
}
