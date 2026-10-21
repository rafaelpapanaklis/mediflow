// Las filas del plan en la base (ws1-t12 · P1): tabla `treatment_plan_items` y columna
// `invoices."treatmentPlanId"` (sql/plan-tratamiento-filas.sql), por SQL crudo y SIN modelo de
// Prisma: si el código sale antes de que Rafael pegue el SQL, el cliente de Prisma compartido no
// cambia y nada se rompe. El contrato (tipos y reglas) vive en `items.ts`.
//
// Mientras la tabla no exista, `disponible()` lo dice SIN consultarla (to_regclass nunca falla) y
// recuerda la respuesta en `globalThis` (sobrevive a las recargas de `next dev`): nada de lanzar
// consultas que fallan y llenan el log de Postgres de producción. Un «no está» se vuelve a
// preguntar a los 2 min; un «sí está», nunca.
//
// Toda consulta lleva `clinicId` (y el plan), y sin él se corta ANTES de consultar.

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  aCentavos,
  ESTADOS_DE_FILA,
  FASES,
  motivoParaNoCancelar,
  puedePasar,
  type CambioDeEstado,
  type DbDeFilas,
  type EstadoDeFila,
  type Fase,
  type FilaDelPlan,
  type FilaNueva,
  type HallazgoDeOrigen,
  type PlanDeCambios,
  type RepoFilas,
} from "./items";

const REPREGUNTAR_MS = 2 * 60_000;

type Sonda = { existe: boolean; en: number };
type Memoria = { tabla?: Sonda; columna?: Sonda };
const CLAVE = Symbol.for("dalecontrol.treatments.items-db");

function memoria(): Memoria {
  const g = globalThis as unknown as Record<symbol, Memoria | undefined>;
  if (!g[CLAVE]) g[CLAVE] = {};
  return g[CLAVE]!;
}

/** Solo para las pruebas: olvida lo que se sabía de la tabla y de la columna. */
export function _olvidarSondas(): void {
  const m = memoria();
  delete m.tabla;
  delete m.columna;
}

async function sondear(cual: "tabla" | "columna", forzar: boolean, pregunta: () => Promise<boolean>): Promise<boolean> {
  const m = memoria();
  const s = m[cual];
  if (s?.existe) return true;
  if (s && !forzar && Date.now() - s.en < REPREGUNTAR_MS) return false;
  try {
    const existe = await pregunta();
    m[cual] = { existe, en: Date.now() };
    return existe;
  } catch (e) {
    // Un fallo de la base no es «no existe», pero tampoco se puede seguir: esta petición se porta
    // como el plan de siempre (texto) y la siguiente vuelve a preguntar. No se memoriza.
    console.warn(`[plan:filas] no se pudo saber si existe la ${cual}:`, e);
    return false;
  }
}

/** ¿Está `treatment_plan_items`? */
export function tablaDeFilasExiste(forzar = false): Promise<boolean> {
  return sondear("tabla", forzar, async () => {
    const r = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT to_regclass('public.treatment_plan_items') IS NOT NULL AS existe`;
    return r[0]?.existe === true;
  });
}

/** ¿Está `invoices."treatmentPlanId"`? (la liga de la nota de cobro al plan) */
export function columnaNotaDelPlanExiste(forzar = false): Promise<boolean> {
  return sondear("columna", forzar, async () => {
    const r = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'treatmentPlanId'
      ) AS existe`;
    return r[0]?.existe === true;
  });
}

function exigir(clinicId: string, planId?: string): void {
  if (typeof clinicId !== "string" || !clinicId) throw new Error("plan:filas: clinicId ausente — se corta antes de consultar");
  if (planId !== undefined && (typeof planId !== "string" || !planId)) throw new Error("plan:filas: planId ausente — se corta antes de consultar");
}

/** Error con el código del contrato (lo traduce la ruta a 409). */
export class FilaError extends Error {
  readonly codigo: string;
  constructor(codigo: string, mensaje?: string) {
    super(mensaje ?? codigo);
    this.name = "FilaError";
    this.codigo = codigo;
  }
}

interface FilaSql {
  id: string;
  clinicId: string;
  planId: string;
  procedureId: string | null;
  nombre: string;
  dientes: number[] | null;
  caras: string[] | null;
  fase: string | null;
  faseNumero: number | null;
  cantidad: number;
  precio: unknown;
  estado: string;
  hechoEn: Date | string | null;
  hechoPor: string | null;
  citaId: string | null;
  motivo: string | null;
  hallazgo: unknown;
  invoiceId: string | null;
  invoiceLinea: number | null;
  quoteItemId: string | null;
  orden: number;
  canceladoEn: Date | string | null;
  canceladoPor: string | null;
  createdById: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

const fecha = (v: Date | string | null): Date | null => (v == null ? null : v instanceof Date ? v : new Date(v));

function hallazgoDe(v: unknown): HallazgoDeOrigen | null {
  const h = typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
  if (!h || typeof h !== "object" || typeof (h as HallazgoDeOrigen).condicion !== "string") return null;
  const x = h as Partial<HallazgoDeOrigen>;
  return {
    condicion: String(x.condicion),
    diente: typeof x.diente === "number" ? x.diente : null,
    caras: Array.isArray(x.caras) ? x.caras.map(String) : [],
    entryId: typeof x.entryId === "string" ? x.entryId : null,
  };
}

/** Fila de la base → contrato. El NUMERIC llega como Decimal (Prisma) o texto: se lee sin float. */
export function aFila(r: FilaSql): FilaDelPlan {
  const centavos = aCentavos(String(r.precio ?? "0"));
  return {
    id: r.id,
    clinicId: r.clinicId,
    planId: r.planId,
    procedureId: r.procedureId ?? null,
    nombre: r.nombre,
    dientes: (r.dientes ?? []).map(Number),
    caras: (r.caras ?? []).map(String),
    fase: r.fase && (FASES as readonly string[]).indexOf(r.fase) !== -1 ? (r.fase as Fase) : null,
    faseNumero: r.faseNumero == null ? null : Number(r.faseNumero),
    cantidad: Number(r.cantidad) || 1,
    precioCentavos: Number.isFinite(centavos) ? centavos : 0,
    estado: (ESTADOS_DE_FILA as readonly string[]).indexOf(r.estado) !== -1 ? (r.estado as EstadoDeFila) : "pendiente",
    hechoEn: fecha(r.hechoEn),
    hechoPor: r.hechoPor ?? null,
    citaId: r.citaId ?? null,
    motivo: r.motivo ?? "",
    hallazgo: hallazgoDe(r.hallazgo),
    invoiceId: r.invoiceId ?? null,
    invoiceLinea: r.invoiceLinea == null ? null : Number(r.invoiceLinea),
    quoteItemId: r.quoteItemId ?? null,
    orden: Number(r.orden) || 0,
    canceladoEn: fecha(r.canceladoEn),
    canceladoPor: r.canceladoPor ?? null,
    createdById: r.createdById ?? null,
    createdAt: fecha(r.createdAt) ?? new Date(0),
    updatedAt: fecha(r.updatedAt) ?? new Date(0),
  };
}

/** «1250.50» exacto desde centavos, para el NUMERIC (sin pasar por float). */
export function numericDe(centavos: number): string {
  const c = Math.round(centavos);
  const signo = c < 0 ? "-" : "";
  const a = Math.abs(c);
  return `${signo}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

const hallazgoJson = (h: HallazgoDeOrigen | null) => (h ? JSON.stringify(h) : null);

async function leer(clinicId: string, planId: string, opciones: { conCanceladas?: boolean; db?: DbDeFilas } = {}): Promise<FilaDelPlan[]> {
  exigir(clinicId, planId);
  if (!(await tablaDeFilasExiste())) return [];
  const db = opciones.db ?? prisma;
  const filas = opciones.conCanceladas
    ? await db.$queryRaw<FilaSql[]>`
        SELECT * FROM "treatment_plan_items"
         WHERE "clinicId" = ${clinicId} AND "planId" = ${planId}
         ORDER BY "orden", "createdAt", "id"`
    : await db.$queryRaw<FilaSql[]>`
        SELECT * FROM "treatment_plan_items"
         WHERE "clinicId" = ${clinicId} AND "planId" = ${planId} AND "estado" <> 'cancelado'
         ORDER BY "orden", "createdAt", "id"`;
  return filas.map(aFila);
}

async function leerDePlanes(clinicId: string, planIds: string[]): Promise<Map<string, FilaDelPlan[]>> {
  exigir(clinicId);
  const out = new Map<string, FilaDelPlan[]>();
  const ids = Array.from(new Set(planIds.filter((x) => typeof x === "string" && x)));
  if (ids.length === 0 || !(await tablaDeFilasExiste())) return out;
  const filas = await prisma.$queryRaw<FilaSql[]>`
    SELECT * FROM "treatment_plan_items"
     WHERE "clinicId" = ${clinicId} AND "planId" IN (${Prisma.join(ids)}) AND "estado" <> 'cancelado'
     ORDER BY "planId", "orden", "createdAt", "id"`;
  for (const r of filas) {
    const f = aFila(r);
    const lista = out.get(f.planId) ?? [];
    lista.push(f);
    out.set(f.planId, lista);
  }
  return out;
}

function valoresDeAlta(args: { clinicId: string; planId: string; userId: string | null }, f: FilaNueva, orden: number, ahora: Date) {
  const hecho = f.estado === "hecho";
  return Prisma.sql`(
    ${randomUUID()}, ${args.clinicId}, ${args.planId}, ${f.procedureId}, ${f.nombre},
    ${f.dientes}::int[], ${f.caras}::text[], ${f.fase}, ${f.faseNumero}::int, ${f.cantidad}::int,
    ${numericDe(f.precioCentavos)}::numeric, ${f.estado}, ${hecho ? ahora.toISOString() : null}::timestamptz, ${hecho ? args.userId : null},
    ${f.motivo || null}, ${hallazgoJson(f.hallazgo)}::jsonb, ${orden}::int, ${args.userId}
  )`;
}

async function insertar(
  db: DbDeFilas,
  args: { clinicId: string; planId: string; userId: string | null; filas: FilaNueva[]; ordenDesde?: number; ordenes?: number[] },
): Promise<FilaDelPlan[]> {
  exigir(args.clinicId, args.planId);
  if (args.filas.length === 0) return [];
  // El plan tiene que ser de ESTA clínica: una fila nunca cuelga de un plan ajeno.
  const suyo = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "treatment_plans" WHERE "id" = ${args.planId} AND "clinicId" = ${args.clinicId}`;
  if (suyo.length !== 1) throw new FilaError("fila_desconocida", "plan de otra clínica");
  const ahora = new Date();
  const desde = args.ordenDesde ?? 0;
  const valores = args.filas.map((f, i) => valoresDeAlta(args, f, args.ordenes?.[i] ?? desde + i, ahora));
  const filas = await db.$queryRaw<FilaSql[]>`
    INSERT INTO "treatment_plan_items"
      ("id", "clinicId", "planId", "procedureId", "nombre",
       "dientes", "caras", "fase", "faseNumero", "cantidad",
       "precio", "estado", "hechoEn", "hechoPor",
       "motivo", "hallazgo", "orden", "createdById")
    VALUES ${Prisma.join(valores)}
    RETURNING *`;
  return filas.map(aFila).sort((a, b) => a.orden - b.orden);
}

async function aplicarCambios(
  db: DbDeFilas,
  args: { clinicId: string; planId: string; userId: string | null; cambios: PlanDeCambios },
): Promise<FilaDelPlan[]> {
  exigir(args.clinicId, args.planId);
  const { altas = [], cambios = [], cancelar = [], orden = [] } = args.cambios;
  if (!args.cambios.ok) throw new FilaError(args.cambios.codigo ?? "fila_desconocida");

  for (const c of cambios) {
    const d = c.despues;
    // La fila cobrada no cambia de qué ni de cuánto: el WHERE lo vuelve a exigir (carrera con la nota).
    const n = await db.$executeRaw`
      UPDATE "treatment_plan_items"
         SET "procedureId" = ${d.procedureId}, "nombre" = ${d.nombre},
             "dientes" = ${d.dientes}::int[], "caras" = ${d.caras}::text[],
             "fase" = ${d.fase}, "faseNumero" = ${d.faseNumero}::int,
             "cantidad" = ${d.cantidad}::int, "precio" = ${numericDe(d.precioCentavos)}::numeric,
             "motivo" = ${d.motivo || null}, "hallazgo" = ${hallazgoJson(d.hallazgo)}::jsonb,
             "updatedAt" = now()
       WHERE "id" = ${c.id} AND "clinicId" = ${args.clinicId} AND "planId" = ${args.planId}
         AND "estado" <> 'cancelado'
         AND ("invoiceId" IS NULL OR ("nombre" = ${d.nombre} AND "cantidad" = ${d.cantidad}::int
              AND "precio" = ${numericDe(d.precioCentavos)}::numeric
              AND "procedureId" IS NOT DISTINCT FROM ${d.procedureId}))`;
    if (n !== 1) throw new FilaError("fila_cobrada");
  }

  if (cancelar.length > 0) {
    for (const f of cancelar) {
      const no = motivoParaNoCancelar(f);
      if (no) throw new FilaError(no);
    }
    const ids = cancelar.map((f) => f.id);
    const n = await db.$executeRaw`
      UPDATE "treatment_plan_items"
         SET "estado" = 'cancelado', "canceladoEn" = now(), "canceladoPor" = ${args.userId}, "updatedAt" = now()
       WHERE "clinicId" = ${args.clinicId} AND "planId" = ${args.planId} AND "id" IN (${Prisma.join(ids)})
         AND "estado" IN ('pendiente', 'en_curso') AND "invoiceId" IS NULL`;
    if (n !== ids.length) throw new FilaError("fila_cobrada");
  }

  // Orden final: las existentes por su id, las altas por su posición.
  const posicion = new Map<string, number>();
  orden.forEach((k, i) => posicion.set(k, i));
  if (altas.length > 0) {
    await insertar(db, {
      clinicId: args.clinicId,
      planId: args.planId,
      userId: args.userId,
      filas: altas,
      ordenes: altas.map((_, i) => posicion.get(`alta:${i}`) ?? orden.length + i),
    });
  }
  const existentes = orden.filter((k) => !k.startsWith("alta:"));
  if (existentes.length > 0) {
    const valores = existentes.map((id) => Prisma.sql`(${id}, ${posicion.get(id) ?? 0}::int)`);
    await db.$executeRaw`
      UPDATE "treatment_plan_items" AS t
         SET "orden" = v."orden"
        FROM (VALUES ${Prisma.join(valores)}) AS v("id", "orden")
       WHERE t."id" = v."id" AND t."clinicId" = ${args.clinicId} AND t."planId" = ${args.planId}
         AND t."orden" IS DISTINCT FROM v."orden"`;
  }
  return leer(args.clinicId, args.planId, { db });
}

async function cambiarEstado(db: DbDeFilas, c: CambioDeEstado): Promise<FilaDelPlan> {
  exigir(c.clinicId, c.planId);
  const filas = await db.$queryRaw<FilaSql[]>`
    SELECT * FROM "treatment_plan_items"
     WHERE "id" = ${c.filaId} AND "clinicId" = ${c.clinicId} AND "planId" = ${c.planId}
     FOR UPDATE`;
  if (!filas[0]) throw new FilaError("fila_desconocida");
  const antes = aFila(filas[0]);
  if (antes.estado === c.a) return antes;
  if (!puedePasar(antes.estado, c.a)) throw new FilaError(antes.estado === "hecho" ? "fila_hecha" : "estado_invalido");
  if (c.a === "cancelado" && motivoParaNoCancelar(antes)) throw new FilaError(motivoParaNoCancelar(antes)!);
  const en = c.en ?? new Date();
  const hecho = c.a === "hecho";
  const r = await db.$queryRaw<FilaSql[]>`
    UPDATE "treatment_plan_items"
       SET "estado" = ${c.a},
           "hechoEn" = ${hecho ? en.toISOString() : null}::timestamptz,
           "hechoPor" = ${hecho ? c.userId : null},
           "citaId" = CASE WHEN ${hecho} AND ${c.citaId ?? null}::text IS NOT NULL THEN ${c.citaId ?? null}::text ELSE "citaId" END,
           "canceladoEn" = CASE WHEN ${c.a} = 'cancelado' THEN ${en.toISOString()}::timestamptz ELSE "canceladoEn" END,
           "canceladoPor" = CASE WHEN ${c.a} = 'cancelado' THEN ${c.userId}::text ELSE "canceladoPor" END,
           "updatedAt" = now()
     WHERE "id" = ${c.filaId} AND "clinicId" = ${c.clinicId} AND "planId" = ${c.planId}
     RETURNING *`;
  return aFila(r[0]);
}

async function ligarANota(
  db: DbDeFilas,
  args: { clinicId: string; planId: string; ligas: Array<{ filaId: string; invoiceId: string; linea: number | null }>; reemplazar?: string[] },
): Promise<number> {
  exigir(args.clinicId, args.planId);
  if (args.ligas.length === 0) return 0;
  const valores = args.ligas.map((l) => Prisma.sql`(${l.filaId}, ${l.invoiceId}, ${l.linea}::int)`);
  const reemplazables = (args.reemplazar ?? []).filter(Boolean);
  // Solo filas SIN nota viva: una nota cancelada (o borrada) sí se reemplaza. Así dos clics a la vez
  // no dejan la misma fila en dos notas — quien llama compara el número y, si no cuadra, aborta.
  return db.$executeRaw`
    UPDATE "treatment_plan_items" AS t
       SET "invoiceId" = v."invoiceId", "invoiceLinea" = v."linea", "updatedAt" = now()
      FROM (VALUES ${Prisma.join(valores)}) AS v("id", "invoiceId", "linea")
     WHERE t."id" = v."id" AND t."clinicId" = ${args.clinicId} AND t."planId" = ${args.planId}
       AND t."estado" <> 'cancelado'
       AND (t."invoiceId" IS NULL ${reemplazables.length ? Prisma.sql`OR t."invoiceId" IN (${Prisma.join(reemplazables)})` : Prisma.empty})`;
}

async function ligarAConceptos(
  db: DbDeFilas,
  args: { clinicId: string; planId: string; ligas: Array<{ filaId: string; quoteItemId: string | null }> },
): Promise<void> {
  exigir(args.clinicId, args.planId);
  if (args.ligas.length === 0) return;
  const ids = args.ligas.map((l) => l.filaId);
  await db.$executeRaw`
    UPDATE "treatment_plan_items" SET "quoteItemId" = NULL, "updatedAt" = now()
     WHERE "clinicId" = ${args.clinicId} AND "planId" = ${args.planId} AND "id" IN (${Prisma.join(ids)})`;
  const valores = args.ligas.filter((l) => l.quoteItemId).map((l) => Prisma.sql`(${l.filaId}, ${l.quoteItemId})`);
  if (valores.length === 0) return;
  await db.$executeRaw`
    UPDATE "treatment_plan_items" AS t
       SET "quoteItemId" = v."quoteItemId", "updatedAt" = now()
      FROM (VALUES ${Prisma.join(valores)}) AS v("id", "quoteItemId")
     WHERE t."id" = v."id" AND t."clinicId" = ${args.clinicId} AND t."planId" = ${args.planId}`;
}

export const repoFilas: RepoFilas & {
  insertar: typeof insertar;
} = {
  disponible: (forzar?: boolean) => tablaDeFilasExiste(forzar),
  leer,
  leerDePlanes,
  insertar,
  aplicarCambios,
  cambiarEstado,
  ligarANota,
  ligarAConceptos,
};

/** Filas con el plan bloqueado (FOR UPDATE): dentro de la transacción de quien escribe. */
export async function bloquearPlan(tx: DbDeFilas, clinicId: string, planId: string): Promise<boolean> {
  exigir(clinicId, planId);
  const r = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "treatment_plans" WHERE "id" = ${planId} AND "clinicId" = ${clinicId} FOR UPDATE`;
  return r.length === 1;
}

/** Los ids que SÍ son del tarifario de la clínica (los demás se anulan en la fila). */
export async function procedimientosDeLaClinica(clinicId: string, ids: Array<string | null>): Promise<Set<string>> {
  exigir(clinicId);
  const unicos = Array.from(new Set(ids.filter((x): x is string => typeof x === "string" && !!x)));
  if (unicos.length === 0) return new Set();
  const found = await prisma.procedureCatalog.findMany({ where: { clinicId, id: { in: unicos } }, select: { id: true } });
  return new Set(found.map((f) => f.id));
}
