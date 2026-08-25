// ═══════════════════════════════════════════════════════════════════════
// POST /api/realty/leases/[id]/inventory/fotos → sube UNA foto de evidencia
//
// La foto llega YA COMPRIMIDA por el navegador (JPEG ~1600 px). Aquí se
// comprueba de nuevo el tamaño y, sobre todo, el TIPO REAL por firma de
// bytes: el Content-Type del multipart lo pone el cliente y se puede mentir.
//
// Las fotos cuentan contra el CUPO DE ALMACENAMIENTO del plan
// (RealtyAccount.storageUsedBytes vs plan.storageQuotaMb). Con el cupo
// lleno se responde 413 con un mensaje que dice qué hacer, no un error
// genérico.
//
// Devuelve la RUTA del bucket privado (no una URL): las ligas se firman al
// leer y caducan en cinco minutos.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { assertRealtyPermission, getRealtyContext } from "@/lib/realty-auth";
import {
  EVIDENCE_MAX_BYTES,
  getStorageState,
  realtyApiError,
  realtyForbidden,
  realtyUnauthorized,
  saveEvidencePhoto,
  signRealtyPaths,
  sniffImageMime,
} from "@/lib/realty/leases";
import { formatRealtyStorage } from "@/lib/realty/plan-shared";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.rentals !== true) return realtyForbidden("rentals");
  try {
    assertRealtyPermission(ctx, "leases.manage");
  } catch {
    return realtyForbidden("leases.manage");
  }

  try {
    // El contrato tiene que ser de esta cuenta ANTES de tocar el bucket.
    const lease = await prisma.realtyLease.findFirst({
      where: { id: params.id, accountId: ctx.accountId },
      select: { id: true },
    });
    if (!lease) {
      return NextResponse.json({ error: "No encontramos ese contrato." }, { status: 404 });
    }

    const storage = await getStorageState(ctx);
    if (storage.full) {
      return NextResponse.json(
        {
          error:
            `Se acabó el espacio de tu plan (${formatRealtyStorage(ctx.plan.storageQuotaMb)}). ` +
            "Borra fotos que ya no ocupes o sube de plan para seguir guardando evidencia.",
          code: "STORAGE_FULL",
        },
        { status: 413 },
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "No llegó ninguna foto." }, { status: 400 });
    }
    if (file.size > EVIDENCE_MAX_BYTES) {
      return NextResponse.json(
        { error: "Esa foto pesa demasiado. Vuelve a intentarlo desde la cámara del teléfono." },
        { status: 413 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffImageMime(bytes);
    if (!mime) {
      return NextResponse.json(
        { error: "Ese archivo no es una foto (solo JPG, PNG o WebP)." },
        { status: 400 },
      );
    }

    const saved = await saveEvidencePhoto(ctx, {
      scope: "inventario",
      ownerId: params.id,
      mime,
      body: bytes,
    });
    const [signedUrl] = await signRealtyPaths([saved.path]);
    const after = await getStorageState(ctx);

    return NextResponse.json({
      ok: true,
      path: saved.path,
      bytes: saved.bytes,
      signedUrl: signedUrl ?? "",
      storage: after,
    });
  } catch (err) {
    return realtyApiError(err, "leases:inventory-photo");
  }
}
