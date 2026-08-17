/**
 * Página del socio — LECTURA Y ESTADO (lado servidor).
 *
 * Separado de page-config.ts a propósito: aquí sí entra Prisma, así que este
 * módulo NO puede acabar en un bundle de navegador. Las reglas puras (catálogo
 * de secciones, tope de la presentación, publicado vs borrador) viven allá,
 * que sí se importa desde el cliente.
 *
 * Lo que aporta:
 *   · PARTNER_PAGE_SELECT — las columnas de la página y NADA más. La fila de
 *     `affiliates` lleva correo, datos de pago y porcentaje de comisión;
 *     ninguno tiene por qué viajar a una pantalla que edita una foto.
 *   · toPageState()       — el DTO exacto que recibe el panel.
 */
import { prisma } from "@/lib/prisma";
import {
  draftPage,
  hasDraft,
  isPublishedEmpty,
  normalizeStatus,
  publishedPage,
  type PartnerPageRow,
  type PartnerPageState,
} from "./page-config";

export type { PartnerPageState };

/** Select explícito: solo las columnas de la página personal. */
export const PARTNER_PAGE_SELECT = {
  photoUrl: true,
  bio: true,
  sectionsConfig: true,
  pageStatus: true,
  pageRejectReason: true,
  pageSubmittedAt: true,
  pageReviewedAt: true,
  photoUrlPending: true,
  bioPending: true,
  sectionsConfigPending: true,
} as const;

export type PartnerPageRecord = PartnerPageRow & {
  pageRejectReason: string | null;
  pageSubmittedAt: Date | null;
  pageReviewedAt: Date | null;
};

/** El DTO que consume el panel. Su forma vive en page-config.ts. */
export function toPageState(row: PartnerPageRecord): PartnerPageState {
  return {
    status: normalizeStatus(row.pageStatus),
    rejectReason: row.pageRejectReason ?? null,
    submittedAt: row.pageSubmittedAt ? row.pageSubmittedAt.toISOString() : null,
    reviewedAt: row.pageReviewedAt ? row.pageReviewedAt.toISOString() : null,
    hasDraft: hasDraft(row),
    draft: draftPage(row),
    published: publishedPage(row),
    publishedEmpty: isPublishedEmpty(row),
  };
}

/**
 * Carga las columnas de la página de UN afiliado. El id sale siempre de la
 * sesión (getAffiliateContext), nunca del request: no hay ninguna superficie
 * en la que un afiliado pueda nombrar a otro.
 */
export async function loadPartnerPage(affiliateId: string): Promise<PartnerPageRecord | null> {
  return prisma.affiliate.findUnique({
    where: { id: affiliateId },
    select: PARTNER_PAGE_SELECT,
  });
}
