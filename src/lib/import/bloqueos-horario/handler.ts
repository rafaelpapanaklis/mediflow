// BLOQUEOS DE AGENDA migrados (ws1-t12, importador Dentalink, sep-2026):
// 13_Horas_Bloqueadas trae los días/horas cerrados del sistema anterior
// (vacaciones, festivos, mantenimiento). NO es un modelo nuevo: ya existe
// `AgendaBlock` (WS1-T2, sql/agenda-bloqueos.sql) con su servicio en
// src/lib/agenda-bloqueos/service.ts — este handler es una fuente MÁS de
// bloqueos, con las mismas reglas que crear uno a mano:
//   · Choque con una cita ya agendada → NO se crea (crearBloqueo revisa antes
//     de escribir); la fila queda en error para que primero se muevan esas citas.
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
import type { Role } from "@prisma/client";
import type { PreviewRow } from "../types";
import { norm, normName, type EntityHandler, type MappedRow, type ImportContext } from "../engine";
import { cellText, oneLine } from "../migrado";
import { parseHora } from "../valores";
import { crearBloqueo, revisarChoque } from "@/lib/agenda-bloqueos/service";
import { parseRangoTecleado } from "@/lib/agenda-bloqueos/core";
import type { BloqueoCtx } from "@/lib/agenda-bloqueos/core-ctx";
import { BloqueoError } from "@/lib/agenda-bloqueos/core-ctx";

const MOTIVO_DEFECTO = "Bloqueo importado";

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
    for (const u of users) byDoctor.set(normName(`${u.firstName} ${u.lastName}`), u.id);

    const bctx: BloqueoCtx = {
      clinicId, userId: ctx.userId, role: (ctx.role as Role) || "ADMIN",
      displayName: "Importador", timezone, puedeGestionar: true,
    };

    const out: PreviewRow[] = [];
    const vistosEnArchivo = new Set<string>();

    for (const { row, mapped } of rows) {
      const pr: PreviewRow = { row, data: {}, status: "ok", errors: [], warnings: [] };

      let doctorId: string | null = null;
      const doctorTexto = cellText(mapped.doctor);
      if (doctorTexto) {
        const id = byDoctor.get(normName(doctorTexto));
        if (!id) { pr.errors.push(`Doctor "${doctorTexto}" no encontrado en la clínica`); pr.status = "error"; out.push(pr); continue; }
        doctorId = id;
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

      const choque = await revisarChoque(bctx, { desdeDia, desdeHora: desdeHora ?? undefined, hastaDia, hastaHora: hastaHora ?? undefined, doctorId: doctorId ?? undefined });
      if (choque) {
        pr.errors.push(`Se empalma con ${choque.total} cita(s) ya agendada(s) en ese rango: muévelas antes de importar este bloqueo`);
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

  async commit(rows: PreviewRow[], clinicId: string, skipDuplicates: boolean, ctx: ImportContext) {
    const toInsert = pickInsertable(rows, skipDuplicates);
    if (toInsert.length === 0) return { created: 0, skipped: 0 };

    const clinic = await prisma.clinic.findFirst({ where: { id: clinicId }, select: { timezone: true } });
    const timezone = clinic?.timezone ?? "America/Mexico_City";
    const bctx: BloqueoCtx = {
      clinicId, userId: ctx.userId, role: (ctx.role as Role) || "ADMIN",
      displayName: "Importador", timezone, puedeGestionar: true,
    };

    let created = 0;
    for (const r of toInsert) {
      try {
        const resultado = await crearBloqueo(bctx, {
          desdeDia: r.data.desdeDia, desdeHora: r.data.desdeHora, hastaDia: r.data.hastaDia, hastaHora: r.data.hastaHora,
          doctorId: r.data.doctorId ?? undefined, reason: r.data.reason,
        });
        if (!resultado.ok) {
          r.status = "error";
          r.errors.push(`Se empalma con ${resultado.choque?.total ?? "una"} cita(s) ya agendada(s): muévelas antes de importar este bloqueo`);
          continue;
        }
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
