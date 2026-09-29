// BLOQUEOS DE AGENDA migrados (ws1-t12, importador Dentalink, sep-2026):
// 13_Horas_Bloqueadas trae los días/horas cerrados del sistema anterior
// (vacaciones, festivos, mantenimiento). NO es un modelo nuevo: ya existe
// `AgendaBlock` (WS1-T2, sql/agenda-bloqueos.sql), con su servicio completo en
// src/lib/agenda-bloqueos/service.ts — pero ESE archivo lleva `import
// "server-only"` en la línea 1 (igual que ruta.server.ts, ver el comentario
// de core-ctx.ts), y ese paquete no resuelve bajo `tsx --test`
// (comprobado: ni siquiera mockeándolo con mock.module, porque Node intenta
// RESOLVERLO antes de aplicar el mock y el paquete no existe fuera del bundle
// de Next). Por eso este handler NO importa service.ts: reimplementa el
// mismo criterio (choque contra citas vivas + creación del bloqueo) a mano,
// apoyándose solo en las piezas PURAS de agenda-bloqueos/core.ts (parseo de
// rango/motivo, sin prisma ni server-only) para no duplicar esa lógica. Si
// alguna vez agenda-bloqueos/service.ts deja de necesitar "server-only", vale
// la pena volver a esta parte y llamarlo directo.
//
// Mismas reglas que crear un bloqueo a mano:
//   · Choque con una cita ya agendada → NO se crea; la fila queda en error
//     para que primero se muevan esas citas.
//   · Sin doctor en la fila = bloqueo de TODA la clínica (mismo NULL que la
//     pantalla). Se avisa siempre en la vista previa: es el radio de acción
//     más grande posible.
//   · Idempotente por rango+alcance (sin tabla de IDs externos: dos filas con
//     el mismo doctor y el mismo instante de inicio/fin son el mismo cierre,
//     venga o no con el mismo texto de motivo).
//
// Construido en un archivo NUEVO, mismo criterio que pagos-historial.
// Multi-tenant: clinicId SIEMPRE de la sesión (runImport lo pasa).

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import type { PreviewRow } from "../types";
import { normName, type EntityHandler, type MappedRow, type ImportContext } from "../engine";
import { cellText, oneLine } from "../migrado";
import { parseHora } from "../valores";
import { parseRangoTecleado, parseKind, BloqueoError } from "@/lib/agenda-bloqueos/core";
import { ESTADOS_MUERTOS } from "@/lib/agenda-nueva/estados";
import { sinApartadoVencido } from "@/lib/agenda/apartado";

const MOTIVO_DEFECTO = "Bloqueo importado";

/**
 * Copia deliberada del criterio de `citasEnElRango`
 * (src/lib/agenda-bloqueos/service.ts): mismas citas que estorban (ni
 * canceladas ni no-show, ni un apartado ya vencido), mismo rango semiabierto.
 * NO se importa de ahí por el bloqueo de "server-only" explicado arriba.
 */
async function contarChoqueConCitas(
  clinicId: string,
  doctorId: string | null,
  startsAt: Date,
  endsAt: Date,
): Promise<number> {
  return prisma.appointment.count({
    where: {
      clinicId,
      status: { notIn: [...ESTADOS_MUERTOS] as any },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(doctorId ? { doctorId } : {}),
      AND: [sinApartadoVencido()],
    },
  });
}

function dosDig(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" de una celda de fecha, con los mismos getters locales que usa `leerInicioDeCita` en entities.ts. */
function fechaISO(v: unknown): string | null {
  if (v instanceof Date) return `${v.getFullYear()}-${dosDig(v.getMonth() + 1)}-${dosDig(v.getDate())}`;
  const s = cellText(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return s.slice(0, 10);
  const m2 = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(s);
  if (m2) return `${m2[3]}-${dosDig(Number(m2[1]) > 12 ? Number(m2[2]) : Number(m2[1]))}-${dosDig(Number(m2[1]) > 12 ? Number(m2[1]) : Number(m2[2]))}`;
  return null;
}

/** "HH:MM" de una celda de hora, o null si viene vacía (bloqueo de día completo). */
function horaHHMM(v: unknown): string | null | undefined {
  const lectura = parseHora(v);
  if (lectura === undefined) return undefined;
  if (lectura === null) return null;
  return `${dosDig(lectura.h)}:${dosDig(lectura.m)}`;
}

const pickInsertable = (rows: PreviewRow[], skipDuplicates: boolean) =>
  rows.filter((r) => r.status === "ok" || (!skipDuplicates && r.status === "duplicate"));

export const blockedHoursHandler: EntityHandler = {
  entity: "blockedHours",
  auditEntityType: "agenda-block",
  sheetNames: ["horasbloqueadas", "bloqueosdeagenda", "bloqueos", "horariobloqueado"],
  headerVariants: {
    doctor: ["doctor", "doctora", "medico", "odontologo", "odontologa", "dentista", "profesional"],
    dateFrom: ["fecha", "fechainicio", "desde", "fechadesde", "diadesde", "fechadelbloqueo"],
    dateTo: ["fechafin", "hasta", "fechahasta", "diahasta"],
    timeFrom: ["horainicio", "horadesde", "desdehora", "inicio"],
    timeTo: ["horafin", "horahasta", "hastahora", "fin"],
    reason: ["motivo", "comentario", "comentarios", "razon", "descripcion", "tipo"],
  },

  validateMapping(campos) {
    if (!campos.has("dateFrom")) return "Falta la columna de fecha del bloqueo";
    return null;
  },

  async process(rows: MappedRow[], clinicId: string, ctx: ImportContext): Promise<PreviewRow[]> {
    const clinic = await prisma.clinic.findFirst({ where: { id: clinicId }, select: { timezone: true } });
    const timezone = clinic?.timezone ?? "America/Mexico_City";
    const users = await prisma.user.findMany({ where: { clinicId, isActive: true }, select: { id: true, firstName: true, lastName: true } });
    const byDoctor = new Map<string, string>();
    const nombreDe = new Map<string, string>();
    for (const u of users) {
      byDoctor.set(normName(`${u.firstName} ${u.lastName}`), u.id);
      nombreDe.set(u.id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim());
    }
    // I7: un doctor del archivo sin equivalente se puede asignar a un usuario de la clínica (valueMapping.doctor).
    const eleccionDoctor = ctx.valueMapping.doctor ?? {};

    const out: PreviewRow[] = [];
    const vistosEnArchivo = new Set<string>();

    for (const { row, mapped } of rows) {
      const pr: PreviewRow = { row, data: {}, status: "ok", errors: [], warnings: [] };

      let doctorId: string | null = null;
      const doctorTexto = cellText(mapped.doctor);
      if (doctorTexto) {
        const clave = normName(doctorTexto);
        const elegido = eleccionDoctor[clave];
        const id = elegido && nombreDe.has(elegido) ? elegido : byDoctor.get(clave);
        if (!id) {
          pr.errors.push(`Doctor "${doctorTexto}" no encontrado en la clínica: elige a qué usuario se asigna`);
          pr.unresolved = [{ field: "doctor", key: clave, value: doctorTexto }];
          pr.status = "error"; out.push(pr); continue;
        }
        doctorId = id;
        pr.data.doctorName = nombreDe.get(id);
      } else {
        pr.warnings.push("Sin doctor en la fila: bloquea la agenda de TODA la clínica");
      }

      const desdeDia = fechaISO(mapped.dateFrom);
      if (!desdeDia) { pr.errors.push(`Fecha inválida "${cellText(mapped.dateFrom)}"`); pr.status = "error"; out.push(pr); continue; }
      const hastaDia = fechaISO(mapped.dateTo) ?? desdeDia;

      const desdeHora = horaHHMM(mapped.timeFrom);
      if (desdeHora === null) { pr.errors.push(`Hora de inicio "${cellText(mapped.timeFrom)}" inválida`); pr.status = "error"; out.push(pr); continue; }
      const hastaHora = horaHHMM(mapped.timeTo);
      if (hastaHora === null) { pr.errors.push(`Hora de fin "${cellText(mapped.timeTo)}" inválida`); pr.status = "error"; out.push(pr); continue; }

      const reason = oneLine(mapped.reason, 200) || MOTIVO_DEFECTO;
      if (!mapped.reason || !cellText(mapped.reason)) pr.warnings.push("Sin motivo en el archivo: se guarda como «Bloqueo importado»");

      let rango: { startsAt: Date; endsAt: Date };
      try {
        rango = parseRangoTecleado({ desdeDia, desdeHora: desdeHora ?? undefined, hastaDia, hastaHora: hastaHora ?? undefined }, timezone);
      } catch (e: any) {
        pr.errors.push(e instanceof BloqueoError ? e.message : "No se pudo calcular el rango del bloqueo");
        pr.status = "error"; out.push(pr); continue;
      }

      const choque = await contarChoqueConCitas(clinicId, doctorId, rango.startsAt, rango.endsAt);
      if (choque > 0) {
        pr.errors.push(`Se empalma con ${choque} cita(s) ya agendada(s) en ese rango: muévelas antes de importar este bloqueo`);
        pr.status = "error"; out.push(pr); continue;
      }

      const key = `${doctorId ?? "clinica"}|${rango.startsAt.toISOString()}|${rango.endsAt.toISOString()}`;
      if (vistosEnArchivo.has(key)) {
        pr.status = "duplicate";
        pr.warnings.push("Bloqueo repetido en el archivo (mismo alcance y rango)");
        out.push(pr);
        continue;
      }
      vistosEnArchivo.add(key);

      Object.assign(pr.data, { doctorId, desdeDia, desdeHora: desdeHora ?? undefined, hastaDia, hastaHora: hastaHora ?? undefined, reason, startsAt: rango.startsAt, endsAt: rango.endsAt });
      out.push(pr);
    }

    // Dedup contra los bloqueos que YA existen en la base (mismo alcance + mismo instante exacto).
    const okRows = out.filter((r) => r.status === "ok");
    if (okRows.length > 0) {
      const desde = okRows.reduce((min, r) => ((r.data.startsAt as Date) < min ? r.data.startsAt : min), okRows[0].data.startsAt as Date);
      const hasta = okRows.reduce((max, r) => ((r.data.endsAt as Date) > max ? r.data.endsAt : max), okRows[0].data.endsAt as Date);
      const existentes = await prisma.agendaBlock.findMany({
        where: { clinicId, deletedAt: null, startsAt: { gte: desde }, endsAt: { lte: hasta } },
        select: { doctorId: true, startsAt: true, endsAt: true },
      });
      const dbKeys = new Set(existentes.map((b) => `${b.doctorId ?? "clinica"}|${b.startsAt.toISOString()}|${b.endsAt.toISOString()}`));
      for (const r of out) {
        if (r.status !== "ok") continue;
        const key = `${r.data.doctorId ?? "clinica"}|${(r.data.startsAt as Date).toISOString()}|${(r.data.endsAt as Date).toISOString()}`;
        if (dbKeys.has(key)) { r.status = "duplicate"; r.warnings.push("Ya existe un bloqueo idéntico en la agenda"); }
      }
    }

    return out;
  },

  // Los usuarios activos de la clínica, para elegir a quién se asigna un doctor del archivo sin equivalente.
  async valueOptions(clinicId: string) {
    const usuarios = await prisma.user.findMany({
      where: { clinicId, isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
    return { doctor: usuarios.map((u: any) => ({ id: u.id, label: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() })) };
  },

  async commit(rows: PreviewRow[], clinicId: string, skipDuplicates: boolean, ctx: ImportContext) {
    const toInsert = pickInsertable(rows, skipDuplicates);
    if (toInsert.length === 0) return { created: 0, skipped: 0 };

    const quien = await prisma.user.findFirst({ where: { id: ctx.userId }, select: { firstName: true, lastName: true } });
    const createdByName = (quien ? `${quien.firstName} ${quien.lastName}`.trim() : "") || "Importador";

    let created = 0;
    for (const r of toInsert) {
      try {
        // REVALIDA el choque en el momento de escribir (igual que crearBloqueo):
        // el dry-run pudo quedar viejo si otra pantalla agendó algo mientras tanto.
        const choque = await contarChoqueConCitas(clinicId, r.data.doctorId ?? null, r.data.startsAt, r.data.endsAt);
        if (choque > 0) {
          r.status = "error";
          r.errors.push(`Se empalma con ${choque} cita(s) ya agendada(s): muévelas antes de importar este bloqueo`);
          continue;
        }

        const bloqueo = await prisma.agendaBlock.create({
          data: {
            clinicId,
            doctorId: r.data.doctorId ?? null,
            kind: parseKind(undefined),
            reason: r.data.reason,
            startsAt: r.data.startsAt,
            endsAt: r.data.endsAt,
            createdById: ctx.userId,
            createdByName,
          },
        });
        await logAudit({
          clinicId, userId: ctx.userId, entityType: "agenda-block", entityId: bloqueo.id, action: "create",
          changes: {
            reason: { before: null, after: r.data.reason },
            doctorId: { before: null, after: r.data.doctorId ?? null },
            startsAt: { before: null, after: (r.data.startsAt as Date).toISOString() },
            endsAt: { before: null, after: (r.data.endsAt as Date).toISOString() },
          },
        });
        created++;
      } catch (e: any) {
        r.status = "error";
        r.errors.push(e instanceof BloqueoError ? e.message : "No se pudo crear el bloqueo (error de base de datos)");
      }
    }

    const erroredNow = toInsert.filter((r) => r.status === "error").length;
    return { created, skipped: Math.max(0, toInsert.length - created - erroredNow) };
  },
};
