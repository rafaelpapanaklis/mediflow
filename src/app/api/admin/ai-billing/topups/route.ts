import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminAuthed } from "@/lib/admin-auth";
import { parsePageParams } from "@/lib/pagination";
import { signMaybeUrls } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = ["PENDING", "PAID", "REJECTED", "FAILED"] as const;
type TopupStatus = (typeof VALID_STATUSES)[number];

/**
 * GET /api/admin/ai-billing/topups
 * Lista las recargas SPEI (default las PENDING: comprobante subido, falta
 * confirmar). Enriquece con el nombre de la clinica y una signed URL temporal
 * del comprobante (bucket privado) para que el admin lo revise. Guard:
 * isAdminAuthed. Query: ?status=PENDING|PAID|REJECTED|FAILED, ?take, ?page.
 */
export async function GET(req: NextRequest) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const statusParam = (req.nextUrl.searchParams.get("status") ?? "PENDING").toUpperCase();
  const status: TopupStatus = (VALID_STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as TopupStatus)
    : "PENDING";

  const { take, skip } = parsePageParams(req.nextUrl.searchParams);

  const topups = await prisma.aiTopup.findMany({
    where: { method: "SPEI", status },
    orderBy: { createdAt: "desc" },
    take,
    skip,
  });

  // No hay relacion Prisma AiTopup->Clinic: resolvemos nombres en batch.
  const clinicIds = Array.from(new Set(topups.map((t) => t.clinicId)));
  const clinics = clinicIds.length
    ? await prisma.clinic.findMany({
        where: { id: { in: clinicIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(clinics.map((c) => [c.id, c.name]));

  // Comprobantes en bucket privado: firmamos URLs temporales en un round-trip.
  const signedProofs = await signMaybeUrls(topups.map((t) => t.proofUrl));

  const items = topups.map((t, i) => ({
    id: t.id,
    clinicId: t.clinicId,
    clinicName: nameById.get(t.clinicId) ?? null,
    amountCents: t.amountCents,
    method: t.method,
    status: t.status,
    proofUrl: signedProofs[i] || null,
    confirmedBy: t.confirmedBy,
    createdAt: t.createdAt,
    paidAt: t.paidAt,
  }));

  return NextResponse.json({ topups: items });
}
