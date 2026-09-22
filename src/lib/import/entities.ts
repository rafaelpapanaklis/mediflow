// Validadores POR entidad para el motor de importación. Cada handler implementa
// EntityHandler (engine.ts): autodetección de columnas, validación estructural,
// process() (normaliza + dedup + resuelve FKs) y commit() (inserta por lotes).
//
// Multi-tenant: clinicId SIEMPRE llega desde la sesión (runImport lo pasa). Las
// resoluciones de paciente/doctor SOLO buscan dentro de esa clínica.

import { prisma } from "@/lib/prisma";
import { getPatientQuota } from "@/lib/patient-quota";
import { lastPatientFolio } from "@/lib/patients/next-patient-number";
import { formatPatientNumber } from "@/lib/patients/next-patient-number-core";
import { canSeePatient } from "@/lib/patient-visibility";
import { lastInvoiceFolio } from "@/lib/invoices/next-invoice-number";
import { formatInvoiceNumber } from "@/lib/invoices/next-invoice-number-core";
import { sumInvoiceItems, computeInvoiceTotal, round2 } from "@/lib/invoice-totals";
import { MAX_INVOICE_FOLIO_DIGITS } from "@/lib/invoices/next-invoice-number-core";
import { computeTotals, formatFolio } from "@/lib/quotes/compute";
import { consentTimeZone, formatConsentDate } from "@/lib/consent/dates";
import { MAX_BODY_LENGTH, MAX_INPUT_LENGTH, isBlankHtml } from "@/lib/document-templates/sanitize";
import {
  MAX_TITLE_LENGTH,
  NOTA_KIND,
  type EncabezadoNota,
} from "@/app/api/patient-documents/_lib/service";
import { VALUE_UNLINKED, type PreviewRow, type UnresolvedRef } from "./types";
import {
  BATCH,
  EMAIL_RE,
  ImportError,
  VALID_BLOOD,
  type EntityHandler,
  type ImportContext,
  last10,
  norm,
  normName,
  parseAmount,
  parseDate,
  parseGender,
  parsePhone,
} from "./engine";
import {
  MIGRATED_STATUS,
  calendarNoonUtc,
  cellText,
  dayKey,
  folioDeNotas,
  huellaDe,
  isFutureDay,
  mergeList,
  mergeText,
  migratedQuoteNotes,
  migratedTitle,
  migrationBannerHtml,
  newId,
  noteFingerprint,
  nombreOrigen,
  oneLine,
  sanitizeFdi,
  splitList,
  textToNoteHtml,
  type MarcaMigracion,
} from "./migrado";

const OPENING_BALANCE_NOTE = "Saldo inicial migrado";

// ---------------------------------------------------------------------------
// Resolución de paciente/doctor por nombre/teléfono/correo (dentro de la clínica).
// ---------------------------------------------------------------------------

interface PatientIndex {
  byPhone: Map<string, string[]>;
  byEmail: Map<string, string[]>;
  byName: Map<string, string[]>;
  /** Nombre completo tal como está en la ficha (para decir a QUIÉN va una fila). */
  nameById: Map<string, string>;
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
 *
 * Visibilidad por paciente (patient-visibility.ts): quien importa solo empareja
 * con los pacientes que PUEDE VER. Un paciente restringido que no le toca es,
 * para su archivo, «no encontrado» — ni se le escribe ni la vista previa delata
 * qué tiene. Los admins ven a todos. Sin viewer (no debería pasar: runImport
 * siempre lo pone) se trata como NO admin, que es lo restrictivo.
 */
async function loadPatientIndex(
  clinicId: string,
  viewer?: { userId: string; role: string },
): Promise<PatientIndex> {
  const patients = await prisma.patient.findMany({
    where: { clinicId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, visibleUserIds: true },
  });
  const idx: PatientIndex = { byPhone: new Map(), byEmail: new Map(), byName: new Map(), nameById: new Map() };
  const quien = { userId: viewer?.userId ?? "", role: viewer?.role ?? "", clinicId };
  for (const p of patients) {
    if (!canSeePatient(quien, p.visibleUserIds)) continue;
    idx.nameById.set(p.id, `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim());
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

/**
 * Resuelve por nombre exacto (normalizado) dentro de un índice nombre→ids.
 * `normalize` es normName (personas: quita "Dr."/"Dra."…) salvo que se diga
 * otra cosa: un procedimiento se normaliza con `norm`, porque "Drenaje" no
 * empieza por un honorífico. El índice tiene que armarse con el MISMO.
 */
function resolveByName(
  value: any,
  byName: Map<string, string[]>,
  label: string,
  normalize: (v: any) => string = normName,
): { id?: string; error?: string } {
  const shown = String(value).trim();
  const ids = byName.get(normalize(value));
  if (!ids || ids.length === 0) return { error: `${label} "${shown}" no encontrado en la clínica` };
  if (ids.length > 1) return { error: `Varios coinciden con ${label.toLowerCase()} "${shown}"` };
  return { id: ids[0] };
}

/**
 * Inserción por lotes con numeración secuencial (patientNumber / invoiceNumber) y
 * reintento ante carrera de unicidad (P2002). Devuelve el total creado.
 *
 * `lastSeq` devuelve el ÚLTIMO número ya emitido (no el conteo de filas): en un
 * lote de N el i-ésimo toma `lastSeq + 1 + i`, así que ni colisiona consigo
 * mismo ni reasigna folios liberados por bajas definitivas.
 */
async function insertNumbered(args: {
  rows: PreviewRow[];
  lastSeq: () => Promise<number>;
  numberField: string;
  format: (seq: number) => string;
  build: (slice: PreviewRow[]) => any[];
  create: (data: any[]) => Promise<{ count: number }>;
}): Promise<number> {
  const { rows, lastSeq, numberField, format, build, create } = args;
  let created = 0;
  const base = await lastSeq();
  rows.forEach((r, i) => { r.data[numberField] = format(base + 1 + i); });
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    try {
      created += (await create(build(slice))).count;
    } catch (e: any) {
      if (e?.code === "P2002") {
        // Carrera de numeración: renumera el slice y reintenta una vez en bloque.
        const fresh = await lastSeq();
        slice.forEach((r, j) => { r.data[numberField] = format(fresh + 1 + j); });
        try {
          created += (await create(build(slice))).count;
        } catch {
          created += await insertSliceByRow(slice, { lastSeq, numberField, format, build, create });
        }
      } else {
        // Error de DB ≠ P2002 (p. ej. FK P2003 si borraron patient/doctorId entre
        // dry-run y commit): NO abortamos el lote. Aislamos fila por fila para
        // insertar las válidas y marcar SOLO la mala como error (se reporta).
        created += await insertSliceByRow(slice, { lastSeq, numberField, format, build, create });
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
    lastSeq: () => Promise<number>;
    numberField: string;
    format: (seq: number) => string;
    build: (slice: PreviewRow[]) => any[];
    create: (data: any[]) => Promise<{ count: number }>;
  },
): Promise<number> {
  const { lastSeq, numberField, format, build, create } = args;
  let made = 0;
  for (const r of slice) {
    try {
      made += (await create(build([r]))).count;
    } catch (e: any) {
      if (e?.code === "P2002") {
        try {
          const fresh = await lastSeq();
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
  sheetNames: ["pacientes", "paciente", "patients"],
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

    // Tope de pacientes del plan. El createMany de abajo lo saltaba por
    // completo: un Básico (500) podía subir un Excel de 5 000 y quedarse con
    // todos. Mismo código de error que POST /api/patients
    // ("PLAN_LIMIT_PATIENTS", 402) y se rechaza el lote ENTERO antes de
    // insertar nada — mejor decir cuántos caben que importar a medias.
    // FAIL-OPEN: si no se puede leer el plan o contar, se deja pasar y se
    // loguea; una migración no puede morir por un error del gate.
    // Cuenta y tope salen de getPatientQuota (@/lib/patient-quota), el mismo
    // helper del contador de la lista y del POST — un solo criterio de cupo.
    try {
      const quota = await getPatientQuota(clinicId);
      if (!quota.unlimited) {
        const room = quota.remaining ?? 0;
        if (toInsert.length > room) {
          throw new ImportError(
            402,
            room === 0
              ? `Tu plan incluye hasta ${quota.max} pacientes y ya los tienes todos. Sube de plan para importar más.`
              : `Tu plan incluye hasta ${quota.max} pacientes y ya tienes ${quota.used}: solo caben ${room} más, y el archivo trae ${toInsert.length}. Sube de plan o recorta el archivo.`,
            undefined,
            "PLAN_LIMIT_PATIENTS",
          );
        }
      }
    } catch (e) {
      if (e instanceof ImportError) throw e;
      console.error("[import/patients] no se pudo validar el tope de pacientes, se deja pasar:", e);
    }

    const created = await insertNumbered({
      rows: toInsert,
      // Máximo folio emitido, NO el conteo: con huecos por bajas definitivas el
      // count+1 reasignaba un folio ya usado y el lote entero moría en P2002.
      lastSeq: async () => (await lastPatientFolio(clinicId)) ?? 0,
      numberField: "patientNumber",
      format: formatPatientNumber,
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
// SALDOS — por fila, el `tipo` decide el destino (el monto SIEMPRE se guarda
// positivo): "adeudo" (o vacío) → factura de apertura (Invoice PENDING, como
// antes); "favor" → saldo a favor (PatientCredit). Resuelve paciente por
// phone(last10)/email/nombre+apellido. SIN CFDI. Idempotente por tipo: adeudo =
// 1 factura de apertura por paciente; favor = no duplica un crédito migrado
// equivalente (mismo paciente + monto).
// ===========================================================================

/** source de los créditos creados por la migración (marca de idempotencia). */
const MIGRATED_SOURCE = "migrated";

/** Clave de equivalencia de un crédito migrado: paciente + monto (2 decimales). */
const creditKey = (patientId: string, amount: number) =>
  `${patientId}|${Math.abs(amount).toFixed(2)}`;

/**
 * Clasifica una fila de saldo en "credit" (a favor) o "debt" (adeudo). Si la
 * fila trae columna `tipo`, manda el texto ("favor"/"a favor"/"crédito"/"haber"/
 * "abono" = a favor; cualquier otro = adeudo). Sin `tipo`, decide el signo del
 * monto (negativo = a favor, convención documentada en parseAmount).
 */
function classifyBalance(rawType: any, amount: number): "credit" | "debt" {
  if (rawType !== undefined && rawType !== null && String(rawType).trim() !== "") {
    const n = norm(rawType);
    if (n.includes("favor") || n === "credito" || n === "credit" || n === "haber" || n === "abono") {
      return "credit";
    }
    return "debt";
  }
  return amount < 0 ? "credit" : "debt";
}

/**
 * Inserta PatientCredit por lotes, aislando fila por fila ante error de DB
 * (mismo patrón resiliente que appointmentsHandler.commit). Sin numeración.
 */
async function insertCredits(rows: PreviewRow[], clinicId: string): Promise<number> {
  const build = (slice: PreviewRow[]) =>
    slice.map((r) => ({
      clinicId,
      patientId: r.data.patientId as string,
      amount: r.data.amount as number,
      description: (r.data.description as string | null) ?? null,
      source: MIGRATED_SOURCE,
      ...(r.data.creditDate ? { creditDate: r.data.creditDate as Date } : {}),
    }));
  const createMany = (data: any[]) => prisma.patientCredit.createMany({ data, skipDuplicates: true });
  let made = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    try {
      made += (await createMany(build(slice))).count;
    } catch {
      // Error de DB en el bloque (p. ej. FK P2003 si borraron al paciente entre
      // dry-run y commit): NO abortamos el lote, aislamos fila por fila.
      for (const r of slice) {
        try {
          made += (await createMany(build([r]))).count;
        } catch (e2: any) {
          markRowError(r, e2);
        }
      }
    }
  }
  return made;
}

export const balancesHandler: EntityHandler = {
  entity: "balances",
  sheetNames: ["saldos", "saldo", "balances"],
  auditEntityType: "invoice",
  headerVariants: {
    name:        ["nombre", "nombredelpaciente", "paciente", "nombrecompleto", "nombres", "cliente"],
    lastName:    ["apellido", "apellidos", "lastname"],
    phone:       ["telefono", "celular", "whatsapp", "phone", "movil"],
    email:       ["email", "correo", "correoelectronico"],
    amount:      ["saldo", "monto", "adeudo", "balance", "saldopendiente", "deuda", "importe", "saldoactual", "porcobrar"],
    type:        ["tipo", "tiposaldo", "tipodesaldo", "movimiento", "tipomovimiento", "adeudoofavor", "naturaleza"],
    description: ["concepto", "descripcion", "motivo", "referencia", "detalle", "observaciones"],
    date:        ["fecha", "fechasaldo", "fechadelsaldo", "fechamovimiento", "fechacargo"],
  },

  validateMapping(campos) {
    if (!campos.has("amount")) return "Falta la columna de saldo/monto";
    if (!campos.has("phone") && !campos.has("email") && !campos.has("name")) {
      return "Falta una columna para identificar al paciente (teléfono, correo o nombre)";
    }
    return null;
  },

  async process(rows, clinicId, ctx) {
    const idx = await loadPatientIndex(clinicId, ctx);
    // Idempotencia ADEUDOS: pacientes con factura de apertura migrada.
    const existingOpening = await prisma.invoice.findMany({
      where: { clinicId, notes: OPENING_BALANCE_NOTE },
      select: { patientId: true },
    });
    const migratedInvoice = new Set(existingOpening.map((i) => i.patientId));
    // Idempotencia A FAVOR: créditos migrados (clave paciente|monto). Resiliente
    // si patient_credits aún no existe (se aplica a mano, sql/patient-credits.sql).
    const migratedCredit = new Set<string>();
    try {
      const existingCredits = await prisma.patientCredit.findMany({
        where: { clinicId, source: MIGRATED_SOURCE },
        select: { patientId: true, amount: true },
      });
      for (const c of existingCredits) migratedCredit.add(creditKey(c.patientId, c.amount));
    } catch (e: any) {
      if (e?.code !== "P2021" && e?.code !== "P2022") throw e;
    }

    const seenDebt = new Set<string>();   // patientId
    const seenCredit = new Set<string>(); // patientId|monto
    const out: PreviewRow[] = [];

    for (const { row, mapped } of rows) {
      const pr: PreviewRow = { row, data: {}, status: "ok", errors: [], warnings: [] };

      const parsed = parseAmount(mapped.amount);
      if (parsed === null) pr.errors.push(`Saldo inválido "${mapped.amount ?? ""}"`);
      else if (parsed === 0) pr.errors.push("Saldo en cero — nada que migrar");

      // Identidad: combina nombre + apellido (antes solo usaba `nombre`). El
      // índice byName se arma con `${firstName} ${lastName}`, así que el nombre
      // completo discrimina mejor entre homónimos de pila.
      const fullName = [mapped.name, mapped.lastName]
        .map((v) => (v == null ? "" : String(v).trim()))
        .filter(Boolean)
        .join(" ");
      const res = resolvePatient(fullName ? { ...mapped, name: fullName } : mapped, idx);
      if (res.error) pr.errors.push(res.error);

      if (pr.errors.length > 0) { pr.status = "error"; out.push(pr); continue; }

      // `tipo` decide el destino/signo; el monto se guarda SIEMPRE positivo.
      const kind = classifyBalance(mapped.type, parsed!);
      const amount = Math.abs(parsed!);

      pr.data = {
        patientId: res.id,
        amount,
        kind,
        name: fullName || (mapped.name ? String(mapped.name).trim() : undefined),
      };

      if (kind === "credit") {
        pr.data.description = mapped.description ? String(mapped.description).trim().slice(0, 300) : null;
        const d = parseDate(mapped.date);
        if (d) pr.data.creditDate = d; // si no, Prisma usa default(now())
        const key = creditKey(res.id!, amount);
        if (migratedCredit.has(key)) {
          pr.status = "duplicate"; pr.warnings.push("El paciente ya tiene este saldo a favor migrado");
        } else if (seenCredit.has(key)) {
          pr.status = "duplicate"; pr.warnings.push("Saldo a favor repetido en el archivo");
        } else {
          seenCredit.add(key);
        }
      } else {
        if (migratedInvoice.has(res.id!)) {
          pr.status = "duplicate"; pr.warnings.push("El paciente ya tiene saldo inicial migrado");
        } else if (seenDebt.has(res.id!)) {
          pr.status = "duplicate"; pr.warnings.push("Paciente repetido en el archivo");
        } else {
          seenDebt.add(res.id!);
        }
      }
      out.push(pr);
    }
    return out;
  },

  async commit(rows, clinicId, skipDuplicates) {
    const toInsert = pickInsertable(rows, skipDuplicates);
    if (toInsert.length === 0) return { created: 0, skipped: 0 };

    // Divide por tipo: adeudos → factura de apertura; a favor → PatientCredit.
    const debtRows = toInsert.filter((r) => r.data.kind !== "credit");
    const creditRows = toInsert.filter((r) => r.data.kind === "credit");
    let created = 0;

    if (debtRows.length > 0) {
      created += await insertNumbered({
        rows: debtRows,
        // Máximo folio emitido, NO el conteo (P0-2): con huecos (DRAFT borrados)
        // el count+1 reasignaba un folio ya usado — mismo arreglo que el
        // patientNumber de arriba, que ya cumple el contrato de lastSeq.
        lastSeq: async () => (await lastInvoiceFolio(clinicId)) ?? 0,
        numberField: "invoiceNumber",
        format: formatInvoiceNumber,
        build: (slice) => slice.map((r) => {
          // La factura de apertura pasa por la MISMA aritmética que el resto
          // (invoice-totals): ningún creador de facturas debe tener matemática
          // propia. El importe del CSV se redondea a centavos antes de guardarse
          // — la guarda del timbrado suma round2 por línea y un monto con 3+
          // decimales dejaba las columnas y los conceptos en números distintos.
          const amount = round2(r.data.amount as number);
          const items = [{ description: OPENING_BALANCE_NOTE, quantity: 1, unitPrice: amount, total: amount }];
          const subtotal = sumInvoiceItems(items);
          const { total } = computeInvoiceTotal(subtotal, 0, 0, true);
          return {
            clinicId,
            patientId: r.data.patientId,
            invoiceNumber: r.data.invoiceNumber,
            items,
            subtotal,
            discount: 0,
            total,
            paid: 0,
            balance: total,
            status: "PENDING" as any,
            notes: OPENING_BALANCE_NOTE,
          };
        }),
        create: (data) => prisma.invoice.createMany({ data, skipDuplicates: true }),
      });
    }

    if (creditRows.length > 0) {
      created += await insertCredits(creditRows, clinicId);
    }

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
  sheetNames: ["citas", "cita", "agenda", "appointments"],
  auditEntityType: "appointment",
  headerVariants: {
    name:     ["paciente", "nombre", "nombredelpaciente", "nombrecompleto", "cliente"],
    // La pestaña «Citas» de la plantilla trae «apellido» desde el principio, pero
    // este validador no lo conocía: sin teléfono, «María» nunca casaba con
    // «María Hernández». Se combina como en saldos (resolvePatientRow).
    lastName: ["apellido", "apellidos", "lastname"],
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

  async process(rows, clinicId, ctx) {
    const idx = await loadPatientIndex(clinicId, ctx);
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

      const pRes = resolvePatientRow(mapped, idx);
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
        patientName: pRes.fullName || undefined,
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


// ===========================================================================
// ENTIDADES CLÍNICAS — expedientes, notas de evolución y presupuestos.
//
// Las tres comparten tres reglas con saldos/citas:
//  · Solo completan pacientes QUE YA EXISTEN: se emparejan con loadPatientIndex
//    + resolvePatient (teléfono → correo → nombre + apellido). No crean pacientes.
//  · Leen en bloque (una consulta por tabla, nunca una por fila) y escriben por
//    lotes de BATCH, aislando fila por fila solo si el lote falla.
//  · Lo que llega de otro sistema es HISTORIA: fecha original, origen dicho, y
//    nada se hace pasar por firmado, cotizado ni cobrado aquí (ver migrado.ts).
// ===========================================================================

/** Columnas para identificar al paciente, comunes a las tres. */
const IDENTITY_VARIANTS: Record<string, string[]> = {
  name:     ["paciente", "nombre", "nombredelpaciente", "nombrecompleto", "nombres", "cliente"],
  lastName: ["apellido", "apellidos", "lastname", "apellidopaterno"],
  phone:    ["telefono", "celular", "whatsapp", "phone", "movil", "telefonocelular"],
  email:    ["email", "correo", "correoelectronico", "mail"],
};

const DOCTOR_VARIANTS = [
  "doctor", "doctora", "medico", "odontologo", "odontologa", "dentista", "profesional",
  "tratante", "atendio", "atendiopor", "realizadopor",
];

const NEED_IDENTITY = "Falta una columna para identificar al paciente (teléfono, correo o nombre)";

function hasIdentity(campos: Set<string>): boolean {
  return campos.has("phone") || campos.has("email") || campos.has("name");
}

/** Palabras de un nombre, sin acentos ni honoríficos: "Dra. María  Hernández" → [maria, hernandez]. */
function nameTokens(s: string): string[] {
  const fuera = new Set(["dr", "dra", "doctor", "doctora", "lic", "sr", "sra", "srita"]);
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t && !fuera.has(t));
}

/** ¿Dos nombres pueden ser la misma persona? Uno contiene todas las palabras del otro. */
function sameName(a: string, b: string): boolean {
  const x = nameTokens(a);
  const y = new Set(nameTokens(b));
  if (x.length === 0 || y.size === 0) return true; // sin nombre que comparar
  if (x.every((t) => y.has(t))) return true;
  const xs = new Set(x);
  return Array.from(y).every((t) => xs.has(t));
}

/**
 * resolvePatient con nombre + apellido juntos (mismo criterio que saldos: el
 * índice byName se arma así).
 *
 * `strict` (las entidades CLÍNICAS): el teléfono manda en resolvePatient, y en
 * una familia es común que la mamá registre su celular para los hijos. Si la
 * fila trae además un nombre y NO es el del paciente al que apunta el teléfono
 * (o el correo), la fila es un error: la nota de Juanito no puede entrar en el
 * expediente de su mamá. Un saldo o una cita se corrigen; un expediente mezclado, no.
 */
function resolvePatientRow(
  mapped: Record<string, any>,
  idx: PatientIndex,
  strict = false,
): { id?: string; error?: string; fullName: string } {
  const fullName = [mapped.name, mapped.lastName]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean)
    .join(" ");
  const res = resolvePatient(fullName ? { ...mapped, name: fullName } : mapped, idx);
  if (strict && res.id && fullName) {
    const enFicha = idx.nameById.get(res.id) ?? "";
    if (enFicha && !sameName(fullName, enFicha)) {
      return {
        error: `El teléfono o correo es de «${enFicha}», no de «${fullName}»: revisa la fila`,
        fullName,
      };
    }
  }
  return { ...res, fullName };
}

/**
 * Día de calendario de una celda, anclado al mediodía UTC (ver calendarNoonUtc).
 * "AAAA-MM-DD" se lee a mano: `new Date("2023-11-05")` es la medianoche UTC, y
 * leída con la hora LOCAL de un servidor al oeste de Greenwich caía el día 4.
 */
function parseCalendarDay(v: any): Date | null {
  if (typeof v === "string") {
    const iso = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
      const out = new Date(Date.UTC(y, m - 1, d, 12));
      return out.getUTCMonth() === m - 1 && out.getUTCDate() === d ? out : null;
    }
  }
  const d = parseDate(v);
  return d ? calendarNoonUtc(d) : null;
}

/** Ids distintos de las filas que resolvieron paciente. */
function patientIdsOf(rows: PreviewRow[]): string[] {
  return Array.from(new Set(rows.map((r) => r.data.patientId).filter(Boolean) as string[]));
}

// ===========================================================================
// EXPEDIENTES — los antecedentes del paciente, que en DaleControl viven EN la
// ficha (Patient): alergias, padecimientos, medicamentos, antecedentes
// heredofamiliares y personales no patológicos. Son los que imprime el
// expediente en PDF. Nunca se pisa lo capturado: las listas se SUMAN (sin
// repetir) y los textos se agregan debajo si traen algo nuevo. Una fila que no
// añade nada es "duplicado" (idempotencia: subir el archivo dos veces no cambia
// nada la segunda).
// ===========================================================================

type HistoryListField = "allergies" | "chronicConditions" | "currentMedications";
type HistoryTextField = "familyHistory" | "personalNonPathologicalHistory";
const HISTORY_LISTS: HistoryListField[] = ["allergies", "chronicConditions", "currentMedications"];
/** campo canónico del archivo → columna de Patient. */
const HISTORY_TEXTS: { campo: string; column: HistoryTextField }[] = [
  { campo: "familyHistory", column: "familyHistory" },
  { campo: "nonPathologicalHistory", column: "personalNonPathologicalHistory" },
];

interface HistoryState {
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  familyHistory: string | null;
  personalNonPathologicalHistory: string | null;
}

const HISTORY_CONFLICT = "El paciente cambió mientras se importaba: vuelve a subir el archivo para no pisar esos cambios";

/**
 * Escribe los antecedentes de un lote de pacientes en UNA sentencia (no hay un
 * `updateMany` de Prisma con valores distintos por fila). Candado optimista por
 * `updatedAt`: si alguien editó al paciente entre la lectura y esta escritura,
 * esa fila no se toca y se devuelve como no actualizada. Devuelve los ids
 * escritos. El `clinicId` va en el WHERE aunque los ids ya salieron de la
 * clínica: la regla de la casa no tiene excepciones.
 */
async function writeHistoryBatch(
  clinicId: string,
  now: Date,
  payload: Array<HistoryState & { id: string; updatedAt: string }>,
): Promise<Set<string>> {
  const json = JSON.stringify(payload);
  // La hora de ESTA escritura (no la del inicio de la importación): si no,
  // `updatedAt` podía quedar ANTES del valor que se acababa de leer.
  const nowIso = new Date(Math.max(Date.now(), now.getTime())).toISOString();
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "patients" AS p SET
      "allergies" = ARRAY(SELECT e.x FROM jsonb_array_elements_text(v.d->'allergies') WITH ORDINALITY AS e(x, i) ORDER BY e.i),
      "chronicConditions" = ARRAY(SELECT e.x FROM jsonb_array_elements_text(v.d->'chronicConditions') WITH ORDINALITY AS e(x, i) ORDER BY e.i),
      "currentMedications" = ARRAY(SELECT e.x FROM jsonb_array_elements_text(v.d->'currentMedications') WITH ORDINALITY AS e(x, i) ORDER BY e.i),
      "familyHistory" = v.d->>'familyHistory',
      "personalNonPathologicalHistory" = v.d->>'personalNonPathologicalHistory',
      "updatedAt" = ${nowIso}::timestamp(3)
    FROM jsonb_array_elements(${json}::jsonb) AS v(d)
    WHERE p."id" = v.d->>'id'
      AND p."clinicId" = ${clinicId}
      AND p."updatedAt" = (v.d->>'updatedAt')::timestamp(3)
    RETURNING p."id"
  `;
  return new Set(rows.map((r) => r.id));
}

export const medicalHistoryHandler: EntityHandler = {
  entity: "medicalHistory",
  auditEntityType: "patient",
  auditAction: "update",
  sheetNames: ["expedientes", "expediente", "antecedentes", "historiaclinica", "anamnesis", "fichaclinica"],
  headerVariants: {
    ...IDENTITY_VARIANTS,
    allergies: ["alergias", "alergia", "alergiasconocidas", "alergicoa", "allergies"],
    chronicConditions: [
      "padecimientos", "padecimientoscronicos", "enfermedades", "enfermedadescronicas",
      "enfermedadessistemicas", "antecedentespatologicos", "antecedentespersonalespatologicos",
      "diagnosticosprevios", "conditions",
    ],
    currentMedications: [
      "medicamentos", "medicamentosactuales", "medicacion", "medicacionactual", "farmacos",
      "tratamientofarmacologico", "medications",
    ],
    familyHistory: ["antecedentesfamiliares", "antecedentesheredofamiliares", "heredofamiliares", "familyhistory"],
    nonPathologicalHistory: [
      "antecedentesnopatologicos", "antecedentespersonalesnopatologicos", "nopatologicos", "habitos",
    ],
  },

  validateMapping(campos) {
    if (!hasIdentity(campos)) return NEED_IDENTITY;
    const any = HISTORY_LISTS.some((f) => campos.has(f)) || HISTORY_TEXTS.some((t) => campos.has(t.campo));
    if (!any) {
      return "Falta al menos una columna de antecedentes (alergias, padecimientos, medicamentos, heredofamiliares o no patológicos)";
    }
    return null;
  },

  async process(rows, clinicId, ctx) {
    const idx = await loadPatientIndex(clinicId, ctx);
    const out: PreviewRow[] = [];

    // 1ª pasada: paciente y valores de cada fila. Nada de base todavía.
    const parsed: Array<{ pr: PreviewRow; lists: Record<HistoryListField, string[]>; texts: Record<HistoryTextField, string> }> = [];
    for (const { row, mapped } of rows) {
      const pr: PreviewRow = { row, data: {}, status: "ok", errors: [], warnings: [] };
      const res = resolvePatientRow(mapped, idx, true);
      if (res.error) pr.errors.push(res.error);

      const lists = {} as Record<HistoryListField, string[]>;
      for (const f of HISTORY_LISTS) lists[f] = splitList(mapped[f]);
      const texts = {} as Record<HistoryTextField, string>;
      for (const t of HISTORY_TEXTS) texts[t.column] = cellText(mapped[t.campo]).slice(0, 5000);
      const empty = HISTORY_LISTS.every((f) => lists[f].length === 0) && Object.values(texts).every((v) => !v);
      if (empty) pr.errors.push("La fila no trae antecedentes");

      // El nombre que se enseña es el de la FICHA: a quién va a parar la fila.
      const name = (res.id && idx.nameById.get(res.id)) || res.fullName || undefined;
      pr.data = { patientId: res.id, name, phone: mapped.phone ? parsePhone(mapped.phone) : undefined };
      if (pr.errors.length > 0) pr.status = "error";
      parsed.push({ pr, lists, texts });
      out.push(pr);
    }

    // Lo que YA tiene cada paciente: una sola consulta para todos.
    const ids = patientIdsOf(out.filter((r) => r.status === "ok"));
    const current = new Map<string, HistoryState & { updatedAt: Date }>();
    if (ids.length > 0) {
      const found = await prisma.patient.findMany({
        where: { clinicId, id: { in: ids } },
        select: {
          id: true, updatedAt: true, allergies: true, chronicConditions: true, currentMedications: true,
          familyHistory: true, personalNonPathologicalHistory: true,
        },
      });
      for (const p of found) current.set(p.id, p);
    }

    // 2ª pasada: se suma fila a fila sobre el estado acumulado del paciente, así
    // dos filas del mismo paciente en el archivo se complementan.
    const state = new Map<string, HistoryState>();
    for (const { pr, lists, texts } of parsed) {
      if (pr.status !== "ok") continue;
      const id = pr.data.patientId as string;
      const base = current.get(id);
      if (!base) { pr.status = "error"; pr.errors.push("Paciente no encontrado en la clínica"); continue; }
      const prev: HistoryState = state.get(id) ?? {
        allergies: base.allergies ?? [],
        chronicConditions: base.chronicConditions ?? [],
        currentMedications: base.currentMedications ?? [],
        familyHistory: base.familyHistory,
        personalNonPathologicalHistory: base.personalNonPathologicalHistory,
      };
      const next: HistoryState = { ...prev };
      const added: Record<string, unknown> = {};
      for (const f of HISTORY_LISTS) {
        const m = mergeList(prev[f], lists[f]);
        next[f] = m.merged;
        if (m.added.length) added[f] = m.added;
      }
      for (const t of HISTORY_TEXTS) {
        const m = mergeText(prev[t.column], texts[t.column]);
        next[t.column] = m.value;
        if (m.changed) added[t.column] = texts[t.column];
      }
      state.set(id, next);
      pr.data.added = added;
      pr.data.next = next;
      pr.data.updatedAt = base.updatedAt.toISOString();
      if (Object.keys(added).length === 0) {
        pr.status = "duplicate";
        pr.warnings.push("El expediente ya tiene estos antecedentes");
      }
    }
    return out;
  },

  toPreview(r) {
    const { next: _next, updatedAt: _u, ...data } = r.data;
    return { ...r, data };
  },

  async commit(rows, clinicId, _skipDuplicates, ctx) {
    // Lo clínico NUNCA reimporta un duplicado, ni con «Omitir duplicados»
    // apagado: la misma nota, el mismo presupuesto o el mismo antecedente dos
    // veces no le sirven a nadie, y no se pueden borrar después.
    const toInsert = pickInsertable(rows, true);
    if (toInsert.length === 0) return { created: 0, skipped: 0 };

    // Un paciente = una escritura, con el estado de su ÚLTIMA fila (acumula las anteriores).
    const byPatient = new Map<string, PreviewRow[]>();
    for (const r of toInsert) {
      const id = r.data.patientId as string;
      const list = byPatient.get(id);
      if (list) list.push(r);
      else byPatient.set(id, [r]);
    }
    const entries = Array.from(byPatient.entries()).map(([id, list]) => {
      const last = list[list.length - 1];
      return { id, rows: list, payload: { id, updatedAt: last.data.updatedAt as string, ...(last.data.next as HistoryState) } };
    });

    let updated = 0;
    const fail = (list: PreviewRow[], msg: string) => {
      for (const r of list) { r.status = "error"; r.errors.push(msg); }
    };
    for (let i = 0; i < entries.length; i += BATCH) {
      const slice = entries.slice(i, i + BATCH);
      let written: Set<string>;
      try {
        written = await writeHistoryBatch(clinicId, ctx.now, slice.map((e) => e.payload));
      } catch {
        // El lote falló entero (dato raro en una fila): se aísla paciente por
        // paciente con el mismo candado, para escribir los buenos.
        written = new Set();
        for (const e of slice) {
          try {
            const r = await prisma.patient.updateMany({
              where: { id: e.id, clinicId, updatedAt: new Date(e.payload.updatedAt) },
              data: {
                allergies: e.payload.allergies,
                chronicConditions: e.payload.chronicConditions,
                currentMedications: e.payload.currentMedications,
                familyHistory: e.payload.familyHistory,
                personalNonPathologicalHistory: e.payload.personalNonPathologicalHistory,
              },
            });
            if (r.count > 0) written.add(e.id);
          } catch (e2: any) {
            fail(e.rows, rowDbErrorMessage(e2));
          }
        }
      }
      for (const e of slice) {
        if (written.has(e.id)) updated++;
        else if (e.rows.every((r) => r.status !== "error")) fail(e.rows, HISTORY_CONFLICT);
      }
    }
    const errored = entries.filter((e) => e.rows.some((r) => r.status === "error")).length;
    // Conteos por PACIENTE (un expediente = un paciente), no por fila.
    return { created: updated, skipped: Math.max(0, entries.length - updated - errored) };
  },
};

// ===========================================================================
// NOTAS DE EVOLUCIÓN — se escriben en la MISMA tabla que la «Nota de evolución»
// del panel (patient_documents, kind NOTA_EVOLUCION), no en un almacén aparte.
//
// 🔴 NOM-004: una nota de otro sistema no la firmó nadie aquí. Entra con
// status "MIGRATED" —ni DRAFT ni SIGNED—, y por eso ninguna ruta de ese módulo
// la puede editar, firmar ni enviar (editar y firmar solo encuentran DRAFT;
// enviar exige SIGNED). Lleva su fecha original (createdAt y la foto
// `encabezado.fecha`), el autor tal como venía, y la marca completa en
// `encabezado.migracion`. El cuerpo ABRE con un párrafo que lo dice en claro.
// ===========================================================================

/** Lo que se muestra del texto de una nota en la tabla de revisión. */
const NOTE_SNIPPET = 160;

export const clinicalNotesHandler: EntityHandler = {
  entity: "clinicalNotes",
  auditEntityType: "record",
  sheetNames: ["notas", "notasclinicas", "notasdeevolucion", "evoluciones", "evolucion", "notas_clinicas"],
  headerVariants: {
    ...IDENTITY_VARIANTS,
    date: ["fecha", "fechadeatencion", "fechaatencion", "fechanota", "fechaevolucion", "fechadelanota", "fechaconsulta", "date"],
    doctor: DOCTOR_VARIANTS,
    title: ["titulo", "asunto", "tiponota", "tipodenota", "motivo", "motivodeconsulta", "tipo"],
    text: [
      "nota", "notas", "texto", "evolucion", "evoluciones", "descripcion", "detalle", "observaciones",
      "notaclinica", "notadeevolucion", "contenido", "comentarios", "text",
    ],
  },

  validateMapping(campos) {
    if (!hasIdentity(campos)) return NEED_IDENTITY;
    if (!campos.has("date")) return "Falta la columna de fecha de la nota";
    if (!campos.has("text")) return "Falta la columna con el texto de la nota";
    return null;
  },

  async process(rows, clinicId, ctx) {
    const idx = await loadPatientIndex(clinicId, ctx);
    // Autor: cualquier usuario de la clínica, activo o no — el doctor que se fue
    // hace años sigue siendo el autor de sus notas viejas.
    const users = await prisma.user.findMany({
      where: { clinicId },
      select: { id: true, firstName: true, lastName: true },
    });
    const byDoctor = new Map<string, string[]>();
    const userName = new Map<string, string>();
    for (const u of users) {
      const full = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
      pushKey(byDoctor, normName(full), u.id);
      userName.set(u.id, full);
    }
    const seen = new Set<string>();
    const out: PreviewRow[] = [];

    for (const { row, mapped } of rows) {
      const pr: PreviewRow = { row, data: {}, status: "ok", errors: [], warnings: [] };
      const res = resolvePatientRow(mapped, idx, true);
      if (res.error) pr.errors.push(res.error);

      const fecha = parseCalendarDay(mapped.date);
      if (!fecha) pr.errors.push(`Fecha inválida "${cellText(mapped.date)}"`);
      else if (isFutureDay(fecha, ctx.now)) pr.errors.push(`La fecha ${dayKey(fecha)} es posterior a hoy`);

      const raw = cellText(mapped.text);
      if (!raw) pr.errors.push("Falta el texto de la nota");
      else if (raw.length > MAX_INPUT_LENGTH) pr.errors.push("La nota es demasiado larga");

      // Autor: si es un usuario de la clínica, se liga; si no, la nota queda a
      // cargo de quien importa y conserva el nombre original en la foto.
      const doctorRaw = oneLine(mapped.doctor, 120);
      let doctorId = ctx.userId;
      let doctorNombre = doctorRaw;
      if (doctorRaw) {
        const d = resolveByName(doctorRaw, byDoctor, "Doctor");
        if (d.id) { doctorId = d.id; doctorNombre = userName.get(d.id) || doctorRaw; }
        else pr.warnings.push(`${d.error}: la nota conserva ese nombre como autor original`);
      } else {
        pr.warnings.push("Sin doctor en el archivo: la nota queda sin autor original");
      }

      if (pr.errors.length > 0) {
        pr.status = "error";
        pr.data = { name: res.fullName || undefined, date: fecha ? dayKey(fecha) : undefined, doctorName: doctorNombre || undefined };
        out.push(pr);
        continue;
      }

      const day = dayKey(fecha!);
      const huella = noteFingerprint(res.id!, day, raw);
      const titulo = oneLine(mapped.title, MAX_TITLE_LENGTH) || "Nota de evolución";
      pr.data = {
        patientId: res.id,
        doctorId,
        name: idx.nameById.get(res.id!) || res.fullName || undefined,
        phone: mapped.phone ? parsePhone(mapped.phone) : undefined,
        date: day,
        createdAt: fecha,
        doctorName: doctorNombre || undefined,
        doctorOriginal: doctorRaw,
        title: titulo,
        text: raw,
        huella,
      };
      if (seen.has(huella)) {
        pr.status = "duplicate"; pr.warnings.push("Nota repetida en el archivo (mismo paciente, día y texto)");
      } else {
        seen.add(huella);
      }
      out.push(pr);
    }

    // Idempotencia contra la base: huellas de las notas YA migradas de estos
    // pacientes en el rango de fechas del archivo. Una consulta.
    const okRows = out.filter((r) => r.status === "ok");
    if (okRows.length > 0) {
      let min = okRows[0].data.createdAt as Date;
      let max = min;
      for (const r of okRows) {
        const d = r.data.createdAt as Date;
        if (d < min) min = d;
        if (d > max) max = d;
      }
      const existing = await prisma.patientDocument.findMany({
        where: {
          clinicId,
          kind: NOTA_KIND,
          status: MIGRATED_STATUS,
          patientId: { in: patientIdsOf(okRows) },
          createdAt: { gte: min, lte: max },
        },
        select: { encabezado: true },
      });
      const dbHuellas = new Set(existing.map((e) => huellaDe(e.encabezado)).filter(Boolean) as string[]);
      for (const r of okRows) {
        if (dbHuellas.has(r.data.huella)) {
          r.status = "duplicate"; r.warnings.push("Esta nota ya se había migrado");
        }
      }
    }
    return out;
  },

  toPreview(r) {
    const { text, ...data } = r.data;
    const snippet = typeof text === "string" && text.length > NOTE_SNIPPET ? `${text.slice(0, NOTE_SNIPPET)}…` : text;
    return { ...r, data: { ...data, ...(snippet ? { text: snippet } : {}) } };
  },

  async commit(rows, clinicId, _skipDuplicates, ctx) {
    // Lo clínico NUNCA reimporta un duplicado, ni con «Omitir duplicados»
    // apagado: la misma nota, el mismo presupuesto o el mismo antecedente dos
    // veces no le sirven a nadie, y no se pueden borrar después.
    const toInsert = pickInsertable(rows, true);
    if (toInsert.length === 0) return { created: 0, skipped: 0 };

    // La foto de la cabecera, armada en bloque: la clínica una vez y los
    // pacientes en una consulta (la nota nativa la arma por nota; aquí son miles).
    const [clinic, patients] = await Promise.all([
      prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { name: true, logoUrl: true, timezone: true, city: true, address: true, state: true, phone: true },
      }),
      prisma.patient.findMany({
        where: { clinicId, id: { in: patientIdsOf(toInsert) } },
        select: { id: true, firstName: true, lastName: true, patientNumber: true, curp: true, curpStatus: true },
      }),
    ]);
    const tz = consentTimeZone(clinic?.timezone);
    const limpio = (v: string | null | undefined): string | null => (v ?? "").trim() || null;
    const direccion = limpio(clinic?.address)
      ? [clinic?.address, clinic?.city, clinic?.state].map(limpio).filter(Boolean).join(", ")
      : null;
    const byId = new Map(patients.map((p) => [p.id, p]));
    const origen = nombreOrigen(ctx.originName);

    const build = (slice: PreviewRow[]) =>
      slice.map((r) => {
        const p = byId.get(r.data.patientId);
        const fecha = r.data.createdAt as Date;
        const doctorNombre = (r.data.doctorName as string | undefined) ?? "";
        const migracion: MarcaMigracion = {
          origen,
          fechaOriginal: r.data.date,
          doctorOriginal: r.data.doctorOriginal ?? "",
          importadoEl: ctx.now.toISOString(),
          importadoPor: ctx.userId,
          archivo: ctx.fileName,
          huella: r.data.huella,
        };
        const encabezado: EncabezadoNota & { migracion: MarcaMigracion } = {
          pacienteNombre: p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() : (r.data.name ?? ""),
          fecha: formatConsentDate(fecha, tz),
          clinicaNombre: clinic?.name ?? "",
          logoUrl: limpio(clinic?.logoUrl),
          doctorNombre,
          // La cédula NO se rellena: no consta con cuál se escribió allí, y la
          // foto nunca lleva un dato inventado (se omite la línea).
          cedula: null,
          clinicaDireccion: direccion,
          clinicaTelefono: limpio(clinic?.phone),
          doctorEspecialidad: null,
          doctorCedulaEspecialidad: null,
          pacienteNumero: limpio(p?.patientNumber),
          pacienteCurp: limpio(p?.curp)?.toUpperCase() ?? null,
          pacienteSinCurp: p?.curpStatus === "FOREIGN",
          migracion,
        };
        const body =
          migrationBannerHtml({ origen, fecha, timezone: tz, doctor: doctorNombre, importadoEl: ctx.now }) +
          textToNoteHtml(r.data.text);
        return {
          clinicId,
          patientId: r.data.patientId as string,
          doctorId: r.data.doctorId as string,
          templateId: null,
          kind: NOTA_KIND,
          // "Resina en 16 · migrada de Dentalink": la lista de notas se lee por el título.
          title: migratedTitle(r.data.title as string, origen, MAX_TITLE_LENGTH, "a"),
          body,
          encabezado: encabezado as any,
          status: MIGRATED_STATUS,
          signedAt: null,
          modoFirma: null,
          // La fecha ORIGINAL: la lista de notas se ordena por aquí. Cuándo se
          // importó queda en encabezado.migracion.importadoEl (y en updatedAt).
          createdAt: fecha,
        };
      });

    // Un cuerpo que tras sanear no deja nada que leer, o que se pasa del tope,
    // no se guarda: se reporta en su fila.
    const writable: PreviewRow[] = [];
    for (const r of toInsert) {
      const html = textToNoteHtml(r.data.text);
      if (isBlankHtml(html)) { r.status = "error"; r.errors.push("La nota está vacía"); continue; }
      if (html.length > MAX_BODY_LENGTH) { r.status = "error"; r.errors.push("La nota es demasiado larga"); continue; }
      writable.push(r);
    }

    const createMany = (data: any[]) => prisma.patientDocument.createMany({ data });
    let created = 0;
    for (let i = 0; i < writable.length; i += BATCH) {
      const slice = writable.slice(i, i + BATCH);
      try {
        created += (await createMany(build(slice))).count;
      } catch {
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

// ===========================================================================
// PRESUPUESTOS — cada fila es una LÍNEA (un procedimiento); las líneas se
// agrupan en un presupuesto por paciente + folio original (o paciente + día si
// el archivo no trae folio). Se escriben en quotes / quote_items, las mismas
// tablas del módulo Presupuestos, con la MISMA aritmética (computeTotals).
//
// 🔴 ES HISTORIA, NO UNA VENTA. Entra con status "MIGRATED", que ninguna
// lectura de dinero reconoce: la factura (POST /api/quotes/[id]/invoice) y el
// plan de tratamiento exigen ACCEPTED; Sabina solo mira PRESENTED/EXPIRED
// («sin respuesta») y ACCEPTED («dinero parado»); el vencimiento perezoso solo
// toca PRESENTED; no hay cron ni trigger sobre quotes. No se crea factura, ni
// CFDI, ni movimiento de caja, ni condiciones de pago.
//
// El procedimiento se casa con el tarifario de la clínica por nombre con la
// misma tolerancia que resolveByName (mayúsculas, acentos, espacios). Lo que
// no casa NO se inventa ni se tira: la línea entra con su nombre y su importe,
// sin ligar, y el usuario puede elegir el equivalente (valueMapping).
// ===========================================================================

/**
 * Mayor folio de presupuesto emitido en la clínica. ESPEJO de lastQuoteFolio
 * de src/lib/quotes/service.ts (privada allí): mismo criterio —último bloque de
 * dígitos, como número, con tope de longitud— para que los folios migrados y
 * los del panel sigan una sola secuencia.
 */
async function lastQuoteFolio(clinicId: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<{ max: bigint | number | null }[]>`
    SELECT MAX(CAST(digits AS BIGINT)) AS max
    FROM (
      SELECT substring("folio" from '([0-9]+)[^0-9]*$') AS digits
      FROM "quotes"
      WHERE "clinicId" = ${clinicId}
    ) s
    WHERE digits IS NOT NULL AND length(digits) <= ${MAX_INVOICE_FOLIO_DIGITS}
  `;
  const raw = rows[0]?.max ?? null;
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

const QUOTE_TITLE_MAX = 160;
const QUOTE_ITEM_NAME_MAX = 200;

/** Clave de un presupuesto ya migrado o por migrar (idempotencia). */
const quoteKeyByFolio = (patientId: string, folio: string) => `${patientId}|f:${norm(folio)}`;
const quoteKeyByDay = (patientId: string, day: string, total: number) => `${patientId}|d:${day}|${round2(total).toFixed(2)}`;

export const quotesHandler: EntityHandler = {
  entity: "quotes",
  auditEntityType: "quote",
  sheetNames: ["presupuestos", "presupuesto", "tratamientos", "planesdetratamiento", "planes"],
  headerVariants: {
    ...IDENTITY_VARIANTS,
    folio: [
      "folio", "numeropresupuesto", "numerodepresupuesto", "nopresupuesto", "nodepresupuesto", "npresupuesto",
      "idpresupuesto", "folioplan", "numerodeplan", "nplan", "idplan", "nodeplan",
    ],
    date: ["fecha", "fechapresupuesto", "fechadelpresupuesto", "fechacreacion", "fechaplan", "date"],
    title: ["titulo", "nombrepresupuesto", "nombredelpresupuesto", "nombreplan", "nombredelplan", "plandetratamiento", "presupuesto"],
    procedure: ["procedimiento", "prestacion", "servicio", "concepto", "tratamiento", "accion", "descripcion"],
    tooth: ["pieza", "diente", "piezadental", "dientes", "piezas", "fdi", "organodentario"],
    quantity: ["cantidad", "cant", "unidades", "qty"],
    price: ["precio", "preciounitario", "valor", "valorunitario", "arancel", "costo", "tarifa", "precioneto"],
    discount: ["descuento", "dcto", "desc", "descuentolinea"],
    total: ["total", "importe", "monto", "subtotal", "totallinea", "valortotal"],
    status: ["estado", "estatus", "status", "situacion"],
    doctor: DOCTOR_VARIANTS,
  },

  validateMapping(campos) {
    if (!hasIdentity(campos)) return NEED_IDENTITY;
    if (!campos.has("procedure")) return "Falta la columna del procedimiento";
    if (!campos.has("price") && !campos.has("total")) return "Falta la columna del precio o del importe";
    if (!campos.has("date")) return "Falta la columna de fecha del presupuesto";
    return null;
  },

  async process(rows, clinicId, ctx) {
    const idx = await loadPatientIndex(clinicId, ctx);
    const catalog = await prisma.procedureCatalog.findMany({
      where: { clinicId },
      select: { id: true, name: true },
    });
    const byProcedure = new Map<string, string[]>();
    for (const c of catalog) pushKey(byProcedure, norm(c.name), c.id);
    const catalogIds = new Set(catalog.map((c) => c.id));
    const chosen = ctx.valueMapping.procedure ?? {};

    // ── 1. Cada línea por su cuenta: importe, procedimiento, paciente y fecha ──
    interface Linea {
      pr: PreviewRow;
      mapped: Record<string, any>;
      patientId?: string;
      fecha: Date | null;
      folio: string;
      /** La línea no trae NINGUNA columna del paciente: lo hereda de su folio. */
      sinPaciente: boolean;
      procedure: string;
      quantity: number;
      unitPrice: number;
      discount: number;
      itemNotes: string | null;
    }
    const lineas: Linea[] = [];
    for (const { row, mapped } of rows) {
      const pr: PreviewRow = { row, data: {}, status: "ok", errors: [], warnings: [] };
      const folio = oneLine(mapped.folio, 40);
      const sinPaciente = !cellText(mapped.name) && !cellText(mapped.lastName) && !cellText(mapped.phone) && !cellText(mapped.email);

      // Paciente: una línea con folio y sin columnas de paciente lo hereda de las
      // demás líneas de su folio (muchos exports solo lo ponen en la primera).
      let patientId: string | undefined;
      if (!(sinPaciente && folio)) {
        const res = resolvePatientRow(mapped, idx, true);
        if (res.error) pr.errors.push(res.error);
        patientId = res.id;
      }
      // Fecha: igual, se hereda del folio si la línea no la trae.
      let fecha: Date | null = null;
      if (cellText(mapped.date) || !folio) {
        fecha = parseCalendarDay(mapped.date);
        if (!fecha) pr.errors.push(`Fecha inválida "${cellText(mapped.date)}"`);
        else if (isFutureDay(fecha, ctx.now)) { pr.errors.push(`La fecha ${dayKey(fecha)} es posterior a hoy`); fecha = null; }
      }

      const procedure = oneLine(mapped.procedure, QUOTE_ITEM_NAME_MAX);
      if (!procedure) pr.errors.push("Falta el procedimiento");

      // Cantidad: vacía = 1; si viene, entero ≥ 1.
      let quantity = 1;
      if (cellText(mapped.quantity)) {
        const q = Number(String(mapped.quantity).replace(",", "."));
        if (Number.isInteger(q) && q >= 1 && q <= 999) quantity = q;
        else pr.errors.push(`Cantidad inválida "${cellText(mapped.quantity)}"`);
      }
      const discount = cellText(mapped.discount) ? parseAmount(mapped.discount) : 0;
      if (discount === null || discount < 0) pr.errors.push(`Descuento inválido "${cellText(mapped.discount)}"`);
      const price = cellText(mapped.price) ? parseAmount(mapped.price) : null;
      const total = cellText(mapped.total) ? parseAmount(mapped.total) : null;
      if (cellText(mapped.price) && (price === null || price < 0)) pr.errors.push(`Precio inválido "${cellText(mapped.price)}"`);
      if (cellText(mapped.total) && (total === null || total < 0)) pr.errors.push(`Importe inválido "${cellText(mapped.total)}"`);
      if (!cellText(mapped.price) && !cellText(mapped.total)) pr.errors.push("Falta el precio de la línea");

      let unitPrice = 0;
      let itemNotes: string | null = null;
      // El precio se calcula aunque la fila tenga otro error: cada rama valida lo suyo.
      const d = round2(discount ?? 0);
      if (price !== null && price >= 0) {
        unitPrice = round2(price);
        const computed = round2(Math.max(0, unitPrice * quantity - d));
        if (unitPrice * quantity < d) pr.errors.push("El descuento es mayor que el importe de la línea");
        else if (total !== null && Math.abs(computed - round2(total)) > 0.01) {
          pr.warnings.push(`El importe del archivo (${round2(total).toFixed(2)}) no cuadra con precio × cantidad − descuento (${computed.toFixed(2)}); se usa el cálculo`);
        }
      } else if (total !== null && total >= 0) {
        // Solo el importe de la línea: precio = (importe + descuento) / cantidad
        // si sale exacto al centavo; si no, cantidad 1 y la original en la nota.
        const gross = round2(total + d);
        const each = round2(gross / quantity);
        if (quantity > 1 && round2(each * quantity) !== gross) {
          itemNotes = `Cantidad original: ${quantity}`;
          quantity = 1;
          unitPrice = gross;
        } else {
          unitPrice = each;
        }
      }
      lineas.push({ pr, mapped, patientId, fecha, folio, sinPaciente, procedure, quantity, unitPrice, discount: round2(discount ?? 0), itemNotes });
    }

    // ── 2. Presupuestos: por FOLIO original (único en el sistema de origen) o,
    //    sin folio, por paciente + día. El folio pone paciente y fecha a las
    //    líneas que no los traen, y si mezcla pacientes es un error del archivo.
    const grupos = new Map<string, Linea[]>();
    for (const l of lineas) {
      const k = l.folio
        ? `f:${norm(l.folio)}`
        : l.patientId && l.fecha ? `${l.patientId}|d:${dayKey(l.fecha)}` : null;
      if (!k) continue;
      const g = grupos.get(k);
      if (g) g.push(l);
      else grupos.set(k, [l]);
    }
    for (const [k, g] of Array.from(grupos.entries())) {
      if (!k.startsWith("f:")) continue;
      const folio = g[0].folio;
      const pacientes = new Set(g.filter((l) => l.patientId).map((l) => l.patientId!));
      if (pacientes.size > 1) {
        for (const l of g) l.pr.errors.push(`El folio ${folio} trae líneas de pacientes distintos`);
      } else if (pacientes.size === 1) {
        const pid = Array.from(pacientes)[0];
        for (const l of g) if (l.sinPaciente) l.patientId = pid;
      } else {
        for (const l of g) if (l.sinPaciente) l.pr.errors.push(`Ninguna línea del folio ${folio} identifica al paciente`);
      }
      const fechaGrupo = g.find((l) => l.fecha)?.fecha ?? null;
      for (const l of g) {
        if (l.fecha || cellText(l.mapped.date)) continue; // la suya (o su error) manda
        if (fechaGrupo) l.fecha = fechaGrupo;
        else l.pr.errors.push(`Ninguna línea del folio ${folio} trae la fecha`);
      }
    }

    // Un presupuesto entra COMPLETO o no entra: con una línea rota, su total
    // sería mentira. Se marca todo el grupo con la fila culpable.
    for (const g of Array.from(grupos.values())) {
      const rota = g.find((l) => l.pr.errors.length > 0);
      if (!rota) continue;
      for (const l of g) {
        if (l.pr.errors.length > 0) continue;
        l.pr.errors.push(`La fila ${rota.pr.row} de este presupuesto tiene error: el presupuesto entra completo o no entra`);
      }
    }

    // ── 3. Lo que queda en pie: procedimiento → tarifario, y los datos de la línea ──
    const out: PreviewRow[] = [];
    const grupoDe = new Map<Linea, string>();
    for (const [k, g] of Array.from(grupos.entries())) for (const l of g) grupoDe.set(l, k);
    for (const l of lineas) {
      const pr = l.pr;
      const name = (l.patientId && idx.nameById.get(l.patientId)) || undefined;
      if (pr.errors.length > 0) {
        pr.status = "error";
        pr.data = { name: name ?? (oneLine([l.mapped.name, l.mapped.lastName].filter(Boolean).join(" "), 120) || undefined), procedure: l.procedure || undefined };
        out.push(pr);
        continue;
      }

      // Primero la decisión del usuario; si no hay, el nombre con la tolerancia
      // de resolveByName; si no casa, sin ligar (y se ofrece elegir equivalente).
      const key = norm(l.procedure);
      let procedureId: string | null = null;
      const pick = chosen[key];
      if (pick && pick !== VALUE_UNLINKED) {
        if (catalogIds.has(pick)) procedureId = pick;
        else pr.warnings.push("El equivalente elegido ya no está en tu catálogo: la línea entra sin ligar");
      } else if (!pick) {
        const hit = resolveByName(l.procedure, byProcedure, "Procedimiento", norm);
        if (hit.id) procedureId = hit.id;
        else {
          const unresolved: UnresolvedRef = { field: "procedure", key, value: l.procedure };
          pr.unresolved = [unresolved];
          pr.warnings.push(`${hit.error}: entra con su nombre e importe, sin ligar (puedes elegir el equivalente)`);
        }
      }

      pr.data = {
        patientId: l.patientId,
        name,
        phone: l.mapped.phone ? parsePhone(l.mapped.phone) : undefined,
        groupKey: grupoDe.get(l),
        folioOriginal: l.folio,
        date: dayKey(l.fecha!),
        createdAt: l.fecha,
        title: oneLine(l.mapped.title, QUOTE_TITLE_MAX),
        statusOriginal: oneLine(l.mapped.status, 60),
        doctor: oneLine(l.mapped.doctor, 120),
        procedure: l.procedure,
        procedureId,
        toothFdi: sanitizeFdi(l.mapped.tooth),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
        lineTotal: round2(Math.max(0, l.unitPrice * l.quantity - l.discount)),
        itemNotes: l.itemNotes,
      };
      out.push(pr);
    }

    // Idempotencia: presupuestos YA migrados de estos pacientes (una consulta),
    // por folio original si lo hay y, si no, por día + total.
    const okRows = out.filter((r) => r.status === "ok");
    const dbKeys = new Set<string>();
    if (okRows.length > 0) {
      const existing = await prisma.quote.findMany({
        where: { clinicId, status: MIGRATED_STATUS, patientId: { in: patientIdsOf(okRows) } },
        select: { patientId: true, createdAt: true, total: true, notes: true },
      });
      for (const q of existing) {
        const f = folioDeNotas(q.notes);
        if (f) dbKeys.add(quoteKeyByFolio(q.patientId, f));
        dbKeys.add(quoteKeyByDay(q.patientId, dayKey(q.createdAt), Number(q.total)));
      }
    }
    const porGrupo = new Map<string, PreviewRow[]>();
    for (const r of okRows) {
      const k = r.data.groupKey as string;
      const g = porGrupo.get(k);
      if (g) g.push(r);
      else porGrupo.set(k, [r]);
    }
    for (const lines of Array.from(porGrupo.values())) {
      const first = lines[0].data;
      const sum = lines.reduce((a, l) => a + (l.data.lineTotal as number), 0);
      const dupKey = first.folioOriginal
        ? quoteKeyByFolio(first.patientId, first.folioOriginal)
        : quoteKeyByDay(first.patientId, first.date, sum);
      if (dbKeys.has(dupKey)) {
        for (const l of lines) { l.status = "duplicate"; l.warnings.push("Este presupuesto ya se había migrado"); }
      }
    }
    return out;
  },

  async valueOptions(clinicId) {
    const catalog = await prisma.procedureCatalog.findMany({
      where: { clinicId },
      select: { id: true, name: true, isActive: true },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });
    return {
      procedure: catalog.map((c) => ({ id: c.id, label: c.isActive ? c.name : `${c.name} (inactivo)` })),
    };
  },

  async commit(rows, clinicId, _skipDuplicates, ctx) {
    // Lo clínico NUNCA reimporta un duplicado, ni con «Omitir duplicados»
    // apagado: la misma nota, el mismo presupuesto o el mismo antecedente dos
    // veces no le sirven a nadie, y no se pueden borrar después.
    const toInsert = pickInsertable(rows, true);
    if (toInsert.length === 0) return { created: 0, skipped: 0 };

    const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } });
    const tz = consentTimeZone(clinic?.timezone);
    const origen = nombreOrigen(ctx.originName);

    // Una "fila" de insertNumbered por PRESUPUESTO; sus líneas cuelgan de data.lines.
    const groups = new Map<string, PreviewRow[]>();
    for (const r of toInsert) {
      const k = r.data.groupKey as string;
      const list = groups.get(k);
      if (list) list.push(r);
      else groups.set(k, [r]);
    }
    const headers: PreviewRow[] = Array.from(groups.values()).map((lines) => {
      lines.sort((a, b) => a.row - b.row);
      const first = lines[0].data;
      const pickFirst = (f: string) => (lines.find((l) => l.data[f])?.data[f] as string | undefined) ?? "";
      const totals = computeTotals(
        lines.map((l) => ({
          procedureId: l.data.procedureId,
          name: l.data.procedure,
          toothFdi: l.data.toothFdi,
          quantity: l.data.quantity,
          unitPrice: l.data.unitPrice,
          discount: l.data.discount,
          phase: null,
          notes: l.data.itemNotes,
        })),
        { discountPct: null, discountAmount: 0 },
      );
      return {
        row: lines[0].row,
        status: "ok" as const,
        errors: [],
        warnings: [],
        data: {
          id: newId(),
          lines,
          totals,
          patientId: first.patientId,
          createdAt: first.createdAt,
          title: migratedTitle(pickFirst("title") || "Presupuesto", origen, QUOTE_TITLE_MAX, "o"),
          notes: migratedQuoteNotes({
            origen,
            importadoEl: ctx.now,
            timezone: tz,
            folio: pickFirst("folioOriginal"),
            estado: pickFirst("statusOriginal"),
            doctor: pickFirst("doctor"),
          }),
        },
      };
    });

    const created = await insertNumbered({
      rows: headers,
      lastSeq: async () => (await lastQuoteFolio(clinicId)) ?? 0,
      numberField: "folio",
      format: formatFolio,
      build: (slice) =>
        slice.map((h) => ({
          quote: {
            id: h.data.id,
            clinicId,
            patientId: h.data.patientId,
            // Quien lo creó EN ESTE SISTEMA: el que importó. El doctor original va en las notas.
            createdById: ctx.userId,
            folio: h.data.folio,
            title: h.data.title,
            status: MIGRATED_STATUS,
            subtotal: h.data.totals.subtotal,
            discountPct: null,
            discountAmount: h.data.totals.discountAmount,
            total: h.data.totals.total,
            validUntil: null,
            notes: h.data.notes,
            createdAt: h.data.createdAt,
          },
          items: (h.data.totals.items as any[]).map((it, i) => ({
            id: newId(),
            quoteId: h.data.id,
            procedureId: it.procedureId ?? null,
            name: it.name,
            toothFdi: it.toothFdi ?? null,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            discount: it.discount,
            lineTotal: it.lineTotal,
            phase: null,
            notes: it.notes ?? null,
            sortOrder: i,
          })),
        })),
      // Cabecera y líneas en una transacción: o entra el presupuesto entero o nada.
      // Sin skipDuplicates: un choque de folio tiene que LANZAR P2002 para que
      // insertNumbered renumere, no saltarse la cabecera y dejar líneas huérfanas.
      create: async (data) => {
        const [q] = await prisma.$transaction([
          prisma.quote.createMany({ data: data.map((d: any) => d.quote) }),
          prisma.quoteItem.createMany({ data: data.flatMap((d: any) => d.items) }),
        ]);
        return { count: q.count };
      },
    });

    // El error de un presupuesto es el de todas sus líneas.
    for (const h of headers) {
      if (h.status !== "error") continue;
      for (const l of h.data.lines as PreviewRow[]) { l.status = "error"; l.errors.push(...h.errors); }
    }
    const errored = headers.filter((h) => h.status === "error").length;
    // Conteos por PRESUPUESTO, no por línea.
    return { created, skipped: Math.max(0, headers.length - created - errored) };
  },
};

export const HANDLERS: Record<string, EntityHandler> = {
  patients: patientsHandler,
  balances: balancesHandler,
  appointments: appointmentsHandler,
  medicalHistory: medicalHistoryHandler,
  clinicalNotes: clinicalNotesHandler,
  quotes: quotesHandler,
};
