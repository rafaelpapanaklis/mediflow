/**
 * DaleControl INSTITUCIONAL — EL HISTORIAL DEL CUPO DE IA.
 *
 * SERVIDOR: importa prisma. No tiene parte pura: son dos funciones de
 * cuatro líneas sobre una tabla de bitácora.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ EXISTE, Y POR QUÉ ES UNA TABLA Y NO DOS COLUMNAS
 *
 * Lo dejó escrito el propio `EduAiQuota` en el esquema: «`updatedByUserId`
 * / `updatedByName` guardan el ÚLTIMO cambio, no la historia: si algún día
 * hace falta la historia del cupo, es una tabla aparte y no una columna
 * más». Ésta es esa tabla.
 *
 * Encender el excedente (`allowOverage`) y subir el tope duro
 * (`hardCapUsdCents`) son decisiones que cuestan dinero REAL de la
 * escuela, y "quién lo subió y cuándo" no se contesta con dos columnas que
 * se pisan en cada guardado.
 *
 * 🔴 QUIÉN LO LEE: `ia.view`. Ninguna key nueva — es la misma pantalla que
 * ya enseña el cupo.
 *
 * ⛔ ESTE ARCHIVO NO ESCRIBE EL CUPO. `src/lib/edu/ia-cupo.ts` es de otra
 * casilla; aquí está el ESCRITOR del historial para que se le llame desde
 * la transacción que guarda el cupo, con su `tx`.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import type { EduAuditActor } from "@/lib/edu/auditoria";

type EduDb = Pick<typeof prisma, "eduAiQuotaChange"> | Prisma.TransactionClient;

/**
 * Registra un cambio del cupo. Best-effort, como `eduAudit`: si el
 * historial falla, lo que NO puede pasar es que se caiga el guardado del
 * cupo que lo generó.
 */
export async function eduAiQuotaChange(
  ctx: EduAuditActor,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  db: EduDb = prisma,
): Promise<void> {
  try {
    if (!ctx?.institutionId) return;
    await db.eduAiQuotaChange.create({
      data: {
        institutionId: ctx.institutionId,
        before: (before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: after as Prisma.InputJsonValue,
        changedById: ctx.eduUserId,
        changedByName: `${ctx.user.firstName} ${ctx.user.lastName}`.trim().slice(0, 160) || "—",
      },
    });
  } catch (err) {
    console.error("[instituto] no se pudo escribir el historial del cupo de IA:", err);
  }
}

export interface EduAiQuotaChangeRow {
  id: string;
  createdAt: string;
  changedByName: string;
  before: unknown;
  after: unknown;
}

/** EL HISTORIAL del cupo, más reciente primero. */
export async function listEduAiQuotaChanges(
  ctx: { institutionId: string },
  take = 50,
): Promise<EduAiQuotaChangeRow[]> {
  const institutionId = ctx?.institutionId;
  if (!institutionId || typeof institutionId !== "string") {
    throw new EduPadronError("Tu sesión no trae instituto. Vuelve a entrar.", 401);
  }
  const filas = await prisma.eduAiQuotaChange.findMany({
    where: { institutionId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(1, take), 200),
    select: { id: true, createdAt: true, changedByName: true, before: true, after: true },
  });
  return filas.map((f) => ({
    id: f.id,
    createdAt: f.createdAt.toISOString(),
    changedByName: f.changedByName,
    before: f.before,
    after: f.after,
  }));
}
