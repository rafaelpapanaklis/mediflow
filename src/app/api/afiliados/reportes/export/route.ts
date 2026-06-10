import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { roundMxn } from "@/lib/affiliates/stats";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;
const MAX_ROWS = 5000;

/** 'YYYY-MM-DD' → Date a las 00:00 UTC. null = no enviado, "invalid" = mal formado. */
function parseDayUtc(raw: string | null): Date | null | "invalid" {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "invalid";
  const d = new Date(`${raw}T00:00:00Z`);
  return isNaN(d.getTime()) ? "invalid" : d;
}

/** dd/mm/yyyy en UTC — mismo criterio de día que el filtro del rango. */
function fmtDayMx(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/**
 * Etiqueta de estado de una clínica referida. Solo la etiqueta: por privacidad
 * el Excel no incluye email, teléfono, plan ni ningún otro dato de la clínica.
 * null = trial inicial sin pasar por billing (vigente si trialEndsAt > now).
 */
function referralStatus(subscriptionStatus: string | null, trialEndsAt: Date | null, now: Date): string {
  if (subscriptionStatus === "active") return "Pagando";
  if (subscriptionStatus === "trialing") return "En prueba";
  if (subscriptionStatus === "past_due") return "Pago vencido";
  if (subscriptionStatus === "cancelled") return "Cancelada";
  return trialEndsAt && trialEndsAt.getTime() > now.getTime() ? "En prueba" : "Prueba vencida";
}

/**
 * GET /api/afiliados/reportes/export?type=referidos|comisiones&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Devuelve un .xlsx (librería `xlsx`, SOLO export — convención G8).
 * Rango default: últimos 30 días; `to` es inclusivo (createdAt < to + 1 día).
 * Datos SIEMPRE where affiliateId del ctx — nunca del request.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAffiliateContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  if (type !== "referidos" && type !== "comisiones") {
    return NextResponse.json(
      { error: "Parámetro 'type' inválido: usa 'referidos' o 'comisiones'." },
      { status: 400 },
    );
  }

  const parsedFrom = parseDayUtc(url.searchParams.get("from"));
  const parsedTo = parseDayUtc(url.searchParams.get("to"));
  if (parsedFrom === "invalid" || parsedTo === "invalid") {
    return NextResponse.json(
      { error: "Fecha inválida: usa el formato YYYY-MM-DD." },
      { status: 400 },
    );
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const to = parsedTo ?? today;
  const from = parsedFrom ?? new Date(to.getTime() - 30 * DAY_MS);

  if (from.getTime() > to.getTime()) {
    return NextResponse.json(
      { error: "La fecha 'desde' no puede ser posterior a la fecha 'hasta'." },
      { status: 400 },
    );
  }
  const toExclusive = new Date(to.getTime() + DAY_MS); // 'to' inclusivo
  const rangeDays = Math.round((toExclusive.getTime() - from.getTime()) / DAY_MS);
  if (rangeDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `El rango máximo es de ${MAX_RANGE_DAYS} días; reduce el periodo.` },
      { status: 400 },
    );
  }

  const affiliateId = ctx.affiliateId;
  const now = new Date();
  const createdAt = { gte: from, lt: toExclusive };

  let header: string[];
  let cols: { wch: number }[];
  let rows: Record<string, string | number>[];
  let sheetName: "Referidos" | "Comisiones";

  if (type === "referidos") {
    sheetName = "Referidos";
    header = ["Clínica", "Fecha de registro", "Estado"];
    cols = [{ wch: 34 }, { wch: 18 }, { wch: 16 }];
    const clinics = await prisma.clinic.findMany({
      where: { affiliateId, createdAt },
      select: { name: true, createdAt: true, subscriptionStatus: true, trialEndsAt: true },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
    });
    rows = clinics.map((c) => ({
      "Clínica": c.name,
      "Fecha de registro": fmtDayMx(c.createdAt),
      "Estado": referralStatus(c.subscriptionStatus, c.trialEndsAt, now),
    }));
  } else {
    sheetName = "Comisiones";
    header = ["Fecha", "Clínica", "Factura base (MXN)", "Comisión (MXN)", "Estado", "Fecha de pago"];
    cols = [{ wch: 12 }, { wch: 34 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 14 }];
    const commissions = await prisma.affiliateCommission.findMany({
      where: { affiliateId, createdAt },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
    });
    // Nombres de clínica resueltos en UNA query (patrón de inicio/page.tsx).
    const clinicIds = Array.from(new Set(commissions.map((c) => c.clinicId)));
    const clinics = clinicIds.length
      ? await prisma.clinic.findMany({ where: { id: { in: clinicIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(clinics.map((c) => [c.id, c.name]));
    rows = commissions.map((c) => ({
      "Fecha": fmtDayMx(c.createdAt),
      "Clínica": nameById.get(c.clinicId) ?? "Clínica",
      "Factura base (MXN)": roundMxn(c.amountMxn),
      "Comisión (MXN)": roundMxn(c.commissionMxn),
      "Estado": c.status === "paid" ? "Pagada" : "Pendiente",
      "Fecha de pago": c.paidAt ? fmtDayMx(c.paidAt) : "—",
    }));
  }

  // Con `header` explícito el sheet conserva los encabezados aunque no haya filas.
  const ws = XLSX.utils.json_to_sheet(rows, { header });
  ws["!cols"] = cols;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const fname = `dalecontrol-afiliado-${type}-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
