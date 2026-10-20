/**
 * COLOR POR PROCEDIMIENTO (WS1-T5) — leer y guardar el color de cada
 * procedimiento del catálogo.
 *
 * 🔴 COLUMNA FUERA DE schema.prisma, A PROPÓSITO. `procedure_catalog` se lee
 * sin `select` en media aplicación (facturas, presupuestos, odontograma…):
 * declarar `agendaColor` en el modelo reventaría todas esas lecturas con P2022
 * mientras Rafael no pegue sql/salamanca-agenda.sql. Va por SQL crudo con
 * sonda, igual que `botBookable` (whatsapp/bot/servicios-agendables-db.ts).
 * Sin columna: nadie tiene color elegido y cada procedimiento usa el suyo por
 * defecto (`colorPorDefecto`), que no necesita base.
 */
import { prisma } from "@/lib/prisma";
import { claveDeProcedimiento, esClaveColor, type ClaveColorProcedimiento, type ProcedimientoConColor } from "./color-procedimiento";

const RECORDAR_AUSENCIA_MS = 10 * 60 * 1000;
const CLAVE = Symbol.for("dalecontrol.agenda.agendaColorColumna");
type Sonda = { existe: boolean; at: number };
const memoria = globalThis as unknown as Record<symbol, Sonda | undefined>;

export async function columnaAgendaColorExiste(forzar = false): Promise<boolean> {
  const s = memoria[CLAVE];
  if (!forzar && s && (s.existe || Date.now() - s.at < RECORDAR_AUSENCIA_MS)) return s.existe;
  try {
    const filas = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'procedure_catalog' AND column_name = 'agendaColor'`;
    const existe = Number(filas[0]?.n ?? 0) === 1;
    memoria[CLAVE] = { existe, at: Date.now() };
    return existe;
  } catch (e) {
    console.warn("[agenda/color-procedimiento] no se pudo comprobar la columna:", e);
    return false;
  }
}

/** id → clave elegida, de ESTA clínica. Sin columna o ante error: ninguno. */
export async function coloresElegidos(clinicId: string): Promise<Record<string, ClaveColorProcedimiento>> {
  if (!clinicId || !(await columnaAgendaColorExiste())) return {};
  try {
    const filas = await prisma.$queryRaw<{ id: string; agendaColor: string | null }[]>`
      SELECT "id", "agendaColor" FROM "procedure_catalog"
       WHERE "clinicId" = ${clinicId} AND "agendaColor" IS NOT NULL`;
    const out: Record<string, ClaveColorProcedimiento> = {};
    for (const f of filas) if (esClaveColor(f.agendaColor)) out[f.id] = f.agendaColor;
    return out;
  } catch (e) {
    console.warn("[agenda/color-procedimiento] no se pudieron leer los colores:", e);
    return {};
  }
}

/** Los procedimientos ACTIVOS de la clínica con su color ya resuelto (para la agenda). */
export async function procedimientosConColor(clinicId: string): Promise<ProcedimientoConColor[]> {
  if (!clinicId) return [];
  const [catalogo, elegidos] = await Promise.all([
    prisma.procedureCatalog.findMany({
      where: { clinicId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    coloresElegidos(clinicId),
  ]);
  return catalogo.map((p) => ({
    id: p.id,
    nombre: p.name,
    color: claveDeProcedimiento({ id: p.id, color: elegidos[p.id] ?? null }),
  }));
}

/**
 * Guarda el color elegido (`null` = vuelve al de por defecto). `false` = la
 * columna no existe todavía (el SQL sin pegar): la ruta lo dice en la respuesta.
 */
export async function guardarColorProcedimiento(
  procedureId: string,
  clinicId: string,
  color: ClaveColorProcedimiento | null,
): Promise<boolean> {
  if (!clinicId || !procedureId || !(await columnaAgendaColorExiste(true))) return false;
  await prisma.$executeRaw`
    UPDATE "procedure_catalog" SET "agendaColor" = ${color}
     WHERE "id" = ${procedureId} AND "clinicId" = ${clinicId}`;
  return true;
}
