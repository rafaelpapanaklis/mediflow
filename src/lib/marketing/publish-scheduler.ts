// ═══════════════════════════════════════════════════════════════════
// Scheduler de publicación del módulo Marketing (WS-MKT-T5).
// Drena MarketingPost en estado SCHEDULED ya vencidos y los publica vía
// publishToMeta() — lo implementa T4 (Conexiones/Meta); T1 dejó el stub que
// lanza NOT_IMPLEMENTED, así que esto compila y corre aunque T4 no esté.
//
// IDEMPOTENCIA / ANTI-DOBLE-PUBLICACIÓN:
//   Cada post se "reclama" con un compare-and-swap atómico — updateMany con
//   where:{ id, status:"SCHEDULED" } -> data:{ status:"PUBLISHING" }. Solo la
//   corrida que voltea la fila (count===1) sigue adelante; cualquier corrida
//   solapada ve count===0 y la salta. Así, aunque dos crons corran a la vez
//   (el cron es */5 y maxDuration=300s ⇒ pueden traslaparse), un post se
//   publica UNA sola vez.
//
// AISLAMIENTO MULTI-TENANT:
//   publishToMeta recibe SIEMPRE el post.clinicId del propio post, nunca un id
//   compartido. El disparo manual (run-scheduler) además acota la query a una
//   sola clínica (ver param clinicId).
// ═══════════════════════════════════════════════════════════════════

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publishToMeta } from "./meta";
import type { Channel } from "./types";

const DEFAULT_LIMIT = 50;          // techo de posts por corrida
const BATCH = 6;                   // concurrencia: respeta la regla del repo (Promise.all < 7) y PgBouncer
const STALE_MS = 15 * 60 * 1000;   // PUBLISHING más viejo que esto = corrida muerta (Vercel corta a 300s)

export interface DrainResult {
  processed: number;   // published + failed + requeued
  published: number;
  failed: number;
  requeued: number;    // T4 sin mergear (NOT_IMPLEMENTED): se devuelve a SCHEDULED
  reclaimed: number;   // posts rescatados de un PUBLISHING atascado por corrida muerta
  skipped: number;     // claim perdido contra otra corrida (no se reprocesa)
}

// Nunca persistimos tokens/credenciales en errorMsg.
function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/access_token=[^&\s"']+/gi, "access_token=***")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer ***")
    // Catch-all defensivo: redacta CUALQUIER credencial/token largo (tokens
    // Graph EAA…, app secrets, tokens de IG, hashes) ANTES de truncar a 500.
    // Un texto de error normal lleva espacios, así que no cae aquí.
    .replace(/[A-Za-z0-9._\-]{40,}/g, "***")
    .slice(0, 500);
}

type Outcome = "published" | "failed" | "requeued" | "skipped";

async function processPost(post: {
  id: string;
  clinicId: string;
  channel: string;
  caption: string;
  mediaUrls: string[];
}): Promise<Outcome> {
  // CLAIM atómico (compare-and-swap): solo procede quien voltea SCHEDULED -> PUBLISHING.
  const claim = await prisma.marketingPost.updateMany({
    where: { id: post.id, status: "SCHEDULED" },
    data:  { status: "PUBLISHING" },
  });
  if (claim.count !== 1) return "skipped"; // otra corrida ya lo tomó

  try {
    const result = await publishToMeta(post.clinicId, {
      caption:   post.caption,
      mediaUrls: post.mediaUrls,
      channel:   post.channel as Channel,
    });
    await prisma.marketingPost.update({
      where: { id: post.id },
      data: {
        status:      "PUBLISHED",
        publishedAt: new Date(),
        externalIds: result as Prisma.InputJsonValue,
        errorMsg:    null,
      },
    });
    return "published";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // T4 aún no mergeado: el stub lanza NOT_IMPLEMENTED. No quemamos el post a
    // FAILED — lo devolvemos a SCHEDULED para que se publique solo en cuanto T4
    // aterrice (reintento suave en cada corrida).
    if (msg === "NOT_IMPLEMENTED") {
      await prisma.marketingPost.update({
        where: { id: post.id },
        data:  { status: "SCHEDULED" },
      });
      return "requeued";
    }
    await prisma.marketingPost.update({
      where: { id: post.id },
      data:  { status: "FAILED", errorMsg: sanitizeError(err) },
    });
    return "failed";
  }
}

/**
 * Drena los posts SCHEDULED vencidos y los publica.
 * @param clinicId  si se pasa, SOLO toca posts de esa clínica (aislamiento
 *                  multi-tenant del disparo manual). Sin él, barre todas.
 * @param limit     techo de posts por corrida (default 50).
 */
export async function drainScheduledPosts(
  { clinicId, limit = DEFAULT_LIMIT }: { clinicId?: string; limit?: number } = {},
): Promise<DrainResult> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_MS);
  const scope = clinicId ? { clinicId } : {};

  // 0) Rescata posts atascados en PUBLISHING de una corrida que murió a media
  //    publicación -> vuelven a SCHEDULED para reintento. Seguro porque el
  //    umbral (15 min) >> maxDuration (5 min): nada vivo sigue en PUBLISHING
  //    tanto tiempo, así que no hay riesgo de doble publicación.
  const reclaim = await prisma.marketingPost.updateMany({
    where: { ...scope, status: "PUBLISHING", updatedAt: { lt: staleBefore } },
    data:  { status: "SCHEDULED" },
  });

  // 1) Candidatos: SCHEDULED con scheduledFor ya vencido (null nunca entra). FIFO.
  const candidates = await prisma.marketingPost.findMany({
    where: { ...scope, status: "SCHEDULED", scheduledFor: { lte: now } },
    orderBy: { scheduledFor: "asc" },
    take: limit,
    select: { id: true, clinicId: true, channel: true, caption: true, mediaUrls: true },
  });

  let published = 0, failed = 0, requeued = 0, skipped = 0;

  // 2) Procesa en tandas de <=6 (Promise.all). Cada worker reclama, publica y registra.
  for (let i = 0; i < candidates.length; i += BATCH) {
    const outcomes = await Promise.all(
      candidates.slice(i, i + BATCH).map((post) => processPost(post)),
    );
    for (const o of outcomes) {
      if (o === "published") published++;
      else if (o === "failed") failed++;
      else if (o === "requeued") requeued++;
      else skipped++;
    }
  }

  return {
    processed: published + failed + requeued,
    published,
    failed,
    requeued,
    reclaimed: reclaim.count,
    skipped,
  };
}
