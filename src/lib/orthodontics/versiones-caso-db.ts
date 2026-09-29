import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { columnaDeDiagnosticoDetalleExiste } from "./diagnostico-detalle-db";
import { columnaDePlanDetalleExiste } from "./plan-detalle-db";
import { cargarNombreDeTecnica } from "./tecnicas-de-la-clinica-db";
import type { VersionCerrada } from "./versiones-caso";

// Ortodoncia — REEVALUACIONES (ws1-t8): las versiones cerradas del caso en `orthodontic_case_versions`
// (sql/ortodoncia-reevaluaciones.sql), por SQL crudo con sonda: la tabla NO está en schema.prisma. Sin ella, no
// hay línea de tiempo y cerrar una versión dice que falta el SQL. La tabla no acepta UPDATE ni DELETE (reglas):
// aquí solo se INSERTA y se LEE.
//
// `clinicId` y `userId` SIEMPRE de la sesión; cada consulta filtra por clínica (sin clínica no se consulta).

const TTL_MS = 60_000;
let sonda: { existe: boolean; at: number } | null = null;

export async function tablaDeVersionesExiste(): Promise<boolean> {
  const t = Date.now();
  if (sonda && (sonda.existe || t - sonda.at < TTL_MS)) return sonda.existe;
  try {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orthodontic_case_versions') AS existe`;
    sonda = { existe: filas[0]?.existe === true, at: t };
    return sonda.existe;
  } catch (e) {
    console.warn("[ortodoncia:versiones] no se pudo comprobar la tabla:", e);
    return false;
  }
}

interface FilaVersion {
  id: string;
  numero: number;
  iniciadaEl: Date;
  cerradaEl: Date;
  motivo: string;
  cerradaPorUserId: string | null;
  diagnostico: Record<string, unknown>;
  diagnosticoDetalle: unknown;
  plan: Record<string, unknown>;
  planDetalle: unknown;
}

/** Las versiones cerradas de un caso, de la inicial a la última. `null` = falta la tabla. Nunca lanza. */
export async function listarVersionesDelCaso(clinicId: string, treatmentPlanId: string): Promise<VersionCerrada[] | null> {
  if (!clinicId || !treatmentPlanId) return [];
  if (!(await tablaDeVersionesExiste())) return null;
  try {
    const filas = await prisma.$queryRaw<FilaVersion[]>`
      SELECT "id", "numero", "iniciadaEl", "cerradaEl", "motivo", "cerradaPorUserId",
             "diagnostico", "diagnosticoDetalle", "plan", "planDetalle"
        FROM "orthodontic_case_versions"
       WHERE "clinicId" = ${clinicId} AND "treatmentPlanId" = ${treatmentPlanId}
       ORDER BY "numero" ASC`;
    const ids = [...new Set(filas.map((f) => f.cerradaPorUserId).filter((x): x is string => Boolean(x)))];
    const usuarios = ids.length
      ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } }).catch(() => [])
      : [];
    const nombre = new Map(usuarios.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
    return filas.map((f) => ({
      id: f.id,
      numero: Number(f.numero),
      iniciadaEl: new Date(f.iniciadaEl).toISOString(),
      cerradaEl: new Date(f.cerradaEl).toISOString(),
      motivo: f.motivo,
      cerradaPor: f.cerradaPorUserId ? nombre.get(f.cerradaPorUserId) ?? null : null,
      diagnostico: f.diagnostico ?? {},
      diagnosticoDetalle: f.diagnosticoDetalle,
      plan: f.plan ?? {},
      planDetalle: f.planDetalle,
    }));
  } catch (e) {
    console.warn("[ortodoncia:versiones] no se pudieron leer las versiones:", e);
    return [];
  }
}

/** La foto como JSON plano (Decimal → texto, fechas → ISO). */
function plano(v: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(v ?? {})) as Record<string, unknown>;
}

/**
 * Cierra la versión viva del caso: guarda la foto del diagnóstico y del plan COMPLETOS con el motivo. Bajo candado
 * de fila del plan (dos reevaluaciones a la vez no se pisan; el índice único plan+número lo respalda).
 */
export async function cerrarVersionDelCaso(args: {
  clinicId: string;
  userId: string;
  treatmentPlanId: string;
  motivo: string;
}): Promise<{ ok: true; numero: number; patientId: string } | { ok: false; error: string }> {
  const { clinicId, userId, treatmentPlanId, motivo } = args;
  if (!clinicId || !userId || !treatmentPlanId) return { ok: false, error: "Sesión sin clínica" };
  if (!(await tablaDeVersionesExiste())) {
    return { ok: false, error: "Falta pegar sql/ortodoncia-reevaluaciones.sql: todavía no se pueden guardar reevaluaciones." };
  }
  const [conDetalle, conPlanDetalle, nombreTecnica] = await Promise.all([
    columnaDeDiagnosticoDetalleExiste(),
    columnaDePlanDetalleExiste(),
    cargarNombreDeTecnica(clinicId, treatmentPlanId).catch(() => null),
  ]);
  try {
    return await prisma.$transaction(async (tx) => {
      const bloqueo = (await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "orthodontic_treatment_plans"
         WHERE "id" = ${treatmentPlanId} AND "clinicId" = ${clinicId} AND "deletedAt" IS NULL
         FOR UPDATE`)) as { id: string }[];
      if (bloqueo.length === 0) return { ok: false as const, error: "Caso no encontrado" };

      const plan = await tx.orthodonticTreatmentPlan.findFirst({ where: { id: treatmentPlanId, clinicId } });
      if (!plan) return { ok: false as const, error: "Caso no encontrado" };
      const dx = await tx.orthodonticDiagnosis.findFirst({ where: { id: plan.diagnosisId, clinicId } });
      if (!dx) return { ok: false as const, error: "El caso no tiene diagnóstico" };

      const previas = (await tx.$queryRaw(Prisma.sql`
        SELECT "numero", "cerradaEl" FROM "orthodontic_case_versions"
         WHERE "clinicId" = ${clinicId} AND "treatmentPlanId" = ${treatmentPlanId}
         ORDER BY "numero" DESC LIMIT 1`)) as { numero: number; cerradaEl: Date }[];
      const numero = previas.length ? Number(previas[0]!.numero) + 1 : 0;
      const iniciadaEl = previas.length ? new Date(previas[0]!.cerradaEl) : dx.diagnosedAt;

      let detalle: unknown = null;
      if (conDetalle) {
        const f = (await tx.$queryRaw(Prisma.sql`
          SELECT "diagnosticoDetalle" FROM "orthodontic_diagnoses" WHERE "id" = ${dx.id} AND "clinicId" = ${clinicId}`)) as { diagnosticoDetalle: unknown }[];
        detalle = f[0]?.diagnosticoDetalle ?? null;
      }
      let planDetalle: unknown = null;
      if (conPlanDetalle) {
        const f = (await tx.$queryRaw(Prisma.sql`
          SELECT "planDetalle" FROM "orthodontic_treatment_plans" WHERE "id" = ${treatmentPlanId} AND "clinicId" = ${clinicId}`)) as { planDetalle: unknown }[];
        planDetalle = f[0]?.planDetalle ?? null;
      }
      const fotoPlan = { ...plano(plan), ...(nombreTecnica ? { techniqueLabel: nombreTecnica } : {}) };

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "orthodontic_case_versions"
          ("id", "clinicId", "patientId", "treatmentPlanId", "diagnosisId", "numero", "iniciadaEl", "cerradaEl",
           "motivo", "cerradaPorUserId", "diagnostico", "diagnosticoDetalle", "plan", "planDetalle")
        VALUES (${randomUUID()}, ${clinicId}, ${plan.patientId}, ${treatmentPlanId}, ${dx.id}, ${numero}, ${iniciadaEl},
                CURRENT_TIMESTAMP, ${motivo}, ${userId}, ${JSON.stringify(plano(dx))}::jsonb,
                ${detalle === null ? null : JSON.stringify(detalle)}::jsonb, ${JSON.stringify(fotoPlan)}::jsonb,
                ${planDetalle === null ? null : JSON.stringify(planDetalle)}::jsonb)`);
      return { ok: true as const, numero, patientId: plan.patientId };
    });
  } catch (e) {
    const code = (e as { code?: string; meta?: { code?: string } } | null)?.meta?.code ?? (e as { code?: string } | null)?.code;
    if (code === "23505" || code === "P2002") return { ok: false, error: "Alguien acaba de guardar otra reevaluación de este caso. Recarga la ficha." };
    console.error("[ortodoncia:versiones] no se pudo cerrar la versión:", e);
    return { ok: false, error: "No se pudo guardar la reevaluación" };
  }
}
