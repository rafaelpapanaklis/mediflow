import "server-only";
import { prisma } from "@/lib/prisma";
import { HECHOS_DENTRO_DEL_CONTROL, ORTHO_CATALOG_CATEGORY } from "@/lib/orthodontics/catalog-procedures";
import { GENERICAS_DE_FABRICA, normalizarGenericas, type FilaCatalogo, type GenericasBot } from "./menu-agenda-core";

// ws1-t3 — «Se agenda por WhatsApp» (sql/ws1-t3-bot-servicios-agendables.sql).
// Columna `procedure_catalog."botBookable"` fuera de schema.prisma a propósito
// (ver el SQL): va por SQL crudo con sonda y, sin ella, nadie está marcado.

const RECORDAR_AUSENCIA_MS = 10 * 60 * 1000;
const CLAVE = Symbol.for("dalecontrol.bot.botBookableColumna");
type Sonda = { existe: boolean; at: number };
const memoria = globalThis as unknown as Record<symbol, Sonda | undefined>;

export async function columnaBotBookableExiste(forzar = false): Promise<boolean> {
  const s = memoria[CLAVE];
  if (!forzar && s && (s.existe || Date.now() - s.at < RECORDAR_AUSENCIA_MS)) return s.existe;
  try {
    const filas = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'procedure_catalog' AND column_name = 'botBookable'`;
    const existe = Number(filas[0]?.n ?? 0) === 1;
    memoria[CLAVE] = { existe, at: Date.now() };
    return existe;
  } catch (e) {
    console.warn("[bot/agendables] no se pudo comprobar la columna:", e);
    return false;
  }
}

/** ids de los procedimientos marcados de ESTA clínica. Sin columna o ante error: ninguno. */
async function idsMarcados(clinicId: string): Promise<Set<string>> {
  if (!clinicId || !(await columnaBotBookableExiste())) return new Set();
  try {
    const filas = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "procedure_catalog"
       WHERE "clinicId" = ${clinicId} AND "isActive" = true AND "botBookable" = true`;
    return new Set(filas.map((f) => f.id));
  } catch (e) {
    console.warn("[bot/agendables] no se pudieron leer las marcas:", e);
    return new Set();
  }
}

/** Para la pantalla del catálogo: id → marcado. */
export async function marcasDeLaClinica(clinicId: string): Promise<Record<string, boolean>> {
  const ids = await idsMarcados(clinicId);
  return Object.fromEntries([...ids].map((id) => [id, true]));
}

/** Guarda la casilla. false = la columna no existe todavía (el SQL sin pegar). */
export async function guardarMarcaAgendable(procedureId: string, clinicId: string, valor: boolean): Promise<boolean> {
  if (!clinicId || !(await columnaBotBookableExiste(true))) return false;
  await prisma.$executeRaw`
    UPDATE "procedure_catalog" SET "botBookable" = ${valor}
     WHERE "id" = ${procedureId} AND "clinicId" = ${clinicId}`;
  return true;
}

/** Catálogo activo agendable (sin los «hechos dentro del control» de ortodoncia). */
async function catalogoActivo(clinicId: string): Promise<FilaCatalogo[]> {
  return prisma.procedureCatalog.findMany({
    where: {
      clinicId,
      isActive: true,
      NOT: { category: ORTHO_CATALOG_CATEGORY, name: { in: [...HECHOS_DENTRO_DEL_CONTROL] } },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, duration: true },
  });
}

/** Lo que necesita el menú del bot: marcados (alfabético) + catálogo para casar las opciones de fábrica. */
export async function listBotServiceMenu(
  clinicId: string,
): Promise<{ marcados: FilaCatalogo[]; catalogo: FilaCatalogo[]; genericas: GenericasBot }> {
  const catalogo = await catalogoActivo(clinicId);
  const ids = await idsMarcados(clinicId);
  const genericas = await leerGenericas(clinicId);
  return { marcados: catalogo.filter((c) => ids.has(c.id)), catalogo, genericas };
}

// ── ws1-t9 · casillas de las opciones genéricas (sql/ws1-t9-bot-genericas.sql) ──
// Columna `whatsapp_bot_configs."botGenericas"` JSONB, fuera de schema.prisma
// (mismo motivo que precios-bot.ts). Sin ella: las tres activas.
const CLAVE_GEN = Symbol.for("dalecontrol.bot.botGenericasColumna");
const memoriaGen = globalThis as unknown as Record<symbol, Sonda | undefined>;

export async function columnaGenericasExiste(forzar = false): Promise<boolean> {
  const s = memoriaGen[CLAVE_GEN];
  if (!forzar && s && (s.existe || Date.now() - s.at < RECORDAR_AUSENCIA_MS)) return s.existe;
  try {
    const filas = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'whatsapp_bot_configs' AND column_name = 'botGenericas'`;
    const existe = Number(filas[0]?.n ?? 0) === 1;
    memoriaGen[CLAVE_GEN] = { existe, at: Date.now() };
    return existe;
  } catch (e) {
    console.warn("[bot/genericas] no se pudo comprobar la columna:", e);
    return false;
  }
}

/** Las casillas de ESTA clínica. Nunca lanza: ante cualquier duda, las tres activas. */
export async function leerGenericas(clinicId: string | null | undefined): Promise<GenericasBot> {
  if (!clinicId || !(await columnaGenericasExiste())) return { ...GENERICAS_DE_FABRICA };
  try {
    const filas = await prisma.$queryRaw<{ botGenericas: unknown }[]>`
      SELECT "botGenericas" FROM "whatsapp_bot_configs" WHERE "clinicId" = ${clinicId} LIMIT 1`;
    return normalizarGenericas(filas[0]?.botGenericas);
  } catch (e) {
    console.warn("[bot/genericas] no se pudieron leer las casillas:", e);
    return { ...GENERICAS_DE_FABRICA };
  }
}

/** Guarda las casillas de la clínica de la SESIÓN. `sin-columna` = falta pegar el SQL. */
export async function guardarGenericas(
  clinicId: string,
  g: GenericasBot,
): Promise<{ ok: true } | { ok: false; motivo: "sin-columna" | "sin-clinica" | "error" }> {
  if (!clinicId) return { ok: false, motivo: "sin-clinica" };
  if (!(await columnaGenericasExiste(true))) return { ok: false, motivo: "sin-columna" };
  try {
    await prisma.$executeRaw`
      UPDATE "whatsapp_bot_configs" SET "botGenericas" = ${JSON.stringify(g)}::jsonb
       WHERE "clinicId" = ${clinicId}`;
    return { ok: true };
  } catch (e) {
    console.error("[bot/genericas] no se pudieron guardar las casillas:", e);
    return { ok: false, motivo: "error" };
  }
}

/** Nombres de los procedimientos marcados «Se agenda por WhatsApp» (solo lectura, para la pantalla del bot). */
export async function nombresMarcados(clinicId: string): Promise<string[]> {
  const catalogo = await catalogoActivo(clinicId);
  const ids = await idsMarcados(clinicId);
  return catalogo.filter((c) => ids.has(c.id)).map((c) => c.name);
}
