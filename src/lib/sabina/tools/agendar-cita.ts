/**
 * `agendar_cita` — PROPONE una cita nueva. No la crea.
 *
 * Devuelve la petición exacta a `POST /api/appointments` (el mismo cuerpo que
 * manda el modal «Nueva cita») para que la confirmación en dos fases la ejecute
 * cuando el usuario toque «Confirmar». Hasta entonces no existe nada.
 *
 * Antes de proponer comprueba, con las piezas del servidor:
 *  · rol (`requireRole` del POST) — la key `agenda.create` ya la cortó el runner;
 *  · paciente visible y no borrado, con el criterio del buscador de «Nueva cita»;
 *    si hay dos que coinciden, PREGUNTA;
 *  · doctor con rol DOCTOR y activo; si hay varios, PREGUNTA;
 *  · motivo (el servidor lo exige desde #248), pasado y archivado con
 *    `newAppointmentRuleViolation`, la misma función del POST;
 *  · horario de la clínica ANTES de guardar: el POST solo avisa después, y la
 *    decisión de Rafael es que Sabina ni lo ofrezca;
 *  · sillón: si la clínica los usa, se pregunta cuál (el servidor no lo exige,
 *    el modal sí), y solo se ofrecen los abiertos y libres a esa hora;
 *  · solape con el doctor y con el sillón → alternativas, nunca un error.
 *
 * Nunca manda `overrideReason` (saltaría el solape) ni `notifyPatient`: desde
 * ws1-t2 ese campo SÍ manda la confirmación por WhatsApp (antes no hacía nada,
 * N5), y que Sabina escriba a un paciente es una decisión que aquí nadie tomó.
 */

import { z } from "zod";
import { newAppointmentRuleViolation, pastToleranceMs } from "@/lib/agenda/booking-rules";
import { tzLocalToUtc } from "@/lib/agenda/time-utils";
import { defaultDurationFor } from "@/lib/new-appointment/duration-presets";
import { definirHerramienta } from "./base";
import { esquemaFecha } from "./fechas";
import {
  ROLES_AGENDAR,
  cargarClinica,
  dbAgendaDe,
  esquemaHora,
  fechaLarga,
  hhmm,
  minutosDe,
  resumirAccion,
  rolPermitido,
  type DatosAccionAgenda,
  type PreguntaAgenda,
} from "./agenda-comun";
import { evaluarHora, leerOcupacion, respuestaNoDisponible } from "./agenda-huecos";
import { resolverDoctor, resolverPaciente, resolverSillon } from "./agenda-resolvedores";
import type { SabinaCtx } from "../tipos";

const parametros = z.object({
  paciente: z.string().max(120).optional().describe("Nombre, teléfono o folio del paciente, tal como lo dijo el usuario."),
  pacienteId: z.string().max(64).optional().describe("Id del paciente, solo si salió de una pregunta anterior."),
  doctor: z.string().max(80).optional().describe("Nombre del doctor. Si no lo dijo, omítelo."),
  doctorId: z.string().max(64).optional(),
  fecha: esquemaFecha.describe("Día de la cita, AAAA-MM-DD, calendario de la clínica."),
  hora: esquemaHora.describe("Hora de inicio HH:MM, hora de la clínica."),
  duracionMinutos: z.number().int().min(5).max(480).optional().describe("Por defecto, la de la clínica."),
  motivo: z.string().max(200).optional().describe("Motivo de la cita (limpieza, revisión…). Obligatorio: si no lo dijo, omítelo y se preguntará."),
  sillon: z.string().max(80).optional(),
  sillonId: z.string().max(64).optional(),
});

export type ParamsAgendarCita = z.infer<typeof parametros>;

export const agendarCita = definirHerramienta<ParamsAgendarCita, DatosAccionAgenda>({
  nombre: "agendar_cita",
  descripcion:
    "PROPONE agendar una cita nueva; no la guarda. El usuario la confirma en pantalla y solo entonces se crea. " +
    "Úsala para «agéndame a Ana Pérez el jueves a las 10 con el Dr. Salas». Si hay dos pacientes o doctores " +
    "que coinciden, o falta el motivo o el sillón, devuelve la pregunta: házsela al usuario y vuelve a llamarla " +
    "con el id que elija. Si la hora no se puede, devuelve horas libres cercanas para ofrecer.",
  parametros,
  permiso: "agenda.create",

  async ejecutar(ctx: SabinaCtx, p): Promise<DatosAccionAgenda> {
    if (!rolPermitido(ctx, ROLES_AGENDAR)) {
      return { estado: "sin_permiso", permiso: "agenda.create", causa: "rol", frase: "Tu rol no permite agendar citas." };
    }
    const db = dbAgendaDe(ctx);

    const [paciente, doctor] = await Promise.all([
      resolverPaciente(ctx, db, { pacienteId: p.pacienteId, paciente: p.paciente }),
      resolverDoctor(ctx, db, { doctorId: p.doctorId, doctor: p.doctor }),
    ]);
    if (paciente.tipo === "no") return { estado: "no_se_puede", causa: paciente.causa, frase: paciente.frase };
    if (doctor.tipo === "no") return { estado: "no_se_puede", causa: doctor.causa, frase: doctor.frase };

    // Todo lo que falta, en UNA pregunta: cada ida y vuelta es un turno del doctor.
    const preguntas: PreguntaAgenda[] = [];
    if (paciente.tipo === "pregunta") preguntas.push(paciente.pregunta);
    if (doctor.tipo === "pregunta") preguntas.push(doctor.pregunta);
    const motivo = (p.motivo ?? "").trim();
    if (!motivo) preguntas.push({ falta: "motivo", texto: "¿Cuál es el motivo de la cita?", opciones: [] });
    if (preguntas.length > 0 || paciente.tipo !== "ok" || doctor.tipo !== "ok") {
      return { estado: "pregunta", preguntas };
    }

    const clinica = await cargarClinica(ctx, db);
    const duracion = p.duracionMinutos ?? defaultDurationFor(clinica.defaultSlotMinutes);
    const inicio = tzLocalToUtc(p.fecha, Math.floor(minutosDe(p.hora) / 60), minutosDe(p.hora) % 60, clinica.timezone);
    const fin = new Date(inicio.getTime() + duracion * 60_000);
    const ahora = new Date();

    const ocupacion = await leerOcupacion(ctx, db, { fecha: p.fecha, doctorId: doctor.valor.id, timezone: clinica.timezone });
    const sillon = resolverSillon(ocupacion.sillones, { sillonId: p.sillonId, sillon: p.sillon });
    if (sillon.tipo === "no") return { estado: "no_se_puede", causa: sillon.causa, frase: sillon.frase };
    if (sillon.tipo === "pregunta") return { estado: "pregunta", preguntas: [sillon.pregunta] };

    const noDisponible = (causa: Parameters<typeof respuestaNoDisponible>[0]["causa"]) =>
      respuestaNoDisponible({
        causa, fecha: p.fecha, hora: p.hora, duracion, clinica, ocupacion,
        sillon: sillon.valor, doctor: doctor.valor.nombre, ahora,
      });

    // Las reglas del POST, con la función del POST.
    const regla = newAppointmentRuleViolation({
      startsAt: inicio,
      reason: motivo,
      patientStatus: paciente.valor.status,
      slotMinutes: clinica.defaultSlotMinutes,
      now: ahora,
    });
    if (regla?.error === "patient_archived") {
      return { estado: "no_se_puede", causa: "paciente_archivado", frase: `${paciente.valor.nombre}: ${regla.reason}` };
    }
    if (regla?.error === "appointment_in_past") return noDisponible("pasado");

    // La hora PEDIDA se mide con la tolerancia del POST (el hueco en curso + 15
    // min: la recepción registra a las 10:10 al que llegó a las 10:00). Las
    // alternativas que ofrece Sabina, en cambio, nunca empiezan antes de ahora.
    const veredicto = evaluarHora({
      fecha: p.fecha, hora: p.hora, duracion, clinica, ocupacion,
      sillonId: sillon.valor?.id ?? null,
      ahora: new Date(ahora.getTime() - pastToleranceMs(clinica.defaultSlotMinutes)),
    });
    if (veredicto.ok === false) return noDisponible((veredicto as Extract<typeof veredicto, { ok: false }>).causa);

    // La clínica usa sillones y no se dijo cuál: se pregunta, con los que sirven a esa hora.
    const libres = (veredicto as Extract<typeof veredicto, { ok: true }>).sillonesLibres;
    if (ocupacion.sillones.length > 0 && !sillon.valor) {
      return {
        estado: "pregunta",
        preguntas: [{
          falta: "sillon",
          texto: `¿En qué sillón? A las ${p.hora} ${libres.length === 1 ? "está libre" : "están libres"}: ${libres.map((s) => s.nombre).join(", ")}.`,
          opciones: libres.map((s) => ({ id: s.id, etiqueta: s.nombre, detalle: null })),
        }],
      };
    }

    const dia = fechaLarga(inicio, clinica.timezone);
    const franja = `${p.hora}–${hhmm((minutosDe(p.hora) + duracion) % (24 * 60))}`;
    const pac = paciente.valor;
    const doc = doctor.valor;
    const sil = sillon.valor;

    const avisos: string[] = [];
    if (clinica.googleCalendarEnabled && pac.tieneCorreo) {
      avisos.push("La clínica tiene Google Calendar activado: lo normal es que Google le envíe al paciente una invitación por correo en cuanto se guarde.");
    }
    avisos.push("Sabina no le manda ningún mensaje al paciente: ni WhatsApp de confirmación ni correo propio. Si la clínica tiene recordatorios automáticos, le llegará el recordatorio antes de la cita.");
    // `ensureUserCanSeePatient` del POST mete al doctor en la lista del paciente
    // restringido, y eso no se revierte al cancelar.
    if (pac.visibleUserIds.length > 0 && !pac.visibleUserIds.includes(doc.id)) {
      avisos.push(`${pac.nombre} es de acceso restringido: al agendar, ${doc.nombre} tendrá acceso a su ficha de forma permanente.`);
    }

    return {
      estado: "propuesta",
      propuesta: {
        accion: "agendar_cita",
        permiso: "agenda.create",
        peticion: {
          metodo: "POST",
          ruta: "/api/appointments",
          cuerpo: {
            patientId: pac.id,
            doctorId: doc.id,
            resourceId: sil?.id ?? null,
            startsAt: inicio.toISOString(),
            endsAt: fin.toISOString(),
            reason: motivo,
          },
        },
        titulo: "Agendar cita",
        frase: `Agendar a ${pac.nombre} el ${dia} a las ${p.hora} (${duracion} min) con ${doc.nombre}${sil ? `, en ${sil.nombre}` : ""}. Motivo: ${motivo}.`,
        detalle: [
          { campo: "Paciente", valor: pac.folio ? `${pac.nombre} (${pac.folio})` : pac.nombre },
          { campo: "Doctor", valor: doc.nombre },
          { campo: "Día", valor: dia },
          { campo: "Hora", valor: franja },
          ...(sil ? [{ campo: "Sillón", valor: sil.nombre }] : []),
          { campo: "Motivo", valor: motivo },
        ],
        antes: null,
        despues: null,
        avisos,
        deshacer: {
          reversible: true,
          como:
            "Se puede cancelar después desde la agenda." +
            (clinica.googleCalendarEnabled && pac.tieneCorreo ? " Si Google ya le mandó la invitación, al cancelar puede llegarle el aviso de cancelación." : ""),
        },
        revalidar: {
          herramienta: "agendar_cita",
          parametros: {
            pacienteId: pac.id,
            doctorId: doc.id,
            fecha: p.fecha,
            hora: p.hora,
            duracionMinutos: duracion,
            motivo,
            ...(sil ? { sillonId: sil.id } : {}),
          },
        },
        esperado: null,
      },
    };
  },

  vacio: () => false,
  resumir: (d) => resumirAccion(d),
});
