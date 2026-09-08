/**
 * DaleControl INSTITUCIONAL — LA FUSIÓN DE DUPLICADOS contra la base.
 *
 * SERVIDOR: importa prisma. Lo puro (las ocho tablas, las reglas de quién
 * se puede fusionar con quién, el plan del odontograma y el de los
 * cuestionarios) vive en fusion-core.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 H-05 · «Dos pacientes idénticos, sin deshacer.»
 *
 * El aviso de duplicado ya existe; lo que no existe es la fusión. Y el
 * duplicado que recepción marca inactivo se le sigue pudiendo agendar
 * cita, porque `listEduPatientOptions` no excluye a los INACTIVE.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 MUEVE, NO BORRA. NUNCA.
 *
 * El PERDEDOR se queda con `mergedIntoId` apuntando al GANADOR, en estado
 * INACTIVE, con su fecha y su autor. Su fila SOBREVIVE porque ese folio se
 * imprimió en un consentimiento, se dictó por teléfono y está escrito en
 * una hoja de papel en un archivero: borrarla dejaría ese papel apuntando
 * a la nada. `deleteMany` no aparece en este archivo, y hay una prueba que
 * lee el fuente y falla si aparece.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 TODO EN UNA TRANSACCIÓN, Y EL ORDEN IMPORTA.
 *
 * Once escrituras. A media fusión, el expediente de una persona estaría
 * partido entre dos fichas y NADIE lo sabría: las dos se verían completas
 * por separado. Por eso `$transaction` y no once `await` seguidos.
 *
 * ⚠️ EL `timeout` VA SUBIDO A PROPÓSITO. Un paciente con veinte años de
 * historia mueve muchas filas y el default de Prisma (5 s) corta una
 * transacción a la mitad — que aquí es exactamente el estado que no puede
 * existir. Con 20 s cabe de sobra; si un día no cupiera, la salida NO es
 * partirla en dos.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCleanId } from "@/lib/edu/agenda-core";
import { eduPatientScopeWhere, eduScopeIsEmpty, eduVisibility } from "@/lib/edu/visibility";
import {
  EDU_FUSION_TABLAS,
  eduFusionCuestionariosPlan,
  eduFusionMotivoParaNoFusionar,
  eduFusionOdontogramaPlan,
  eduFusionParseReason,
  type EduFusionResumen,
} from "@/lib/edu/fusion-core";
import { eduArcoAsegurarPermiso, type EduArcoContext } from "@/lib/edu/arco";
import { eduAudit } from "@/lib/edu/auditoria";

/** Cuánto se le da a la transacción. Ver el encabezado. */
const EDU_FUSION_TIMEOUT_MS = 20_000;

function requireInstitution(ctx: { institutionId?: string }): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Tu sesión no trae instituto. Vuelve a entrar.", 401);
  }
  return id;
}

/**
 * FUSIONA dos fichas del mismo paciente.
 *
 * `ganadorId` es la ficha que SE QUEDA; `perdedorId` la que se marca como
 * fusionada. El orden lo decide quien fusiona y no el sistema: cuál de las
 * dos tiene el folio bueno, el teléfono correcto y la historia más larga
 * es un juicio humano.
 */
export async function mergeEduPatients(
  ctx: EduArcoContext,
  input: { ganadorId: unknown; perdedorId: unknown; reason?: unknown },
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{
  ganador: { id: string; folio: string };
  perdedor: { id: string; folio: string };
  movido: EduFusionResumen;
  sinMover: string[];
}> {
  eduArcoAsegurarPermiso(ctx);
  const institutionId = requireInstitution(ctx);

  const ganadorId = eduCleanId(input?.ganadorId);
  const perdedorId = eduCleanId(input?.perdedorId);
  if (!ganadorId || !perdedorId) {
    throw new EduPadronError("Faltan las dos fichas que se van a fusionar.", 400);
  }
  const reason = eduFusionParseReason(input?.reason);

  // 🔴 LOS DOS DENTRO DEL ALCANCE, y en UNA consulta con `id: { in: … }`
  // en vez de dos: son dos viajes al pooler para lo mismo, y el pooler de
  // este proyecto ya tiene su límite escrito en CLAUDE.md.
  const scope = eduVisibility(ctx, "patients");
  if (eduScopeIsEmpty(scope)) {
    throw new EduPadronError("Tu rol no alcanza a esos pacientes.", 403);
  }
  const encontrados = await prisma.eduPatient.findMany({
    where: {
      ...eduPatientScopeWhere({ institutionId, scope, now }),
      id: { in: [ganadorId, perdedorId] },
    },
    select: {
      id: true,
      folio: true,
      institutionId: true,
      firstName: true,
      lastName: true,
      deletedAt: true,
      anonymizedAt: true,
      mergedIntoId: true,
    },
  });

  const ganador = encontrados.find((p) => p.id === ganadorId);
  const perdedor = encontrados.find((p) => p.id === perdedorId);
  if (!ganador || !perdedor) {
    throw new EduPadronError("Una de las dos fichas no existe o no es de tu instituto.", 404);
  }

  const bloqueo = eduFusionMotivoParaNoFusionar(ganador, perdedor);
  if (bloqueo) throw new EduPadronError(bloqueo, 409);

  // Lo que hace falta para las dos tablas que NO se mueven con un
  // updateMany. Se lee ANTES de la transacción para que dentro solo haya
  // escrituras: una transacción que también lee es una transacción que
  // dura más, y ésta ya mueve once cosas.
  const [odontoPerdedor, odontoGanador, cuestPerdedor, maxVersionGanador] = await Promise.all([
    prisma.eduOdontogramEntry.findMany({
      where: { institutionId, patientId: perdedor.id },
      select: { id: true, tooth: true, surface: true, condition: true },
    }),
    prisma.eduOdontogramEntry.findMany({
      where: { institutionId, patientId: ganador.id },
      select: { tooth: true, surface: true, condition: true },
    }),
    prisma.eduHealthQuestionnaire.findMany({
      where: { institutionId, patientId: perdedor.id },
      select: { id: true, recordedAt: true },
    }),
    prisma.eduHealthQuestionnaire.aggregate({
      where: { institutionId, patientId: ganador.id },
      _max: { version: true },
    }),
  ]);

  const planOdonto = eduFusionOdontogramaPlan(odontoPerdedor, odontoGanador);
  const planCuest = eduFusionCuestionariosPlan(
    cuestPerdedor,
    maxVersionGanador._max.version ?? 0,
  );

  const movido: EduFusionResumen = {};

  await prisma.$transaction(
    async (tx) => {
      // ── 1 · LAS OCHO COLECCIONES ────────────────────────────────────
      // El `where` lleva SIEMPRE el institutionId además del patientId:
      // un `patientId` suelto sería un filtro que depende de que el id no
      // se repita entre escuelas, y eso es exactamente lo que no se
      // asume en este vertical.
      for (const t of EDU_FUSION_TABLAS) {
        const delegate = (tx as unknown as Record<string, {
          updateMany: (a: unknown) => Promise<{ count: number }>;
        }>)[t.model];
        const r = await delegate.updateMany({
          where: { institutionId, patientId: perdedor.id },
          data: { patientId: ganador.id },
        });
        movido[t.label] = r.count;
      }

      // ── 2 · EL ODONTOGRAMA, fila a fila ─────────────────────────────
      // Los que chocarían contra el índice único de cinco columnas se
      // QUEDAN en la ficha del perdedor, con su autor y su fecha. No se
      // borran: dos personas miraron la misma boca en dos momentos.
      if (planOdonto.mover.length > 0) {
        const r = await tx.eduOdontogramEntry.updateMany({
          where: { institutionId, patientId: perdedor.id, id: { in: planOdonto.mover } },
          data: { patientId: ganador.id },
        });
        movido["hallazgos del odontograma"] = r.count;
      } else {
        movido["hallazgos del odontograma"] = 0;
      }

      // ── 3 · LOS CUESTIONARIOS, renumerados ──────────────────────────
      // De MAYOR a MENOR versión, que es como los devuelve el plan: al
      // revés, la primera escritura chocaría contra el índice único
      // (patientId, version) de una que todavía no se ha movido.
      for (const q of planCuest) {
        await tx.eduHealthQuestionnaire.updateMany({
          where: { institutionId, id: q.id },
          data: { patientId: ganador.id, version: q.version },
        });
      }
      movido["versiones del cuestionario"] = planCuest.length;

      // ── 4 · Y EL PERDEDOR, marcado ──────────────────────────────────
      // 🔴 `mergedIntoId: null` EN EL WHERE. Es el candado contra la
      // doble fusión: si otra pantalla fusionó esta misma ficha mientras
      // ésta corría, el count sale 0 y la transacción entera se deshace
      // — con las once escrituras de arriba incluidas.
      const marcado = await tx.eduPatient.updateMany({
        where: { id: perdedor.id, institutionId, mergedIntoId: null },
        data: {
          mergedIntoId: ganador.id,
          mergedAt: now,
          mergedById: ctx.eduUserId,
          status: "INACTIVE",
          deletedAt: perdedor.deletedAt ?? now,
          deletedById: ctx.eduUserId,
          deleteReason: `Fusionada con ${ganador.folio}: ${reason}`.slice(0, 500),
        },
      });
      if (marcado.count === 0) {
        throw new EduPadronError(
          "Esa ficha se fusionó con otra mientras ésta corría: no se movió nada. Actualiza la pantalla.",
          409,
        );
      }
    },
    { timeout: EDU_FUSION_TIMEOUT_MS },
  );

  await eduAudit(ctx, {
    action: "arco",
    entity: "patient",
    entityId: perdedor.id,
    patientId: ganador.id,
    before: { folio: perdedor.folio, mergedIntoId: null },
    after: {
      mergedIntoId: ganador.id,
      ganador: ganador.folio,
      motivo: reason,
      movido: JSON.stringify(movido),
    },
    ...meta,
  });

  return {
    ganador: { id: ganador.id, folio: ganador.folio },
    perdedor: { id: perdedor.id, folio: perdedor.folio },
    movido,
    sinMover: planOdonto.sePierdenPorChoque,
  };
}

/**
 * Los CANDIDATOS a duplicado de una ficha: mismo nombre y apellido, o
 * mismo teléfono, dentro del alcance.
 *
 * 🔴 SUGIERE, NO DECIDE. Dos hermanas con el mismo apellido y el teléfono
 * de su madre saldrían aquí, y NO son la misma persona. Quien fusiona es
 * quien mira las dos fichas; esto solo se las pone delante.
 */
export async function listEduFusionCandidatos(
  ctx: EduArcoContext,
  patientId: string,
  now: Date = new Date(),
): Promise<{ id: string; folio: string; nombre: string; motivo: string }[]> {
  eduArcoAsegurarPermiso(ctx);
  const institutionId = requireInstitution(ctx);

  const scope = eduVisibility(ctx, "patients");
  if (eduScopeIsEmpty(scope)) return [];
  const id = eduCleanId(patientId);
  if (!id) return [];
  const base = eduPatientScopeWhere({ institutionId, scope, now });

  const yo = await prisma.eduPatient.findFirst({
    where: { ...base, id },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
  if (!yo) return [];

  const or: Prisma.EduPatientWhereInput[] = [
    { firstName: { equals: yo.firstName, mode: "insensitive" }, lastName: { equals: yo.lastName, mode: "insensitive" } },
  ];
  if (yo.phone && yo.phone.trim()) or.push({ phone: yo.phone });

  const filas = await prisma.eduPatient.findMany({
    where: {
      ...base,
      id: { not: yo.id },
      // Una ficha ya fusionada no vuelve a ser candidata: su expediente ya
      // está en otra parte.
      mergedIntoId: null,
      OR: or,
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, folio: true, firstName: true, lastName: true, phone: true },
  });

  return filas.map((p) => ({
    id: p.id,
    folio: p.folio,
    nombre: `${p.firstName} ${p.lastName}`.trim(),
    motivo:
      p.firstName.toLowerCase() === yo.firstName.toLowerCase() &&
      p.lastName.toLowerCase() === yo.lastName.toLowerCase()
        ? "Mismo nombre y apellido"
        : "Mismo teléfono",
  }));
}
