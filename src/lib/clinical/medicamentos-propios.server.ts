// ═══════════════════════════════════════════════════════════════════════════
// MEDICAMENTOS PROPIOS DE LA CLÍNICA (ws1-t10, decisión de Rafael 28-oct-2026):
// «Agregar medicamento que no está» en el buscador de la receta.
//
// CÓMO SE GUARDA — en la MISMA tabla `cums_items`, con una columna nueva
// `clinicId` (NULL = catálogo global; con valor = propio de esa clínica). Por
// qué así y no en una tabla aparte: `prescription_items.cumsKey` es FK
// obligatoria a `cums_items.clave`, y de ahí leen la receta, el PDF, la firma
// FIEL (contenido-receta.ts), la verificación pública del QR, el CDA, el
// expediente PDF, el portal del paciente, Sabina y el chequeo IA. Con una fila
// en `cums_items` todo eso sigue funcionando sin tocar una línea; con una tabla
// aparte habría que hacer nullable la FK y reescribir once lectores. CFDI no
// toca recetas (comprobado con grep: ningún archivo de cfdi lee prescriptions).
//
// La clave de una fila propia es `CL-<11 chars aleatorios>` (nunca choca con
// las claves oficiales `010.000.xxxx.xx` ni con las internas `MX-xxxx`).
//
// SIN EL SQL (sql/cums-medicamentos-propios.sql) TODO SIGUE COMO HOY: la sonda
// pregunta a information_schema si existe la columna (nunca falla), recuerda
// la respuesta en globalThis (sobrevive a las recargas de next dev; un «no»
// se vuelve a preguntar cada 10 min), y mientras no exista no se lanza ninguna
// consulta que la nombre: el buscador usa el cliente de Prisma de siempre y el
// botón de agregar no aparece. La columna NO va en schema.prisma a propósito:
// el cliente de Prisma se comparte con dev.108 y, con el campo en el modelo,
// toda lectura sin `select` reventaría con P2022 hasta que se pegue el SQL.
//
// AISLAMIENTO: una clínica solo ve y solo puede recetar las filas globales y
// las suyas. `catalogoParaReceta` es lo que usa POST /api/prescriptions para
// validar las claves: una clave propia de OTRA clínica no existe para esta.
//
// CANDADO: `crearMedicamentoPropio` rechaza (controlado) cualquier nombre o
// presentación que nombre un medicamento de los grupos I, II o III — ver
// `controlados.ts`. Esa comprobación vive aquí, en el servidor; la pantalla
// solo la repite para avisar antes.
// ═══════════════════════════════════════════════════════════════════════════

import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { detectarControlado } from "@/lib/clinical/controlados";
import {
  armarFilaPropia,
  GRUPO_PROPIO,
  validarAlta,
  type AltaMedicamentoPropio,
  type MedicamentoCatalogo,
  type ResultadoAlta,
} from "@/lib/clinical/medicamentos-propios.contrato";

export {
  armarFilaPropia,
  GRUPO_PROPIO,
  LIMITES_PROPIO,
  validarAlta,
  type AltaMedicamentoPropio,
  type MedicamentoCatalogo,
  type ResultadoAlta,
} from "@/lib/clinical/medicamentos-propios.contrato";

type Db = any;

// ── Sonda de la columna ─────────────────────────────────────────────────────

const SONDA = Symbol.for("dalecontrol.cums.columnaClinicId");
const SONDA_EN_CURSO = Symbol.for("dalecontrol.cums.columnaClinicId.enCurso");
type Sonda = { existe: boolean; at: number };
const RE_PREGUNTAR_MS = 10 * 60_000;

/**
 * ¿Existe `cums_items.clinicId`? Si la sonda falla, `false` sin recordarlo.
 * Dos preguntas a la vez (el buscador la hace en paralelo con la búsqueda)
 * comparten la misma consulta.
 */
export async function hayMedicamentosPropios(db: Db = prisma): Promise<boolean> {
  const g = globalThis as unknown as Record<symbol, Sonda | Promise<boolean> | undefined>;
  const s = g[SONDA] as Sonda | undefined;
  if (s && (s.existe || Date.now() - s.at < RE_PREGUNTAR_MS)) return s.existe;
  const enCurso = g[SONDA_EN_CURSO] as Promise<boolean> | undefined;
  if (enCurso) return enCurso;
  const pregunta = (async () => {
    try {
      const filas = await db.$queryRaw`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'cums_items' AND column_name = 'clinicId'
        ) AS existe`;
      const existe = (filas as Array<{ existe: boolean }>)?.[0]?.existe === true;
      g[SONDA] = { existe, at: Date.now() };
      return existe;
    } catch {
      return false;
    } finally {
      delete g[SONDA_EN_CURSO];
    }
  })();
  g[SONDA_EN_CURSO] = pregunta;
  return pregunta;
}

/** Solo para las pruebas: olvida lo que se sabía de la columna. */
export function olvidarSondaDeMedicamentos(): void {
  const g = globalThis as unknown as Record<symbol, unknown>;
  delete g[SONDA];
  delete g[SONDA_EN_CURSO];
}

// ── Búsqueda ────────────────────────────────────────────────────────────────

const COLUMNAS = Prisma.sql`"clave", "descripcion", "presentacion", "formaFarmaceutica", "grupoTerapeutico", "cofeprisGroup"`;

function patron(q: string): string {
  // `contains` de Prisma = ILIKE '%q%' con los comodines del usuario escapados.
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Busca en el catálogo global + la lista propia de la clínica. Las propias van
 * primero (son las que la clínica se tomó la molestia de dar de alta), luego
 * las globales por descripción. Sin la columna: solo el catálogo global, por
 * el cliente de Prisma, como siempre.
 */
export async function buscarMedicamentos(
  args: { q: string; group: string; limit: number; clinicId: string },
  db: Db = prisma,
): Promise<MedicamentoCatalogo[]> {
  const { q, group, limit, clinicId } = args;
  if (!clinicId) throw new Error("sesion_invalida: falta clinicId");

  if (!(await hayMedicamentosPropios(db))) {
    const where: Record<string, unknown> = {};
    if (group) where.grupoTerapeutico = group;
    if (q) {
      where.OR = [
        { clave: { contains: q, mode: "insensitive" } },
        { descripcion: { contains: q, mode: "insensitive" } },
      ];
    }
    const filas = await db.cumsItem.findMany({ where, take: limit, orderBy: [{ descripcion: "asc" }] });
    return (filas as MedicamentoCatalogo[]).map((f) => ({ ...f, propio: false }));
  }

  const condiciones: Prisma.Sql[] = [Prisma.sql`("clinicId" IS NULL OR "clinicId" = ${clinicId})`];
  if (group) condiciones.push(Prisma.sql`"grupoTerapeutico" = ${group}`);
  if (q) {
    const p = patron(q);
    condiciones.push(Prisma.sql`("clave" ILIKE ${p} OR "descripcion" ILIKE ${p})`);
  }
  const filas = (await db.$queryRaw`
    SELECT ${COLUMNAS}, ("clinicId" IS NOT NULL) AS "propio"
      FROM "cums_items"
     WHERE ${Prisma.join(condiciones, " AND ")}
     ORDER BY ("clinicId" IS NOT NULL) DESC, "descripcion" ASC
     LIMIT ${limit}`) as Array<MedicamentoCatalogo & { propio: boolean }>;
  return filas;
}

/**
 * Las claves que una receta de ESTA clínica puede llevar: catálogo global +
 * sus propias. Es lo que POST /api/prescriptions usa para validar `items` y
 * para sacar el grupo COFEPRIS real. Una clave propia de otra clínica no
 * aparece (= `cums_not_found`).
 */
export async function catalogoParaReceta(
  claves: string[],
  clinicId: string,
  db: Db = prisma,
): Promise<Array<{ clave: string; cofeprisGroup: string | null }>> {
  if (!clinicId) throw new Error("sesion_invalida: falta clinicId");
  if (claves.length === 0) return [];
  if (!(await hayMedicamentosPropios(db))) {
    return db.cumsItem.findMany({
      where: { clave: { in: claves } },
      select: { clave: true, cofeprisGroup: true },
    });
  }
  return (await db.$queryRaw`
    SELECT "clave", "cofeprisGroup"
      FROM "cums_items"
     WHERE "clave" IN (${Prisma.join(claves)})
       AND ("clinicId" IS NULL OR "clinicId" = ${clinicId})`) as Array<{ clave: string; cofeprisGroup: string | null }>;
}

// ── Alta ────────────────────────────────────────────────────────────────────

function claveNueva(): string {
  // 8 bytes → 11 chars base64url; "CL-" + 11 = 14 ≤ VARCHAR(20).
  return `CL-${randomBytes(8).toString("base64url")}`;
}

/**
 * Da de alta un medicamento propio. Idempotente por (clínica, nombre,
 * presentación armada): si ya existe uno igual se devuelve ese (`existia`).
 */
export async function crearMedicamentoPropio(
  args: { clinicId: string; userId: string; alta: Partial<AltaMedicamentoPropio> },
  db: Db = prisma,
): Promise<ResultadoAlta> {
  const { clinicId, userId } = args;
  if (!clinicId) throw new Error("sesion_invalida: falta clinicId");

  const v = validarAlta(args.alta);
  if (v.ok === false) return { ok: false, error: "datos_invalidos", campo: v.campo };

  // El candado, ANTES de mirar la base: un controlado no se guarda nunca, ni
  // aunque la columna no exista. Se revisa nombre y presentación/concentración.
  const controlado = detectarControlado(v.alta.nombre, v.alta.concentracion, v.alta.presentacion, v.alta.forma);
  if (controlado) return { ok: false, error: "medicamento_controlado", controlado };

  if (!(await hayMedicamentosPropios(db))) return { ok: false, error: "sin_sql" };

  const fila = armarFilaPropia(v.alta);

  const iguales = (await db.$queryRaw`
    SELECT ${COLUMNAS}
      FROM "cums_items"
     WHERE "clinicId" = ${clinicId}
       AND lower("descripcion") = lower(${fila.descripcion})
       AND lower("presentacion") = lower(${fila.presentacion})
     LIMIT 1`) as MedicamentoCatalogo[];
  if (iguales.length > 0) return { ok: true, medicamento: { ...iguales[0], propio: true }, existia: true };

  // La clave es aleatoria; si por un azar enorme choca, se reintenta.
  for (let intento = 0; intento < 3; intento++) {
    const clave = claveNueva();
    const n = (await db.$executeRaw`
      INSERT INTO "cums_items" ("clave", "descripcion", "presentacion", "formaFarmaceutica", "grupoTerapeutico", "cofeprisGroup", "clinicId", "createdBy", "createdAt")
      VALUES (${clave}, ${fila.descripcion}, ${fila.presentacion}, ${fila.formaFarmaceutica}, ${GRUPO_PROPIO}, NULL, ${clinicId}, ${userId}, NOW())
      ON CONFLICT ("clave") DO NOTHING`) as number;
    if (n === 1) {
      return {
        ok: true,
        existia: false,
        medicamento: {
          clave,
          descripcion: fila.descripcion,
          presentacion: fila.presentacion,
          formaFarmaceutica: fila.formaFarmaceutica,
          grupoTerapeutico: GRUPO_PROPIO,
          cofeprisGroup: null,
          propio: true,
        },
      };
    }
  }
  throw new Error("cums_clave_no_asignada");
}
