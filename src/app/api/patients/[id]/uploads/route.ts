// GET /api/patients/[id]/uploads — archivos que el PACIENTE subió a su
// expediente, vistos por la clínica (WS1-T8). Aislado por clinicId. Devuelve
// signed URLs de corta duración (TTL 5 min); NUNCA expone el storageKey.
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { signMaybeUrls } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // EQ-07 — "Ver radiografías" (xrays.view). Es el mismo cajón de archivos del
  // paciente que sirve /api/xrays (que ya lo exige), sólo que la otra mitad: lo
  // que subió el propio paciente. Sin este gate un READONLY —que no tiene
  // ningún xrays.*— no veía la pestaña pero recibía 200 con las signed URLs de
  // sus estudios. Recepción SÍ lo tiene por default y no pierde nada.
  const deniedPerm = denyIfMissingPermission(ctx, "xrays.view");
  if (deniedPerm) return deniedPerm;

  // Visibilidad por paciente: sin esto, un usuario fuera de la lista podía leer
  // los archivos (y sus signed URLs) de un paciente restringido con solo tener
  // el id. 404 = "para ti no existe".
  const denied = await assertPatientVisible(params.id, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (denied) return denied;

  // Aislamiento por clínica: solo subidas del paciente que pertenecen a ESTA
  // clínica (el endpoint del paciente las guardó con su clinicId del link).
  const rows = await prisma.patientUpload.findMany({
    where: { patientId: params.id, clinicId: ctx.clinicId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      fileName: true,
      fileType: true,
      sizeBytes: true,
      kind: true,
      storageKey: true,
      createdAt: true,
    },
  });

  // Firma todas las URLs en UN round-trip (TTL 5 min).
  const urls = await signMaybeUrls(rows.map((r) => r.storageKey));
  const items = rows.map((r, i) => ({
    id: r.id,
    fileName: r.fileName,
    fileType: r.fileType,
    sizeBytes: r.sizeBytes,
    kind: r.kind,
    createdAt: r.createdAt.toISOString(),
    url: urls[i],
  }));

  return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
}
