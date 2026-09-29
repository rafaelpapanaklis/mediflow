// HISTORIAL DE CITAS PASADAS migrado (ws1-t12, importador Dentalink, sep-2026):
// 05b_Citas_Estados_Historico trae citas del sistema anterior que YA
// terminaron (atendida, no asistió, cancelada). El archivo de citas "vivas"
// (05_Citas, appointmentsHandler en entities.ts) las omite a propósito — una
// cita pasada no se agenda, ver `estadoDeCita`/el chequeo de `startsAt` ahí —
// así que sin este handler esa historia se perdía por completo.
//
// Es HISTORIA, no agenda. Mismo criterio que pagos-historial:
//   · NUNCA crea una fila en `Appointment`: por eso el barrido de
//     recordatorios (reminders/enqueue.ts, filtra por status
//     PENDING/SCHEDULED/CONFIRMED) y el de seguimiento post-cita
//     (post-appointment-followup/route.ts, filtra por status+ventana de
//     tiempo reciente) NUNCA la leen — ninguno de los dos consulta
//     `migrated_visits`. No hay recordatorio ni cobro posible porque no hay
//     código nuevo que dispare ninguno de los dos a partir de esta tabla.
//   · Se ve, de solo lectura, en la ficha del paciente ("Citas anteriores
//     (migradas)" — ver leer.ts + la tarjeta de la ficha).
//   · Solo acepta un estado FINAL reconocido (atendida/no asistió/cancelada):
//     este archivo es justamente el que dice cómo terminó cada cita, así que
//     un estado que no es final (o que no se reconoce) es un error, nunca una
//     adivinanza silenciosa.
//
// Construido en un archivo NUEVO. Multi-tenant: clinicId SIEMPRE de la sesión.

import { prisma } from "@/lib/prisma";
import type { PreviewRow } from "../types";
import { BATCH, ImportError, norm, normName, parseDate, type EntityHandler, type MappedRow, type ImportContext } from "../engine";
import { cellText, oneLine, nombreOrigen, newId, calendarNoonUtc, dayKey } from "../migrado";
import { parseHora, horaLocalAUtc, textoLocal } from "../valores";
import { loadPatientIndex, resolvePaymentPatient } from "../pagos-historial/paciente";

const DEFAULT_HOUR = { h: 9, m: 0 };

/** ¿El error es "la tabla migrated_visits no existe todavía"? (SQL pendiente, sql/citas-historial-migradas.sql) */
function faltaLaTabla(e: unknown): boolean {
  const code = (e as any)?.code;
  return code === "P2021" || code === "P2022";
}

/**
 * Estado en el sistema de origen → estado FINAL reconocido, o null si no lo
 * es (este archivo solo trae historia ya cerrada; "agendada"/"confirmada" no
 * pertenecen aquí y se rechazan en vez de adivinar cuál de las tres es).
 */
function estadoFinal(v: unknown): "COMPLETED" | "NO_SHOW" | "CANCELLED" | null {
  const n = norm(cellText(v));
  if (!n) return null;
  if (/atendid|realizad|complet|finaliz|terminad|attended/.test(n)) return "COMPLETED";
  if (/noasist|inasist|ausent|falt|noshow/.test(n)) return "NO_SHOW";
  if (/anul|cancel|elimin|rechaz|suspend/.test(n)) return "CANCELLED";
  return null;
}

const pickInsertable = (rows: PreviewRow[], skipDuplicates: boolean) =>
  rows.filter((r) => r.status === "ok" || (!skipDuplicates && r.status === "duplicate"));

function llaveDeVisita(o: { patientId: string; startsAt: Date; status: string }): string {
  return `v:${o.patientId}|${o.startsAt.toISOString()}|${o.status}`;
}

export const appointmentHistoryHandler: EntityHandler = {
  entity: "appointmentHistory",
  auditEntityType: "appointment",
  sheetNames: ["citasestadoshistorico", "historialdecitas", "estadosdecitas", "citashistorico"],
  headerVariants: {
    name: ["nombre", "nombredelpaciente", "paciente", "nombrecompleto", "nombres", "cliente"],
    lastName: ["apellido", "apellidos", "lastname"],
    phone: ["telefono", "celular", "whatsapp", "phone", "movil"],
    email: ["email", "correo", "correoelectronico"],
    patientExternalId: ["idpaciente", "#paciente", "iddelpaciente", "idficha", "idfichapaciente", "codigopaciente", "nficha", "nroficha", "numeroficha", "numerodeficha"],
    doctor: ["doctor", "doctora", "medico", "odontologo", "odontologa", "dentista", "profesional", "atiende"],
    date: ["fecha", "fechacita", "fechadelacita", "dia", "date"],
    time: ["hora", "horacita", "time", "horario"],
    status: ["estado", "estadocita", "estadofinal", "estadodelacita", "status"],
    type: ["tipo", "motivo", "tratamiento", "servicio", "tipocita", "concepto"],
    notes: ["notas", "observaciones", "comentarios", "nota", "comentario"],
  },

  validateMapping(campos) {
    if (!campos.has("date")) return "Falta la columna de fecha de la cita";
    if (!campos.has("status")) return "Falta la columna del estado final de la cita (atendida / no asistió / cancelada)";
    if (!campos.has("name") && !campos.has("phone") && !campos.has("email") && !campos.has("patientExternalId")) {
      return "Falta una columna para identificar al paciente (ID, nombre, teléfono o correo)";
    }
    return null;
  },

  async process(rows: MappedRow[], clinicId: string, ctx: ImportContext): Promise<PreviewRow[]> {
    const idx = await loadPatientIndex(clinicId, ctx);
    const clinic = await prisma.clinic.findFirst({ where: { id: clinicId }, select: { timezone: true } });
    const tz = clinic?.timezone ?? null;
    const origen = nombreOrigen(ctx.originName);

    const users = await prisma.user.findMany({ where: { clinicId, isActive: true }, select: { id: true, firstName: true, lastName: true } });
    // Nombre normalizado → TODOS los usuarios que lo llevan: con dos iguales (el dueño y su ficha de doctor) ya
    // no gana el último en silencio; es ambiguo y lo decide la persona (valueMapping.doctor).
    const byDoctor = new Map<string, string[]>();
    const nombreDe = new Map<string, string>();
    for (const u of users) {
      const k = normName(`${u.firstName} ${u.lastName}`);
      byDoctor.set(k, [...(byDoctor.get(k) ?? []), u.id]);
      nombreDe.set(u.id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim());
    }
    const eleccionDoctor = ctx.valueMapping.doctor ?? {};

    // Red contra lo que ya está en migrated_visits (tolera que la tabla aún no exista).
    const existentes = new Set<string>();
    try {
      const ya = await prisma.migratedVisit.findMany({ where: { clinicId }, select: { patientId: true, startsAt: true, status: true } });
      for (const v of ya) existentes.add(llaveDeVisita({ patientId: v.patientId, startsAt: v.startsAt, status: v.status }));
    } catch (e) {
      if (!faltaLaTabla(e)) throw e;
    }

    const vistosEnArchivo = new Set<string>();
    const out: PreviewRow[] = [];

    for (const { row, mapped } of rows) {
      const pr: PreviewRow = { row, data: {}, status: "ok", errors: [], warnings: [] };

      const status = estadoFinal(mapped.status);
      if (!status) {
        pr.errors.push(`Estado «${cellText(mapped.status)}» no es un estado final reconocido (usa atendida, no asistió o cancelada)`);
      }

      const fecha = mapped.date ? parseDate(mapped.date) : null;
      if (!mapped.date || !cellText(mapped.date)) pr.errors.push("Falta la fecha de la cita");
      else if (!fecha) pr.errors.push(`Fecha "${cellText(mapped.date)}" inválida`);

      let hora = DEFAULT_HOUR;
      if (mapped.time && cellText(mapped.time)) {
        const leida = parseHora(mapped.time);
        if (leida === null) pr.errors.push(`Hora "${cellText(mapped.time)}" inválida`);
        else if (leida) hora = leida;
      }

      const res = resolvePaymentPatient(mapped, idx);
      if (res.error) pr.errors.push(res.error);
      if (res.warning) pr.warnings.push(res.warning);

      let doctorId: string | null = null;
      if (mapped.doctor && cellText(mapped.doctor)) {
        const clave = normName(cellText(mapped.doctor));
        const elegido = eleccionDoctor[clave];
        const iguales = byDoctor.get(clave) ?? [];
        if (elegido && nombreDe.has(elegido)) doctorId = elegido;
        else if (iguales.length === 1) doctorId = iguales[0];
        else {
          // No existe, o hay varios con ese nombre: la persona elige a quién va; sin elegir se guarda sin doctor.
          pr.unresolved = [{ field: "doctor", key: clave, value: cellText(mapped.doctor) }];
          pr.warnings.push(iguales.length > 1
            ? `Varios usuarios coinciden con el doctor "${cellText(mapped.doctor)}": elige a cuál se asigna (mientras tanto se guarda sin doctor)`
            : `Doctor "${cellText(mapped.doctor)}" no encontrado en la clínica: elige a qué usuario se asigna (mientras tanto se guarda sin doctor)`);
        }
      }

      if (pr.errors.length > 0) { pr.status = "error"; out.push(pr); continue; }

      const startsAt = horaLocalAUtc(fecha!.getFullYear(), fecha!.getMonth() + 1, fecha!.getDate(), hora.h, hora.m, tz);
      if (!startsAt) { pr.status = "error"; pr.errors.push("La hora no existe en la zona horaria de la clínica (cambio de horario)"); out.push(pr); continue; }

      if (startsAt.getTime() > ctx.now.getTime()) {
        pr.status = "error";
        pr.errors.push(`Fecha futura (${textoLocal(startsAt, tz)}) para un estado ya cerrado: dato incoherente`);
        out.push(pr);
        continue;
      }

      const type = mapped.type && cellText(mapped.type) ? oneLine(mapped.type, 200) : null;
      const notes = mapped.notes && cellText(mapped.notes) ? oneLine(mapped.notes, 500) : null;

      Object.assign(pr.data, {
        patientId: res.id,
        doctorId,
        startsAt,
        status,
        type,
        notes,
        origin: origen,
        patientName: res.fullName || idx.nameById.get(res.id!) || undefined,
      });

      const key = llaveDeVisita({ patientId: res.id!, startsAt, status: status! });
      if (existentes.has(key)) {
        pr.status = "skipped";
        pr.warnings.push("Esta cita ya se importó antes");
      } else if (vistosEnArchivo.has(key)) {
        pr.status = "duplicate";
        pr.warnings.push("Fila repetida en el archivo (mismo paciente, fecha y estado)");
      } else {
        vistosEnArchivo.add(key);
      }
      out.push(pr);
    }
    return out;
  },

  // Los usuarios activos de la clínica, para elegir a quién se asigna un doctor del archivo sin equivalente.
  async valueOptions(clinicId: string) {
    const usuarios = await prisma.user.findMany({
      where: { clinicId, isActive: true },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
    const ROL: Record<string, string> = { SUPER_ADMIN: "dueño", ADMIN: "administrador", DOCTOR: "doctor", RECEPTIONIST: "recepción" };
    return {
      doctor: usuarios.map((u: any) => ({ id: u.id, label: `${`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()}${u.role && ROL[u.role] ? ` · ${ROL[u.role]}` : ""}` })),
    };
  },

  async commit(rows: PreviewRow[], clinicId: string, skipDuplicates: boolean, ctx: ImportContext) {
    const toInsert = pickInsertable(rows, skipDuplicates);
    if (toInsert.length === 0) return { created: 0, skipped: 0 };

    try {
      await prisma.migratedVisit.count({ where: { clinicId } });
    } catch (e) {
      if (faltaLaTabla(e)) {
        throw new ImportError(
          409,
          "Falta aplicar el SQL del historial de citas (sql/citas-historial-migradas.sql) antes de importar",
          undefined,
          "MIGRATED_VISITS_TABLE_MISSING",
        );
      }
      throw e;
    }

    for (const r of toInsert) r.data.newId = newId();
    const build = (rs: PreviewRow[]) => rs.map((r) => ({
      id: r.data.newId as string,
      clinicId,
      patientId: r.data.patientId as string,
      doctorId: (r.data.doctorId as string | null) ?? null,
      startsAt: r.data.startsAt as Date,
      status: r.data.status as any,
      type: (r.data.type as string | null) ?? null,
      notes: (r.data.notes as string | null) ?? null,
      origin: r.data.origin as string,
      createdById: ctx.userId,
    }));

    let created = 0;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const slice = toInsert.slice(i, i + BATCH);
      try {
        created += (await prisma.migratedVisit.createMany({ data: build(slice) })).count;
      } catch {
        for (const r of slice) {
          try {
            created += (await prisma.migratedVisit.createMany({ data: build([r]) })).count;
          } catch (e2: any) {
            r.status = "error";
            r.errors.push(e2?.code === "P2003" ? "No se pudo guardar: el paciente ya no existe" : "No se pudo guardar la fila (error de base de datos)");
          }
        }
      }
    }

    const erroredNow = toInsert.filter((r) => r.status === "error").length;
    return { created, skipped: Math.max(0, toInsert.length - created - erroredNow) };
  },
};
