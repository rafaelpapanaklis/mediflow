import { getAdminSession } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAdminGlobalEvent } from "@/lib/admin-audit";
import { normalizePayoutMode, type PayoutMode } from "@/lib/affiliates/payout";


// Estados que el admin asigna a mano desde el panel. PENDING no se asigna
// manualmente: es el estado inicial con el que nace todo afiliado al registrarse.
const ASSIGNABLE_STATUSES = ["APPROVED", "REJECTED", "SUSPENDED"] as const;
type AssignableStatus = (typeof ASSIGNABLE_STATUSES)[number];

// Modalidad de pago para las PRÓXIMAS clínicas del afiliado. Las ya referidas
// conservan la suya (congelada en AffiliateClinicTerms al alta).
const PAYOUT_MODES = ["recurring", "onetime"] as const;

// PATCH /api/admin/affiliates/[id]  body: { status?, payoutMode? }
// Los dos campos son opcionales y pueden venir juntos o por separado, pero al
// menos uno debe llegar. Responde SIEMPRE con el afiliado actualizado (el
// listado de /admin/affiliates hace merge de ese JSON en su fila).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const wantsStatus = body?.status !== undefined && body?.status !== null;
  const wantsPayoutMode = body?.payoutMode !== undefined && body?.payoutMode !== null;

  if (!wantsStatus && !wantsPayoutMode) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }

  const data: { status?: AssignableStatus; approvedAt?: Date; payoutMode?: PayoutMode } = {};

  let status: AssignableStatus | null = null;
  if (wantsStatus) {
    const raw = String(body.status);
    if (!(ASSIGNABLE_STATUSES as readonly string[]).includes(raw)) {
      return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
    }
    status = raw as AssignableStatus;
    data.status = status;

    // Aprobar (también reactiva un rechazado/suspendido) sella la fecha de
    // aprobación. Affiliate no tiene rejectedReason, así que REJECTED/SUSPENDED
    // sólo cambian el status.
    if (status === "APPROVED") {
      data.approvedAt = new Date();
    }
  }

  let payoutMode: PayoutMode | null = null;
  if (wantsPayoutMode) {
    const raw = String(body.payoutMode);
    if (!(PAYOUT_MODES as readonly string[]).includes(raw)) {
      return NextResponse.json(
        { error: 'La modalidad debe ser "recurring" (fijo recurrente) o "onetime" (pago único)' },
        { status: 400 }
      );
    }
    payoutMode = raw as PayoutMode;
    data.payoutMode = payoutMode;
  }

  // Estado previo SOLO para auditar el cambio de modalidad. Si la columna
  // payout_mode aún no existe en la BD, el select lanza y seguimos sin "before"
  // (la auditoría nunca debe bloquear la operación).
  let before: PayoutMode | null = null;
  if (wantsPayoutMode) {
    const prev = await prisma.affiliate
      .findUnique({ where: { id: params.id }, select: { payoutMode: true } })
      .catch(() => null);
    before = prev ? normalizePayoutMode(prev.payoutMode) : null;
  }

  try {
    const updated = await prisma.affiliate.update({ where: { id: params.id }, data });

    if (status) {
      logAdminGlobalEvent({
        req, admin: admin.user, entity: "affiliate", entityId: params.id,
        action: status === "APPROVED" ? "approve" : status === "REJECTED" ? "reject" : "suspend",
        after: { status: updated.status, approvedAt: updated.approvedAt ?? null },
      });
    }

    if (payoutMode) {
      logAdminGlobalEvent({
        req, admin: admin.user, entity: "affiliate", entityId: params.id,
        action: "update",
        before: { payoutMode: before },
        after: { payoutMode },
      });
    }

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Afiliado no encontrado" }, { status: 404 });
  }
}
