import "server-only";
import { prisma } from "@/lib/prisma";
import { HECHOS_DENTRO_DEL_CONTROL, ORTHO_CATALOG_CATEGORY } from "@/lib/orthodontics/catalog-procedures";
import type { FilaCatalogo } from "./menu-agenda-core";

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
export async function listBotServiceMenu(clinicId: string): Promise<{ marcados: FilaCatalogo[]; catalogo: FilaCatalogo[] }> {
  const catalogo = await catalogoActivo(clinicId);
  const ids = await idsMarcados(clinicId);
  return { marcados: catalogo.filter((c) => ids.has(c.id)), catalogo };
}
