import { NextResponse, type NextRequest } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import sharp from "sharp";
import { assertBarberPermission, BarberForbiddenError, getBarberContext, type BarberContext } from "@/lib/barber-auth";
import { assertBarberSubscriptionActive, barberGateErrorPayload } from "@/lib/barber/gating";
import { barberApiError, barberUnauthorized } from "@/lib/barber/branches";
import { assertBarberFeature, moneyErrorResponse } from "@/lib/barber/cash";
import {
  FOTO_BARBERO_LADO_MAX,
  FOTO_BARBERO_MAX_BODY_BYTES,
  FOTO_BARBERO_MAX_BYTES,
  FOTO_BARBERO_TIPOS,
  objetoFotoAnterior,
} from "@/lib/barber/barber-photo";
import { carpetaFotoProducto, tiendaReady } from "@/lib/barber/tienda-core";
import { revalidarTienda } from "@/lib/barber/tienda";
import { persistentRateLimit } from "@/lib/failban";
import { prisma } from "@/lib/prisma";
import { validateMagicNumber } from "@/lib/validate-upload";
import { BUCKETS } from "@/lib/storage";
import { pareceScriptOMarcado, registrarSubidaRechazada, tieneExtensionPeligrosa } from "@/lib/uploads/validar-archivo";

/* ═══════════════════════════════════════════════════════════════════════
   FOTO DEL PRODUCTO (tienda, ws6-t1).

   La MISMA receta que la foto del barbero (team/barbers/[id]/photo), con sus
   mismos límites (4 MB, 1600 px, JPG/PNG/WebP) y el navegador comprimiendo
   antes igual que con las fotos de los clientes (comprimirFotoDeCorte). Va al
   bucket PÚBLICO `clinic-public` y no al privado de las fotos de clientes:
   la foto sale en /b/<slug>/tienda y como og:image al compartir la liga, y
   una liga firmada caducaría en 5 minutos.

     · puerta: products.manage + plan con productos + suscripción ACTIVA;
     · el producto tiene que ser de la barbería de la sesión; la carpeta sale
       de su FILA (barber/<shopId>/productos/<productId>), nunca del body;
     · se sube la imagen REPROCESADA (rotate + 1600 + webp): el EXIF con el
       GPS del teléfono se queda fuera;
     · al subir otra, o con DELETE, se borra la anterior SOLO si vive en la
       carpeta de ese producto (una liga ajena nunca se toca);
     · sin sql/barber_tienda.sql (no hay columna photoUrl) → 409.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

const RUTA = "barber/products/photo";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

interface Abierta {
  response: NextResponse | null;
  ctx: BarberContext | null;
  product: { id: string; barbershopId: string; photoUrl: string | null } | null;
}

async function puerta(req: NextRequest, productId: string): Promise<Abierta> {
  const ctx = await getBarberContext();
  if (!ctx) return { response: barberUnauthorized(), ctx: null, product: null };
  try {
    assertBarberPermission(ctx, "products.manage");
    await assertBarberFeature(ctx, "products");
    await assertBarberSubscriptionActive(ctx);
  } catch (e) {
    if (e instanceof BarberForbiddenError) {
      return { response: NextResponse.json({ error: "No tienes permiso para cambiar la foto de un producto.", permission: e.permission }, { status: 403 }), ctx: null, product: null };
    }
    const gate = barberGateErrorPayload(e);
    if (gate) return { response: NextResponse.json(gate.body, { status: gate.status }), ctx: null, product: null };
    return { response: moneyErrorResponse(e), ctx: null, product: null };
  }
  if (!(await tiendaReady(prisma)).columns) {
    return { response: NextResponse.json({ error: "Falta aplicar sql/barber_tienda.sql", code: "TIENDA_SQL_PENDING" }, { status: 409 }), ctx: null, product: null };
  }
  const frenado = await persistentRateLimit(req, {
    id: `${ctx.barbershopId}:${ctx.barberUserId}`,
    limit: 30,
    windowSec: 10 * 60,
    scope: "barber:product-photo",
  });
  if (frenado) return { response: frenado as NextResponse, ctx: null, product: null };

  const rows = await prisma.$queryRaw<Array<{ id: string; barbershopId: string; photoUrl: string | null }>>`
    SELECT "id", "barbershopId", "photoUrl" FROM "barber_products"
    WHERE "id" = ${productId} AND "barbershopId" = ${ctx.barbershopId}
  `;
  if (!rows[0]) return { response: NextResponse.json({ error: "Producto no encontrado." }, { status: 404 }), ctx: null, product: null };
  return { response: null, ctx, product: rows[0] };
}

/** POST multipart { file } → sube, guarda photoUrl y devuelve la liga. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const abierta = await puerta(req, params.id);
    if (abierta.response) return abierta.response;
    const ctx = abierta.ctx as BarberContext;
    const product = abierta.product!;

    const declarado = Number(req.headers.get("content-length") ?? "");
    if (Number.isFinite(declarado) && declarado > FOTO_BARBERO_MAX_BODY_BYTES) {
      return NextResponse.json({ error: "La imagen es demasiado pesada (máximo 4 MB). Súbela desde el navegador, que la comprime sola." }, { status: 413 });
    }
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "No pudimos leer el archivo." }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No llegó ninguna imagen." }, { status: 400 });
    if (tieneExtensionPeligrosa(file.name)) {
      await registrarSubidaRechazada({ ruta: RUTA, motivo: "El nombre del archivo tiene una extensión no permitida", codigo: "extension_peligrosa", nombreOriginal: file.name });
      return NextResponse.json({ error: "Ese nombre de archivo no está permitido." }, { status: 400 });
    }
    if (!FOTO_BARBERO_TIPOS.includes(file.type)) return NextResponse.json({ error: "Solo aceptamos JPG, PNG o WebP." }, { status: 400 });
    if (file.size > FOTO_BARBERO_MAX_BYTES) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      return NextResponse.json({ error: `La imagen pesa ${mb} MB y el máximo son 4 MB.` }, { status: 400 });
    }
    const bytes = await file.arrayBuffer();
    const marcador = pareceScriptOMarcado(Buffer.from(bytes));
    if (marcador) {
      await registrarSubidaRechazada({ ruta: RUTA, motivo: `El contenido parece un script o marcado (${marcador.trim()})`, codigo: "script_o_marcado", nombreOriginal: file.name });
      return NextResponse.json({ error: "Ese archivo no es una imagen válida." }, { status: 400 });
    }
    const malo = await validateMagicNumber(bytes, FOTO_BARBERO_TIPOS);
    if (malo) {
      await registrarSubidaRechazada({ ruta: RUTA, motivo: malo, codigo: "tipo_no_permitido", nombreOriginal: file.name });
      return NextResponse.json({ error: malo }, { status: 400 });
    }
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
      await registrarSubidaRechazada({ ruta: RUTA, motivo: "La imagen no se pudo decodificar", codigo: "imagen_corrupta", nombreOriginal: file.name });
      return NextResponse.json({ error: "La imagen no se pudo decodificar (está corrupta o no es una imagen real)." }, { status: 400 });
    }

    const carpeta = carpetaFotoProducto(product.barbershopId, product.id);
    const objeto = `${carpeta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
    const sb = admin();
    const { error: subida } = await sb.storage.from(BUCKETS.CLINIC_PUBLIC).upload(objeto, procesada, { contentType: "image/webp", upsert: false });
    if (subida) {
      console.error("[barber/products/photo] falló la subida:", subida);
      return NextResponse.json({ error: "No se pudo subir la foto." }, { status: 500 });
    }
    const { data: pub } = sb.storage.from(BUCKETS.CLINIC_PUBLIC).getPublicUrl(objeto);
    if (!pub?.publicUrl) {
      await sb.storage.from(BUCKETS.CLINIC_PUBLIC).remove([objeto]).catch(() => undefined);
      return NextResponse.json({ error: "No se pudo generar la liga de la foto." }, { status: 500 });
    }
    try {
      await prisma.$executeRaw`
        UPDATE "barber_products" SET "photoUrl" = ${pub.publicUrl}, "updatedAt" = now()
        WHERE "id" = ${product.id} AND "barbershopId" = ${product.barbershopId}
      `;
    } catch (e) {
      await sb.storage.from(BUCKETS.CLINIC_PUBLIC).remove([objeto]).catch(() => undefined);
      throw e;
    }
    const anterior = objetoFotoAnterior(product.photoUrl, BUCKETS.CLINIC_PUBLIC, carpeta);
    if (anterior && anterior !== objeto) {
      await sb.storage.from(BUCKETS.CLINIC_PUBLIC).remove([anterior]).catch((e) => console.warn("[barber/products/photo] anterior:", e));
    }
    revalidarTienda(ctx.barbershop.slug, product.id);
    return NextResponse.json({ photoUrl: pub.publicUrl });
  } catch (err) {
    return barberApiError(err, "products/[id]/photo:POST");
  }
}

/** DELETE → «Quitar foto»: photoUrl en null y borra el objeto si es nuestro. Idempotente. */
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const abierta = await puerta(req, params.id);
    if (abierta.response) return abierta.response;
    const ctx = abierta.ctx as BarberContext;
    const product = abierta.product!;
    await prisma.$executeRaw`
      UPDATE "barber_products" SET "photoUrl" = NULL, "updatedAt" = now()
      WHERE "id" = ${product.id} AND "barbershopId" = ${product.barbershopId}
    `;
    const objeto = objetoFotoAnterior(product.photoUrl, BUCKETS.CLINIC_PUBLIC, carpetaFotoProducto(product.barbershopId, product.id));
    if (objeto) await admin().storage.from(BUCKETS.CLINIC_PUBLIC).remove([objeto]).catch((e) => console.warn("[barber/products/photo] borrar:", e));
    revalidarTienda(ctx.barbershop.slug, product.id);
    return NextResponse.json({ photoUrl: null });
  } catch (err) {
    return barberApiError(err, "products/[id]/photo:DELETE");
  }
}
