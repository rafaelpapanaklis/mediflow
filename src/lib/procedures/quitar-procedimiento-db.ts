// «Quitar» un procedimiento — la parte que habla con la base (ws1-t8).
// `clinicId` SIEMPRE de la sesión. Cada fuente de uso es tolerante: si la
// tabla o la columna no existe, esa fuente cuenta 0 (no hay nada que romper);
// si falla por otra razón, todo el conteo es «no sé» (null) y se archiva.

import { prisma } from "@/lib/prisma";
import type { QuitarDeps } from "./quitar-procedimiento";

function faltaLaTabla(e: unknown): boolean {
  const c = (e as { code?: string })?.code;
  const m = String((e as { message?: string })?.message ?? "");
  return c === "P2021" || c === "P2022" || /does not exist/i.test(m);
}

async function tolerante(q: () => Promise<number>): Promise<number> {
  try {
    return await q();
  } catch (e) {
    if (faltaLaTabla(e)) return 0;
    throw e;
  }
}

/** Cuántos registros de la clínica apuntan a este procedimiento. */
export async function contarUsosDeProcedimiento(clinicId: string, id: string): Promise<number> {
  const enTexto = async (sql: Promise<{ n: bigint | number }[]>) => Number((await sql)[0]?.n ?? 0);
  const partes = await Promise.all([
    // Presupuestos y sesiones de tratamiento: llaves reales.
    tolerante(() => prisma.quoteItem.count({ where: { procedureId: id, quote: { clinicId } } })),
    tolerante(() => prisma.treatmentSession.count({ where: { procedureId: id, treatment: { clinicId } } })),
    // Facturas (renglones en JSON) y extras de hoja (la marca va en las notas).
    tolerante(() =>
      enTexto(prisma.$queryRaw`
        SELECT COUNT(*) AS n FROM "invoices"
         WHERE "clinicId" = ${clinicId}
           AND (POSITION(${id} IN "items"::text) > 0 OR POSITION(${id} IN COALESCE("notes", '')) > 0)`),
    ),
    // Hojas de control / procedimientos de visita (JSON de la nota del expediente).
    tolerante(() =>
      enTexto(prisma.$queryRaw`
        SELECT COUNT(*) AS n FROM "medical_records"
         WHERE "clinicId" = ${clinicId} AND POSITION(${id} IN COALESCE("specialtyData"::text, '')) > 0`),
    ),
    // Plantillas de evolución que lo precargan.
    tolerante(() => prisma.clinicalEvolutionTemplate.count({ where: { clinicId, proceduresPrefilled: { has: id } } })),
  ]);
  return partes.reduce((a, b) => a + b, 0);
}

export const quitarDepsPrisma: QuitarDeps = {
  buscar: (clinicId, id) =>
    prisma.procedureCatalog.findFirst({
      where: { id, clinicId },
      select: { id: true, name: true, code: true, category: true, isActive: true },
    }),
  contarUsos: contarUsosDeProcedimiento,
  eliminar: async (clinicId, id) => {
    await prisma.procedureCatalog.deleteMany({ where: { id, clinicId } });
  },
  archivar: async (clinicId, id) => {
    await prisma.procedureCatalog.updateMany({ where: { id, clinicId }, data: { isActive: false } });
  },
};
