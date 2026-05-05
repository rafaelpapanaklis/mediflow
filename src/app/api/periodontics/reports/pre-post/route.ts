// Periodontics — endpoint que renderiza el PDF comparativo pre/post.
// SPEC §9.3. Recibe ?initial=...&post=... como query params.

import { NextRequest, NextResponse } from "next/server";
import { renderToStream } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { PERIODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { computePerioMetrics } from "@/lib/periodontics/periodontogram-math";
import type { Site, ToothLevel } from "@/lib/periodontics/schemas";
import { PrePostComparePDF } from "@/lib/periodontics/pdf-templates/pre-post-compare";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (ctx.clinicCategory !== "DENTAL") {
    return NextResponse.json({ error: "Categoría no válida" }, { status: 403 });
  }
  const access = await canAccessModule(ctx.clinicId, PERIODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    return NextResponse.json({ error: "Módulo no activo" }, { status: 403 });
  }

  const initialId = req.nextUrl.searchParams.get("initial");
  const postId = req.nextUrl.searchParams.get("post");
  if (!initialId || !postId) {
    return NextResponse.json({ error: "initial y post requeridos" }, { status: 400 });
  }

  const [initial, post] = await Promise.all([
    prisma.periodontalRecord.findFirst({
      where: { id: initialId, clinicId: ctx.clinicId, deletedAt: null },
      include: { patient: { select: { firstName: true, lastName: true } } },
    }),
    prisma.periodontalRecord.findFirst({
      where: { id: postId, clinicId: ctx.clinicId, deletedAt: null },
    }),
  ]);
  if (!initial || !post) {
    return NextResponse.json({ error: "Sondajes no encontrados" }, { status: 404 });
  }

  const m1 = computePerioMetrics(
    ((initial.sites as unknown as Site[] | null) ?? []) as Site[],
    ((initial.toothLevel as unknown as ToothLevel[] | null) ?? []) as ToothLevel[],
  );
  const m2 = computePerioMetrics(
    ((post.sites as unknown as Site[] | null) ?? []) as Site[],
    ((post.toothLevel as unknown as ToothLevel[] | null) ?? []) as ToothLevel[],
  );

  const postSites = ((post.sites as unknown as Site[] | null) ?? []) as Site[];
  const residualSites = postSites.filter((s) => s.pdMm >= 5 && s.bop);
  const fdiCounts = new Map<number, number>();
  for (const s of residualSites) fdiCounts.set(s.fdi, (fdiCounts.get(s.fdi) ?? 0) + 1);
  const surgicalCandidatesTeeth = Array.from(fdiCounts.entries())
    .filter(([, count]) => count >= 2)
    .map(([fdi]) => fdi)
    .sort((a, b) => a - b);

  const doctor = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { firstName: true, lastName: true },
  });

  const fmt = (d: Date) => d.toLocaleDateString("es-MX");

  const doc = PrePostComparePDF({
    patientName: `${initial.patient.firstName} ${initial.patient.lastName}`.trim(),
    doctorName: `${doctor?.firstName ?? ""} ${doctor?.lastName ?? ""}`.trim() || "Doctor",
    initial: { recordedAt: fmt(initial.createdAt), metrics: m1 },
    post: { recordedAt: fmt(post.createdAt), metrics: m2 },
    residualCount: residualSites.length,
    surgicalCandidatesTeeth,
  });

  const stream = await renderToStream(doc);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  const pdfBytes = Buffer.concat(chunks);

  return new NextResponse(new Uint8Array(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="comparativo-perio-${initial.id}-${post.id}.pdf"`,
    },
  });
}
