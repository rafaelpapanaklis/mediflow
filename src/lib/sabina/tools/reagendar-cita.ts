/**
 * `reagendar_cita` — PROPONE mover una cita a otra hora. No la mueve.
 *
 * Devuelve la petición exacta a `PATCH /api/appointments/:id` con SOLO la hora
 * nueva (`startsAt` + `endsAt`, misma duración). Tres cuidados del MAPA (§2):
 *  · si solo se manda `startsAt`, el fin sigue siendo el viejo: se manda siempre
 *    el par;
 *  · `reason: null` devuelve el motivo a «Consulta general» y `notes: null`
 *    borra las notas: nunca se mandan campos que no cambian;
 *  · 🔴 nadie le avisa al paciente del cambio (N9). Decisión de Rafael: Sabina no
 *    manda nada, pero LO DICE en la tarjeta — y si ya le salió el recordatorio
 *    con la hora vieja, también.
 *
 * Solo mueve citas agendadas o confirmadas que aún no empiezan (el criterio del
 * bot para ofrecer mover), con `rescheduleRuleViolation`, la función del PATCH.
 * Doctor y sillón no cambian en esta ola.
 */

import { z } from "zod";
import { NOT_MOVABLE_STATUSES, pastToleranceMs, rescheduleRuleViolation } from "@/lib/agenda/booking-rules";
import { tzLocalToUtc } from "@/lib/agenda/time-utils";
import { definirHerramienta } from "./base";
import { etiquetaEstado } from "./estados";
import { esquemaFecha, fechaDe, horaDe } from "./fechas";
import {
  ROLES_AGENDAR,
  cargarClinica,
  dbAgendaDe,
  esquemaHora,
  fechaLarga,
  minutosDe,
  resumirAccion,
  rolPermitido,
  type DatosAccionAgenda,
  type MomentoCita,
} from "./agenda-comun";
import { evaluarHora, leerOcupacion, respuestaNoDisponible } from "./agenda-huecos";
import { resolverCita } from "./agenda-resolvedores";
import type { SabinaCtx } from "../tipos";

/** Lo que Sabina mueve: lo agendado que no ha empezado. PENDING es el SCHEDULED de antes. */
const MOVIBLES = ["SCHEDULED", "CONFIRMED", "PENDING"] as const;

const parametros = z.object({
  citaId: z.string().max(64).optional().describe("Id de la cita, solo si salió de una pregunta anterior."),
  paciente: z.string().max(120).optional().describe("Nombre, teléfono o folio del paciente de la cita."),
  pacienteId: z.string().max(64).optional(),
  fechaActual: esquemaFecha.optional().describe("Día en que está la cita AHORA, si el usuario lo dijo."),
  nuevaFecha: esquemaFecha.describe("Día nuevo, AAAA-MM-DD."),
  nuevaHora: esquemaHora.describe("Hora nueva HH:MM, hora de la clínica."),
});

export type ParamsReagendarCita = z.infer<typeof parametros>;

export const reagendarCita = definirHerramienta<ParamsReagendarCita, DatosAccionAgenda>({
  nombre: "reagendar_cita",
  descripcion:
    "PROPONE mover una cita existente a otro día u hora; no la mueve. El usuario confirma en pantalla. " +
    "Úsala para «pasa la cita de Juan de mañana al viernes a las 5». Mantiene doctor, sillón y duración. " +
    "Si el paciente tiene varias citas, devuelve la pregunta de cuál. Si la hora no se puede, devuelve " +
    "horas libres cercanas. Recuerda decir que el paciente NO recibirá aviso del cambio.",
  parametros,
  permiso: "agenda.edit",

  async ejecutar(ctx: SabinaCtx, p): Promise<DatosAccionAgenda> {
    if (!rolPermitido(ctx, ROLES_AGENDAR)) {
      return { estado: "sin_permiso", permiso: "agenda.edit", causa: "rol", frase: "Tu rol no permite mover citas." };
    }
    const db = dbAgendaDe(ctx);

    const r = await resolverCita(ctx, db, {
      citaId: p.citaId,
      pacienteId: p.pacienteId,
      paciente: p.paciente,
      fecha: p.fechaActual,
      estados: MOVIBLES,
      desde: "ahora",
      verbo: "por mover",
    });
    if (r.tipo === "no") return { estado: "no_se_puede", causa: r.causa, frase: r.frase };
    if (r.tipo === "pregunta") return { estado: "pregunta", preguntas: [r.pregunta] };
    const cita = r.valor;

    const clinica = await cargarClinica(ctx, db);
    const ahora = new Date();
    const duracion = Math.max(1, Math.round((cita.endsAt.getTime() - cita.startsAt.getTime()) / 60_000));
    const inicio = tzLocalToUtc(p.nuevaFecha, Math.floor(minutosDe(p.nuevaHora) / 60), minutosDe(p.nuevaHora) % 60, clinica.timezone);
    const fin = new Date(inicio.getTime() + duracion * 60_000);

    const horaAntes = horaDe(cita.startsAt, clinica.timezone);
    const antes: MomentoCita = momento(cita.startsAt, cita.endsAt, clinica.timezone, cita.doctor);

    // ── El estado: lo cerrado lo dice la función del PATCH; lo que ya está en
    //    curso o ya pasó, Sabina no lo mueve.
    if ((NOT_MOVABLE_STATUSES as readonly string[]).includes(cita.status)) {
      const v = rescheduleRuleViolation({
        current: { status: cita.status, startsAt: cita.startsAt, doctorId: cita.doctorId, reason: cita.motivo },
        next: { startsAt: new Date(cita.startsAt.getTime() + 60_000), doctorId: cita.doctorId },
        reason: undefined,
        patientStatus: cita.paciente.status,
        slotMinutes: clinica.defaultSlotMinutes,
        now: ahora,
      });
      return { estado: "no_se_puede", causa: "cita_no_movible", frase: v?.reason ?? "Esa cita ya está cerrada; no se puede mover." };
    }
    if (!(MOVIBLES as readonly string[]).includes(cita.status)) {
      return {
        estado: "no_se_puede",
        causa: "cita_no_movible",
        frase: `Esa cita ya está en curso («${etiquetaEstado(cita.status)}»); no la muevo. Si hace falta otra cita, la agendo nueva.`,
      };
    }
    if (cita.startsAt.getTime() < ahora.getTime()) {
      return { estado: "no_se_puede", causa: "cita_no_movible", frase: `Esa cita (${antes.texto}) ya empezó o ya pasó; no la muevo. Si hace falta, agendo una nueva.` };
    }

    if (Math.floor(inicio.getTime() / 60_000) === Math.floor(cita.startsAt.getTime() / 60_000)) {
      return { estado: "no_se_puede", causa: "sin_cambios", frase: `La cita ya está el ${antes.texto}; no hay nada que mover.` };
    }

    const regla = rescheduleRuleViolation({
      current: { status: cita.status, startsAt: cita.startsAt, doctorId: cita.doctorId, reason: cita.motivo },
      next: { startsAt: inicio, doctorId: cita.doctorId },
      reason: undefined,
      patientStatus: cita.paciente.status,
      slotMinutes: clinica.defaultSlotMinutes,
      now: ahora,
    });
    if (regla?.error === "patient_archived") {
      return { estado: "no_se_puede", causa: "paciente_archivado", frase: `${cita.paciente.nombre}: ${regla.reason}` };
    }
    if (regla && regla.error !== "appointment_in_past") {
      return { estado: "no_se_puede", causa: "cita_no_movible", frase: regla.reason };
    }

    const [ocupacionDia, recordatoriosSalidos] = await Promise.all([
      leerOcupacion(ctx, db, {
        fecha: p.nuevaFecha, doctorId: cita.doctorId, timezone: clinica.timezone,
        excluirCitaId: cita.id, incluirSillonId: cita.resourceId,
      }),
      db.whatsAppReminder.count({ where: { clinicId: ctx.clinicId, appointmentId: cita.id, status: "SENT" } }),
    ]);
    // El sillón no cambia: solo cuenta el de la cita, AUNQUE esté dado de baja,
    // igual que el PATCH, que valida el horario del sillón que ya tenía sin mirar
    // si sigue activo (y la constraint cuenta todas sus citas).
    const sillonDeLaCita = ocupacionDia.sillones.find((s) => s.id === cita.resourceId) ?? null;
    const ocupacion = {
      doctor: ocupacionDia.doctor,
      sillones: sillonDeLaCita ? [sillonDeLaCita] : [],
      // WS1-T2 — el doctor y los bloqueos se arrastran TAL CUAL de la lectura
      // del día. Aquí se recorta la lista de sillones al de la cita, pero un
      // bloqueo no depende del sillón: recortarlo dejaría reagendar dentro de
      // un día cerrado.
      doctorId: ocupacionDia.doctorId,
      bloqueos: ocupacionDia.bloqueos,
    };

    const noDisponible = (
      causa: Parameters<typeof respuestaNoDisponible>[0]["causa"],
      motivoBloqueo?: string,
    ) =>
      respuestaNoDisponible({
        causa, motivoBloqueo, fecha: p.nuevaFecha, hora: p.nuevaHora, duracion, clinica, ocupacion,
        sillon: sillonDeLaCita ? { id: sillonDeLaCita.id, nombre: sillonDeLaCita.nombre } : null,
        doctor: cita.doctor, ahora,
      });
    if (regla?.error === "appointment_in_past") return noDisponible("pasado");

    // Misma tolerancia de «pasado» que el PATCH para la hora pedida.
    const veredicto = evaluarHora({
      fecha: p.nuevaFecha, hora: p.nuevaHora, duracion, clinica, ocupacion,
      sillonId: sillonDeLaCita?.id ?? null,
      ahora: new Date(ahora.getTime() - pastToleranceMs(clinica.defaultSlotMinutes)),
    });
    if (veredicto.ok === false) {
      const no = veredicto as Extract<typeof veredicto, { ok: false }>;
      return noDisponible(no.causa, no.motivoBloqueo);
    }

    const despues = momento(inicio, fin, clinica.timezone, cita.doctor);

    const avisos: string[] = [
      `${cita.paciente.nombre} no recibirá ningún aviso del cambio: Sabina no le manda nada y el sistema tampoco. Si hace falta, avísale tú.`,
    ];
    if (recordatoriosSalidos > 0) {
      avisos.push(`Ya le llegó un recordatorio con la hora anterior (${horaAntes}); si nadie le avisa, puede presentarse a esa hora.`);
    }
    if (clinica.googleCalendarEnabled && cita.googleCalendarEventId) {
      avisos.push("Su evento de Google Calendar cambiará de hora sin que le llegue ningún correo.");
    }
    avisos.push("Los recordatorios automáticos que aún no han salido se reprograman a la hora nueva.");

    return {
      estado: "propuesta",
      propuesta: {
        accion: "reagendar_cita",
        permiso: "agenda.edit",
        peticion: {
          metodo: "PATCH",
          ruta: `/api/appointments/${cita.id}`,
          // `notifyPatient: false`: la propuesta le dice a quien confirma que el
          // paciente NO recibirá aviso. Desde ws1-t2 el PATCH avisa si la clínica
          // encendió «Aviso al reprogramar»; sin esto, aquella frase sería mentira.
          cuerpo: { startsAt: inicio.toISOString(), endsAt: fin.toISOString(), notifyPatient: false },
        },
        titulo: "Mover cita",
        frase: `Mover la cita de ${cita.paciente.nombre} con ${cita.doctor} del ${antes.texto} al ${despues.texto}.`,
        detalle: [
          { campo: "Paciente", valor: cita.paciente.nombre },
          { campo: "Doctor", valor: cita.doctor },
          { campo: "Antes", valor: antes.texto },
          { campo: "Después", valor: despues.texto },
          ...(sillonDeLaCita ? [{ campo: "Sillón", valor: sillonDeLaCita.nombre }] : []),
        ],
        antes,
        despues,
        avisos,
        deshacer: {
          reversible: true,
          como: `Se puede volver a mover al ${antes.texto} si ese hueco sigue libre. Un recordatorio que ya haya salido no se recupera.`,
        },
        revalidar: {
          herramienta: "reagendar_cita",
          parametros: { citaId: cita.id, nuevaFecha: p.nuevaFecha, nuevaHora: p.nuevaHora },
        },
        esperado: {
          startsAt: cita.startsAt.toISOString(),
          endsAt: cita.endsAt.toISOString(),
          doctorId: cita.doctorId,
          status: cita.status,
        },
      },
    };
  },

  vacio: () => false,
  resumir: (d) => resumirAccion(d),
});

function momento(inicio: Date, fin: Date, timezone: string, doctor: string): MomentoCita {
  const hora = horaDe(inicio, timezone);
  return {
    fecha: fechaDe(inicio, timezone),
    hora,
    texto: `${fechaLarga(inicio, timezone)}, ${hora}–${horaDe(fin, timezone)}`,
    doctor,
  };
}
