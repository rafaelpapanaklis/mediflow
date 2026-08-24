import { NextResponse } from "next/server";
import {
  PHOTO_MAX_BYTES,
  listBarberClientPhotos,
  saveBarberVisitPhoto,
  sniffImageMime,
} from "@/lib/barber/clients";
import { alsoHas, gateBarberClients, serverError } from "../../_helpers";
import type { BarberPhotoKind } from "@/lib/barber/types";

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

    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffImageMime(bytes);
    if (!mime) {
      return NextResponse.json(
        { error: "Ese archivo no es una imagen (solo WebP, JPG o PNG)." },
        { status: 400 },
      );
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
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

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
