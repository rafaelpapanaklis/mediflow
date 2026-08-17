/**
 * Moderación de las páginas de socio — LAS TRANSICIONES.
 *
 * Tres decisiones, y las tres viven aquí en vez de en el route handler para
 * que la regla de qué se publica esté escrita UNA vez:
 *
 *   aprobar()   pendiente → publicado. Copia los tres campos y limpia el
 *               borrador. Es el ÚNICO punto de todo el repo que escribe las
 *               columnas publicadas de una página de socio.
 *   rechazar()  se queda sin publicar, con motivo. El borrador SE CONSERVA:
 *               el socio tiene que poder corregir lo que escribió, no
 *               volver a escribirlo desde cero.
 *   retirar()   baja una página YA publicada. Lo publicado vuelve al
 *               borrador del socio (no se tira su trabajo) y la página
 *               pública regresa a la de fábrica.
 *
 * Las tres son condicionales: usan updateMany con el estado esperado en el
 * WHERE, así que dos pestañas del admin sobre el mismo afiliado no pueden
 * aprobar y rechazar lo mismo. La segunda toca 0 filas y lo dice.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasDraft, normalizeSections, normalizeStatus, type PartnerPageRow } from "./page-config";
import { PARTNER_PAGE_SELECT, loadPartnerPage, toPageState, type PartnerPageState } from "./page-store";

export type ModerationAction = "approve" | "reject" | "unpublish";

export interface ModerationResult {
  ok: boolean;
  /** Mensaje para el admin cuando ok === false. */
  error?: string;
  /** Código HTTP sugerido cuando ok === false. */
  status?: number;
  /** Estado ya recalculado, para que la pantalla se ponga al día. */
  state?: PartnerPageState;
  /** Datos del afiliado para el correo. Solo cuando ok. */
  notify?: { email: string; name: string; slug: string };
}

const NOTIFY_SELECT = { email: true, name: true, slug: true } as const;

/**
 * Aprueba lo pendiente: pasa a publicado y el borrador queda limpio.
 *
 * El borrador se vacía a propósito. Si se conservara, el panel del socio
 * seguiría enseñando "tienes cambios sin enviar" justo después de que se le
 * aprobaron — y hasDraft() dejaría de significar lo que dice.
 */
export async function approvePage(affiliateId: string): Promise<ModerationResult> {
  const row = await loadPartnerPage(affiliateId);
  if (!row) return { ok: false, error: "Afiliado no encontrado.", status: 404 };

  if (normalizeStatus(row.pageStatus) !== "pending") {
    return {
      ok: false,
      status: 409,
      error: "Esta página ya no está en revisión. Actualiza la lista.",
      state: toPageState(row),
    };
  }

  const res = await prisma.affiliate.updateMany({
    where: { id: affiliateId, pageStatus: "pending" },
    data: {
      // Lo pendiente pasa a ser lo público. Punto único.
      photoUrl: row.photoUrlPending,
      bio: row.bioPending,
      sectionsConfig: normalizeSections(row.sectionsConfigPending) as any,
      pageStatus: "approved",
      pageReviewedAt: new Date(),
      pageRejectReason: null,
      photoUrlPending: null,
      bioPending: null,
      // Prisma.DbNull, no `undefined` ni `null`: en un campo Json `undefined`
      // significa "no toques esta columna" y dejaría el borrador intacto —
      // justo lo contrario de lo que hace una aprobación. Con el borrador sin
      // limpiar, hasDraft() seguiría en true y el panel del socio le diría
      // "tienes cambios sin enviar" el segundo después de aprobárselos.
      sectionsConfigPending: Prisma.DbNull,
    },
  });

  if (res.count === 0) return staleResult(affiliateId);

  // La foto que se publicaba ANTES ya no la enlaza nadie.
  await removeOrphanPhoto(row.photoUrl, [row.photoUrlPending], affiliateId);

  return finish(affiliateId);
}

/**
 * Rechaza con motivo. El motivo es obligatorio: un rechazo sin explicación
 * deja al socio adivinando qué corregir, y la siguiente versión llega igual.
 */
export async function rejectPage(affiliateId: string, reason: string): Promise<ModerationResult> {
  const motivo = String(reason ?? "").trim().slice(0, 1000);
  if (!motivo) {
    return { ok: false, status: 400, error: "Escribe el motivo del rechazo: el socio lo va a leer." };
  }

  const row = await loadPartnerPage(affiliateId);
  if (!row) return { ok: false, error: "Afiliado no encontrado.", status: 404 };

  if (normalizeStatus(row.pageStatus) !== "pending") {
    return {
      ok: false,
      status: 409,
      error: "Esta página ya no está en revisión. Actualiza la lista.",
      state: toPageState(row),
    };
  }

  const res = await prisma.affiliate.updateMany({
    where: { id: affiliateId, pageStatus: "pending" },
    // Ni una columna publicada se toca: la página pública sigue igual que
    // antes del envío. Y el borrador se queda para que pueda corregirlo.
    data: {
      pageStatus: "rejected",
      pageRejectReason: motivo,
      pageReviewedAt: new Date(),
    },
  });

  if (res.count === 0) return staleResult(affiliateId);
  return finish(affiliateId);
}

/**
 * Baja una página ya publicada.
 *
 * Lo publicado vuelve al BORRADOR del socio en vez de tirarse — salvo que ya
 * tuviera un borrador nuevo, que sería lo que se perdería. Así el socio ve el
 * motivo, conserva su texto y su foto, y puede corregir y reenviar; su página
 * pública, mientras tanto, ya volvió a la de fábrica.
 */
export async function unpublishPage(affiliateId: string, reason: string): Promise<ModerationResult> {
  const motivo = String(reason ?? "").trim().slice(0, 1000);
  if (!motivo) {
    return { ok: false, status: 400, error: "Escribe por qué la retiras: el socio lo va a leer." };
  }

  const row = await loadPartnerPage(affiliateId);
  if (!row) return { ok: false, error: "Afiliado no encontrado.", status: 404 };

  if (!hasPublishedContent(row)) {
    return {
      ok: false,
      status: 409,
      error: "Este socio no tiene nada publicado que retirar.",
      state: toPageState(row),
    };
  }

  // Si YA tiene un borrador propio, se respeta: devolverle lo publicado le
  // machacaría los cambios que estaba escribiendo.
  const devolverAlBorrador = !hasDraft(row);

  const res = await prisma.affiliate.updateMany({
    where: { id: affiliateId },
    data: {
      photoUrl: null,
      bio: null,
      // Mismo motivo que en approvePage: en Json, `undefined` no borra nada.
      sectionsConfig: Prisma.DbNull,
      pageStatus: "rejected",
      pageRejectReason: motivo,
      pageReviewedAt: new Date(),
      ...(devolverAlBorrador
        ? {
            photoUrlPending: row.photoUrl,
            bioPending: row.bio,
            sectionsConfigPending: normalizeSections(row.sectionsConfig) as any,
          }
        : {}),
    },
  });

  if (res.count === 0) return staleResult(affiliateId);
  return finish(affiliateId);
}

/* ── Auxiliares ─────────────────────────────────────────────────────────── */

function hasPublishedContent(row: PartnerPageRow): boolean {
  return Boolean(row.photoUrl || row.bio || row.sectionsConfig);
}

async function staleResult(affiliateId: string): Promise<ModerationResult> {
  const fresh = await loadPartnerPage(affiliateId);
  return {
    ok: false,
    status: 409,
    error: "Alguien más resolvió esta página primero. Actualiza la lista.",
    state: fresh ? toPageState(fresh) : undefined,
  };
}

async function finish(affiliateId: string): Promise<ModerationResult> {
  const [fresh, notify] = await Promise.all([
    loadPartnerPage(affiliateId),
    prisma.affiliate.findUnique({ where: { id: affiliateId }, select: NOTIFY_SELECT }),
  ]);
  return {
    ok: true,
    state: fresh ? toPageState(fresh) : undefined,
    notify: notify ?? undefined,
  };
}

/**
 * Borra del bucket una foto que ya no enlaza nadie. Best-effort y con lista
 * de excepciones: jamás toca una URL que siga viva en otra columna.
 */
async function removeOrphanPhoto(
  url: string | null,
  stillUsed: (string | null)[],
  affiliateId: string,
): Promise<void> {
  if (!url || stillUsed.includes(url)) return;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const { BUCKETS } = await import("@/lib/storage");
    const marker = `/${BUCKETS.CLINIC_PUBLIC}/`;
    const at = url.indexOf(marker);
    if (at < 0) return;
    const path = url.slice(at + marker.length).split("?")[0];
    // Solo dentro de la carpeta de ESTE afiliado.
    if (!path.startsWith(`affiliates/${affiliateId}/`)) return;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    await supabase.storage.from(BUCKETS.CLINIC_PUBLIC).remove([path]);
  } catch (e) {
    console.warn("[page-moderation] no se pudo borrar la foto anterior:", e);
  }
}

/* ── La cola ────────────────────────────────────────────────────────────── */

export interface ModerationRow {
  id: string;
  name: string;
  slug: string;
  email: string;
  state: PartnerPageState;
}

export interface ModerationQueue {
  pending: ModerationRow[];
  published: ModerationRow[];
}

const QUEUE_SELECT = {
  id: true,
  name: true,
  slug: true,
  email: true,
  ...PARTNER_PAGE_SELECT,
} as const;

/** Cuántas esperan revisión. Para el badge del menú; nunca lanza. */
export async function countPagesPendingReview(): Promise<number> {
  try {
    return await prisma.affiliate.count({ where: { pageStatus: "pending" } });
  } catch {
    return 0;
  }
}

/**
 * Lo que ve el admin: lo que espera revisión y lo que ya está publicado (que
 * es lo único que se puede retirar).
 */
export async function loadModerationQueue(): Promise<ModerationQueue> {
  const [pendingRows, publishedRows] = await Promise.all([
    prisma.affiliate.findMany({
      where: { pageStatus: "pending" },
      // Ascendente: el que lleva más esperando se atiende primero.
      orderBy: { pageSubmittedAt: "asc" },
      select: QUEUE_SELECT,
    }),
    prisma.affiliate.findMany({
      where: {
        status: "APPROVED",
        // Publicado = tiene foto o texto propio. Ordenar por pageReviewedAt
        // sería más útil pero en DESC Postgres pone los NULL primero y una
        // fila tocada a mano encabezaría la lista; por nombre no hay trampa.
        OR: [{ photoUrl: { not: null } }, { bio: { not: null } }],
      },
      orderBy: { name: "asc" },
      select: QUEUE_SELECT,
    }),
  ]);

  const toRow = (r: any): ModerationRow => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    email: r.email,
    state: toPageState(r),
  });

  return {
    pending: pendingRows.map(toRow),
    published: publishedRows.map(toRow),
  };
}
