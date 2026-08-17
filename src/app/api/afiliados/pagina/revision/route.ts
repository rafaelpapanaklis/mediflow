/**
 * Revisión de la página del socio.
 *   POST   /api/afiliados/pagina/revision → la manda a revisar ('pending')
 *   DELETE /api/afiliados/pagina/revision → retira el envío ('pending' → 'draft')
 *
 * Enviar NO publica nada: solo congela el borrador y lo pone en la cola de
 * Rafael. La página pública sigue con lo último aprobado hasta que él apruebe.
 *
 * El DELETE existe porque la cola la atiende una sola persona: sin él, un
 * afiliado que detecta su propia errata treinta segundos después de enviar se
 * queda bloqueado —sin poder editar ni reenviar— hasta que alguien revise.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { hasDraft, normalizeStatus } from "@/lib/affiliates/page-config";
import { PARTNER_PAGE_SELECT, loadPartnerPage, toPageState } from "@/lib/affiliates/page-store";

export const dynamic = "force-dynamic";

export async function POST() {
  const ctx = await getAffiliateContext();
  if (!ctx || ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const row = await loadPartnerPage(ctx.affiliateId);
  if (!row) return NextResponse.json({ error: "Afiliado no encontrado" }, { status: 404 });

  if (normalizeStatus(row.pageStatus) === "pending") {
    return NextResponse.json({ error: "Tu página ya está en revisión." }, { status: 409 });
  }
  if (!hasDraft(row)) {
    return NextResponse.json(
      { error: "No tienes cambios que enviar. Edita tu foto, tu presentación o tus secciones primero." },
      { status: 400 },
    );
  }

  const updated = await prisma.affiliate.update({
    where: { id: ctx.affiliateId },
    data: {
      pageStatus: "pending",
      pageSubmittedAt: new Date(),
      // Se limpian los dos rastros de la revisión ANTERIOR: si no, un
      // rechazo viejo seguiría pintando su motivo sobre un envío nuevo.
      pageReviewedAt: null,
      pageRejectReason: null,
    },
    select: PARTNER_PAGE_SELECT,
  });

  return NextResponse.json(toPageState(updated));
}

export async function DELETE() {
  const ctx = await getAffiliateContext();
  if (!ctx || ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // updateMany con el estado en el WHERE, no un update a secas: si Rafael
  // aprobó o rechazó mientras el afiliado tenía la pantalla abierta, esto
  // toca 0 filas en vez de revertir su decisión.
  const res = await prisma.affiliate.updateMany({
    where: { id: ctx.affiliateId, pageStatus: "pending" },
    data: { pageStatus: "draft", pageSubmittedAt: null },
  });

  const row = await loadPartnerPage(ctx.affiliateId);
  if (!row) return NextResponse.json({ error: "Afiliado no encontrado" }, { status: 404 });

  if (res.count === 0) {
    return NextResponse.json(
      {
        error: "Tu página ya fue revisada, así que no hay nada que retirar.",
        state: toPageState(row),
      },
      { status: 409 },
    );
  }

  return NextResponse.json(toPageState(row));
}
