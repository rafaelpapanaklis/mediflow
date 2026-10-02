// Tratamientos de ORTODONCIA de Dentalink → CASOS vivos del módulo (ws1-t12). El enganche único de
// treatmentPlansHandler llama a `marcarCasosDeOrtodoncia` (process) y `commitCasosDeOrtodoncia` (commit); todo lo
// demás vive aquí y en ortodoncia-caso.ts (la parte pura: técnica, estado, modo de cobro, controles, pagos).
//
// Por cada tratamiento de ortodoncia (esOrtodonciaDentalink) crea, en UNA transacción:
//   diagnóstico mínimo + plan (técnica, estado, doctor, fechas) + 6 fases + una hoja de control por cada control HECHO
//   + su factura (el cargo del control) + la factura de la colocación/tratamiento + una de extras + los pagos
//   MIGRADOS (nunca `payments`: Caja y Finanzas suman todos los Payment por fecha).
// Después, en pasos tolerantes (SQL crudo con sonda, nunca revierten el caso): modo de cobro del caso, nombre propio
// de la técnica, y la liga de las facturas al caso (`invoices.orthodonticTreatmentPlanId`).
//
// Sin duplicar: el «# Tratamiento» queda en import_external_ids ('ortho_case' → id del plan) y cada control en
// 'ortho_control' («# Tratamiento|día» → id de la hoja), la clave que comparte con el importador de citas (05).
// Aislamiento: TODA consulta lleva el clinicId de la sesión.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lastInvoiceFolio } from "@/lib/invoices/next-invoice-number";
import { formatInvoiceNumber } from "@/lib/invoices/next-invoice-number-core";
import { invoiceFieldsFromQuote } from "@/lib/quotes/invoice-from-quote-core";
import { PHASE_ORDER } from "@/lib/orthodontics/phase-machine";
import { CHECK_DURACION_Y_COSTO, esViolacionDelCheckDelPlan, mensajeDelCheckDelPlan } from "@/lib/orthodontics/check-del-caso";
import { isMissingColumnError } from "@/lib/orthodontics/alta-caso-tolerance";
import { guardarModoDeCobroDelCaso } from "@/lib/orthodontics/billing-mode-db";
import { guardarNombreDeTecnicaDelCaso, leerTecnicasDeLaClinica } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import { existeColumnaDeFacturasDelCaso } from "@/lib/orthodontics/cobro/extras-db";
import { marcaDeControlDeHoja } from "@/lib/orthodontics/cobro/control-sin-cita";
import type { PreviewRow } from "../types";
import type { ImportContext } from "../engine";
import { newId, nombreOrigen } from "../migrado";
import { claveControlCaso, cargarCasosOrto, cargarControlesOrto, guardarControlesOrto, guardarExternosDe, ENTIDAD_CASO_ORTO } from "./control-ortodoncia";
import { esOrtodonciaDentalink } from "./es-ortodoncia";
import { armarCaso, resumenDelCaso, type CargoDelCaso, type EntradaDelCaso, type PlanDelCaso } from "./ortodoncia-caso";

/** Solo el sistema de origen Dentalink usa este camino (los «# Tratamiento» son suyos). */
const ORIGEN_DENTALINK = "dentalink";
/** Marca del diagnóstico mínimo: no es un examen, es el hueco que exige el modelo. */
export const MARCA_DIAGNOSTICO_MIGRADO = "Migrado de Dentalink — sin datos clínicos";

const MSG_SIN_TABLA_EXTERNOS =
  "Falta aplicar sql/import-ids-externos.sql: sin él no se puede recordar qué casos de ortodoncia ya entraron y un reintento los duplicaría";

// ---------------------------------------------------------------------------
// process(): qué filas son un caso de ortodoncia
// ---------------------------------------------------------------------------

function agruparPorTratamiento(filas: PreviewRow[]): Map<string, PreviewRow[]> {
  const grupos = new Map<string, PreviewRow[]>();
  for (const r of filas) {
    const k = String(r.data.groupKey ?? "");
    if (!k) continue;
    const g = grupos.get(k);
    if (g) g.push(r); else grupos.set(k, [r]);
  }
  for (const g of Array.from(grupos.values())) g.sort((a, b) => a.row - b.row);
  return grupos;
}

const primero = <T>(g: PreviewRow[], campo: string): T | undefined =>
  g.find((r) => r.data[campo] !== undefined && r.data[campo] !== null && r.data[campo] !== "")?.data[campo] as T | undefined;

/** Lo que `esOrtodonciaDentalink` lee de un renglón ya mapeado. */
const renglonCrudo = (r: PreviewRow) => ({ procedure: r.data.procedure, categoria: r.data.categoria, especialidad: r.data.especialidad });

export function entradaDelCaso(g: PreviewRow[], tecnicas: EntradaDelCaso["tecnicasPropias"]): EntradaDelCaso {
  const first = g[0].data;
  const abonado = g.find((r) => typeof r.data.abonado === "number")?.data.abonado as number | undefined;
  return {
    folio: String(first.folioOriginal ?? ""),
    patientId: String(first.patientId),
    doctorId: String(primero<string>(g, "doctorId") ?? ""),
    doctorName: String(primero<string>(g, "doctorName") ?? ""),
    estadoTratamiento: (primero<"activo" | "finalizado">(g, "estadoTratamiento") ?? null) as EntradaDelCaso["estadoTratamiento"],
    abonadoTratamiento: abonado ?? null,
    generado: first.createdAt as Date,
    tecnicasPropias: tecnicas,
    renglones: g.map((r) => ({
      row: r.row,
      procedure: String(r.data.procedure ?? ""),
      categoria: String(r.data.categoria ?? ""),
      lineTotal: Number(r.data.lineTotal) || 0,
      quantity: Number(r.data.quantity) || 1,
      unitPrice: Number(r.data.unitPrice) || 0,
      discount: Number(r.data.discount) || 0,
      hecho: r.data.hecho === true && r.data.fechaRealizado instanceof Date,
      fechaRealizado: r.data.fechaRealizado instanceof Date ? (r.data.fechaRealizado as Date) : null,
      abonadoLinea: typeof r.data.abonadoLinea === "number" ? (r.data.abonadoLinea as number) : null,
      itemNotes: (r.data.itemNotes as string | null | undefined) ?? null,
    })),
  };
}

/**
 * process(): marca `data.ortoCaso` en las filas de cada tratamiento de ortodoncia (con folio, de Dentalink, en una
 * clínica con el módulo de Ortodoncia contratado), avisa de lo que entrará y descarta lo ya importado. No consulta la
 * base si el archivo no trae ninguno. Fuera de esas condiciones no toca nada: el tratamiento entra como siempre.
 */
export async function marcarCasosDeOrtodoncia(filas: PreviewRow[], clinicId: string, ctx: ImportContext): Promise<void> {
  if (ctx.originId !== ORIGEN_DENTALINK) return;
  const candidatas = filas.filter((r) => r.status === "ok" && r.data.ortoCaso !== true && String(r.data.folioOriginal ?? "").trim() !== "");
  const grupos = Array.from(agruparPorTratamiento(candidatas).values()).filter((g) => esOrtodonciaDentalink(g.map(renglonCrudo)));
  if (grupos.length === 0) return;

  // Import dinámico (mismo criterio que ortho-casos/handler.ts): access.ts lleva `import "server-only"`.
  const { hasActiveOrthodonticsModule } = await import("@/lib/orthodontics/access");
  if (!(await hasActiveOrthodonticsModule(clinicId, ctx.now))) {
    for (const g of grupos) g[0].warnings.push("Es un tratamiento de ortodoncia, pero el módulo de Ortodoncia no está activo en esta clínica: entra como tratamiento dental");
    return;
  }

  const casos = await cargarCasosOrto(clinicId, ctx.originId);
  const tecnicas = (await leerTecnicasDeLaClinica(clinicId)).tecnicas;

  for (const g of grupos) {
    if (!casos.disponible) {
      for (const r of g) { r.status = "error"; r.errors.push(MSG_SIN_TABLA_EXTERNOS); }
      continue;
    }
    const folio = String(g[0].data.folioOriginal);
    for (const r of g) {
      r.data.ortoCaso = true;
      // Un caso de ortodoncia no usa el catálogo de prestaciones: no hay equivalente que elegir.
      r.unresolved = r.unresolved?.filter((u) => u.field !== "procedure");
      if (r.unresolved && r.unresolved.length === 0) delete r.unresolved;
      r.warnings = r.warnings.filter((w) => !/sin ligar|se agregará al catálogo/.test(w));
      // Un renglón dental dentro del presupuesto de ortodoncia puede compartir nombre con una prestación que sí se
      // agrega al catálogo: aquí no se agrega nada, el renglón viaja como cargo del caso.
      delete r.data.catalogo;
      r.data.procedureId = null;
    }
    if (casos.mapa.has(folio)) {
      for (const r of g) { r.status = "duplicate"; r.warnings.push("Este caso de ortodoncia ya se importó antes"); }
      continue;
    }
    const plan = armarCaso(entradaDelCaso(g, tecnicas));
    g[0].warnings.push(resumenDelCaso(plan), ...plan.avisos);
  }
}

// ---------------------------------------------------------------------------
// commit(): los registros de un caso (puro: se prueba sin base)
// ---------------------------------------------------------------------------

export interface RegistrosDelCaso {
  diagnostico: Record<string, unknown>;
  plan: Record<string, unknown>;
  fases: Record<string, unknown>[];
  hojas: Record<string, unknown>[];
  facturas: Record<string, unknown>[];
  pagosMigrados: Record<string, unknown>[];
  /** Facturas que se ligan al caso por `invoices.orthodonticTreatmentPlanId` (controles y extras). */
  facturasLigadas: string[];
  /** «# Tratamiento|día» → id de la hoja, para 'ortho_control'. */
  clavesDeControl: Array<{ externalId: string; localId: string }>;
  ids: { diagnostico: string; plan: string };
}

export interface OpcionesDeRegistros {
  clinicId: string;
  userId: string;
  origen: string;
  ahora: Date;
  /** Primer número de factura libre (`MF-####` = formato de la clínica). */
  primerNumero: number;
  patientId: string;
  doctorId: string;
  /** Controles que 05 ya trajo como cita: «# Tratamiento|día» → id de la cita, ya verificada. */
  citasDeControl?: ReadonlyMap<string, { citaId: string; conFactura: boolean }>;
  /** false = la base no tiene aún alguna columna opcional (doctor tratante, liga de factura, cita de la hoja). */
  columnasOpcionales?: boolean;
}

const HOJA_S = "Visita migrada de Dentalink";
const SIN_DATO = "histórico administrativo";

export function construirRegistros(p: PlanDelCaso, o: OpcionesDeRegistros): RegistrosDelCaso {
  const opcionales = o.columnasOpcionales !== false;
  const diagnosticoId = newId("OrthodonticDiagnosis");
  const planId = newId("OrthodonticTreatmentPlan");
  let numero = o.primerNumero;
  const facturas: Record<string, unknown>[] = [];
  const pagosMigrados: Record<string, unknown>[] = [];
  const facturasLigadas: string[] = [];

  const nuevaFactura = (c: CargoDelCaso, extra: { notes: string; appointmentId?: string }): string => {
    const id = newId("Invoice");
    const campos = invoiceFieldsFromQuote({
      discountAmount: 0,
      items: c.items.map((it) => ({ name: it.name, toothFdi: null, quantity: it.quantity, unitPrice: it.unitPrice, discount: it.discount })),
    });
    const pagado = Math.min(c.pagado, campos.total);
    const saldo = Math.max(0, Math.round((campos.total - pagado) * 100) / 100);
    const status = campos.total > 0 && saldo <= 0.004 ? "PAID" : pagado > 0 ? "PARTIAL" : "PENDING";
    facturas.push({
      id,
      clinicId: o.clinicId,
      patientId: o.patientId,
      doctorId: o.doctorId,
      invoiceNumber: formatInvoiceNumber(numero++),
      items: campos.items,
      subtotal: campos.subtotal,
      discount: campos.discount,
      total: campos.total,
      paid: pagado,
      balance: saldo,
      status,
      notes: extra.notes,
      createdAt: c.fecha,
      paidAt: status === "PAID" ? c.fecha : null,
      ...(extra.appointmentId ? { appointmentId: extra.appointmentId } : {}),
    });
    if (pagado > 0) {
      pagosMigrados.push({
        id: newId("MigratedPayment"),
        clinicId: o.clinicId,
        patientId: o.patientId,
        amount: pagado,
        method: null,
        concept: `Pago migrado — ${c.concepto} (# Tratamiento ${p.folio})`.slice(0, 200),
        doctorId: o.doctorId,
        paidAt: c.fecha,
        origin: o.origen,
        createdById: o.userId,
      });
    }
    return id;
  };

  const principalId = p.principal
    ? nuevaFactura(p.principal, { notes: `Migrado de Dentalink (# Tratamiento ${p.folio}): ${p.billingMode === "PAGO_POR_CONTROL" ? "colocación / enganche" : "tratamiento completo"} del caso de ortodoncia.` })
    : null;

  const hojas: Record<string, unknown>[] = [];
  const clavesDeControl: Array<{ externalId: string; localId: string }> = [];
  for (const c of p.controles) {
    const hojaId = newId("OrthoTreatmentCard");
    const clave = claveControlCaso(p.folio, c.dia);
    const cita = clave ? o.citasDeControl?.get(clave) : undefined;
    hojas.push({
      id: hojaId,
      treatmentPlanId: planId,
      patientId: o.patientId,
      clinicId: o.clinicId,
      cardNumber: c.cardNumber,
      visitDate: c.fecha,
      durationMin: 30,
      phaseKey: c.phaseKey,
      monthAt: c.monthAt,
      soapS: `${HOJA_S} · ${c.nombre}.`,
      soapO: `Sin exploración registrada (${SIN_DATO}).`,
      soapA: `Sin valoración registrada (${SIN_DATO}).`,
      soapP: `Sin plan registrado (${SIN_DATO}).`,
      status: "SIGNED",
      signedAt: c.fecha,
      ...(cita && opcionales ? { appointmentId: cita.citaId } : {}),
    });
    // La clave del control la deja quien llega primero: si 05 ya trajo la cita, su clave manda y no se pisa.
    if (clave && !cita) clavesDeControl.push({ externalId: clave, localId: hojaId });
    if (c.cargo) {
      const facturaId = nuevaFactura(c.cargo, {
        notes: `${marcaDeControlDeHoja(hojaId)} Control de ortodoncia migrado de Dentalink (# Tratamiento ${p.folio}) · ${c.nombre}.`,
        ...(cita && opcionales && !cita.conFactura ? { appointmentId: cita.citaId } : {}),
      });
      facturasLigadas.push(facturaId);
    }
  }
  if (p.extras) {
    facturasLigadas.push(nuevaFactura(p.extras, { notes: `Migrado de Dentalink (# Tratamiento ${p.folio}): extras y otros cargos del presupuesto de ortodoncia.` }));
  }

  // ── Fases: 6, como createTreatmentPlan; su avance sigue el estado del caso ───────────────────────
  const inicio = p.installedAt;
  const fases = PHASE_ORDER.map((phaseKey, i) => {
    const esRetencion = phaseKey === "RETENTION";
    let status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" = "NOT_STARTED";
    let startedAt: Date | null = null;
    let completedAt: Date | null = null;
    if (p.status === "COMPLETED") {
      status = "COMPLETED"; startedAt = inicio; completedAt = p.ultimaActividad;
    } else if (p.status === "RETENTION") {
      const retDesde = p.controles.find((c) => c.esContencion)?.fecha ?? p.ultimaActividad;
      if (esRetencion) { status = "IN_PROGRESS"; startedAt = retDesde; }
      else { status = "COMPLETED"; startedAt = inicio; completedAt = retDesde; }
    } else if (p.status === "IN_PROGRESS" && i === 0) {
      status = "IN_PROGRESS"; startedAt = inicio;
    }
    return { id: newId("OrthodonticPhase"), treatmentPlanId: planId, clinicId: o.clinicId, phaseKey, orderIndex: i, status, startedAt, completedAt };
  });

  const diagnostico = {
    id: diagnosticoId,
    patientId: o.patientId,
    clinicId: o.clinicId,
    diagnosedById: o.userId,
    diagnosedAt: p.installedAt ?? p.ultimaActividad,
    // Valores neutros: son los mismos con los que arranca el formulario de «Abrir caso»; el modelo los exige y
    // Dentalink no exporta el examen. La marca y el resumen dicen que NO son mediciones.
    angleClassRight: "CLASS_I",
    angleClassLeft: "CLASS_I",
    overbiteMm: 2,
    overbitePercentage: 20,
    overjetMm: 2,
    dentalPhase: "PERMANENT",
    etiologyNotes: MARCA_DIAGNOSTICO_MIGRADO,
    clinicalSummary:
      `Caso migrado de Dentalink (# Tratamiento ${p.folio}) sin diagnóstico clínico registrado. La clase de Angle, la sobremordida y el resalte ` +
      "de este diagnóstico son valores neutros de migración, no mediciones: se completan en la próxima consulta.",
  };

  const plan = {
    id: planId,
    diagnosisId: diagnosticoId,
    patientId: o.patientId,
    clinicId: o.clinicId,
    technique: p.technique,
    techniqueNotes: p.techniqueNotes,
    estimatedDurationMonths: p.estimatedDurationMonths,
    startDate: p.startDate,
    installedAt: p.installedAt,
    prescriptionNotes: p.prescriptionNotes,
    totalCostMxn: p.totalCostMxn,
    anchorageType: "MODERATE",
    extractionsRequired: false,
    extractionsTeethFdi: [] as number[],
    iprRequired: false,
    tadsRequired: false,
    treatmentObjectives: "AESTHETIC_AND_FUNCTIONAL",
    retentionPlanText: "Plan de retención sin registrar (caso migrado de Dentalink): se define al llegar a la etapa de retención.",
    status: p.status,
    statusUpdatedAt: p.status === "COMPLETED" ? p.ultimaActividad : o.ahora,
    ...(opcionales ? { treatingDoctorId: o.doctorId, ...(principalId ? { invoiceId: principalId } : {}) } : {}),
  };

  return { diagnostico, plan, fases, hojas, facturas, pagosMigrados, facturasLigadas, clavesDeControl, ids: { diagnostico: diagnosticoId, plan: planId } };
}

// ---------------------------------------------------------------------------
// commit(): escribir
// ---------------------------------------------------------------------------

/** Las citas que 05 ya dejó para estos controles (su clave apunta a una cita de ESTA clínica, sin hoja ni factura). */
async function citasYaImportadas(
  clinicId: string,
  claves: ReadonlyMap<string, string>,
  tomadas: Set<string>,
): Promise<Map<string, { citaId: string; conFactura: boolean }>> {
  const salida = new Map<string, { citaId: string; conFactura: boolean }>();
  const ids = Array.from(new Set(claves.values()));
  if (ids.length === 0) return salida;
  try {
    const citas = await prisma.appointment.findMany({ where: { clinicId, id: { in: ids } }, select: { id: true } });
    const existen = new Set(citas.map((c: { id: string }) => c.id));
    if (existen.size === 0) return salida;
    const facturas = await prisma.invoice.findMany({ where: { clinicId, appointmentId: { in: Array.from(existen) } }, select: { appointmentId: true } });
    const conFactura = new Set(facturas.map((f: { appointmentId: string | null }) => f.appointmentId));
    // La columna de la hoja puede no existir todavía (sql/ortodoncia-nucleo.sql): entonces no se liga ninguna.
    const hojas = await prisma.orthoTreatmentCard.findMany({ where: { clinicId, appointmentId: { in: Array.from(existen) } }, select: { appointmentId: true } });
    const conHoja = new Set(hojas.map((h: { appointmentId: string | null }) => h.appointmentId));
    for (const [clave, citaId] of Array.from(claves.entries())) {
      if (!existen.has(citaId) || conHoja.has(citaId) || tomadas.has(citaId)) continue;
      tomadas.add(citaId);
      salida.set(clave, { citaId, conFactura: conFactura.has(citaId) });
    }
  } catch (e) {
    console.warn("[import/ortho-caso] no se pudieron leer las citas ya importadas; las hojas quedan sin cita:", e);
    salida.clear();
  }
  return salida;
}

async function escribirCaso(r: RegistrosDelCaso): Promise<void> {
  await prisma.$transaction([
    prisma.orthodonticDiagnosis.createMany({ data: [r.diagnostico as any] }),
    ...(r.facturas.length ? [prisma.invoice.createMany({ data: r.facturas as any[] })] : []),
    prisma.orthodonticTreatmentPlan.createMany({ data: [r.plan as any] }),
    prisma.orthodonticPhase.createMany({ data: r.fases as any[] }),
    ...(r.hojas.length ? [prisma.orthoTreatmentCard.createMany({ data: r.hojas as any[] })] : []),
    ...(r.pagosMigrados.length ? [prisma.migratedPayment.createMany({ data: r.pagosMigrados as any[] })] : []),
  ]);
}

async function ligarFacturas(clinicId: string, planId: string, facturaIds: string[]): Promise<"ok" | "sin-columna" | "error"> {
  if (facturaIds.length === 0) return "ok";
  if (!(await existeColumnaDeFacturasDelCaso())) return "sin-columna";
  try {
    await prisma.$executeRaw`
      UPDATE "invoices" SET "orthodonticTreatmentPlanId" = ${planId}
       WHERE "clinicId" = ${clinicId} AND "id" IN (${Prisma.join(facturaIds)})`;
    return "ok";
  } catch (e) {
    console.warn("[import/ortho-caso] no se pudieron ligar las facturas al caso:", e);
    return "error";
  }
}

/** El código de error de la base (Prisma «P2003» o Postgres «23514»), si el error lo trae; nunca el detalle de la fila. */
export function codigoDeLaBase(e: any): string | null {
  const valido = (c: unknown): c is string => typeof c === "string" && /^(P\d{4}|\d{2}[0-9A-Z]{3})$/.test(c);
  // El de Postgres (más útil: 23514, 42P01) antes que el envoltorio de Prisma (P2010, P2004…).
  const postgres = [e?.meta?.code, e?.cause?.code].find(valido);
  if (postgres) return postgres;
  // Prisma no siempre trae el código en un campo: en el texto va como «Code: `42P01`» (P2010) o, en un error
  // desconocido de la consulta, como «PostgresError { code: "23514", …» (medido contra la base real, 29-sep-2026).
  const enTexto = typeof e?.message === "string" ? /Code: `([0-9A-Z]{5})`|PostgresError \{ code: "([0-9A-Z]{5})"/.exec(e.message) : null;
  if (enTexto) return enTexto[1] ?? enTexto[2];
  return valido(e?.code) ? e.code : null;
}

/**
 * El motivo que ve quien importa, por caso: nombra el tratamiento y, si la base rechazó el caso por una restricción,
 * cuál y con qué valor (nunca el volcado de la fila: trae ids y datos del paciente).
 */
export function mensajeDeError(e: any, plan?: PlanDelCaso): string {
  const de = plan ? `Tratamiento #${plan.folio}: ` : "";
  if (e?.code === "P2003") return `${de}No se pudo guardar el caso: el paciente o el doctor ya no existe`;
  if (e?.code === "P2002") return `${de}No se pudo guardar el caso: número de factura repetido, reintenta`;
  if (esViolacionDelCheckDelPlan(e)) {
    const detalle = plan
      ? mensajeDelCheckDelPlan({ estimatedDurationMonths: plan.estimatedDurationMonths, totalCostMxn: plan.totalCostMxn })
      : "La base de datos rechazó el caso por una restricción de la tabla de casos de ortodoncia.";
    return `${de}${detalle} (restricción ${CHECK_DURACION_Y_COSTO}; hay un SQL pendiente: sql/ortodoncia-costo-del-caso.sql)`;
  }
  const codigo = codigoDeLaBase(e);
  return `${de}No se pudo guardar el caso de ortodoncia (error de base de datos${codigo ? ` ${codigo}` : ""})`;
}

/**
 * commit(): crea el caso de cada tratamiento marcado. Un caso entra COMPLETO o no entra (una transacción); un fallo
 * de un caso no frena a los demás. Devuelve creados (casos) y omitidos (ya importados).
 */
export async function commitCasosDeOrtodoncia(
  filas: PreviewRow[],
  clinicId: string,
  ctx: ImportContext,
): Promise<{ created: number; skipped: number }> {
  const grupos = Array.from(agruparPorTratamiento(filas).values());
  if (grupos.length === 0) return { created: 0, skipped: 0 };
  const fuente = ctx.originId;
  const origen = nombreOrigen(ctx.originName);

  const casos = await cargarCasosOrto(clinicId, fuente);
  if (!casos.disponible) {
    for (const g of grupos) for (const r of g) { r.status = "error"; r.errors.push(MSG_SIN_TABLA_EXTERNOS); }
    return { created: 0, skipped: 0 };
  }
  const controles = await cargarControlesOrto(clinicId, fuente);
  const tecnicas = (await leerTecnicasDeLaClinica(clinicId)).tecnicas;
  const citasTomadas = new Set<string>();

  let created = 0;
  let skipped = 0;
  let ultimoNumero = 0;

  for (const g of grupos) {
    const entrada = entradaDelCaso(g, tecnicas);
    if (casos.mapa.has(entrada.folio)) { skipped++; for (const r of g) r.status = "duplicate"; continue; }
    const plan = armarCaso(entrada);

    // Controles que 05 ya trajo como cita: la hoja se adjunta a esa cita en vez de crear otra visita.
    const claves = new Map<string, string>();
    for (const c of plan.controles) {
      const k = claveControlCaso(plan.folio, c.dia);
      const ya = k ? controles.mapa.get(k) : undefined;
      if (k && ya) claves.set(k, ya);
    }
    const citas = await citasYaImportadas(clinicId, claves, citasTomadas);

    const necesarias = (plan.principal ? 1 : 0) + (plan.extras ? 1 : 0) + plan.controles.filter((c) => c.cargo).length;
    let registros: RegistrosDelCaso | null = null;
    let conOpcionales = true;
    let ultimoError: unknown = null;
    for (let intento = 0; intento < 4 && !registros; intento++) {
      const base = Math.max((await lastInvoiceFolio(clinicId)) ?? 0, ultimoNumero);
      const candidato = construirRegistros(plan, {
        clinicId, userId: ctx.userId, origen, ahora: ctx.now, primerNumero: base + 1,
        patientId: entrada.patientId, doctorId: entrada.doctorId || ctx.userId,
        citasDeControl: citas, columnasOpcionales: conOpcionales,
      });
      try {
        await escribirCaso(candidato);
        registros = candidato;
        ultimoNumero = base + necesarias;
      } catch (e: any) {
        ultimoError = e;
        if (isMissingColumnError(e) && conOpcionales) {
          // Falta alguna columna opcional (doctor tratante, liga de la factura o cita de la hoja): el caso entra sin ella.
          conOpcionales = false;
          console.warn("[import/ortho-caso] faltan columnas opcionales del módulo; el caso entra sin doctor tratante ni liga de factura:", e);
          continue;
        }
        if (e?.code === "P2002") continue; // folio de factura ocupado por otra pestaña: se relee y se reintenta
        break;
      }
    }
    if (!registros) {
      for (const r of g) { r.status = "error"; r.errors.push(mensajeDeError(ultimoError, plan)); }
      continue;
    }

    // ── Pasos tolerantes: nunca revierten un caso ya creado ─────────────────────────────────────
    const planId = registros.ids.plan;
    await guardarModoDeCobroDelCaso(clinicId, planId, plan.billingMode);
    if (plan.techniqueLabel) await guardarNombreDeTecnicaDelCaso(clinicId, planId, plan.techniqueLabel);
    const liga = conOpcionales ? await ligarFacturas(clinicId, planId, registros.facturasLigadas) : "sin-columna";
    if (liga !== "ok") {
      g[0].warnings.push(
        liga === "sin-columna"
          ? "Los cargos de los controles y los extras quedaron creados pero sin ligar al caso: falta aplicar sql/ortodoncia-cobro.sql"
          : "Los cargos de los controles y los extras quedaron creados pero no se pudieron ligar al caso; ligarlos desde Cobranza",
      );
    }
    if (!(await guardarExternosDe(clinicId, fuente, ENTIDAD_CASO_ORTO, [{ externalId: plan.folio, localId: planId }]))) {
      console.warn("[import/ortho-caso] import_external_ids no existe: un reintento duplicaría el caso");
    }
    if (registros.clavesDeControl.length > 0) await guardarControlesOrto(clinicId, fuente, registros.clavesDeControl);
    created++;
  }
  return { created, skipped };
}
