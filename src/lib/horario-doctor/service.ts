import "server-only";

/**
 * EL HORARIO PROPIO DEL DOCTOR — la mitad que escribe. WS1-T2 · horario.
 *
 * Lo usan las tres rutas de `/api/team/[id]/horario` (GET, PUT, DELETE). La
 * decisión de quién puede tocar qué vive AQUÍ, en el servidor, y no en la
 * pantalla: la pantalla es de ws1-t3 y solo pinta lo que esto deja hacer.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL ALCANCE POR ROL
 *
 *  · ADMIN / SUPER_ADMIN → el horario de cualquier doctor de SU clínica.
 *  · DOCTOR              → SOLO el suyo. Otro id → 403.
 *  · RECEPTIONIST        → nada por defecto (no tiene la llave). Si el
 *    SUPER_ADMIN se la enciende desde Equipo → Permisos, trabaja como la
 *    administración: el mismo criterio que los bloqueos.
 *
 * La llave es `agenda.bloqueos`, REUTILIZADA a propósito: ya tiene
 * exactamente el reparto por rol que pide este encargo (ADMIN y SUPER_ADMIN
 * sí, DOCTOR sí, RECEPTIONIST no), ya sale en Equipo → Permisos, y
 * «nunca trabajo los miércoles» es cerrar días y horas de la agenda. Igual
 * que con los bloqueos, la llave abre la pantalla y el servidor decide hasta
 * dónde llega quien la abre.
 * ═══════════════════════════════════════════════════════════════════════
 */

import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import type { ClinicSession } from "@/lib/agenda/api-helpers";
import { hasPermission } from "@/lib/auth/permissions";
import {
  HorarioError,
  alcanceDelHorario,
  avisosDeRecorte,
  parseSemana,
  semanaCompleta,
  semanaHeredada,
  type AvisoRecorte,
  type DiaHorario,
} from "./core";
import { esTablaAusente, leerHorarioDeDoctor } from "./consulta.server";

/** Quién pide. Sale SIEMPRE de la sesión, nunca del cuerpo de la petición. */
export interface HorarioCtx {
  clinicId: string;
  userId: string;
  role: Role;
  /** `agenda.bloqueos` concedido (default del rol + override). */
  puedeGestionar: boolean;
  /** Lo que hace falta para saber qué hereda el doctor y qué se recorta. */
  clinica: {
    agendaDayStart: number;
    agendaDayEnd: number;
    schedules: DiaHorario[];
  };
}

/**
 * La sesión convertida en contexto. El `clinicId`, el rol y la llave salen de
 * la SESIÓN, nunca del cuerpo ni de la URL.
 */
export function ctxDeSesion(session: ClinicSession): HorarioCtx {
  return {
    clinicId: session.clinic.id,
    userId: session.user.id,
    role: session.user.role,
    puedeGestionar: hasPermission(
      { role: session.user.role, permissionsOverride: session.user.permissionsOverride ?? [] },
      "agenda.bloqueos",
    ),
    clinica: {
      agendaDayStart: session.clinic.agendaDayStart,
      agendaDayEnd: session.clinic.agendaDayEnd,
      schedules: session.clinic.schedules,
    },
  };
}

/** Lo que devuelven las tres rutas. ws1-t3 programa contra esta forma. */
export interface RespuestaHorario {
  /** Los 7 días, siempre. Con `hereda: true` es el de la clínica. */
  horario: DiaHorario[];
  /** `true` = no tiene horario propio, sigue el de la clínica. */
  hereda: boolean;
  /** Los 7 días de la clínica, para pintarlos al lado. */
  clinica: DiaHorario[];
  /**
   * Los días en que lo guardado se sale del horario de la clínica y qué se
   * agenda de verdad ese día. Vacío si todo cabe (o si hereda).
   */
  avisos: AvisoRecorte[];
}

/** Los roles que tienen agenda propia: a quien se le puede dar una cita. */
const ROLES_CON_AGENDA: readonly Role[] = ["DOCTOR", "ADMIN", "SUPER_ADMIN"];

function exigeClinica(ctx: HorarioCtx): string {
  // Corta ANTES de consultar: en Prisma un clinicId vacío no filtra nada.
  if (!ctx?.clinicId || typeof ctx.clinicId !== "string") {
    throw new HorarioError("Tu sesión no trae clínica. Vuelve a entrar.", 401, "SIN_SESION");
  }
  return ctx.clinicId;
}

/**
 * EL DOCTOR CUYO HORARIO SE PIDE, comprobado contra quien lo pide.
 *
 * El orden importa: primero la llave y el alcance por rol (`alcanceDelHorario`,
 * pura y probada), y SOLO al final la base. Un DOCTOR que pide el id de un
 * compañero recibe 403 sin que se consulte nada.
 */
export async function resolverDoctor(ctx: HorarioCtx, doctorIdRaw: unknown): Promise<string> {
  const clinicId = exigeClinica(ctx);
  const doctorId = alcanceDelHorario(ctx, doctorIdRaw);

  // El doctor tiene que ser de ESTA clínica (de la sesión). Sin esto, un
  // administrador podría colgar filas del id de un doctor de otra clínica.
  const doctor = await prisma.user.findFirst({
    where: { id: doctorId, clinicId },
    select: { id: true, role: true },
  });
  if (!doctor) {
    throw new HorarioError("Ese doctor no existe o no es de tu clínica.", 404, "DOCTOR_NO_ENCONTRADO");
  }
  if (!ROLES_CON_AGENDA.includes(doctor.role)) {
    throw new HorarioError(
      "Esa persona no atiende pacientes, así que no tiene horario de agenda.",
      400,
      "SIN_AGENDA",
    );
  }
  return doctor.id;
}

function respuesta(ctx: HorarioCtx, filas: readonly DiaHorario[] | null): RespuestaHorario {
  const clinica = semanaHeredada(ctx.clinica, ctx.clinica.schedules);
  if (!filas || filas.length === 0) {
    return { horario: clinica, hereda: true, clinica, avisos: [] };
  }
  const horario = semanaCompleta(filas);
  return {
    horario,
    hereda: false,
    clinica,
    avisos: avisosDeRecorte(horario, ctx.clinica, ctx.clinica.schedules),
  };
}

/** GET — el horario del doctor, o el de la clínica si hereda. */
export async function verHorario(ctx: HorarioCtx, doctorIdRaw: unknown): Promise<RespuestaHorario> {
  const doctorId = await resolverDoctor(ctx, doctorIdRaw);
  const filas = await leerHorarioDeDoctor(ctx.clinicId, doctorId);
  return respuesta(ctx, filas);
}

/**
 * PUT — guarda la semana entera. Los 7 días siempre (ver `parseSemana`).
 *
 * 🔴 ACEPTA Y AVISA. Si la semana se sale del horario de la clínica, se guarda
 * tal cual y la respuesta trae `avisos` con lo que de verdad se agendará. El
 * recorte lo hace el cálculo de huecos (la intersección), no este guardado.
 */
export async function guardarHorario(
  ctx: HorarioCtx,
  doctorIdRaw: unknown,
  body: { horario?: unknown } | null | undefined,
  meta: { ipAddress?: string; userAgent?: string } = {},
): Promise<RespuestaHorario> {
  const clinicId = exigeClinica(ctx);
  const doctorId = await resolverDoctor(ctx, doctorIdRaw);
  const semana = parseSemana(body?.horario);

  const antes = await leerHorarioDeDoctor(clinicId, doctorId);

  try {
    // Un upsert por día, en UNA transacción: o se guarda la semana entera o
    // no se guarda nada. Mismo patrón que PATCH /api/settings/schedule.
    await prisma.$transaction(
      semana.map((d) =>
        prisma.doctorSchedule.upsert({
          where: { doctorId_dayOfWeek: { doctorId, dayOfWeek: d.dayOfWeek } },
          // clinicId de la SESIÓN; el doctor ya se comprobó que es de ella.
          create: { clinicId, doctorId, ...d },
          update: { clinicId, enabled: d.enabled, openTime: d.openTime, closeTime: d.closeTime },
        }),
      ),
    );
  } catch (err) {
    throw traducirTablaAusente(err);
  }

  await logAudit({
    clinicId,
    userId: ctx.userId,
    // Es un dato del usuario (su jornada): se audita contra él.
    entityType: "user",
    entityId: doctorId,
    action: "update",
    changes: {
      horarioPropio: { before: antes ? semanaCompleta(antes) : null, after: semana },
    },
    ...meta,
  });

  return respuesta(ctx, semana);
}

/**
 * DELETE — borra el horario propio. El doctor vuelve a seguir el de la
 * clínica, que es exactamente como estaba antes de tener uno.
 */
export async function borrarHorario(
  ctx: HorarioCtx,
  doctorIdRaw: unknown,
  meta: { ipAddress?: string; userAgent?: string } = {},
): Promise<RespuestaHorario> {
  const clinicId = exigeClinica(ctx);
  const doctorId = await resolverDoctor(ctx, doctorIdRaw);
  const antes = await leerHorarioDeDoctor(clinicId, doctorId);

  if (antes) {
    try {
      await prisma.doctorSchedule.deleteMany({ where: { clinicId, doctorId } });
    } catch (err) {
      throw traducirTablaAusente(err);
    }
    await logAudit({
      clinicId,
      userId: ctx.userId,
      entityType: "user",
      entityId: doctorId,
      action: "delete",
      changes: { horarioPropio: { before: semanaCompleta(antes), after: null } },
      ...meta,
    });
  }
  // Sin horario propio que borrar no hay nada que auditar: la respuesta es la
  // misma (hereda) y repetir el DELETE no deja filas de ruido en la bitácora.

  return respuesta(ctx, null);
}

/**
 * 🔴 LA VENTANA ENTRE LA INTEGRACIÓN Y EL SQL. LEER se degrada a «nadie tiene
 * horario propio» (ver consulta.server.ts), pero ESCRIBIR no se puede
 * degradar: fingir que se guardó dejaría al doctor creyendo que ya no le
 * agendan los miércoles. Se dice qué falta y quién lo aplica.
 */
function traducirTablaAusente(err: unknown): unknown {
  if (esTablaAusente(err)) {
    return new HorarioError(
      "El horario por doctor todavía no está activado en esta base. " +
        "Falta aplicar sql/doctor-horarios.sql; avisa a soporte.",
      503,
      "SQL_PENDIENTE",
    );
  }
  return err;
}
