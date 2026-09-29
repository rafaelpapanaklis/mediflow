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

import { CODIGO_CONTROL_ORTO, ORTHO_CATALOG_CATEGORY } from "./catalog-procedures-constantes";
export { CODIGO_CONTROL_ORTO, ORTHO_CATALOG_CATEGORY };

// ── El control se reconoce por su IDENTIFICADOR, no por su nombre ─────────
// (ws1-t5, 28-sep-2026; revisión de lógica de uso, fila 26 del mapa).
//
// EL FALLO. `buscarPrecioControlOrto` encontraba el procedimiento por su
// NOMBRE exacto. Si la clínica lo renombraba en Procedimientos («Control
// mensual», «Ajuste de brackets»…), en modo «Pago por control» los controles
// dejaban de facturarse sin que nadie avisara.
//
// EL ARREGLO. La fila del control lleva una llave interna en
// `procedure_catalog.code`, la misma columna —de siempre— que usa el
// odontograma con sus `ODO_*` y que el panel nunca escribe (ver
// src/app/api/procedures/entrada.ts). Sin SQL nuevo. Se busca primero por la
// llave; si no hay ninguna (catálogos sembrados antes de este cambio), por el
// nombre de siempre, y en ese momento se le pone la llave. También se le pone
// justo al renombrarlo (PATCH /api/procedures/[id]).

export interface FilaCandidataControl {
  id: string;
  name: string;
  code: string | null;
  category: string;
  basePrice: number;
  isActive: boolean;
}

/**
 * ¿Cuál de estas filas es el procedimiento del control? PURO.
 *  1. La que lleva la llave, se llame como se llame y esté en la categoría
 *     que esté.
 *  2. Si ninguna la lleva: la de ortodoncia que conserva el nombre de siempre
 *     (datos anteriores a la llave).
 * Solo filas activas: un control desactivado no se factura, como hasta hoy.
 */
export function elegirProcedimientoControl<T extends FilaCandidataControl>(
  filas: readonly T[],
): { fila: T; por: "llave" | "nombre" } | null {
  const activas = filas.filter((f) => f.isActive);
  const conLlave = activas.find((f) => f.code === CODIGO_CONTROL_ORTO);
  if (conLlave) return { fila: conLlave, por: "llave" };
  const porNombre = activas.find(
    (f) => f.category === ORTHO_CATALOG_CATEGORY && f.name === TIPO_CITA_CONTROL_ORTO && !f.code,
  );
  return porNombre ? { fila: porNombre, por: "nombre" } : null;
}

/**
 * ¿Hay que ponerle la llave a esta fila ANTES de cambiarla? Sí, si es el
 * control de siempre (por nombre y categoría) y todavía no lleva ninguna
 * llave. Así un cambio de nombre no lo deja huérfano. PURO.
 */
export function debeMarcarseComoControl(fila: {
  name: string;
  code: string | null;
  category: string;
}): boolean {
  return !fila.code && fila.category === ORTHO_CATALOG_CATEGORY && fila.name === TIPO_CITA_CONTROL_ORTO;
}

export interface OrthoProcedureSeed {
  name: string;
  basePrice: number;
  /** null = «Control de ortodoncia»: su cobro depende del modo, no de este flag. */
  orthoIncludedInTreatment: boolean | null;
  description: string;
}

// ── Lo que se anota DENTRO de la hoja de control (fila 35 de la revisión de
// uso, ws1-t4 ronda 6; decisión del gerente) ──────────────────────────────
// «Activación», «Cambio de arco» y «Ajuste de aparatología» eran tres
// procedimientos más para la misma visita: todos son «el control del mes».
// Ya no se siembran ni se ofrecen para agendar (menú del bot); lo que una
// clínica ya tenga se queda en su catálogo, sin borrar nada.
export const HECHOS_DENTRO_DEL_CONTROL: readonly string[] = ["Activación", "Cambio de arco", "Ajuste de aparatología"];

/** ¿Se ofrece este procedimiento como servicio para agendar? PURO. */
export function seOfreceParaAgendar(p: { name: string; category: string | null }): boolean {
  return !(p.category === ORTHO_CATALOG_CATEGORY && HECHOS_DENTRO_DEL_CONTROL.includes(p.name));
}

// Fila 34 (ws1-t4 ronda 6): cada procedimiento que también es un tipo de cita
// se llama igual que el tipo de cita (`DEFAULT_ORTHO_APPOINTMENT_TYPES`,
// clinic-settings-db.ts): «Toma de registros de ortodoncia» (antes «Estudio
// de registros…») y «Urgencia de ortodoncia» (antes «… fuera de control»).
export const DEFAULT_ORTHO_PROCEDURES: readonly OrthoProcedureSeed[] = [
  // ── Incluidos en el tratamiento (no se cobran aparte) ──────────────────
  { name: "Colocación de elásticos", basePrice: 0, orthoIncludedInTreatment: true, description: "Incluido en el tratamiento." },

  // ── El control: su cobro depende del modo de cobro de la clínica ───────
  {
    name: TIPO_CITA_CONTROL_ORTO,
    basePrice: 300,
    orthoIncludedInTreatment: null,
    description: "En modo «Precio total a plazos» va incluido en la mensualidad. En modo «Pago por control» se cobra aparte en cada visita.",
  },

  // ── Con costo aparte ─────────────────────────────────────────────────
  { name: "Valoración de ortodoncia", basePrice: 500, orthoIncludedInTreatment: false, description: "Con costo aparte." },
  { name: "Toma de registros de ortodoncia", basePrice: 1500, orthoIncludedInTreatment: false, description: "Con costo aparte." },
  { name: "Colocación de aparatología", basePrice: 3000, orthoIncludedInTreatment: false, description: "Con costo aparte." },
  { name: "Reposición de bracket", basePrice: 350, orthoIncludedInTreatment: false, description: "Con costo aparte, pasadas las reposiciones incluidas del caso." },
  { name: "Retenedor superior", basePrice: 1800, orthoIncludedInTreatment: false, description: "Con costo aparte." },
  { name: "Retenedor inferior", basePrice: 1800, orthoIncludedInTreatment: false, description: "Con costo aparte." },
  { name: "Retiro de aparatología", basePrice: 1200, orthoIncludedInTreatment: false, description: "Con costo aparte." },
  { name: "Urgencia de ortodoncia", basePrice: 400, orthoIncludedInTreatment: false, description: "Fuera del control del mes. Con costo aparte." },
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
 * El precio vigente del control del catálogo de la clínica — lo que usa
 * signTreatmentCard.ts para facturar cada control en modo PAGO_POR_CONTROL.
 * `null` = la clínica todavía no tiene ese procedimiento en su catálogo, o lo
 * desactivó (no inventamos un precio: no se factura nada). Esta consulta SÍ
 * puede usar Prisma normal con `select`: son columnas de siempre.
 *
 * Se reconoce por su LLAVE (`CODIGO_CONTROL_ORTO`), no por su nombre: la
 * clínica puede llamarlo como quiera. `name` devuelve el nombre que ELLA le
 * puso, que es el que sale en la factura.
 */
export async function buscarPrecioControlOrto(clinicId: string): Promise<{ procedureId: string; name: string; basePrice: number } | null> {
  if (!clinicId) return null;
  try {
    const filas = await prisma.procedureCatalog.findMany({
      where: {
        clinicId,
        isActive: true,
        OR: [
          { code: CODIGO_CONTROL_ORTO },
          { category: ORTHO_CATALOG_CATEGORY, name: TIPO_CITA_CONTROL_ORTO },
        ],
      },
      select: { id: true, name: true, code: true, category: true, basePrice: true, isActive: true },
      orderBy: { createdAt: "asc" },
    });
    const elegido = elegirProcedimientoControl(filas);
    if (!elegido) return null;
    if (elegido.por === "nombre") {
      // Catálogo anterior a la llave: se le pone ahora, para que un cambio de
      // nombre posterior no lo pierda. Si falla, el precio se devuelve igual.
      await prisma.procedureCatalog
        .updateMany({ where: { id: elegido.fila.id, clinicId, code: null }, data: { code: CODIGO_CONTROL_ORTO } })
        .catch((e) => console.warn("[ortodoncia:catalogo] no se pudo marcar el control:", e));
    }
    return { procedureId: elegido.fila.id, name: elegido.fila.name, basePrice: elegido.fila.basePrice };
  } catch (e) {
    if (esRelacionAusente(e)) return null;
    throw e;
  }
}

/**
 * Qué falta por sembrar de la precarga sugerida. PURO. No repite nombres que
 * ya existan y no siembra un segundo control si la clínica ya tiene el suyo
 * (con su llave), aunque le haya cambiado el nombre.
 */
export function faltantesPorSembrar(
  nombresExistentes: ReadonlySet<string>,
  yaHayControl: boolean,
): OrthoProcedureSeed[] {
  return DEFAULT_ORTHO_PROCEDURES.filter((p) => {
    if (nombresExistentes.has(p.name)) return false;
    if (p.name === TIPO_CITA_CONTROL_ORTO && yaHayControl) return false;
    return true;
  });
}

/** Llave del candado de siembra de UNA clínica (ver `sembrarProcedimientosDeOrtodoncia`). */
export function llaveDeSiembra(clinicId: string): string {
  return `ortodoncia:siembra-catalogo:${clinicId}`;
}

/** Lo mínimo del cliente de Prisma que usa la siembra (así se prueba sin base). */
export interface DbDeSiembra {
  $transaction<T>(fn: (tx: TxDeSiembra) => Promise<T>): Promise<T>;
}
export interface TxDeSiembra {
  $executeRaw(consulta: TemplateStringsArray, ...valores: unknown[]): Promise<number>;
  procedureCatalog: {
    findMany(args: {
      where: { clinicId: string; OR: Array<{ category: string } | { code: string }> };
      select: { name: true; code: true };
    }): Promise<{ name: string; code: string | null }[]>;
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<{ count: number }>;
  };
}

/**
 * Siembra la precarga sugerida. Explícita: solo la corre quien la invoque
 * (GET /api/procedures con el catálogo de ortodoncia vacío, o la acción de
 * Configuración), nunca sola.
 *
 * IDEMPOTENTE TAMBIÉN CON DOS CARGAS A LA VEZ (ws1-t4 ronda 6). Antes leía
 * los nombres y luego insertaba, sin nada en medio: dos GET simultáneos
 * veían el catálogo vacío y sembraban los dos — así quedó duplicado el de
 * Rafael Clinica. `procedure_catalog` no tiene índice único por clínica+nombre
 * (y ponérselo tumbaría las clínicas que ya tienen repetidos), así que la
 * lectura y la inserción van en UNA transacción con un candado de Postgres
 * por clínica (`pg_advisory_xact_lock`): la segunda carga espera a que la
 * primera termine, relee y ya no encuentra nada que sembrar. El candado se
 * suelta solo al cerrar la transacción; no bloquea a otras clínicas.
 */
export async function sembrarProcedimientosDeOrtodoncia(
  clinicId: string,
  db: DbDeSiembra = prisma as unknown as DbDeSiembra,
  marcarFlags: (clinicId: string, sembrados: OrthoProcedureSeed[]) => Promise<void> = marcarIncluidoConCosto,
): Promise<{ creados: number }> {
  if (!clinicId) return { creados: 0 };
  let faltantes: OrthoProcedureSeed[];
  try {
    faltantes = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${llaveDeSiembra(clinicId)}))`;
      const rows = await tx.procedureCatalog.findMany({
        where: { clinicId, OR: [{ category: ORTHO_CATALOG_CATEGORY }, { code: CODIGO_CONTROL_ORTO }] },
        select: { name: true, code: true },
      });
      // El control que la clínica renombró sigue siendo el control: no se
      // siembra otro con el nombre de fábrica.
      const pendientes = faltantesPorSembrar(
        new Set(rows.map((r) => r.name)),
        rows.some((r) => r.code === CODIGO_CONTROL_ORTO),
      );
      if (pendientes.length === 0) return pendientes;
      // Columnas de SIEMPRE, con Prisma normal, UNA sola consulta — nunca
      // falla por SQL sin pegar (createMany no cuenta como N inserts sueltos).
      await tx.procedureCatalog.createMany({
        data: pendientes.map((p) => ({
          clinicId,
          name: p.name,
          category: ORTHO_CATALOG_CATEGORY,
          basePrice: p.basePrice,
          description: p.description,
          // El control nace con su llave (ver CODIGO_CONTROL_ORTO).
          ...(p.name === TIPO_CITA_CONTROL_ORTO ? { code: CODIGO_CONTROL_ORTO } : {}),
        })),
      });
      return pendientes;
    });
  } catch (e) {
    if (esRelacionAusente(e)) return { creados: 0 };
    throw e;
  }
  if (faltantes.length === 0) return { creados: 0 };

  await marcarFlags(clinicId, faltantes);
  return { creados: faltantes.length };
}

/** Nombre del procedimiento cuyo precio abre la factura de colocación en «Pago por control». */
export const NOMBRE_COLOCACION_APARATOLOGIA = "Colocación de aparatología";

/**
 * Puro: el precio de «Colocación de aparatología» entre las filas del catálogo,
 * o null si no está, está apagada o no tiene precio. Una fila activa gana a una
 * apagada del mismo nombre.
 */
export function elegirPrecioColocacion(filas: readonly Pick<OrthoProcedureRow, "name" | "basePrice" | "isActive">[]): number | null {
  const fila = filas.find((f) => f.isActive && f.name === NOMBRE_COLOCACION_APARATOLOGIA);
  const precio = Number(fila?.basePrice);
  return Number.isFinite(precio) && precio > 0 ? precio : null;
}

/** El precio de la colocación en el catálogo de ortodoncia de la clínica (null si no hay). */
export async function precioDeColocacionDelCatalogo(clinicId: string): Promise<number | null> {
  return elegirPrecioColocacion(await listarProcedimientosDeOrtodoncia(clinicId));
}

/**
 * orthoIncludedInTreatment de lo recién sembrado, SQL crudo, tolerante — si la
 * columna aún no existe, las filas quedan creadas igual (catálogo normal,
 * editable), solo sin el flag todavía. Fuera de la transacción de la siembra:
 * un fallo aquí no debe deshacer lo sembrado.
 */
async function marcarIncluidoConCosto(clinicId: string, faltantes: OrthoProcedureSeed[]): Promise<void> {
  // UN UPDATE por grupo, no uno por fila (el pooler).
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
}
