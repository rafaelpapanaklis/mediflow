// Ortodoncia — ¿la base ya tiene los materiales de arco de `sql/ws1-t12-material-de-arco.sql`? (ws1-t12, punto 4d)
//
// Se pregunta a `pg_enum`, que nunca falla (no se intenta escribir un valor que la base no conoce para ver si truena: eso
// deja errores en los logs de Postgres). La respuesta se recuerda en `globalThis` para que sobreviva a las recargas de
// `next dev`. Con los valores puestos ya no se vuelve a preguntar; sin ellos, se re-pregunta cada 10 minutos. Solo se
// consulta cuando el doctor elige uno de los materiales nuevos.

import { MATERIALES_NUEVOS } from "./material-de-arco";

const LLAVE = Symbol.for("dalecontrol.orto.materialesDeArcoEnLaBase");
const REPREGUNTAR_MS = 10 * 60 * 1000;

type Memoria = { hay: boolean; en: number };

export async function materialesNuevosEnLaBase(
  consultar: () => Promise<{ enumlabel: string }[]> = async () => {
    const { prisma } = await import("@/lib/prisma");
    return prisma.$queryRaw<{ enumlabel: string }[]>`
      SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'OrthoWireMaterial'`;
  },
  ahora: number = Date.now(),
): Promise<boolean> {
  const g = globalThis as unknown as Record<symbol, Memoria | undefined>;
  const previa = g[LLAVE];
  if (previa && (previa.hay || ahora - previa.en < REPREGUNTAR_MS)) return previa.hay;
  try {
    const filas = await consultar();
    const hay = Array.from(MATERIALES_NUEVOS).every((m) => filas.some((f) => f.enumlabel === m));
    g[LLAVE] = { hay, en: ahora };
    return hay;
  } catch (e) {
    console.warn("[ortho] no se pudo leer OrthoWireMaterial de pg_enum:", e);
    return false;
  }
}

/** Solo para las pruebas: olvida la respuesta guardada. */
export function olvidarMaterialesEnLaBase(): void {
  delete (globalThis as unknown as Record<symbol, Memoria | undefined>)[LLAVE];
}
