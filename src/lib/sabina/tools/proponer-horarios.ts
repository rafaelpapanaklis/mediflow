/**
 * `proponer_horarios` — las horas libres de un doctor un día concreto.
 *
 * Solo lee (key `agenda.view`, la de ver la agenda). No reserva nada: la hora
 * que devuelve se agenda con `agendar_cita`, que vuelve a comprobarla, y al
 * confirmar la comprueba el servidor otra vez.
 *
 * Distingue las respuestas que el MAPA (§5) pide no mezclar: «ese día la
 * clínica cierra», «ese día ya no quedan huecos de N minutos», «ese día ya
 * pasó». Y si quien pregunta no puede agendar, lo dice (`puedeAgendar`): no
 * tiene sentido ofrecerle huecos sin avisar.
 */

import { z } from "zod";
import { defaultDurationFor } from "@/lib/new-appointment/duration-presets";
import { definirHerramienta, tienePermiso } from "./base";
import { esquemaFecha, hoyEnClinica } from "./fechas";
import { tzLocalToUtc } from "@/lib/agenda/time-utils";
import {
  ROLES_AGENDAR,
  cargarClinica,
  dbAgendaDe,
  esquemaHora,
  fechaLarga,
  rolPermitido,
  type PreguntaAgenda,
} from "./agenda-comun";
import { buscarHuecos, leerOcupacion, type Hueco } from "./agenda-huecos";
import { resolverDoctor, resolverSillon } from "./agenda-resolvedores";
import type { SabinaCtx } from "../tipos";

const parametros = z.object({
  fecha: esquemaFecha.describe("Día, AAAA-MM-DD, en el calendario de la clínica."),
  doctor: z.string().max(80).optional().describe("Nombre del doctor, tal como lo dijo el usuario."),
  doctorId: z.string().max(64).optional().describe("Id del doctor, si ya lo resolviste antes."),
  duracionMinutos: z.number().int().min(5).max(480).optional().describe("Duración de la cita. Por defecto, la de la clínica."),
  horaPreferida: esquemaHora.optional().describe("Si el usuario pidió una hora, para ofrecer las más cercanas."),
  sillon: z.string().max(80).optional(),
  sillonId: z.string().max(64).optional(),
});

export type ParamsProponerHorarios = z.infer<typeof parametros>;

export interface DatosProponerHorarios {
  estado: "con_huecos" | "sin_huecos" | "dia_cerrado" | "pasado" | "pregunta" | "no_se_puede";
  fecha: string;
  doctor: { id: string; nombre: string } | null;
  sillon: { id: string; nombre: string } | null;
  duracionMinutos: number;
  /** Ventana de atención de ese día; `null` si cierra. */
  horario: { abre: string; cierra: string } | null;
  /** Como mucho 5. Sin nombres: solo horas (y qué sillones quedan libres). */
  huecos: Hueco[];
  /** Cuántas horas caben en total ese día. */
  totalHuecos: number;
  preguntas: PreguntaAgenda[];
  /** Frase cuando no se pudo resolver algo (doctor inexistente…). */
  frase: string | null;
  /** ¿Quien pregunta puede agendar? Si no, Sabina lo dice al ofrecer. */
  puedeAgendar: boolean;
}

export const proponerHorarios = definirHerramienta<ParamsProponerHorarios, DatosProponerHorarios>({
  nombre: "proponer_horarios",
  descripcion:
    "Horas libres de un doctor en un día concreto, dentro del horario de la clínica y del sillón, " +
    "sin encimar otra cita. Úsala para «¿qué huecos tiene el Dr. Salas el jueves?» o antes de agendar " +
    "cuando el usuario no dijo la hora. No agenda nada. Si falta el doctor, pregunta cuál.",
  parametros,
  permiso: "agenda.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosProponerHorarios> {
    const db = dbAgendaDe(ctx);
    const puedeAgendar = rolPermitido(ctx, ROLES_AGENDAR) && tienePermiso(ctx, "agenda.create");
    const clinica = await cargarClinica(ctx, db);
    const duracion = params.duracionMinutos ?? defaultDurationFor(clinica.defaultSlotMinutes);
    const vacio: DatosProponerHorarios = {
      estado: "pregunta",
      fecha: params.fecha,
      doctor: null,
      sillon: null,
      duracionMinutos: duracion,
      horario: null,
      huecos: [],
      totalHuecos: 0,
      preguntas: [],
      frase: null,
      puedeAgendar,
    };

    const doctor = await resolverDoctor(ctx, db, { doctorId: params.doctorId, doctor: params.doctor });
    if (doctor.tipo === "pregunta") return { ...vacio, preguntas: [doctor.pregunta] };
    if (doctor.tipo === "no") return { ...vacio, estado: "no_se_puede", frase: doctor.frase };

    const ocupacion = await leerOcupacion(ctx, db, { fecha: params.fecha, doctorId: doctor.valor.id, timezone: clinica.timezone });
    const sillon = resolverSillon(ocupacion.sillones, { sillonId: params.sillonId, sillon: params.sillon });
    if (sillon.tipo === "pregunta") return { ...vacio, doctor: doctor.valor, preguntas: [sillon.pregunta] };
    if (sillon.tipo === "no") return { ...vacio, estado: "no_se_puede", doctor: doctor.valor, frase: sillon.frase };

    const ahora = new Date();
    const { huecos, total, ventana } = buscarHuecos({
      fecha: params.fecha,
      duracion,
      clinica,
      ocupacion,
      sillonId: sillon.valor?.id ?? null,
      ahora,
      horaPreferida: params.horaPreferida ?? null,
    });

    const finDelDia = tzLocalToUtc(params.fecha, 23, 59, clinica.timezone);
    const estado: DatosProponerHorarios["estado"] = !ventana
      ? "dia_cerrado"
      : total > 0
        ? "con_huecos"
        : params.fecha < hoyEnClinica(clinica.timezone) || finDelDia.getTime() < ahora.getTime()
          ? "pasado"
          : "sin_huecos";

    return {
      ...vacio,
      estado,
      doctor: doctor.valor,
      sillon: sillon.valor,
      horario: ventana,
      huecos,
      totalHuecos: total,
      frase: estado === "dia_cerrado" ? `La clínica cierra el ${fechaLarga(tzLocalToUtc(params.fecha, 12, 0, clinica.timezone), clinica.timezone)}.` : null,
    };
  },

  vacio: () => false,

  resumir(d) {
    const dia = d.fecha;
    const conQuien = d.doctor ? ` con ${d.doctor.nombre}` : "";
    const aviso = d.puedeAgendar ? "" : " OJO: quien pregunta NO tiene permiso para agendar citas; dilo si ofreces horas.";
    switch (d.estado) {
      case "pregunta":
        return `FALTA INFORMACIÓN: ${d.preguntas.map((p) => p.texto).join(" ")} Pregúntaselo al usuario; no elijas tú.`;
      case "no_se_puede":
        return `NO SE PUEDE: ${d.frase ?? "no pude resolver los datos."}`;
      case "dia_cerrado":
        return `${d.frase ?? `La clínica cierra el ${dia}.`} No hay horas que ofrecer ese día.${aviso}`;
      case "pasado":
        return `El ${dia} ya pasó: no hay horas que ofrecer.`;
      case "sin_huecos":
        return `El ${dia}${conQuien} ya no quedan huecos de ${d.duracionMinutos} min dentro del horario (${d.horario?.abre}–${d.horario?.cierra}).${aviso}`;
      case "con_huecos":
        return (
          `${d.totalHuecos} horas libres de ${d.duracionMinutos} min el ${dia}${conQuien}` +
          `${d.sillon ? ` en ${d.sillon.nombre}` : ""}; las primeras: ${d.huecos.map((h) => h.hora).join(", ")}.${aviso}`
        );
    }
  },
});
