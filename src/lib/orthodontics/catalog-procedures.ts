// ═══════════════════════════════════════════════════════════════════════════
// CATÁLOGO de procedimientos de ortodoncia (ws1-t1, Ola 2) — sobre el mismo
// `ProcedureCatalog` que usa toda la clínica (dental incluido), marcados con
// `category: "orthodontics"` y `orthoIncludedInTreatment`:
//   true  = incluido en el tratamiento (no se cobra al cerrar la hoja).
//   false = con costo aparte (se agrega como extra, factura normal).
//   null  = «Control de ortodoncia»: su cobro depende del MODO de la
//           clínica, no de este flag — en PRECIO_TOTAL va dentro de la
//           mensualidad (no se factura solo); en PAGO_POR_CONTROL SÍ lleva
//           precio y es justo el que usa signTreatmentCard.ts para la
//           factura automática de cada control.
//
// `orthoIncludedInTreatment` va por SQL CRUDO a propósito, NUNCA declarado
// en prisma/schema.prisma: `procedure_catalog` la lee CASI toda la app
// (facturas, presupuestos, odontograma…) sin `select` explícito. Declararla
// en Prisma revienta con P2022 CUALQUIERA de esas lecturas mientras Rafael
// no pegue sql/ortodoncia-modo-cobro.sql — medido en vivo en dev.108, tumbó
// /api/procedures entero (GET sin select). Mismo espíritu que
// `orthodontic_billing_configs` (cobro/config-db.ts). El resto de columnas
// (`name`, `category`, `basePrice`, `isActive`…) SÍ son del modelo de
// siempre — esas se leen/escriben con Prisma normal, sin riesgo.
//
// `DEFAULT_ORTHO_PROCEDURES` es una PRECARGA SUGERIDA — mismo patrón que
// `DENTAL_SEED` en src/app/api/procedures/route.ts (auto-siembra si el
// catálogo de ortodoncia de la clínica está vacío, EDITABLE después desde el
// modal de siempre, PATCH /api/procedures/[id]). Nada se pone a cobrar solo:
// son precios de arranque, la clínica los ajusta.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { TIPO_CITA_CONTROL_ORTO } from "./agenda-constants";

export const ORTHO_CATALOG_CATEGORY = "orthodontics";

export interface OrthoProcedureSeed {
  name: string;
  basePrice: number;
  /** null = «Control de ortodoncia»: su cobro depende del modo, no de este flag. */
  orthoIncludedInTreatment: boolean | null;
  description: string;
}

export const DEFAULT_ORTHO_PROCEDURES: readonly OrthoProcedureSeed[] = [
  // ── Incluidos en el tratamiento (no se cobran aparte) ──────────────────
  { name: "Activación", basePrice: 0, orthoIncludedInTreatment: true, description: "Incluido en el tratamiento." },
  { name: "Cambio de arco", basePrice: 0, orthoIncludedInTreatment: true, description: "Incluido en el tratamiento." },
  { name: "Colocación de elásticos", basePrice: 0, orthoIncludedInTreatment: true, description: "Incluido en el tratamiento." },
  { name: "Ajuste de aparatología", basePrice: 0, orthoIncludedInTreatment: true, description: "Incluido en el tratamiento." },

  // ── El control: su cobro depende del modo de cobro de la clínica ───────
  {
    name: TIPO_CITA_CONTROL_ORTO,
    basePrice: 300,
    orthoIncludedInTreatment: null,
    description: "En modo «Precio total a plazos» va incluido en la mensualidad. En modo «Pago por control» se cobra aparte en cada visita.",
  },

  // ── Con costo aparte ─────────────────────────────────────────────────
  { name: "Valoración de ortodoncia", basePrice: 500, orthoIncludedInTreatment: false, description: "Con costo aparte." },
  { name: "Estudio de registros de ortodoncia", basePrice: 1500, orthoIncludedInTreatment: false, description: "Con costo aparte." },
  { name: "Colocación de aparatología", basePrice: 3000, orthoIncludedInTreatment: false, description: "Con costo aparte." },
  { name: "Reposición de bracket", basePrice: 350, orthoIncludedInTreatment: false, description: "Con costo aparte, pasadas las reposiciones incluidas del caso." },
  { name: "Retenedor superior", basePrice: 1800, orthoIncludedInTreatment: false, description: "Con costo aparte." },
  { name: "Retenedor inferior", basePrice: 1800, orthoIncludedInTreatment: false, description: "Con costo aparte." },
  { name: "Retiro de aparatología", basePrice: 1200, orthoIncludedInTreatment: false, description: "Con costo aparte." },
  { name: "Urgencia de ortodoncia fuera de control", basePrice: 400, orthoIncludedInTreatment: false, description: "Con costo aparte." },
  { name: "Microimplante (TAD)", basePrice: 2500, orthoIncludedInTreatment: false, description: "Con costo aparte." },
  { name: "Alineadores de refinamiento", basePrice: 4500, orthoIncludedInTreatment: false, description: "Con costo aparte." },
];

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

let columna: { existe: boolean; at: number } | null = null;
const TTL_MS = 60_000;

async function columnaOrthoIncluidoExiste(): Promise<boolean> {
  const t = Date.now();
  if (columna && (columna.existe || t - columna.at < TTL_MS)) return columna.existe;
  try {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'procedure_catalog' AND column_name = 'orthoIncludedInTreatment'
      ) AS existe`;
    columna = { existe: filas[0]?.existe === true, at: t };
    return columna.existe;
  } catch (e) {
    console.warn("[ortodoncia:catalogo] no se pudo comprobar la columna:", e);
    return false;
  }
}

/** Solo para pruebas: olvida lo que se sabía de la columna. */
export function _olvidarColumnaOrthoIncluido(): void {
  columna = null;
}

export interface OrthoProcedureRow {
  id: string;
  name: string;
  basePrice: number;
  orthoIncludedInTreatment: boolean | null;
  isActive: boolean;
}

/**
 * El catálogo de ortodoncia de la clínica (category "orthodontics"), activos
 * primero. Con Prisma normal (`select`, sin la columna nueva) + la sonda de
 * columna para decidir si además trae `orthoIncludedInTreatment` — NUNCA un
 * `$queryRaw` incondicional que la mencione: un raw query contra una columna
 * que no existe falla con P2010 (mensaje "column ... does not exist"), no
 * con P2021/P2022, así que `esRelacionAusente` no lo atraparía.
 */
export async function listarProcedimientosDeOrtodoncia(clinicId: string): Promise<OrthoProcedureRow[]> {
  if (!clinicId) return [];
  let base: { id: string; name: string; basePrice: number; isActive: boolean }[];
  try {
    base = await prisma.procedureCatalog.findMany({
      where: { clinicId, category: ORTHO_CATALOG_CATEGORY },
      select: { id: true, name: true, basePrice: true, isActive: true },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });
  } catch (e) {
    if (esRelacionAusente(e)) return [];
    throw e;
  }
  if (base.length === 0) return [];

  if (!(await columnaOrthoIncluidoExiste())) {
    return base.map((p) => ({ ...p, orthoIncludedInTreatment: null }));
  }
  try {
    const flags = await prisma.$queryRaw<{ id: string; orthoIncludedInTreatment: boolean | null }[]>`
      SELECT "id", "orthoIncludedInTreatment"
        FROM "procedure_catalog"
       WHERE "clinicId" = ${clinicId} AND "category" = ${ORTHO_CATALOG_CATEGORY}`;
    const flagById = new Map(flags.map((f) => [f.id, f.orthoIncludedInTreatment]));
    return base.map((p) => ({ ...p, orthoIncludedInTreatment: flagById.get(p.id) ?? null }));
  } catch (e) {
    console.warn("[ortodoncia:catalogo] no se pudo leer incluido/con costo:", e);
    return base.map((p) => ({ ...p, orthoIncludedInTreatment: null }));
  }
}

/**
 * Aplica `orthoIncludedInTreatment` a UN procedimiento ya creado (POST/PATCH
 * de /api/procedures) — SQL crudo, tolerante: sin la columna, no hace nada
 * (el procedimiento queda creado/editado igual, solo sin el flag).
 */
export async function aplicarOrthoIncluido(procedureId: string, clinicId: string, valor: boolean | null): Promise<void> {
  if (!(await columnaOrthoIncluidoExiste())) return;
  try {
    await prisma.$executeRaw`
      UPDATE "procedure_catalog"
         SET "orthoIncludedInTreatment" = ${valor}
       WHERE "id" = ${procedureId} AND "clinicId" = ${clinicId}`;
  } catch (e) {
    console.warn("[ortodoncia:catalogo] no se pudo aplicar incluido/con costo:", e);
  }
}

/**
 * El precio vigente de «Control de ortodoncia» del catálogo de la clínica —
 * lo que usa signTreatmentCard.ts para facturar cada control en modo
 * PAGO_POR_CONTROL. `null` = la clínica todavía no tiene ese procedimiento
 * en su catálogo (no inventamos un precio: no se factura nada). Esta
 * consulta SÍ puede usar Prisma normal con `select`: `name`/`basePrice` son
 * columnas de siempre, no la nueva.
 */
export async function buscarPrecioControlOrto(clinicId: string): Promise<{ procedureId: string; name: string; basePrice: number } | null> {
  if (!clinicId) return null;
  try {
    const row = await prisma.procedureCatalog.findFirst({
      where: { clinicId, category: ORTHO_CATALOG_CATEGORY, name: TIPO_CITA_CONTROL_ORTO, isActive: true },
      select: { id: true, name: true, basePrice: true },
    });
    return row ? { procedureId: row.id, name: row.name, basePrice: row.basePrice } : null;
  } catch (e) {
    if (esRelacionAusente(e)) return null;
    throw e;
  }
}

/** Siembra la precarga sugerida (idempotente: no duplica nombres que ya existan). Explícita: solo la corre quien la invoque (acción), nunca sola. */
export async function sembrarProcedimientosDeOrtodoncia(clinicId: string): Promise<{ creados: number }> {
  if (!clinicId) return { creados: 0 };
  let existentes: Set<string>;
  try {
    const rows = await prisma.procedureCatalog.findMany({
      where: { clinicId, category: ORTHO_CATALOG_CATEGORY },
      select: { name: true },
    });
    existentes = new Set(rows.map((r) => r.name));
  } catch (e) {
    if (esRelacionAusente(e)) return { creados: 0 };
    throw e;
  }

  const faltantes = DEFAULT_ORTHO_PROCEDURES.filter((p) => !existentes.has(p.name));
  if (faltantes.length === 0) return { creados: 0 };

  // Paso 1: columnas de SIEMPRE, con Prisma normal, UNA sola consulta —
  // nunca falla por SQL sin pegar, y respeta «menos de 7 por Promise.all»
  // (createMany no cuenta como N inserts sueltos).
  await prisma.procedureCatalog.createMany({
    data: faltantes.map((p) => ({ clinicId, name: p.name, category: ORTHO_CATALOG_CATEGORY, basePrice: p.basePrice, description: p.description })),
  });

  // Paso 2: orthoIncludedInTreatment, SQL crudo, tolerante — si la columna
  // aún no existe, las filas quedan creadas igual (catálogo normal,
  // editable), solo sin el flag todavía. UN solo UPDATE con CASE, no uno por
  // fila (mismo motivo: el pooler).
  if (await columnaOrthoIncluidoExiste()) {
    try {
      const incluidos = faltantes.filter((p) => p.orthoIncludedInTreatment === true).map((p) => p.name);
      const conCosto = faltantes.filter((p) => p.orthoIncludedInTreatment === false).map((p) => p.name);
      if (incluidos.length > 0) {
        await prisma.$executeRaw`UPDATE "procedure_catalog" SET "orthoIncludedInTreatment" = true WHERE "clinicId" = ${clinicId} AND "category" = ${ORTHO_CATALOG_CATEGORY} AND "name" IN (${Prisma.join(incluidos)})`;
      }
      if (conCosto.length > 0) {
        await prisma.$executeRaw`UPDATE "procedure_catalog" SET "orthoIncludedInTreatment" = false WHERE "clinicId" = ${clinicId} AND "category" = ${ORTHO_CATALOG_CATEGORY} AND "name" IN (${Prisma.join(conCosto)})`;
      }
      // Los null (ej. «Control de ortodoncia») ya nacen NULL por default: nada que hacer.
    } catch (e) {
      console.warn("[ortodoncia:catalogo] no se pudo marcar incluido/con costo:", e);
    }
  }

  return { creados: faltantes.length };
}
