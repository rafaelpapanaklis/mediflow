import "server-only";

/**
 * «Buscar espacio» — los primeros huecos libres de N minutos en los próximos
 * días, por responsable.
 *
 * ⛔ Esta NO es una calculadora de huecos nueva. El repo ya tenía CUATRO que
 * no coincidían entre sí, y `src/lib/sabina/tools/agenda-huecos.ts` se escribió
 * justo para acabar con eso: cada hora candidata pasa por las MISMAS funciones
 * con las que decide `POST /api/appointments` (horario de la clínica, horario
 * del sillón, solape, pasado). Aquí se reusan `buscarHuecos` y `ventanaDeAtencion`
 * tal cual. Lo único que se añade es lo que a Sabina no le hacía falta: barrer
 * VARIOS días y VARIOS responsables con un número acotado de consultas.
 *
 * Por qué no se llama a `leerOcupacion` en bucle: sería una consulta por día y
 * por doctor (14 × 3 = 42). La regla de la casa es menos de 7 por `Promise.all`
 * porque el pooler se satura. Aquí son CUATRO en total —unidades, citas del
 * rango, bloqueos del rango y horarios de unidad— y el reparto por día se hace
 * en memoria.
 *
 * ⚠️ WS1-T2 — ESTE ES EL SEXTO SITIO que calcula disponibilidad, y no estaba en
 * la lista de cinco de la tarea. No hizo falta encontrarlo a mano: al volver
 * OBLIGATORIO el campo `bloqueos` de `Ocupacion`, el compilador señaló este
 * archivo. Es exactamente para eso que ese campo no es opcional.
 */

import { prisma } from "@/lib/prisma";
import { calendarRangeUtc } from "@/lib/agenda/date-ranges";
import { calendarDayRangeUtc } from "@/lib/agenda/time-utils";
import type { BusyInterval } from "@/lib/public-booking/slots";
import type { WeekScheduleDTO } from "@/lib/agenda/types";
import {
  buscarHuecos,
  ventanaDeAtencion,
  type Ocupacion,
  type Sillon,
} from "@/lib/sabina/tools/agenda-huecos";
import type { ConfigClinica } from "@/lib/sabina/tools/agenda-comun";
import { rangoDeCuando, sumarDias } from "./fechas";
import { leerBloqueosDelRango } from "@/lib/agenda-bloqueos/consulta.server";
import { sinApartadoVencido } from "@/lib/agenda/apartado";

// Reexportado para que la ruta lo importe de un solo sitio.
export { rangoDeCuando };

/** Cuántos huecos devuelve como mucho. El diseño enseña seis. */
export const TOPE_HUECOS_PANEL = 6;

/** Cuántos días se barren como mucho, pase lo que pase en la petición. */
export const MAX_DIAS = 21;

export interface HuecoEncontrado {
  /** `YYYY-MM-DD` en la zona de la clínica. */
  fecha: string;
  /** `HH:MM` local. */
  hora: string;
  /** `HH:MM` local de fin. */
  horaFin: string;
  doctorId: string;
  doctorNombre: string;
  /** La primera unidad libre a esa hora, si la clínica usa unidades. */
  unidadId: string | null;
  unidadNombre: string | null;
}

export interface BuscarHuecosArgs {
  clinicId: string;
  clinica: ConfigClinica;
  /** Primer día del barrido, `YYYY-MM-DD`. */
  desde: string;
  /** Cuántos días barrer desde `desde`, ambos inclusive. */
  dias: number;
  duracionMin: number;
  /** Ids de los responsables entre los que buscar. Vacío = no se busca nada. */
  doctorIds: string[];
  /** Nombre por id, para no volver a leer la tabla de usuarios. */
  nombresDoctor: Map<string, string>;
  ahora: Date;
  tope?: number;
}

/**
 * Los primeros huecos del rango, ordenados por fecha y hora.
 *
 * Por cada día y cada responsable se busca UN hueco (el primero que cabe),
 * como el diseño: la lista es «lo antes posible con cada quien», no la rejilla
 * entera de un día.
 */
export async function buscarHuecosDelRango(args: BuscarHuecosArgs): Promise<HuecoEncontrado[]> {
  const tope = args.tope ?? TOPE_HUECOS_PANEL;
  const dias = Math.max(1, Math.min(MAX_DIAS, args.dias));
  if (args.doctorIds.length === 0 || args.duracionMin <= 0) return [];

  const { timezone } = args.clinica;
  const fechas: string[] = [];
  for (let i = 0; i < dias; i++) fechas.push(sumarDias(args.desde, i));

  // El rango UTC completo del barrido, de la primera medianoche a la última.
  const rango = calendarRangeUtc(args.desde, fechas[fechas.length - 1]!, timezone);

  // CUATRO consultas, no una por día. `clinicId` sale de la sesión: si faltara,
  // Prisma descartaría la clave y devolvería las citas de TODAS las clínicas.
  const [unidades, citas, bloqueos] = await Promise.all([
    prisma.resource.findMany({
      where: { clinicId: args.clinicId, isActive: true },
      orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    // Por `clinicId` y NO por doctor: una hora puede estar libre para el
    // doctor y tener el sillón ocupado por otro. Solo se piden horas y a quién
    // bloquean; ni un dato del paciente sale de aquí.
    prisma.appointment.findMany({
      where: {
        clinicId: args.clinicId,
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        startsAt: { lt: rango.toUtc },
        endsAt: { gt: rango.fromUtc },
        // WS1-T5 — una cita apartada cuyo anticipo venció ya no ocupa el hueco.
        AND: [sinApartadoVencido()],
      },
      select: { doctorId: true, resourceId: true, startsAt: true, endsAt: true },
    }),
    // WS1-T2 — los bloqueos de TODO el barrido, de una vez. Se piden los de
    // estos doctores y los de toda la clínica; `bloqueaEsteHueco` (dentro de
    // `evaluarHora`) aplica el alcance doctor a doctor.
    leerBloqueosDelRango(args.clinicId, rango.fromUtc, rango.toUtc, {
      doctorIds: args.doctorIds,
    }),
  ]);

  const idsUnidad = unidades.map((u) => u.id);
  const filasHorario = idsUnidad.length
    ? await prisma.resourceSchedule.findMany({
        where: { resourceId: { in: idsUnidad } },
        select: { resourceId: true, dayOfWeek: true, startTime: true, endTime: true },
        orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
      })
    : [];

  const horarioPorUnidad = new Map<string, ReturnType<typeof aWeekSchedule>>();
  for (const u of unidades) {
    horarioPorUnidad.set(
      u.id,
      aWeekSchedule(filasHorario.filter((f) => f.resourceId === u.id)),
    );
  }

  const intervalo = (c: { startsAt: Date; endsAt: Date }): BusyInterval => ({
    startsAt: c.startsAt,
    endsAt: c.endsAt,
  });

  const resultados: HuecoEncontrado[] = [];

  for (const fecha of fechas) {
    if (resultados.length >= tope) break;

    // Día cerrado: ni se mira. `ventanaDeAtencion` ya aplica el criterio de
    // `scheduleViolation` (manda el horario del día de Ajustes; sin él, la
    // ventana histórica agendaDayStart/End).
    if (ventanaDeAtencion(fecha, args.clinica) === null) continue;

    const { startUtc, endUtc } = calendarDayRangeUtc(fecha, timezone);
    const delDia = citas.filter(
      (c) => c.startsAt.getTime() < endUtc.getTime() && c.endsAt.getTime() > startUtc.getTime(),
    );
    // Los bloqueos que tocan ESTE día, recortando en memoria el barrido entero
    // (mismo criterio de solape que las citas de arriba).
    const bloqueosDelDia = bloqueos.filter(
      (b) => b.startsAt.getTime() < endUtc.getTime() && b.endsAt.getTime() > startUtc.getTime(),
    );

    const sillonesDelDia: Sillon[] = unidades.map((u) => ({
      id: u.id,
      nombre: u.name,
      horario: horarioPorUnidad.get(u.id) ?? null,
      ocupado: delDia.filter((c) => c.resourceId === u.id).map(intervalo),
    }));

    // Un hueco por responsable y día: el primero que cabe.
    const delDiaOrdenados: HuecoEncontrado[] = [];
    for (const doctorId of args.doctorIds) {
      const ocupacion: Ocupacion = {
        doctorId,
        doctor: delDia.filter((c) => c.doctorId === doctorId).map(intervalo),
        sillones: sillonesDelDia,
        bloqueos: bloqueosDelDia,
      };

      const { huecos } = buscarHuecos({
        fecha,
        duracion: args.duracionMin,
        clinica: args.clinica,
        ocupacion,
        sillonId: null,
        ahora: args.ahora,
        tope: 1,
      });

      const h = huecos[0];
      if (!h) continue;

      const primera = h.sillones?.[0] ?? null;
      delDiaOrdenados.push({
        fecha,
        hora: h.hora,
        horaFin: sumarMinutosAHora(h.hora, args.duracionMin),
        doctorId,
        doctorNombre: args.nombresDoctor.get(doctorId) ?? "Responsable",
        unidadId: primera?.id ?? null,
        unidadNombre: primera?.nombre ?? null,
      });
    }

    delDiaOrdenados.sort((a, b) => a.hora.localeCompare(b.hora));
    for (const h of delDiaOrdenados) {
      if (resultados.length >= tope) break;
      resultados.push(h);
    }
  }

  return resultados;
}

/** `HH:MM` + minutos → `HH:MM`. */
function sumarMinutosAHora(hhmm: string, minutos: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + minutos;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Filas de `resource_schedules` → el `WeekScheduleDTO` que espera
 * `validateResourceSchedule`. Sin filas, `null` = siempre abierto (el mismo
 * criterio de `loadResourceSchedule`).
 */
function aWeekSchedule(
  filas: { dayOfWeek: number; startTime: string; endTime: string }[],
): WeekScheduleDTO | null {
  if (filas.length === 0) return null;
  // Los siete días literales (no un Record<number, …>): `WeekScheduleDTO` los
  // declara uno a uno, y un índice suelto no le vale al tipo.
  const days: WeekScheduleDTO["days"] = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const f of filas) {
    if (f.dayOfWeek < 0 || f.dayOfWeek > 6) continue;
    days[f.dayOfWeek as keyof WeekScheduleDTO["days"]].push({
      startTime: f.startTime,
      endTime: f.endTime,
    });
  }
  return { days };
}
