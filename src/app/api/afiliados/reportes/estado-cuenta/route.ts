import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { monthBoundsUtc, roundMxn } from "@/lib/affiliates/stats";
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
    clinicName: clinicNameById.get(c.clinicId) ?? "Clínica",
    baseMxn: c.amountMxn,
    commissionMxn: c.commissionMxn,
    status: c.status,
  }));

  const totals = {
    count: commissions.length,
    totalMxn: roundMxn(commissions.reduce((s, c) => s + c.commissionMxn, 0)),
    paidMxn: roundMxn(
      commissions.filter((c) => c.status === "paid").reduce((s, c) => s + c.commissionMxn, 0),
    ),
    pendingMxn: roundMxn(
      commissions.filter((c) => c.status === "pending").reduce((s, c) => s + c.commissionMxn, 0),
    ),
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
