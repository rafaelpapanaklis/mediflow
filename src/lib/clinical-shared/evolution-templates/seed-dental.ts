// Clinical-shared — seed de las 8 plantillas de odontología general.
//
// Se crea on-demand la primera vez que se abre la ficha dental de una clínica.
// Idempotente por (clinicId, module, name): una plantilla que la
// clínica ya tenga (o haya borrado con deletedAt) no se toca.
//
// ⚠️ Requiere el valor `dental` en el enum "ClinicalModule" de la base:
// sql/clinical-module-dental-enum.sql. Sin él, la consulta lanza.

import { prisma } from "@/lib/prisma";
import { DENTAL_DEFAULT_TEMPLATES, DENTAL_MODULE } from "./dental-templates";

export { DENTAL_DEFAULT_TEMPLATES };

/**
 * Crea las plantillas dentales default si no existen. Idempotente.
 * Retorna cuántas fueron creadas en esta llamada.
 */
export async function ensureDentalDefaults(args: {
  clinicId: string;
  createdBy: string;
}): Promise<{ created: number; total: number }> {
  // `clinicId: undefined` no filtra nada en Prisma: se corta antes de consultar.
  if (!args.clinicId || !args.createdBy) {
    throw new Error("ensureDentalDefaults: clinicId y createdBy son obligatorios");
  }
  // Una lectura y, solo si falta algo, una escritura. La ficha llama a esto en
  // cada «Nueva consulta»: ocho upserts por apertura eran ocho escrituras para
  // nada. Se cuentan también las borradas (deletedAt): una plantilla que la
  // clínica quitó no se resucita. skipDuplicates cubre la carrera de dos
  // pestañas sembrando a la vez contra el unique (clinicId, module, name).
  const existing = await prisma.clinicalEvolutionTemplate.findMany({
    where: { clinicId: args.clinicId, module: DENTAL_MODULE },
    select: { name: true },
  });
  const have = new Set(existing.map((r) => r.name));
  const missing = DENTAL_DEFAULT_TEMPLATES.filter((t) => !have.has(t.name));
  if (missing.length === 0) return { created: 0, total: DENTAL_DEFAULT_TEMPLATES.length };
  const result = await prisma.clinicalEvolutionTemplate.createMany({
    data: missing.map((t) => ({
      clinicId: args.clinicId,
      module: DENTAL_MODULE,
      name: t.name,
      soapTemplate: t.soap as unknown as object,
      proceduresPrefilled: t.procedures,
      materialsPrefilled: t.materials,
      isDefault: t.isDefault,
      createdBy: args.createdBy,
    })),
    skipDuplicates: true,
  });
  return { created: result.count, total: DENTAL_DEFAULT_TEMPLATES.length };
}
