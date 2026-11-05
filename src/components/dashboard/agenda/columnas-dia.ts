/**
 * Las columnas de la vista Día de la agenda de siempre (`AgendaShell`), en lógica PURA: sin
 * React ni DOM, para poder probarla sola. La usa `computeColumns` de agenda-page-client.tsx.
 *
 * ws1-t11 · fase 2 · P2 — cita «Sin doctor» (plan §2.3, decisión D2): en modo «Doctores» va una
 * columna «Sin doctor» A LA IZQUIERDA de los doctores, con las citas que todavía no son de
 * nadie. Sale si la clínica puede agendar así (`sinDoctorDisponible`: el SQL ya se pegó) o si
 * en lo cargado hay alguna sin doctor (nunca se esconde una cita). Sin el SQL y sin ninguna, las
 * columnas son exactamente las de antes.
 *
 * Su `doctorId` es `FILTRO_SIN_DOCTOR` (nunca un id de la base): el droppable lo lleva tal cual
 * y `resolveDropTarget` lo convierte en `null` (soltar ahí le quita el doctor); el clic en un
 * hueco abre «Nueva cita» con `doctorId: null` («Sin doctor»).
 *
 * Mismo ancho que las demás (`repeat(N, minmax(160px, 1fr))` y la guía del cursor cuentan con
 * columnas iguales): con un solo doctor quedan dos columnas a la mitad, como con dos doctores.
 */
import { FILTRO_SIN_DOCTOR } from "@/lib/agenda/sin-doctor";
import { calendarDayISO } from "@/lib/agenda/date-ranges";
import { COLOR_SIN_DOCTOR } from "@/lib/agenda/doctor-legend";
import { hayColumnaSinDoctor } from "@/lib/agenda-nueva/vista-modelo";
import type { AgendaAppointmentDTO, DoctorColumnDTO } from "@/lib/agenda/types";

export interface AgendaColumnDescriptor {
  key: string;
  type: "doctor" | "resource" | "unified";
  doctorId: string | null;
  resourceId: string | null;
  title: string;
  subtitle?: string;
  color?: string | null;
  occupancyPct: number;
  /** ws1-t11 — la columna «Sin doctor» (`doctorId === FILTRO_SIN_DOCTOR`). */
  sinDoctor?: boolean;
  /**
   * ws1-t11 — citas vivas del día en la columna «Sin doctor». Su cabecera dice «N citas» en vez
   * del % de ocupación: varias «Sin doctor» a la misma hora no se estorban, así que el % no dice nada.
   */
  citas?: number;
}

export function esColumnaSinDoctor(doctorId: string | null | undefined): boolean {
  return doctorId === FILTRO_SIN_DOCTOR;
}

/** La columna de doctor de una cita: su doctor, o «Sin doctor». */
export function columnaDeDoctorDe(a: Pick<AgendaAppointmentDTO, "doctor">): string {
  return a.doctor?.id ?? FILTRO_SIN_DOCTOR;
}

/** `doctorId` de `initialSlot` al hacer clic en un hueco: `null` en «Sin doctor» (D1), `undefined` fuera de doctores. */
export function doctorDelHuecoDe(column: Pick<AgendaColumnDescriptor, "doctorId">): string | null | undefined {
  if (esColumnaSinDoctor(column.doctorId)) return null;
  return column.doctorId ?? undefined;
}

const NO_OCUPA = new Set(["CANCELLED", "NO_SHOW"]);

export function occupancyOf(
  appts: { startsAt: string; endsAt?: string; status: string }[],
  totalSlots: number,
  slotMinutes: number,
): number {
  if (totalSlots === 0) return 0;
  let occupied = 0;
  for (const a of appts) {
    if (NO_OCUPA.has(a.status)) continue;
    if (!a.endsAt) continue;
    const dur = (new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60_000;
    occupied += Math.ceil(dur / slotMinutes);
  }
  return Math.min(100, Math.round((occupied / totalSlots) * 100));
}

export interface EntradaColumnasPorDoctor {
  doctors: readonly DoctorColumnDTO[];
  appointments: readonly AgendaAppointmentDTO[];
  dayISO: string;
  timezone: string;
  /** `state.sinDoctorDisponible`. */
  sinDoctorDisponible?: boolean;
  slotsAvailablePerColumn: number;
  slotMinutes: number;
  /** i18n `agenda.sinDoctor.nombre`. */
  nombreSinDoctor: string;
  /** i18n `agenda.pageClient.professionalFallback`. */
  nombreProfesional: string;
}

/** Modo «Doctores»: [«Sin doctor»?] + doctores activos + huérfanos (doctores con citas que ya no están en agenda). */
export function columnasPorDoctor(e: EntradaColumnasPorDoctor): AgendaColumnDescriptor[] {
  // Columnas para doctores explícitamente activos en agenda.
  const activeDoctors = e.doctors.filter((d) => d.activeInAgenda);
  const renderedIds = new Set(activeDoctors.map((d) => d.id));

  // Doctores con citas hoy pero que NO están marcados como activos en
  // agenda (o que no aparecen en state.doctors). Sin esta unión, una
  // cita queda silenciosamente oculta cuando el doctor fue desactivado
  // pero todavía tiene citas — es la causa raíz observada de la
  // vista Día vacía aunque el contador muestre N citas.
  const orphanIds = new Set<string>();
  for (const a of e.appointments) {
    const id = a.doctor?.id;
    if (id && !renderedIds.has(id)) orphanIds.add(id);
  }

  const orphanDoctors: DoctorColumnDTO[] = Array.from(orphanIds).map((id) => {
    const known = e.doctors.find((d) => d.id === id);
    if (known) return known;
    // El doctor no está en state.doctors (ej. role != DOCTOR o
    // isActive=false). Construimos un descriptor mínimo a partir del
    // shortName que viene en la cita.
    const fromAppt = e.appointments.find((a) => a.doctor?.id === id)?.doctor;
    return {
      id,
      displayName: fromAppt?.shortName ?? e.nombreProfesional,
      shortName: fromAppt?.shortName ?? e.nombreProfesional,
      color: null,
      avatarUrl: null,
      activeInAgenda: false,
    };
  });

  const columnas: AgendaColumnDescriptor[] = [...activeDoctors, ...orphanDoctors].map((d) => {
    const apptsHere = e.appointments.filter((a) => a.doctor?.id === d.id);
    return {
      key: `doctor:${d.id}`,
      type: "doctor",
      doctorId: d.id,
      resourceId: null,
      title: d.shortName,
      subtitle: undefined,
      color: d.color,
      occupancyPct: occupancyOf(apptsHere, e.slotsAvailablePerColumn, e.slotMinutes),
    };
  });

  if (!hayColumnaSinDoctor(e.sinDoctorDisponible, e.appointments)) return columnas;

  const sinDoctor = e.appointments.filter((a) => !a.doctor?.id);
  const vivasHoy = sinDoctor.filter(
    (a) => !NO_OCUPA.has(a.status) && calendarDayISO(a.startsAt, e.timezone) === e.dayISO,
  ).length;
  return [
    {
      key: `doctor:${FILTRO_SIN_DOCTOR}`,
      type: "doctor",
      doctorId: FILTRO_SIN_DOCTOR,
      resourceId: null,
      title: e.nombreSinDoctor,
      subtitle: undefined,
      color: COLOR_SIN_DOCTOR,
      occupancyPct: occupancyOf(sinDoctor, e.slotsAvailablePerColumn, e.slotMinutes),
      sinDoctor: true,
      citas: vivasHoy,
    },
    ...columnas,
  ];
}
