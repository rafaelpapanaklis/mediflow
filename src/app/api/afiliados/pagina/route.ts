/**
 * PATCH /api/afiliados/pagina — guarda el BORRADOR de la página del socio.
 *   body: { bio?: string | null, sections?: Array<{ id, visible }> }
 *
 * AISLAMIENTO: no hay ningún id en la URL ni en el cuerpo. El afiliado sale
 * de la sesión (getAffiliateContext) y el update va contra ESE id, así que no
 * existe la superficie de "pedir la página de otro" — es la forma fuerte de la
 * regla que /api/afiliados/soporte/[id] resuelve con un where compuesto.
 *
 * Escribe SIEMPRE en las columnas *Pending. Nada de lo que pase por aquí
 * aparece en /socio/<slug> hasta que Rafael lo apruebe.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import {
  buildDraftPatch,
  canEditPage,
  normalizeSections,
  sanitizeBio,
  type DraftChanges,
} from "@/lib/affiliates/page-config";
import { PARTNER_PAGE_SELECT, loadPartnerPage, toPageState } from "@/lib/affiliates/page-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getAffiliateContext();
  if (!ctx || ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const row = await loadPartnerPage(ctx.affiliateId);
  if (!row) return NextResponse.json({ error: "Afiliado no encontrado" }, { status: 404 });

  return NextResponse.json(toPageState(row));
}

export async function PATCH(req: Request) {
  const ctx = await getAffiliateContext();
  if (!ctx || ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const row = await loadPartnerPage(ctx.affiliateId);
  if (!row) return NextResponse.json({ error: "Afiliado no encontrado" }, { status: 404 });

  if (!canEditPage(row.pageStatus)) {
    return NextResponse.json(
      { error: "Tu página está en revisión. Espera el resultado para volver a editarla." },
      { status: 409 },
    );
  }

  // Solo se toca lo que venga en el cuerpo: un PATCH con `bio` no debe
  // reescribir las secciones con lo que el navegador tuviera cacheado.
  const changes: DraftChanges = {};
  if ("bio" in body) changes.bio = sanitizeBio(body.bio);
  if ("sections" in body) changes.sections = normalizeSections(body.sections);

  if (Object.keys(changes).length === 0) {
    return NextResponse.json({ error: "No mandaste nada que guardar." }, { status: 400 });
  }

  const patch = buildDraftPatch(row, changes);
  const updated = await prisma.affiliate.update({
    where: { id: ctx.affiliateId },
    data: {
      photoUrlPending: patch.photoUrlPending,
      bioPending: patch.bioPending,
      sectionsConfigPending: patch.sectionsConfigPending as any,
      ...(patch.pageStatus ? { pageStatus: patch.pageStatus } : {}),
    },
    select: PARTNER_PAGE_SELECT,
  });

  return NextResponse.json(toPageState(updated));
}
