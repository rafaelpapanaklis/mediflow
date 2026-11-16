import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { assertBarberFeature, moneyErrorResponse } from "@/lib/barber/cash";
import { assertCashMovementsReady, receiptFolder } from "@/lib/barber/caja-movimientos";
import { periodKeyFor, DEFAULT_BARBER_TZ } from "@/lib/barber/commissions";
import { PHOTO_MAX_BYTES, sniffImageMime } from "@/lib/barber/clients";
import { BARBER_FILES_BUCKET } from "@/lib/barber/types";
import {
  limiteSubidasPorUsuario,
  pareceScriptOMarcado,
  registrarSubidaRechazada,
  tieneExtensionPeligrosa,
} from "@/lib/uploads/validar-archivo";

export const dynamic = "force-dynamic";

const RUTA = "barber/cash-movements/receipt";

/* ═══════════════════════════════════════════════════════════════════════
   FOTO DEL COMPROBANTE de un gasto o pago (caja completa, ws6-t1).

   La MISMA receta que las fotos del corte (clients/[id]/photos): el
   navegador ya la comprimió (comprimirFotoDeCorte), aquí se revisa el techo,
   el nombre, que no sea un script y el tipo REAL por firma de bytes; sharp
   la reprocesa a WebP (sin EXIF/GPS) y va al bucket PRIVADO barber-files,
   en la carpeta de la barbería de la sesión. Devuelve la RUTA (no una liga):
   el movimiento la guarda y se ve con una liga firmada de 5 minutos.

   Puerta: puede subir quien puede registrar un gasto o un pago
   (cash.expenses o cash.withdraw). Sin el SQL de caja completa → 409.
   ═══════════════════════════════════════════════════════════════════════ */
export async function POST(req: Request) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const user = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
    if (!hasBarberPermission(user, "cash.expenses") && !hasBarberPermission(user, "cash.withdraw")) {
      return NextResponse.json({ error: "Sin permiso", code: "FORBIDDEN", permission: "cash.expenses" }, { status: 403 });
    }
    await assertCashMovementsReady();
    if (!limiteSubidasPorUsuario(`barber:comprobante:${ctx.barbershopId}:${ctx.barberUserId}`, 60)) {
      return NextResponse.json({ error: "Demasiadas subidas en poco tiempo. Espera unos minutos." }, { status: 429 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "No llegó la foto." }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "No llegó la foto." }, { status: 400 });
    if (file.size > PHOTO_MAX_BYTES) {
      return NextResponse.json({ error: `Esa foto pesa ${(file.size / (1024 * 1024)).toFixed(1)} MB y el máximo son ${PHOTO_MAX_BYTES / (1024 * 1024)} MB.` }, { status: 413 });
    }
    if (tieneExtensionPeligrosa(file.name)) {
      await registrarSubidaRechazada({ ruta: RUTA, motivo: "El nombre del archivo tiene una extensión no permitida", codigo: "extension_peligrosa", nombreOriginal: file.name });
      return NextResponse.json({ error: "Ese nombre de archivo no está permitido." }, { status: 400 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const marcador = pareceScriptOMarcado(Buffer.from(bytes));
    if (marcador) {
      await registrarSubidaRechazada({ ruta: RUTA, motivo: `El contenido parece un script o marcado (${marcador.trim()})`, codigo: "script_o_marcado", nombreOriginal: file.name });
      return NextResponse.json({ error: "Ese archivo no es una imagen válida." }, { status: 400 });
    }
    const mime = sniffImageMime(bytes);
    if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
      await registrarSubidaRechazada({ ruta: RUTA, motivo: "Tipo real de archivo no reconocido como imagen", codigo: "tipo_no_reconocido", nombreOriginal: file.name });
      return NextResponse.json({ error: "Ese archivo no es una imagen (solo WebP, JPG o PNG)." }, { status: 400 });
    }
    let procesada: Buffer;
    try {
      procesada = await sharp(Buffer.from(bytes))
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
    } catch {
      await registrarSubidaRechazada({ ruta: RUTA, motivo: "La imagen no se pudo decodificar", codigo: "imagen_corrupta", nombreOriginal: file.name });
      return NextResponse.json({ error: "La imagen no se pudo leer (está dañada o no es una imagen real)." }, { status: 400 });
    }

    const month = periodKeyFor(new Date(), ctx.barbershop.timezone || DEFAULT_BARBER_TZ);
    const path = `${receiptFolder(ctx.barbershopId)}${month}/${randomUUID()}.webp`;
    const sb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await sb.storage.from(BARBER_FILES_BUCKET).upload(path, procesada, { contentType: "image/webp", upsert: false });
    if (error) {
      console.warn("[barber/cash-movements/receipt] falló la subida:", error.message);
      return NextResponse.json({ error: "No se pudo guardar la foto. Inténtalo otra vez." }, { status: 500 });
    }
    return NextResponse.json({ path }, { status: 201 });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
