// ═══════════════════════════════════════════════════════════════════════
// POST /api/realty/maintenance/[id]/fotos → agrega una foto a la incidencia
//
// Mismas rejas que la foto del inventario: tipo real por firma de bytes
// (el Content-Type del multipart se puede mentir), techo de tamaño y CUPO
// DE ALMACENAMIENTO del plan. La foto se guarda en el bucket PRIVADO y en
// photoUrls queda la RUTA, no una URL: se firma al leer y caduca.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { assertRealtyPermission, getRealtyContext } from "@/lib/realty-auth";
import { prisma } from "@/lib/prisma";
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
import {
  limiteSubidasPorUsuario,
  pareceScriptOMarcado,
  registrarSubidaRechazada,
} from "@/lib/uploads/validar-archivo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Tope de fotos por incidencia: la evidencia se documenta, no se archiva. */
const MAX_PHOTOS = 12;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getRealtyContext();
  if (!ctx) return realtyUnauthorized();
  if (ctx.plan.features.maintenance !== true) return realtyForbidden("maintenance");
  try {
    assertRealtyPermission(ctx, "maintenance.manage");
  } catch {
    return realtyForbidden("maintenance.manage");
  }

  try {
    const row = await prisma.realtyMaintenance.findFirst({
      where: { id: params.id, accountId: ctx.accountId },
      select: { id: true, photoUrls: true },
    });
    if (!row) {
      return NextResponse.json({ error: "No encontramos esa incidencia." }, { status: 404 });
    }
    if ((row.photoUrls ?? []).length >= MAX_PHOTOS) {
      return NextResponse.json(
        { error: `Esta incidencia ya tiene ${MAX_PHOTOS} fotos.` },
        { status: 409 },
      );
    }

    if (!limiteSubidasPorUsuario(`realty:mantenimiento:${ctx.accountId}`, 60)) {
      return NextResponse.json(
        { error: "Demasiadas subidas en poco tiempo. Espera un momento e inténtalo de nuevo." },
        { status: 429 },
      );
    }

    const storage = await getStorageState(ctx);
    if (storage.full) {
      return NextResponse.json(
        {
          error:
            `Se acabó el espacio de tu plan (${formatRealtyStorage(ctx.plan.storageQuotaMb)}). ` +
            "Borra fotos que ya no ocupes o sube de plan.",
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
      return NextResponse.json({ error: "Esa foto pesa demasiado." }, { status: 413 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const marcador = pareceScriptOMarcado(Buffer.from(bytes));
    if (marcador) {
      await registrarSubidaRechazada({
        ruta: "maintenance/[id]/fotos:POST",
        motivo: `contenido parece script o marcado (${marcador.trim()})`,
        codigo: "script_o_marcado",
        nombreOriginal: "foto-evidencia",
      });
      return NextResponse.json(
        { error: "El contenido del archivo no parece una imagen válida." },
        { status: 400 },
      );
    }
    const mime = sniffImageMime(bytes);
    if (!mime) {
      await registrarSubidaRechazada({
        ruta: "maintenance/[id]/fotos:POST",
        motivo: "tipo real no reconocido como imagen",
        codigo: "tipo_no_permitido",
        nombreOriginal: "foto-evidencia",
      });
      return NextResponse.json(
        { error: "Ese archivo no es una foto (solo JPG, PNG o WebP)." },
        { status: 400 },
      );
    }
    try {
      const metadata = await sharp(Buffer.from(bytes)).metadata();
      if (!metadata.width || !metadata.height) throw new Error("sin dimensiones");
      await sharp(Buffer.from(bytes)).toBuffer();
    } catch {
      await registrarSubidaRechazada({
        ruta: "maintenance/[id]/fotos:POST",
        motivo: "la imagen no se pudo decodificar (está corrupta o no es una imagen real)",
        codigo: "imagen_corrupta",
        nombreOriginal: "foto-evidencia",
      });
      return NextResponse.json(
        { error: "La imagen no se pudo decodificar (está corrupta o no es una imagen real)." },
        { status: 400 },
      );
    }

    const saved = await saveEvidencePhoto(ctx, {
      scope: "mantenimiento",
      ownerId: params.id,
      mime,
      body: bytes,
    });

    await prisma.realtyMaintenance.update({
      where: { id: params.id },
      data: { photoUrls: { push: saved.path } },
    });

    const [signedUrl] = await signRealtyPaths([saved.path]);
    return NextResponse.json({ ok: true, path: saved.path, signedUrl: signedUrl ?? "" });
  } catch (err) {
    return realtyApiError(err, "maintenance:photo");
  }
}
