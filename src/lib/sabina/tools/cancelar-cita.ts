/**
 * `cancelar_cita` — PROPONE cancelar una cita. No la cancela.
 *
 * Camino: `DELETE /api/appointments/:id` con `{ reason }`. Es el de la ficha del
 * paciente y /dashboard/appointments, y el MAPA (§3) lo elige sobre
 * `PATCH /status` por dos razones: deja AuditLog y borra el evento de Google. El
 * otro camino no hace ninguna de las dos (N2). Los dos aplican la misma matriz de
 * estados.
 *
 * Antes de proponer:
 *  · 🔴 rol: un DOCTOR no puede cancelar ninguna cita, ni por la pantalla ni por
 *    la API (N4). Decisión de Rafael: se queda así. Sabina lo dice SIN intentarlo
 *    y sin leer nada. READONLY, igual;
 *  · la cita, visible para quien pregunta;
 *  · ya cancelada → se dice (el DELETE contestaría 200 sin tocar nada);
 *  · `canTransition(estado, "CANCELLED", rol)`, la función del DELETE: una cita en
 *    consulta solo la cancela un administrador; una completada, nadie.
 *
 * La tarjeta dice ANTES que para quien no es administrador no se puede deshacer,
 * y qué le llega (o no) al paciente.
 */

import { z } from "zod";
import { canTransition } from "@/lib/agenda/transitions";
import type { AppointmentStatus } from "@/lib/agenda/types";
import { definirHerramienta } from "./base";
import { etiquetaEstado } from "./estados";
import { esquemaFecha, horaDe } from "./fechas";
import {
  ROLES_CANCELAR,
  cargarClinica,
  dbAgendaDe,
  fechaLarga,
  resumirAccion,
  rolPermitido,
  type DatosAccionAgenda,
} from "./agenda-comun";
import { resolverCita } from "./agenda-resolvedores";
import type { SabinaCtx } from "../tipos";

/** Candidatas al buscar por paciente: lo que ALGÚN rol puede cancelar según la matriz. */
const CANCELABLES = ["PENDING", "SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"] as const;

const parametros = z.object({
  citaId: z.string().max(64).optional().describe("Id de la cita, solo si salió de una pregunta anterior."),
  paciente: z.string().max(120).optional().describe("Nombre, teléfono o folio del paciente de la cita."),
  pacienteId: z.string().max(64).optional(),
  fecha: esquemaFecha.optional().describe("Día de la cita, si el usuario lo dijo."),
  motivo: z.string().max(300).optional().describe("Motivo de la cancelación, si el usuario lo dio."),
});

export type ParamsCancelarCita = z.infer<typeof parametros>;

export const cancelarCita = definirHerramienta<ParamsCancelarCita, DatosAccionAgenda>({
  nombre: "cancelar_cita",
  descripcion:
    "PROPONE cancelar una cita; no la cancela. El usuario confirma en pantalla. Úsala para «cancela la cita " +
    "de Juan del jueves». Si el paciente tiene varias citas, devuelve la pregunta de cuál. Un doctor no puede " +
    "cancelar citas: si lo devuelve como sin_permiso, dilo tal cual. Cancelar no se puede deshacer para quien " +
    "no es administrador.",
  parametros,
  permiso: "agenda.delete",

  async ejecutar(ctx: SabinaCtx, p): Promise<DatosAccionAgenda> {
    // El rol va ANTES de leer nada: la respuesta ya se sabe.
    if (!rolPermitido(ctx, ROLES_CANCELAR)) {
      return {
        estado: "sin_permiso",
        permiso: "agenda.delete",
        causa: "rol",
        frase: "Tu rol no permite cancelar citas; lo hace recepción o el administrador.",
      };
    }
    const db = dbAgendaDe(ctx);

    const r = await resolverCita(ctx, db, {
      citaId: p.citaId,
      pacienteId: p.pacienteId,
      paciente: p.paciente,
      fecha: p.fecha,
      estados: CANCELABLES,
      desde: "hoy",
      verbo: "por cancelar",
    });
    if (r.tipo === "no") return { estado: "no_se_puede", causa: r.causa, frase: r.frase };
    if (r.tipo === "pregunta") return { estado: "pregunta", preguntas: [r.pregunta] };
    const cita = r.valor;

    const clinica = await cargarClinica(ctx, db);
    const cuando = `${fechaLarga(cita.startsAt, clinica.timezone)} a las ${horaDe(cita.startsAt, clinica.timezone)}`;

    if (cita.status === "CANCELLED") {
      return { estado: "no_se_puede", causa: "ya_cancelada", frase: `La cita de ${cita.paciente.nombre} del ${cuando} ya estaba cancelada.` };
    }

    // Misma traducción de PENDING que el DELETE: se evalúa como SCHEDULED.
    const desde = (cita.status === "PENDING" ? "SCHEDULED" : cita.status) as AppointmentStatus;
    const check = canTransition(desde, "CANCELLED", ctx.role as any, new Date(), cita.startsAt);
    if (!check.ok) {
      if (check.code === "forbidden_role") {
        return {
          estado: "sin_permiso",
          permiso: "agenda.delete",
          causa: "estado",
          frase: `La cita de ${cita.paciente.nombre} está «${etiquetaEstado(cita.status)}»; a estas alturas solo un administrador puede cancelarla.`,
        };
      }
      return {
        estado: "no_se_puede",
        causa: "transicion_invalida",
        frase: `La cita de ${cita.paciente.nombre} del ${cuando} está «${etiquetaEstado(cita.status)}»; no se puede cancelar.`,
      };
    }

    const recordatoriosSalidos = await db.whatsAppReminder.count({
      where: { clinicId: ctx.clinicId, appointmentId: cita.id, status: "SENT" },
    });

    const motivo = (p.motivo ?? "").trim();
    const avisos: string[] = [];
    if (clinica.googleCalendarEnabled && cita.googleCalendarEventId && cita.paciente.tieneCorreo) {
      // No se PROMETE: al mover una cita, `updateCalendarEvent` reescribe el
      // evento sin invitados, y entonces el DELETE ya no tiene a quién avisar.
      avisos.push(
        "Sabina no le manda ningún mensaje. Google Calendar puede enviarle un correo de cancelación si su invitación sigue activa, " +
          "pero no está garantizado (si la cita se movió antes, lo normal es que no le llegue): avísale tú.",
      );
    } else {
      avisos.push(`${cita.paciente.nombre} no recibirá ningún aviso de la cancelación: Sabina no le manda nada y el sistema tampoco. Si hace falta, avísale tú.`);
    }
    if (recordatoriosSalidos > 0) {
      avisos.push("Ya le llegó un recordatorio de esta cita: si nadie le avisa, puede presentarse igual.");
    }
    avisos.push("Los recordatorios que aún no han salido se cancelan.");

    const esAdmin = ctx.role === "ADMIN" || ctx.role === "SUPER_ADMIN";

    return {
      estado: "propuesta",
      propuesta: {
        accion: "cancelar_cita",
        permiso: "agenda.delete",
        peticion: {
          metodo: "DELETE",
          ruta: `/api/appointments/${cita.id}`,
          cuerpo: motivo ? { reason: motivo } : null,
        },
        titulo: "Cancelar cita",
        frase: `Cancelar la cita de ${cita.paciente.nombre} con ${cita.doctor} del ${cuando}${motivo ? `. Motivo: ${motivo}` : ""}.`,
        detalle: [
          { campo: "Paciente", valor: cita.paciente.nombre },
          { campo: "Doctor", valor: cita.doctor },
          { campo: "Cita", valor: cuando },
          { campo: "Estado", valor: etiquetaEstado(cita.status) },
          ...(motivo ? [{ campo: "Motivo", valor: motivo }] : []),
        ],
        antes: null,
        despues: null,
        avisos,
        deshacer: {
          reversible: false,
          como: esAdmin
            ? "No se deshace limpio: un administrador puede reabrirla, pero no vuelven los recordatorios ni el evento de Google, y si el hueco ya se ocupó no se puede. Lo normal es agendar una cita nueva."
            : "No se puede deshacer: solo un administrador puede reabrir una cita cancelada. Si hace falta, se agenda una cita nueva.",
        },
        revalidar: {
          herramienta: "cancelar_cita",
          parametros: { citaId: cita.id, ...(motivo ? { motivo } : {}) },
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
