import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { leerPreciosPorTecnica } from "./precios-por-tecnica-db";
import {
  limpiarNombre,
  normalizarTecnicas,
  resolverTecnicas,
  type TecnicaClinica,
} from "./tecnicas-de-la-clinica";

// Ortodoncia — técnicas propias de la clínica (ws1-t10). Dos columnas nuevas
// (sql/ortodoncia-tecnicas-propias.sql), NINGUNA declarada en schema.prisma a propósito: con una
// columna de menos, cualquier `findMany` de OrthodonticTreatmentPlan (decenas de sitios) o
// `findUnique` de OrthodonticsClinicSettings tiraría P2022. Van por SQL crudo con su sonda:
//   - orthodontics_clinic_settings."techniqueList" JSONB  → la lista de la clínica
//   - orthodontic_treatment_plans."techniqueLabel" TEXT   → el nombre propio de cada caso
// Sin la primera se ofrecen las 7 de siempre (con lo que haya en techniquePrices); sin la segunda
// cada caso muestra el nombre de su tipo base.

const TTL_MS = 60_000;
type Sonda = { existe: boolean; at: number } | null;
let sondaLista: Sonda = null;
let sondaNombre: Sonda = null;

async function sondar(tabla: string, columna: string): Promise<boolean | null> {
  try {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = ${tabla} AND column_name = ${columna}
      ) AS existe`;
    return filas[0]?.existe === true;
  } catch (e) {
    console.warn(`[ortodoncia:tecnicas] no se pudo comprobar ${tabla}.${columna}:`, e);
    return null;
  }
}

export async function columnaDeListaExiste(): Promise<boolean> {
  const t = Date.now();
  if (sondaLista && (sondaLista.existe || t - sondaLista.at < TTL_MS)) return sondaLista.existe;
  const r = await sondar("orthodontics_clinic_settings", "techniqueList");
  if (r === null) return false;
  sondaLista = { existe: r, at: t };
  return r;
}

export async function columnaDeNombreExiste(): Promise<boolean> {
  const t = Date.now();
  if (sondaNombre && (sondaNombre.existe || t - sondaNombre.at < TTL_MS)) return sondaNombre.existe;
  const r = await sondar("orthodontic_treatment_plans", "techniqueLabel");
  if (r === null) return false;
  sondaNombre = { existe: r, at: t };
  return r;
}

/** Solo para pruebas. */
export function _olvidarSondasDeTecnicas(): void {
  sondaLista = null;
  sondaNombre = null;
}

export interface TecnicasDeLaClinica {
  tecnicas: TecnicaClinica[];
  /** false = falta pegar el SQL: se ven las 7 de siempre y no se puede guardar la lista. */
  columnaLista: boolean;
  /** false = la clínica aún no editó su lista (se muestran las de siempre, sembradas). */
  editada: boolean;
}

/** La lista de la clínica (`clinicId` de la sesión). Sin columna o sin fila: las 7 de siempre. Nunca lanza. */
export async function leerTecnicasDeLaClinica(clinicId: string): Promise<TecnicasDeLaClinica> {
  const precios = await leerPreciosPorTecnica(clinicId);
  if (!clinicId) return { tecnicas: resolverTecnicas(null, precios), columnaLista: false, editada: false };
  const columnaLista = await columnaDeListaExiste();
  if (!columnaLista) return { tecnicas: resolverTecnicas(null, precios), columnaLista: false, editada: false };
  try {
    const filas = await prisma.$queryRaw<{ techniqueList: unknown }[]>`
      SELECT "techniqueList" FROM "orthodontics_clinic_settings" WHERE "clinicId" = ${clinicId}`;
    const guardada = normalizarTecnicas(filas[0]?.techniqueList);
    return { tecnicas: guardada ?? resolverTecnicas(null, precios), columnaLista: true, editada: guardada !== null };
  } catch (e) {
    console.warn("[ortodoncia:tecnicas] no se pudo leer la lista:", e);
    return { tecnicas: resolverTecnicas(null, precios), columnaLista: true, editada: false };
  }
}

/** Guarda la lista (sustituye la anterior). `sin-columna` = falta pegar el SQL. */
export async function guardarTecnicasDeLaClinica(
  clinicId: string,
  userId: string,
  tecnicas: TecnicaClinica[],
): Promise<{ ok: true; tecnicas: TecnicaClinica[] } | { ok: false; motivo: "sin-columna" | "sin-clinica" | "error" }> {
  if (!clinicId) return { ok: false, motivo: "sin-clinica" };
  if (!(await columnaDeListaExiste())) return { ok: false, motivo: "sin-columna" };
  const limpia = normalizarTecnicas(tecnicas) ?? [];
  try {
    // La fila puede no existir aún (clínica que nunca guardó su Configuración).
    await prisma.orthodonticsClinicSettings.upsert({
      where: { clinicId },
      create: { clinicId, updatedBy: userId },
      update: { updatedBy: userId },
    });
    const json = JSON.stringify(limpia);
    await prisma.$executeRaw`
      UPDATE "orthodontics_clinic_settings" SET "techniqueList" = ${json}::jsonb, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "clinicId" = ${clinicId}`;
    return { ok: true, tecnicas: limpia };
  } catch (e) {
    console.warn("[ortodoncia:tecnicas] no se pudo guardar la lista:", e);
    return { ok: false, motivo: "error" };
  }
}

/** Cliente de solo lectura por SQL crudo: el `prisma` del repo, o el doble que inyectan las pruebas de Sabina. */
export interface LectorRaw {
  $queryRaw(query: any): Promise<any>;
}

/**
 * Nombres propios de los casos, en lote. Sin la columna, sin ids o con error: mapa vacío (se muestra el
 * del tipo base). `db` = el cliente inyectado (Sabina): con él se comprueba la columna sin la caché global.
 */
export async function cargarNombresDeTecnica(clinicId: string, planIds: string[], db?: LectorRaw): Promise<Map<string, string>> {
  const salida = new Map<string, string>();
  const ids = [...new Set(planIds.filter(Boolean))];
  if (!clinicId || ids.length === 0) return salida;
  try {
    if (db) {
      const sonda = await db.$queryRaw(Prisma.sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_name = 'orthodontic_treatment_plans' AND column_name = 'techniqueLabel'
        ) AS existe`);
      if (sonda?.[0]?.existe !== true) return salida;
    } else if (!(await columnaDeNombreExiste())) {
      return salida;
    }
    const consulta = Prisma.sql`
      SELECT "id", "techniqueLabel" FROM "orthodontic_treatment_plans"
       WHERE "clinicId" = ${clinicId} AND "id" IN (${Prisma.join(ids)})`;
    const filas = (await (db ?? prisma).$queryRaw(consulta)) as { id: string; techniqueLabel: string | null }[];
    for (const f of filas) {
      const n = limpiarNombre(f.techniqueLabel);
      if (n) salida.set(f.id, n);
    }
    return salida;
  } catch (e) {
    console.warn("[ortodoncia:tecnicas] no se pudieron leer los nombres de los casos:", e);
    return salida;
  }
}

/** Mismo lector, para UN caso. `null` = mostrar el nombre del tipo base. */
export async function cargarNombreDeTecnica(clinicId: string, planId: string, db?: LectorRaw): Promise<string | null> {
  return (await cargarNombresDeTecnica(clinicId, [planId], db)).get(planId) ?? null;
}

/**
 * Nombre propio del caso. `null` lo borra (vuelve al del tipo base). No lanza: sin la columna el caso
 * queda con el nombre de su tipo base y solo avisa por consola. Devuelve si quedó guardado.
 */
export async function guardarNombreDeTecnicaDelCaso(clinicId: string, planId: string, nombre: string | null): Promise<boolean> {
  if (!clinicId || !planId) return false;
  const limpio = nombre === null ? null : limpiarNombre(nombre) || null;
  if (!(await columnaDeNombreExiste())) {
    if (limpio) console.warn("[ortodoncia:tecnicas] columna techniqueLabel aún sin aplicar (sql/ortodoncia-tecnicas-propias.sql) — el caso muestra el nombre del tipo base");
    return false;
  }
  try {
    await prisma.$executeRaw`
      UPDATE "orthodontic_treatment_plans" SET "techniqueLabel" = ${limpio}
       WHERE "id" = ${planId} AND "clinicId" = ${clinicId}`;
    return true;
  } catch (e) {
    console.warn("[ortodoncia:tecnicas] no se pudo guardar el nombre del caso:", e);
    return false;
  }
}
