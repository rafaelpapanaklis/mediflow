import { NextResponse } from "next/server";
import sharp from "sharp";
import {
  PHOTO_MAX_BYTES,
  listBarberClientPhotos,
  saveBarberVisitPhoto,
  sniffImageMime,
} from "@/lib/barber/clients";
import { alsoHas, gateBarberClients, serverError } from "../../_helpers";
import type { BarberPhotoKind } from "@/lib/barber/types";
import {
  limiteSubidasPorUsuario,
  pareceScriptOMarcado,
  registrarSubidaRechazada,
  tieneExtensionPeligrosa,
} from "@/lib/uploads/validar-archivo";

export const dynamic = "force-dynamic";

const KINDS: BarberPhotoKind[] = ["BEFORE", "AFTER", "REFERENCE"];

/** GET — fotos del cliente con su URL firmada (5 min). Bucket PRIVADO. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateBarberClients("clients.view");
  if ("response" in gate) return gate.response;

  try {
    const url = new URL(req.url);
    const appointmentId = url.searchParams.get("appointmentId");
    const photos = await listBarberClientPhotos(gate.ctx, params.id, {
      appointmentId: appointmentId ? appointmentId : undefined,
    });
    return NextResponse.json({ photos });
  } catch (e) {
    return serverError("photos.list", e);
  }
}

/**
 * POST multipart — sube una foto del corte.
 *
 * El NAVEGADOR ya la comprimió (WebP, lado mayor ≤1600 px): ver
 * comprimirFotoDeCorte en src/components/barber/clients/photo-uploader.tsx.
 * Sin eso, una foto de celular son 8-15 MB, no cabe en el cuerpo de la
 * petición (~4.5 MB en serverless) y un portafolio de cortes se come el
 * Storage. Aquí solo se verifica el techo y —esto sí importa— el tipo REAL
 * por firma de bytes: el Content-Type del multipart lo escribe el cliente.
 *
 * `visibleToClient` marca las que el PORTAL DEL CLIENTE (T5) podrá mostrar.
 * Por defecto false: una foto no se publica por accidente.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateBarberClients("clients.edit");
  if ("response" in gate) return gate.response;

  try {
    const cabe = limiteSubidasPorUsuario(`barber:foto-cliente:${gate.ctx.barbershopId}:${gate.ctx.barberUserId}`, 60);
    if (!cabe) {
      return NextResponse.json(
        { error: "Demasiadas subidas en poco tiempo. Espera unos minutos." },
        { status: 429 },
      );
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "No llegó la foto." }, { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No llegó la foto." }, { status: 400 });
    }
    if (file.size > PHOTO_MAX_BYTES) {
      return NextResponse.json(
        {
          error: `Esa foto pesa ${(file.size / (1024 * 1024)).toFixed(1)} MB y el máximo son ${
            PHOTO_MAX_BYTES / (1024 * 1024)
          } MB.`,
        },
        { status: 413 },
      );
    }

    if (tieneExtensionPeligrosa(file.name)) {
      await registrarSubidaRechazada({
        ruta: "barber/clients/photos",
        motivo: "El nombre del archivo tiene una extensión no permitida",
        codigo: "extension_peligrosa",
        nombreOriginal: file.name,
      });
      return NextResponse.json(
        { error: "Ese nombre de archivo no está permitido." },
        { status: 400 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    const marcador = pareceScriptOMarcado(Buffer.from(bytes));
    if (marcador) {
      await registrarSubidaRechazada({
        ruta: "barber/clients/photos",
        motivo: `El contenido parece un script o marcado (${marcador.trim()})`,
        codigo: "script_o_marcado",
        nombreOriginal: file.name,
      });
      return NextResponse.json(
        { error: "Ese archivo no es una imagen válida." },
        { status: 400 },
      );
    }

    const mime = sniffImageMime(bytes);
    if (!mime) {
      await registrarSubidaRechazada({
        ruta: "barber/clients/photos",
        motivo: "Tipo real de archivo no reconocido como imagen",
        codigo: "tipo_no_reconocido",
        nombreOriginal: file.name,
      });
      return NextResponse.json(
        { error: "Ese archivo no es una imagen (solo WebP, JPG o PNG)." },
        { status: 400 },
      );
    }

    // heic/heif no se fuerzan por sharp: libvips de este repo no decodifica
    // HEIC real, solo AVIF pese al nombre "heif".
    if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") {
      try {
        const buf = Buffer.from(bytes);
        const metadata = await sharp(buf).metadata();
        if (!metadata.width || !metadata.height) throw new Error("sin dimensiones");
        await sharp(buf).toBuffer();
      } catch {
        await registrarSubidaRechazada({
          ruta: "barber/clients/photos",
          motivo: "La imagen no se pudo decodificar (está corrupta o no es una imagen real)",
          codigo: "imagen_corrupta",
          nombreOriginal: file.name,
        });
        return NextResponse.json(
          { error: "La imagen no se pudo decodificar (está corrupta o no es una imagen real)." },
          { status: 400 },
        );
      }
    }

    const rawKind = String(form.get("kind") ?? "AFTER");
    const kind = (KINDS as string[]).includes(rawKind) ? (rawKind as BarberPhotoKind) : "AFTER";

    // Publicar al portal es otro permiso (portal.manage). Quien no lo tenga
    // sube la foto, pero no la puede marcar visible para el cliente.
    const wantsVisible = String(form.get("visibleToClient") ?? "") === "true";
    const visibleToClient = wantsVisible && alsoHas(gate.ctx, "portal.manage");

    const rawAppointment = form.get("appointmentId");
    const appointmentId =
      typeof rawAppointment === "string" && rawAppointment ? rawAppointment : null;

    const result = await saveBarberVisitPhoto(gate.ctx, {
      clientId: params.id,
      appointmentId,
      kind,
      visibleToClient,
      mime,
      body: bytes,
    });
    if (!result.ok) {
      await registrarSubidaRechazada({
        ruta: "barber/clients/photos",
        motivo: result.error,
        codigo: "tipo_no_permitido",
        nombreOriginal: file.name,
      });
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(
      {
        photo: { ...result.photo, signedUrl: result.signedUrl },
        bytes: bytes.length,
        visibleDenied: wantsVisible && !visibleToClient,
      },
      { status: 201 },
    );
  } catch (e) {
    return serverError("photos.upload", e);
  }
}
