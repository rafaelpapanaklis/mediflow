import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient as createAdmin } from "@supabase/supabase-js";
import sharp from "sharp";
import {
  assertBarberPermission,
  BarberForbiddenError,
  getAccessibleBranchIds,
  getBarberContext,
} from "@/lib/barber-auth";
import { assertBarberSubscriptionActive, barberGateErrorPayload } from "@/lib/barber/gating";
import { barberApiError, barberUnauthorized } from "@/lib/barber/branches";
import { rutaWebBarberia } from "@/lib/barber/landing";
import {
  carpetaFotoBarbero,
  extensionFotoBarbero,
  FOTO_BARBERO_MAX_BYTES,
  FOTO_BARBERO_TIPOS,
  objetoFotoAnterior,
} from "@/lib/barber/barber-photo";
import { persistentRateLimit } from "@/lib/failban";
import { prisma } from "@/lib/prisma";
import { validateMagicNumber } from "@/lib/validate-upload";
import { BUCKETS } from "@/lib/storage";
import {
  pareceScriptOMarcado,
  registrarSubidaRechazada,
  tieneExtensionPeligrosa,
} from "@/lib/uploads/validar-archivo";

/* ═══════════════════════════════════════════════════════════════════════
   FOTO DEL BARBERO, SUBIDA DESDE EL CELULAR.

   Misma receta que /api/barber/settings/logo (el logo es igual de público:
   se pinta en /b/<slug> y en la reserva, así que va al bucket PÚBLICO
   `clinic-public` y no a un bucket privado con liga firmada que caduca).

   Lo que cambia respecto al logo:
     · la puerta es `barbers.manage` (no `settings.edit`);
     · el barbero tiene que ser de una sede que la SESIÓN alcanza
       (getAccessibleBranchIds). El id del barbero viene de la ruta, pero la
       carpeta del bucket sale de la FILA del barbero, nunca del body;
     · exige suscripción ACTIVA: una cuenta sin pagar no sube archivos;
     · guarda en barber/<barbershopId>/barberos/<barberId>/ y actualiza
       `photoUrl`; al subir una nueva, BORRA la anterior de ESE barbero (solo
       si vive en su carpeta: nunca una liga ajena ni el objeto de otro);
     · el freno de subidas es persistente (Upstash si está configurado), no
       un Map por instancia.

   El navegador comprime antes (prepararFoto en components/barber/landing/
   imagen.ts): el tope de 4 MB de aquí es la última red, no la primera.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

const RUTA = "barber/team/barbers/photo";

/** POST multipart { file } → sube, guarda photoUrl y devuelve la liga. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();

    // 1 · Permiso de gestionar barberos + suscripción activa.
    try {
      assertBarberPermission(ctx, "barbers.manage");
      await assertBarberSubscriptionActive(ctx);
    } catch (e) {
      if (e instanceof BarberForbiddenError) {
        return NextResponse.json(
          { error: "No tienes permiso para cambiar la foto de un barbero.", permission: e.permission },
          { status: 403 },
        );
      }
      const gate = barberGateErrorPayload(e);
      if (gate) return NextResponse.json(gate.body, { status: gate.status });
      throw e;
    }

    // 2 · Freno de subidas (por usuario, no por IP ni por barbero).
    const frenado = await persistentRateLimit(req, {
      id: `${ctx.barbershopId}:${ctx.barberUserId}`,
      limit: 15,
      windowSec: 10 * 60,
      scope: "barber:barber-photo",
    });
    if (frenado) return frenado;

    // 3 · El barbero es de una sede que la sesión alcanza.
    const ids = await getAccessibleBranchIds(ctx);
    if (ids.length === 0) return NextResponse.json({ error: "Barbero no encontrado." }, { status: 404 });
    const barber = await prisma.barber.findFirst({
      where: { id: params.id, barbershopId: { in: ids } },
      select: {
        id: true,
        barbershopId: true,
        photoUrl: true,
        barbershop: { select: { slug: true } },
      },
    });
    if (!barber) return NextResponse.json({ error: "Barbero no encontrado." }, { status: 404 });

    // 4 · El archivo, con las mismas puertas que el logo.
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "No pudimos leer el archivo." }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No llegó ninguna imagen." }, { status: 400 });
    }
    if (tieneExtensionPeligrosa(file.name)) {
      await registrarSubidaRechazada({
        ruta: RUTA,
        motivo: "El nombre del archivo tiene una extensión no permitida",
        codigo: "extension_peligrosa",
        nombreOriginal: file.name,
      });
      return NextResponse.json({ error: "Ese nombre de archivo no está permitido." }, { status: 400 });
    }
    if (!FOTO_BARBERO_TIPOS.includes(file.type)) {
      return NextResponse.json({ error: "Solo aceptamos JPG, PNG o WebP." }, { status: 400 });
    }
    if (file.size > FOTO_BARBERO_MAX_BYTES) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      return NextResponse.json(
        { error: `La imagen pesa ${mb} MB y el máximo son 4 MB. Súbela desde el navegador, que la comprime sola.` },
        { status: 400 },
      );
    }

    const bytes = await file.arrayBuffer();

    const marcador = pareceScriptOMarcado(Buffer.from(bytes));
    if (marcador) {
      await registrarSubidaRechazada({
        ruta: RUTA,
        motivo: `El contenido parece un script o marcado (${marcador.trim()})`,
        codigo: "script_o_marcado",
        nombreOriginal: file.name,
      });
      return NextResponse.json({ error: "Ese archivo no es una imagen válida." }, { status: 400 });
    }

    // El tipo que declara el navegador es falseable: esto mira los bytes.
    const malo = await validateMagicNumber(bytes, FOTO_BARBERO_TIPOS);
    if (malo) {
      await registrarSubidaRechazada({
        ruta: RUTA,
        motivo: malo,
        codigo: "tipo_no_permitido",
        nombreOriginal: file.name,
      });
      return NextResponse.json({ error: malo }, { status: 400 });
    }

    // Decodificación real: una firma válida con payload corrupto no entra.
    try {
      const buf = Buffer.from(bytes);
      const metadata = await sharp(buf).metadata();
      if (!metadata.width || !metadata.height) throw new Error("sin dimensiones");
      await sharp(buf).toBuffer();
    } catch {
      await registrarSubidaRechazada({
        ruta: RUTA,
        motivo: "La imagen no se pudo decodificar (está corrupta o no es una imagen real)",
        codigo: "imagen_corrupta",
        nombreOriginal: file.name,
      });
      return NextResponse.json(
        { error: "La imagen no se pudo decodificar (está corrupta o no es una imagen real)." },
        { status: 400 },
      );
    }

    // 5 · Subir. La carpeta sale de la FILA del barbero; la extensión, del tipo real.
    const carpeta = carpetaFotoBarbero(barber.barbershopId, barber.id);
    const objeto = `${carpeta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensionFotoBarbero(file.type)}`;

    const sb = admin();
    const { error: subida } = await sb.storage
      .from(BUCKETS.CLINIC_PUBLIC)
      .upload(objeto, bytes, { contentType: file.type, upsert: false });
    if (subida) {
      console.error("[barber/team/barbers/photo] falló la subida:", subida);
      return NextResponse.json({ error: "No se pudo subir la foto." }, { status: 500 });
    }
    const { data: pub } = sb.storage.from(BUCKETS.CLINIC_PUBLIC).getPublicUrl(objeto);
    if (!pub?.publicUrl) {
      await sb.storage.from(BUCKETS.CLINIC_PUBLIC).remove([objeto]).catch(() => undefined);
      return NextResponse.json({ error: "No se pudo generar la liga de la foto." }, { status: 500 });
    }

    // 6 · Guardar. Si la base falla, no se queda un objeto huérfano.
    try {
      await prisma.barber.updateMany({
        where: { id: barber.id, barbershopId: barber.barbershopId },
        data: { photoUrl: pub.publicUrl },
      });
    } catch (e) {
      await sb.storage.from(BUCKETS.CLINIC_PUBLIC).remove([objeto]).catch(() => undefined);
      throw e;
    }

    // 7 · Quitar la anterior de ESE barbero (best-effort, solo en su carpeta).
    const anterior = objetoFotoAnterior(barber.photoUrl, BUCKETS.CLINIC_PUBLIC, carpeta);
    if (anterior && anterior !== objeto) {
      try {
        await sb.storage.from(BUCKETS.CLINIC_PUBLIC).remove([anterior]);
      } catch (e) {
        console.warn("[barber/team/barbers/photo] no se pudo borrar la foto anterior:", e);
      }
    }

    // La mini-web /b/<slug> es ISR: que el barbero nuevo se vea ya.
    try {
      if (barber.barbershop?.slug) revalidatePath(rutaWebBarberia(barber.barbershop.slug));
    } catch {
      /* fuera de un request de Next (pruebas): no pasa nada */
    }

    return NextResponse.json({ photoUrl: pub.publicUrl });
  } catch (err) {
    return barberApiError(err, "team/barbers/[id]/photo:POST");
  }
}
