import { prisma } from "@/lib/prisma";
import { normalizarPrecios, type PreciosPorTecnica } from "./precios-por-tecnica";

// Ortodoncia — precio por técnica (ws1-t10, decisión 2). La columna `techniquePrices`
// (sql/ortodoncia-precios-por-tecnica.sql) NO se declara en schema.prisma a propósito:
// con una columna de menos, un `findUnique` normal de OrthodonticsClinicSettings
// tiraría P2022 en toda la app. Va por SQL crudo con una sonda de columna.

let sonda: { existe: boolean; at: number } | null = null;
const TTL_MS = 60_000;

export async function columnaDePreciosExiste(): Promise<boolean> {
  const t = Date.now();
  if (sonda && (sonda.existe || t - sonda.at < TTL_MS)) return sonda.existe;
  try {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'orthodontics_clinic_settings' AND column_name = 'techniquePrices'
      ) AS existe`;
    sonda = { existe: filas[0]?.existe === true, at: t };
    return sonda.existe;
  } catch (e) {
    console.warn("[ortodoncia:precios] no se pudo comprobar la columna:", e);
    return false;
  }
}

/** Solo para pruebas. */
export function _olvidarSondaDePrecios(): void {
  sonda = null;
}

/** La tabla de precios de la clínica (`clinicId` de la sesión). Sin columna o sin fila: {}. Nunca lanza. */
export async function leerPreciosPorTecnica(clinicId: string): Promise<PreciosPorTecnica> {
  if (!clinicId) return {};
  if (!(await columnaDePreciosExiste())) return {};
  try {
    const filas = await prisma.$queryRaw<{ techniquePrices: unknown }[]>`
      SELECT "techniquePrices" FROM "orthodontics_clinic_settings" WHERE "clinicId" = ${clinicId}`;
    return normalizarPrecios(filas[0]?.techniquePrices);
  } catch (e) {
    console.warn("[ortodoncia:precios] no se pudo leer la tabla de precios:", e);
    return {};
  }
}

/** Guarda la tabla (sustituye la anterior). `sin-columna` = falta pegar el SQL. */
export async function guardarPreciosPorTecnica(
  clinicId: string,
  userId: string,
  precios: PreciosPorTecnica,
): Promise<{ ok: boolean; motivo?: "sin-columna" | "sin-clinica" | "error" }> {
  if (!clinicId) return { ok: false, motivo: "sin-clinica" };
  if (!(await columnaDePreciosExiste())) return { ok: false, motivo: "sin-columna" };
  try {
    // La fila puede no existir aún (clínica que nunca guardó su Configuración): se crea
    // vacía con los defaults del módulo y luego se le pone la tabla.
    await prisma.orthodonticsClinicSettings.upsert({
      where: { clinicId },
      create: { clinicId, updatedBy: userId },
      update: { updatedBy: userId },
    });
    const json = JSON.stringify(normalizarPrecios(precios));
    await prisma.$executeRaw`
      UPDATE "orthodontics_clinic_settings" SET "techniquePrices" = ${json}::jsonb, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "clinicId" = ${clinicId}`;
    return { ok: true };
  } catch (e) {
    console.warn("[ortodoncia:precios] no se pudo guardar:", e);
    return { ok: false, motivo: "error" };
  }
}
