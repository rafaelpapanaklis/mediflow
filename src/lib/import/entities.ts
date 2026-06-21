// Validadores POR entidad para el motor de importación. Cada handler implementa
// EntityHandler (engine.ts): autodetección de columnas, validación estructural,
// process() (normaliza + dedup + resuelve FKs) y commit() (inserta por lotes).
//
// Multi-tenant: clinicId SIEMPRE llega desde la sesión (runImport lo pasa). Las
// resoluciones de paciente/doctor SOLO buscan dentro de esa clínica.

import { prisma } from "@/lib/prisma";
import type { PreviewRow } from "./types";
import {
  BATCH,
  EMAIL_RE,
  VALID_BLOOD,
  type EntityHandler,
  last10,
  normName,
  parseAmount,
  parseDate,
  parseGender,
  parsePhone,
} from "./engine";

const OPENING_BALANCE_NOTE = "Saldo inicial migrado";

// ---------------------------------------------------------------------------
// Resolución de paciente/doctor por nombre/teléfono/correo (dentro de la clínica).
// ---------------------------------------------------------------------------

interface PatientIndex {
  byPhone: Map<string, string[]>;
  byEmail: Map<string, string[]>;
  byName: Map<string, string[]>;
}

function pushKey(m: Map<string, string[]>, k: string, id: string) {
  if (!k) return;
  const arr = m.get(k);
  if (arr) arr.push(id);
  else m.set(k, [id]);
}

/**
 * Carga TODOS los pacientes de la clínica (5 campos) para resolver en memoria por
 * teléfono (last10), correo o nombre. El nombre normalizado no es indexable en
 * DB; cargar el padrón es aceptable para una migración puntual.
 */
async function loadPatientIndex(clinicId: string): Promise<PatientIndex> {
  const patients = await prisma.patient.findMany({
    where: { clinicId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
  });
  const idx: PatientIndex = { byPhone: new Map(), byEmail: new Map(), byName: new Map() };
  for (const p of patients) {
    if (p.phone) pushKey(idx.byPhone, last10(p.phone), p.id);
    if (p.email) pushKey(idx.byEmail, p.email.toLowerCase(), p.id);
    pushKey(idx.byName, normName(`${p.firstName} ${p.lastName}`), p.id);
  }
  return idx;
}

/** Resuelve un paciente por prioridad teléfono → correo → nombre. */
function resolvePatient(mapped: Record<string, any>, idx: PatientIndex): { id?: string; error?: string } {
  const sets: string[][] = [];
  if (mapped.phone) { const ids = idx.byPhone.get(last10(mapped.phone)); if (ids) sets.push(ids); }
  if (mapped.email) { const ids = idx.byEmail.get(String(mapped.email).toLowerCase()); if (ids) sets.push(ids); }
  if (mapped.name)  { const ids = idx.byName.get(normName(mapped.name)); if (ids) sets.push(ids); }
  if (sets.length === 0) return { error: "Paciente no encontrado en la clínica" };
  const hit = sets[0];
  if (hit.length > 1) return { error: "Coincide con varios pacientes; identifica por teléfono o correo único" };
  return { id: hit[0] };
}

/** Resuelve por nombre exacto (normalizado) dentro de un índice nombre→ids. */
function resolveByName(value: any, byName: Map<string, string[]>, label: string): { id?: string; error?: string } {
  const shown = String(value).trim();
  const ids = byName.get(normName(value));
  if (!ids || ids.length === 0) return { error: `${label} "${shown}" no encontrado en la clínica` };
  if (ids.length > 1) return { error: `Varios coinciden con ${label.toLowerCase()} "${shown}"` };
  return { id: ids[0] };
}

/**
 * Inserción por lotes con numeración secuencial (patientNumber / invoiceNumber) y
 * reintento ante carrera de unicidad (P2002). Devuelve el total creado.
 */
async function insertNumbered(args: {
  rows: PreviewRow[];
  count: () => Promise<number>;
  numberField: string;
  format: (seq: number) => string;
  build: (slice: PreviewRow[]) => any[];
  create: (data: any[]) => Promise<{ count: number }>;
}): Promise<number> {
  const { rows, count, numberField, format, build, create } = args;
  let created = 0;
  const base = await count();
  rows.forEach((r, i) => { r.data[numberField] = format(base + 1 + i); });
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    try {
      created += (await create(build(slice))).count;
    } catch (e: any) {
      if (e?.code === "P2002") {
        // Carrera de numeración: renumera el slice y reintenta una vez en bloque.
        const fresh = await count();
        slice.forEach((r, j) => { r.data[numberField] = format(fresh + 1 + j); });
        try {
          created += (await create(build(slice))).count;
        } catch {
          created += await insertSliceByRow(slice, { count, numberField, format, build, create });
        }
      } else {
        // Error de DB ≠ P2002 (p. ej. FK P2003 si borraron patient/doctorId entre
        // dry-run y commit): NO abortamos el lote. Aislamos fila por fila para
        // insertar las válidas y marcar SOLO la mala como error (se reporta).
        created += await insertSliceByRow(slice, { count, numberField, format, build, create });
      }
    }
  }
  return created;
}

const pickInsertable = (rows: PreviewRow[], skipDuplicates: boolean) =>
  rows.filter((r) => r.status === "ok" || (!skipDuplicates && r.status === "duplicate"));

/** Mensaje en español para un error de DB al insertar una fila concreta. */
function rowDbErrorMessage(e: any): string {
  const code = e?.code;
  if (code === "P2003") return "No se pudo guardar: el paciente o doctor referido ya no existe";
  if (code === "P2002") return "No se pudo guardar: registro duplicado";
  return "No se pudo guardar la fila (error de base de datos)";
}

/** Marca una fila como error de commit; se reporta por fila y NO aborta el lote. */
function markRowError(r: PreviewRow, e: any) {
  r.status = "error";
  r.errors.push(rowDbErrorMessage(e));
}

/**
 * Inserta un slice fila por fila cuando el insert en bloque falló por un error de
 * DB que NO es de numeración (p. ej. FK P2003). Inserta las válidas, renumera y
 * reintenta una vez ante P2002, y marca como error las filas que sigan fallando.
 * Devuelve cuántas se crearon; las filas marcadas error fluyen al reporte por fila.
 */
async function insertSliceByRow(
  slice: PreviewRow[],
  args: {
    count: () => Promise<number>;
    numberField: string;
    format: (seq: number) => string;
    build: (slice: PreviewRow[]) => any[];
    create: (data: any[]) => Promise<{ count: number }>;
  },
): Promise<number> {
  const { count, numberField, format, build, create } = args;
  let made = 0;
  for (const r of slice) {
    try {
      made += (await create(build([r]))).count;
    } catch (e: any) {
      if (e?.code === "P2002") {
        try {
          const fresh = await count();
          r.data[numberField] = format(fresh + 1);
          made += (await create(build([r]))).count;
        } catch (e2: any) {
          markRowError(r, e2);
        }
      } else {
        markRowError(r, e);
      }
    }
  }
  return made;
}

// ===========================================================================
// PACIENTES — reusa la normalización del endpoint original (firstName/lastName/
// email/phone/dob/gender/bloodType/address/notes). Dedup por email/phone.
// ===========================================================================

export const patientsHandler: EntityHandler = {
  entity: "patients",
  auditEntityType: "patient",
  headerVariants: {
    firstName: ["nombre", "nombres", "firstname", "primernombre"],
    lastName:  ["apellido", "apellidos", "lastname"],
    email:     ["email", "correo", "correoelectronico", "emailaddress"],
    phone:     ["telefono", "celular", "whatsapp", "phone", "movil"],
    dob:       ["fechadenacimiento", "nacimiento", "fechanac", "birthdate", "dob", "fechanacimiento"],
    gender:    ["genero", "sexo", "gender"],
    address:   ["direccion", "domicilio", "address"],
    bloodType: ["tiposangre", "tipodesangre", "bloodtype"],
    notes:     ["notas", "observaciones", "comentarios", "notes"],
  },

  validateMapping(campos) {
    if (!campos.has("firstName") || !campos.has("lastName")) {
      return "El archivo debe tener columnas 'nombre' y 'apellido'";
    }
    return null;
  },

  async process(rows, clinicId) {
    const seenEmails = new Set<string>();
    const seenPhones = new Set<string>();
    const out: PreviewRow[] = [];

    for (const { row, mapped } of rows) {
      const pr: PreviewRow = { row, data: {}, status: "ok", errors: [], warnings: [] };
      const data = pr.data;

      for (const campo of Object.keys(mapped)) {
        const v = mapped[campo];
        if (v === undefined || v === null || String(v).trim() === "") continue;
        const sv = String(v).trim();
        switch (campo) {
          case "firstName":
          case "lastName":
          case "address":
          case "notes":
            data[campo] = sv;
            break;
          case "email":
            if (EMAIL_RE.test(sv)) data.email = sv.toLowerCase();
            else { data.email = null; pr.warnings.push(`Email inválido "${sv}" — guardado sin email`); }
            break;
          case "phone":
            data.phone = parsePhone(sv);
            break;
          case "dob": {
            const d = parseDate(v);
            if (d) data.dob = d;
            else { data.dob = null; pr.warnings.push(`Fecha "${sv}" inválida — guardada sin fecha`); }
            break;
          }
          case "gender":
            data.gender = parseGender(sv);
            break;
          case "bloodType": {
            const up = sv.toUpperCase();
            if (VALID_BLOOD.has(up)) data.bloodType = up;
            else { data.bloodType = null; pr.warnings.push(`Tipo sangre "${sv}" inválido — guardado sin valor`); }
            break;
          }
        }
      }

      if (!data.firstName) pr.errors.push("Falta nombre");
      if (!data.lastName) pr.errors.push("Falta apellido");
      if (pr.errors.length > 0) pr.status = "error";

      if (pr.status === "ok") {
        // El teléfono se DEDUPLICA por last10 (misma convención que resolvePatient/
        // loadPatientIndex), no por el string crudo: "+5255…" y "5255…" = mismo paciente.
        const phoneKey = data.phone ? last10(data.phone) : null;
        if (data.email && seenEmails.has(data.email)) {
          pr.status = "duplicate"; pr.warnings.push("Email repetido en el archivo");
        } else if (phoneKey && seenPhones.has(phoneKey)) {
          pr.status = "duplicate"; pr.warnings.push("Teléfono repetido en el archivo");
        } else {
          if (data.email) seenEmails.add(data.email);
          if (phoneKey) seenPhones.add(phoneKey);
        }
      }
      out.push(pr);
    }

    // Dedup contra DB. El teléfono NO se compara con un IN crudo: el padrón puede
    // guardarlo en otro formato, así que se normaliza a last10 (igual que
    // loadPatientIndex/resolvePatient). El correo se compara en minúsculas. Se carga
    // el padrón de la clínica (phone/email), aceptable para una migración puntual.
    const okRows = out.filter((r) => r.status === "ok");
    const hasEmail = okRows.some((r) => r.data.email);
    const hasPhone = okRows.some((r) => r.data.phone);
    if (hasEmail || hasPhone) {
      const existing = await prisma.patient.findMany({
        where: { clinicId },
        select: { email: true, phone: true },
      });
      const dbEmails = new Set(
        existing.map((e) => e.email?.toLowerCase()).filter(Boolean) as string[],
      );
      const dbPhones = new Set(
        existing.map((e) => (e.phone ? last10(e.phone) : null)).filter(Boolean) as string[],
      );
      for (const r of out) {
        if (r.status !== "ok") continue;
        const phoneKey = r.data.phone ? last10(r.data.phone) : null;
        if ((r.data.email && dbEmails.has(r.data.email)) || (phoneKey && dbPhones.has(phoneKey))) {
          r.status = "duplicate"; r.warnings.push("Ya existe en la base de datos");
        }
      }
    }
    return out;
  },

  async commit(rows, clinicId, skipDuplicates) {
    const toInsert = pickInsertable(rows, skipDuplicates);
    if (toInsert.length === 0) return { created: 0, skipped: 0 };
    const created = await insertNumbered({
      rows: toInsert,
      count: () => prisma.patient.count({ where: { clinicId } }),
      numberField: "patientNumber",
      format: (seq) => `P${String(seq).padStart(4, "0")}`,
      build: (slice) => slice.map((r) => ({
        clinicId,
        patientNumber: r.data.patientNumber,
        firstName: r.data.firstName,
        lastName: r.data.lastName,
        email: r.data.email ?? null,
        phone: r.data.phone ?? null,
        dob: r.data.dob ?? null,
        gender: (r.data.gender ?? "OTHER") as any,
        bloodType: r.data.bloodType ?? null,
        address: r.data.address ?? null,
        notes: r.data.notes ?? null,
      })),
      create: (data) => prisma.patient.createMany({ data, skipDuplicates: true }),
    });
    const erroredNow = toInsert.filter((r) => r.status === "error").length;
    return { created, skipped: Math.max(0, toInsert.length - created - erroredNow) };
  },
};

// ===========================================================================
// SALDOS — crea una "factura de apertura" (Invoice) por paciente con su saldo.
// Resuelve paciente por phone(last10)/email/nombre. SIN CFDI. Idempotente: si el
// paciente ya tiene una factura de apertura migrada, se marca duplicado.
// ===========================================================================

export const balancesHandler: EntityHandler = {
  entity: "balances",
  auditEntityType: "invoice",
  headerVariants: {
    name:   ["nombre", "nombredelpaciente", "paciente", "nombrecompleto", "nombres", "cliente"],
    phone:  ["telefono", "celular", "whatsapp", "phone", "movil"],
    email:  ["email", "correo", "correoelectronico"],
    amount: ["saldo", "monto", "adeudo", "balance", "saldopendiente", "deuda", "importe", "saldoactual", "porcobrar"],
  },

  validateMapping(campos) {
    if (!campos.has("amount")) return "Falta la columna de saldo/monto";
    if (!campos.has("phone") && !campos.has("email") && !campos.has("name")) {
      return "Falta una columna para identificar al paciente (teléfono, correo o nombre)";
    }
    return null;
  },

  async process(rows, clinicId) {
    const idx = await loadPatientIndex(clinicId);
    // Pacientes que YA tienen saldo inicial migrado → idempotencia.
    const existingOpening = await prisma.invoice.findMany({
      where: { clinicId, notes: OPENING_BALANCE_NOTE },
      select: { patientId: true },
    });
    const alreadyMigrated = new Set(existingOpening.map((i) => i.patientId));
    const seenPatients = new Set<string>();
    const out: PreviewRow[] = [];

    for (const { row, mapped } of rows) {
      const pr: PreviewRow = { row, data: {}, status: "ok", errors: [], warnings: [] };

      const amount = parseAmount(mapped.amount);
      if (amount === null) pr.errors.push(`Saldo inválido "${mapped.amount ?? ""}"`);
      else if (amount === 0) pr.errors.push("Saldo en cero — nada que migrar");

      const res = resolvePatient(mapped, idx);
      if (res.error) pr.errors.push(res.error);

      if (pr.errors.length > 0) { pr.status = "error"; out.push(pr); continue; }

      pr.data = {
        patientId: res.id,
        amount,
        name: mapped.name ? String(mapped.name).trim() : undefined,
      };

      if (alreadyMigrated.has(res.id!)) {
        pr.status = "duplicate"; pr.warnings.push("El paciente ya tiene saldo inicial migrado");
      } else if (seenPatients.has(res.id!)) {
        pr.status = "duplicate"; pr.warnings.push("Paciente repetido en el archivo");
      } else {
        seenPatients.add(res.id!);
      }
      out.push(pr);
    }
    return out;
  },

  async commit(rows, clinicId, skipDuplicates) {
    const toInsert = pickInsertable(rows, skipDuplicates);
    if (toInsert.length === 0) return { created: 0, skipped: 0 };
    const created = await insertNumbered({
      rows: toInsert,
      count: () => prisma.invoice.count({ where: { clinicId } }),
      numberField: "invoiceNumber",
      format: (seq) => `MF-${String(seq).padStart(4, "0")}`,
      build: (slice) => slice.map((r) => {
        const amount = r.data.amount as number;
        return {
          clinicId,
          patientId: r.data.patientId,
          invoiceNumber: r.data.invoiceNumber,
          items: [{ description: OPENING_BALANCE_NOTE, quantity: 1, unitPrice: amount, total: amount }],
          subtotal: amount,
          discount: 0,
          total: amount,
          paid: 0,
          balance: amount,
          status: "PENDING" as any,
          notes: OPENING_BALANCE_NOTE,
        };
      }),
      create: (data) => prisma.invoice.createMany({ data, skipDuplicates: true }),
    });
    const erroredNow = toInsert.filter((r) => r.status === "error").length;
    return { created, skipped: Math.max(0, toInsert.length - created - erroredNow) };
  },
};

// ===========================================================================
// CITAS — resuelve patientId (phone/email/nombre) + doctorId (nombre → User de la
// clínica). Valida fecha/hora, calcula endsAt, status SCHEDULED. Dedup por
// (paciente + horario) en archivo y contra DB.
// ===========================================================================

const DEFAULT_DURATION_MIN = 30;

/** Combina fecha + hora en un Date. Si no hay hora, ancla a 09:00 local. */
function parseStartsAt(dateVal: any, timeVal: any): Date | null {
  const d = parseDate(dateVal);
  if (!d) return null;
  let hours = 9;
  let mins = 0;
  if (timeVal instanceof Date) {
    hours = timeVal.getHours();
    mins = timeVal.getMinutes();
  } else if (timeVal !== undefined && timeVal !== null && String(timeVal).trim() !== "") {
    const m = String(timeVal).trim().match(/^(\d{1,2}):(\d{2})/);
    if (m) { hours = Math.min(23, Number(m[1])); mins = Math.min(59, Number(m[2])); }
  }
  d.setHours(hours, mins, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDuration(v: any): number {
  if (v === undefined || v === null || String(v).trim() === "") return DEFAULT_DURATION_MIN;
  const n = parseInt(String(v).replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) && n > 0 && n <= 600 ? n : DEFAULT_DURATION_MIN;
}

export const appointmentsHandler: EntityHandler = {
  entity: "appointments",
  auditEntityType: "appointment",
  headerVariants: {
    name:     ["paciente", "nombre", "nombredelpaciente", "nombrecompleto", "cliente"],
    phone:    ["telefono", "celular", "whatsapp", "phone", "movil"],
    email:    ["email", "correo", "correoelectronico"],
    doctor:   ["doctor", "doctora", "medico", "odontologo", "odontologa", "dentista", "profesional", "atiende"],
    date:     ["fecha", "fechacita", "fechadelacita", "dia", "date"],
    time:     ["hora", "horacita", "time", "horario", "horadelacita"],
    type:     ["tipo", "motivo", "tratamiento", "servicio", "tipocita", "concepto"],
    duration: ["duracion", "minutos", "durationmin", "duracionmin"],
    notes:    ["notas", "observaciones", "comentarios", "nota"],
  },

  validateMapping(campos) {
    if (!campos.has("date")) return "Falta la columna de fecha de la cita";
    if (!campos.has("doctor")) return "Falta la columna del doctor";
    if (!campos.has("name") && !campos.has("phone") && !campos.has("email")) {
      return "Falta una columna para identificar al paciente (nombre, teléfono o correo)";
    }
    return null;
  },

  async process(rows, clinicId) {
    const idx = await loadPatientIndex(clinicId);
    // Índice de doctores por nombre (cualquier usuario activo de la clínica).
    const users = await prisma.user.findMany({
      where: { clinicId, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    });
    const byDoctor = new Map<string, string[]>();
    for (const u of users) pushKey(byDoctor, normName(`${u.firstName} ${u.lastName}`), u.id);

    const seen = new Set<string>();
    const out: PreviewRow[] = [];

    for (const { row, mapped } of rows) {
      const pr: PreviewRow = { row, data: {}, status: "ok", errors: [], warnings: [] };

      const startsAt = parseStartsAt(mapped.date, mapped.time);
      if (!startsAt) pr.errors.push(`Fecha inválida "${mapped.date ?? ""}"`);

      const pRes = resolvePatient(mapped, idx);
      if (pRes.error) pr.errors.push(pRes.error);

      const dRes = (!mapped.doctor || !String(mapped.doctor).trim())
        ? { error: "Falta el doctor" }
        : resolveByName(mapped.doctor, byDoctor, "Doctor");
      if (dRes.error) pr.errors.push(dRes.error);

      if (pr.errors.length > 0) { pr.status = "error"; out.push(pr); continue; }

      const dur = parseDuration(mapped.duration);
      const endsAt = new Date(startsAt!.getTime() + dur * 60_000);
      const type = mapped.type && String(mapped.type).trim() ? String(mapped.type).trim().slice(0, 200) : "Consulta";

      pr.data = {
        patientId: pRes.id,
        doctorId: dRes.id,
        startsAt,
        endsAt,
        type,
        notes: mapped.notes ? String(mapped.notes).trim() : null,
        status: "SCHEDULED",
        patientName: mapped.name ? String(mapped.name).trim() : undefined,
        doctorName: String(mapped.doctor).trim(),
      };

      const key = `${pRes.id}|${startsAt!.toISOString()}`;
      if (seen.has(key)) {
        pr.status = "duplicate"; pr.warnings.push("Cita repetida en el archivo (mismo paciente y horario)");
      } else {
        seen.add(key);
      }
      out.push(pr);
    }

    // Dedup contra DB: citas existentes del mismo paciente en el rango de fechas.
    const okRows = out.filter((r) => r.status === "ok");
    if (okRows.length > 0) {
      const patientIds = Array.from(new Set(okRows.map((r) => r.data.patientId as string)));
      let minStart = okRows[0].data.startsAt as Date;
      let maxStart = okRows[0].data.startsAt as Date;
      for (const r of okRows) {
        const d = r.data.startsAt as Date;
        if (d < minStart) minStart = d;
        if (d > maxStart) maxStart = d;
      }
      const existing = await prisma.appointment.findMany({
        where: { clinicId, patientId: { in: patientIds }, startsAt: { gte: minStart, lte: maxStart } },
        select: { patientId: true, startsAt: true },
      });
      const dbKeys = new Set(existing.map((a) => `${a.patientId}|${a.startsAt.toISOString()}`));
      for (const r of out) {
        if (r.status !== "ok") continue;
        const key = `${r.data.patientId}|${(r.data.startsAt as Date).toISOString()}`;
        if (dbKeys.has(key)) {
          r.status = "duplicate"; r.warnings.push("Ya existe una cita para ese paciente y horario");
        }
      }
    }
    return out;
  },

  async commit(rows, clinicId, skipDuplicates) {
    const toInsert = pickInsertable(rows, skipDuplicates);
    if (toInsert.length === 0) return { created: 0, skipped: 0 };
    const build = (slice: PreviewRow[]) =>
      slice.map((r) => ({
        clinicId,
        patientId: r.data.patientId,
        doctorId: r.data.doctorId,
        type: r.data.type,
        startsAt: r.data.startsAt,
        endsAt: r.data.endsAt,
        status: "SCHEDULED" as any,
        notes: r.data.notes ?? null,
      }));
    const createMany = (data: any[]) => prisma.appointment.createMany({ data, skipDuplicates: true });
    let created = 0;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const slice = toInsert.slice(i, i + BATCH);
      try {
        created += (await createMany(build(slice))).count;
      } catch {
        // Error de DB en el bloque (p. ej. FK P2003 por doctorId/patientId borrado
        // entre dry-run y commit): NO abortamos el lote, aislamos fila por fila.
        for (const r of slice) {
          try {
            created += (await createMany(build([r]))).count;
          } catch (e2: any) {
            markRowError(r, e2);
          }
        }
      }
    }
    const erroredNow = toInsert.filter((r) => r.status === "error").length;
    return { created, skipped: Math.max(0, toInsert.length - created - erroredNow) };
  },
};

export const HANDLERS: Record<string, EntityHandler> = {
  patients: patientsHandler,
  balances: balancesHandler,
  appointments: appointmentsHandler,
};
