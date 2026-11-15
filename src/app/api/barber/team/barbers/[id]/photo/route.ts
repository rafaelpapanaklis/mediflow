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
  FOTO_BARBERO_LADO_MAX,
  FOTO_BARBERO_MAX_BODY_BYTES,
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
       un Map por instancia;
     · lo que se SUBE es la imagen REPROCESADA (rotate + resize a 1600 + webp):
       la foto de un teléfono trae el EXIF con la UBICACIÓN GPS y el bucket
       es público, así que el archivo original nunca se guarda. De paso el
       tipo guardado es el real (image/webp), no el que declaró el navegador;
     · un Content-Length de más de 4,5 MB se corta con 413 ANTES de leer el
       cuerpo (el tope de 4 MB del archivo se sigue comprobando después);
     · DELETE: «Quitar foto» borra también el objeto del bucket, con el mismo
       `objetoFotoAnterior` (solo dentro de la carpeta de ese barbero).

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

interface BarberFoto {
  id: string;
  barbershopId: string;
  photoUrl: string | null;
  barbershop: { slug: string } | null;
}

/**
 * Resultado deliberadamente NO discriminado (el repo compila con `strict: false`
 * y ahí TypeScript no estrecha una unión): o `response` (error ya armado) o
 * `barber`, nunca los dos.
 */
interface Resultado {
  response: NextResponse | null;
  barber: BarberFoto | null;
}

/**
 * Las puertas comunes a subir y quitar: sesión, permiso, suscripción, freno de
 * subidas y que el barbero sea de una sede que la sesión alcanza. Devuelve la
 * respuesta de error ya armada, o el barbero.
 */
async function puerta(
  req: NextRequest,
  barberId: string,
): Promise<Resultado> {
  const ctx = await getBarberContext();
  if (!ctx) return { response: barberUnauthorized(), barber: null };

  try {
    assertBarberPermission(ctx, "barbers.manage");
    await assertBarberSubscriptionActive(ctx);
  } catch (e) {
    if (e instanceof BarberForbiddenError) {
      return {
        response: NextResponse.json(
          { error: "No tienes permiso para cambiar la foto de un barbero.", permission: e.permission },
          { status: 403 },
        ),
        barber: null,
      };
    }
    const gate = barberGateErrorPayload(e);
    if (gate) return { response: NextResponse.json(gate.body, { status: gate.status }), barber: null };
    throw e;
  }

  // Freno de subidas (por usuario, no por IP ni por barbero).
  const frenado = await persistentRateLimit(req, {
    id: `${ctx.barbershopId}:${ctx.barberUserId}`,
    limit: 15,
    windowSec: 10 * 60,
    scope: "barber:barber-photo",
  });
  if (frenado) return { response: frenado as NextResponse, barber: null };

  const ids = await getAccessibleBranchIds(ctx);
  if (ids.length === 0) {
    return { response: NextResponse.json({ error: "Barbero no encontrado." }, { status: 404 }), barber: null };
  }
  const barber = await prisma.barber.findFirst({
    where: { id: barberId, barbershopId: { in: ids } },
    select: {
      id: true,
      barbershopId: true,
      photoUrl: true,
      barbershop: { select: { slug: true } },
    },
  });
  if (!barber) return { response: NextResponse.json({ error: "Barbero no encontrado." }, { status: 404 }), barber: null };
  return { response: null, barber: barber as BarberFoto };
}

/** La mini-web /b/<slug> es ISR: que el cambio se vea ya. */
function revalidarWeb(slug: string | undefined): void {
  try {
    if (slug) revalidatePath(rutaWebBarberia(slug));
  } catch {
    /* fuera de un request de Next (pruebas): no pasa nada */
  }
}

/** POST multipart { file } → sube, guarda photoUrl y devuelve la liga. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const abierta = await puerta(req, params.id);
    if (abierta.response) return abierta.response;
    const barber = abierta.barber as BarberFoto;

    // Cuerpo demasiado grande: se corta ANTES de leerlo entero en memoria.
    const declarado = Number(req.headers.get("content-length") ?? "");
    if (Number.isFinite(declarado) && declarado > FOTO_BARBERO_MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "La imagen es demasiado pesada (máximo 4 MB). Súbela desde el navegador, que la comprime sola." },
        { status: 413 },
      );
    }

    // El archivo, con las mismas puertas que el logo.
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

    // REPROCESAR: decodifica de verdad (una firma válida con payload corrupto
    // no entra), aplica la orientación EXIF, achica a 1600 px y recodifica en
    // WebP. sharp NO conserva los metadatos por defecto: el EXIF (con el GPS)
    // se queda fuera. Lo que se sube es esto, no el archivo original.
    let procesada: Buffer;
    try {
      const entrada = Buffer.from(bytes);
      const metadata = await sharp(entrada).metadata();
      if (!metadata.width || !metadata.height) throw new Error("sin dimensiones");
      procesada = await sharp(entrada)
        .rotate()
        .resize({ width: FOTO_BARBERO_LADO_MAX, height: FOTO_BARBERO_LADO_MAX, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
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

    // Subir. La carpeta sale de la FILA del barbero; el tipo, de lo que sharp produjo.
    const carpeta = carpetaFotoBarbero(barber.barbershopId, barber.id);
    const objeto = `${carpeta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;

    const sb = admin();
    const { error: subida } = await sb.storage
      .from(BUCKETS.CLINIC_PUBLIC)
      .upload(objeto, procesada, { contentType: "image/webp", upsert: false });
    if (subida) {
      console.error("[barber/team/barbers/photo] falló la subida:", subida);
      return NextResponse.json({ error: "No se pudo subir la foto." }, { status: 500 });
    }
    const { data: pub } = sb.storage.from(BUCKETS.CLINIC_PUBLIC).getPublicUrl(objeto);
    if (!pub?.publicUrl) {
      await sb.storage.from(BUCKETS.CLINIC_PUBLIC).remove([objeto]).catch(() => undefined);
      return NextResponse.json({ error: "No se pudo generar la liga de la foto." }, { status: 500 });
    }

    // Guardar. Si la base falla, no se queda un objeto huérfano.
    try {
      await prisma.barber.updateMany({
        where: { id: barber.id, barbershopId: barber.barbershopId },
        data: { photoUrl: pub.publicUrl },
      });
    } catch (e) {
      await sb.storage.from(BUCKETS.CLINIC_PUBLIC).remove([objeto]).catch(() => undefined);
      throw e;
    }

    // Quitar la anterior de ESE barbero (best-effort, solo en su carpeta).
    const anterior = objetoFotoAnterior(barber.photoUrl, BUCKETS.CLINIC_PUBLIC, carpeta);
    if (anterior && anterior !== objeto) {
      try {
        await sb.storage.from(BUCKETS.CLINIC_PUBLIC).remove([anterior]);
      } catch (e) {
        console.warn("[barber/team/barbers/photo] no se pudo borrar la foto anterior:", e);
      }
    }

    revalidarWeb(barber.barbershop?.slug);
    return NextResponse.json({ photoUrl: pub.publicUrl });
  } catch (err) {
    return barberApiError(err, "team/barbers/[id]/photo:POST");
  }
}

/**
 * DELETE → «Quitar foto»: deja `photoUrl` en null y borra el objeto del bucket
 * (solo si es de la carpeta de ESE barbero: una liga pegada a mano se limpia
 * de la ficha pero no hay nada nuestro que borrar). Es idempotente.
 */
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const abierta = await puerta(req, params.id);
    if (abierta.response) return abierta.response;
    const barber = abierta.barber as BarberFoto;

    // Primero la base (la liga deja de apuntar al archivo) y luego el objeto.
    await prisma.barber.updateMany({
      where: { id: barber.id, barbershopId: barber.barbershopId },
      data: { photoUrl: null },
    });

    const carpeta = carpetaFotoBarbero(barber.barbershopId, barber.id);
    const objeto = objetoFotoAnterior(barber.photoUrl, BUCKETS.CLINIC_PUBLIC, carpeta);
    if (objeto) {
      try {
        await admin().storage.from(BUCKETS.CLINIC_PUBLIC).remove([objeto]);
      } catch (e) {
        console.warn("[barber/team/barbers/photo] no se pudo borrar el archivo:", e);
      }
    }

    revalidarWeb(barber.barbershop?.slug);
    return NextResponse.json({ photoUrl: null });
  } catch (err) {
    return barberApiError(err, "team/barbers/[id]/photo:DELETE");
  }
}
