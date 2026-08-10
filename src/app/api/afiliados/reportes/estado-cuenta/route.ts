import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { monthBoundsUtc, roundMxn } from "@/lib/affiliates/stats";
import { commissionKindLabel, isNetworkBonusKind } from "@/lib/affiliates/payout-core";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import {
  AffiliateStatementDocument,
  type AffiliateStatementRow,
} from "@/lib/pdf/affiliate-statement-document";

export const dynamic = "force-dynamic";

/**
 * GET /api/afiliados/reportes/estado-cuenta?month=YYYY-MM
 * Estado de cuenta mensual del afiliado en PDF (@react-pdf/renderer).
 *
 * Espeja el patrón de src/app/api/analytics/payroll-pdf/route.ts
 * (createElement + renderToBuffer, Content-Type application/pdf +
 * Content-Disposition attachment).
 *
 * - Auth: getAffiliateContext() → 401. affiliateId SIEMPRE de la sesión,
 *   nunca del request.
 * - month inválido → 400; sin month → mes actual UTC (YYYY-MM).
 * - Privacidad: de las clínicas referidas solo se expone el nombre.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAffiliateContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  const bounds = monthBoundsUtc(month);
  if (!bounds) {
    return NextResponse.json({ error: "Mes inválido. Usa el formato YYYY-MM." }, { status: 400 });
  }

  const commissions = await prisma.affiliateCommission.findMany({
    where: { affiliateId: ctx.affiliateId, createdAt: { gte: bounds.start, lt: bounds.end } },
    orderBy: { createdAt: "asc" },
    take: 2000,
  });

  // Nombres de clínica en UNA query (AffiliateCommission no tiene relación a
  // Clinic en el schema). PRIVACIDAD: solo el nombre.
  const clinicIds = Array.from(new Set(commissions.map((c) => c.clinicId)));
  const clinics = clinicIds.length
    ? await prisma.clinic.findMany({ where: { id: { in: clinicIds } }, select: { id: true, name: true } })
    : [];
  const clinicNameById = new Map(clinics.map((c) => [c.id, c.name]));

  const rows: AffiliateStatementRow[] = commissions.map((c) => ({
    date: c.createdAt.toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }),
    // Un BONO POR RED no nace de una clínica (su `clinicId` va vacío a
    // propósito): sin este corte el estado de cuenta pintaría una "Clínica"
    // fantasma en la fila donde el afiliado espera ver su bono.
    clinicName: isNetworkBonusKind(c.kind)
      ? commissionKindLabel(c.kind)
      : (clinicNameById.get(c.clinicId) ?? "Clínica"),
    // Las filas viejas pueden no traer kind/monthsCovered: siempre con fallback
    // (el documento etiqueta con commissionKindLabel, que tolera null).
    kind: c.kind,
    monthsCovered: c.monthsCovered ?? 1,
    baseMxn: c.amountMxn,
    commissionMxn: c.commissionMxn,
    status: c.status,
  }));

  // Desglose del generado por tipo. Mismo criterio que commissionKindLabel:
  // cualquier kind desconocido o ausente cuenta como "% del nivel".
  // Los BONOS POR RED llevan su propio cubo: meterlos en el de "% del nivel"
  // le diría al afiliado que cobró por un porcentaje que nunca se le aplicó.
  const byKind = { pct: 0, recurring: 0, onetime: 0, networkBonus: 0 };
  commissions.forEach((c) => {
    const kind =
      c.kind === "recurring" || c.kind === "onetime"
        ? c.kind
        : isNetworkBonusKind(c.kind)
          ? "networkBonus"
          : "pct";
    byKind[kind] += c.commissionMxn;
  });

  const totals = {
    count: commissions.length,
    totalMxn: roundMxn(commissions.reduce((s, c) => s + c.commissionMxn, 0)),
    paidMxn: roundMxn(
      commissions.filter((c) => c.status === "paid").reduce((s, c) => s + c.commissionMxn, 0),
    ),
    pendingMxn: roundMxn(
      commissions.filter((c) => c.status === "pending").reduce((s, c) => s + c.commissionMxn, 0),
    ),
    byKind: {
      pct: roundMxn(byKind.pct),
      recurring: roundMxn(byKind.recurring),
      onetime: roundMxn(byKind.onetime),
      networkBonus: roundMxn(byKind.networkBonus),
    },
  };

  // renderToBuffer espera un ReactElement<DocumentProps>. AffiliateStatementDocument
  // sí retorna <Document>, pero el type system no lo infiere desde el wrapper FC.
  // Cast explícito que sigue siendo type-safe en runtime — mismo patrón que payroll-pdf.
  const element = createElement(AffiliateStatementDocument, {
    affiliateName: ctx.affiliate.name,
    referralCode: ctx.affiliate.referralCode,
    monthLabel: bounds.label,
    generatedAt: new Date().toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }),
    rows,
    totals,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="dalecontrol-estado-cuenta-${month}.pdf"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
