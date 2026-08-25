import { NextResponse, type NextRequest } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { BUCKETS } from "@/lib/storage";
import { validateMagicNumber } from "@/lib/validate-upload";
import { rateLimitKey } from "@/lib/rate-limit";
import {
  assertRealtyPermission,
  getRealtyContext,
  RealtyForbiddenError,
} from "@/lib/realty-auth";
import { realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { esRanuraDeFotoRealtyWeb } from "@/lib/realty/landing";

/* ═══════════════════════════════════════════════════════════════════════
   SUBIR UNA FOTO DE LA WEB PÚBLICA (logo, portada, retrato, oficina…).

   ── LAS MISMAS TRES PUERTAS QUE GUARDAR ──────────────────────────
   Subir NUNCA puede ser más permisivo que guardar: quien no puede escribir
   la configuración tampoco puede dejar archivos en el bucket.

   ── POR QUÉ `clinic-public` Y NO `realty-files` ──────────────────
   REALTY_FILES_BUCKET ("realty-files") es PRIVADO por diseño: ahí viven
   escrituras, prediales e identificaciones, y se sirven con URLs firmadas
   de cinco minutos. Estas fotos son lo contrario: se pintan en una página
   indexable y cacheada por ISR, así que una URL firmada rompería la caché
   y caducaría a los cinco minutos dejando la web sin imágenes. Se reusa el
   bucket PÚBLICO que ya existe, bajo el prefijo realty/<accountId>/, que
   es exactamente lo que hizo barber por el mismo motivo.

   ── EL `destino` NO ES TEXTO LIBRE ───────────────────────────────
   Entra en la RUTA del objeto. Se valida contra el vocabulario de ranuras
   de las nueve plantillas (esRanuraDeFotoRealtyWeb) más una lista corta de
   destinos extra. Sin eso, un `destino` con "../" escribe donde quiera.

   ── EL TIPO QUE DECLARA EL NAVEGADOR ES FALSEABLE ────────────────
   Por eso además de `file.type` se miran los primeros bytes de verdad con
   validateMagicNumber.
   ═══════════════════════════════════════════════════════════════════════ */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tope del runtime serverless para un multipart. */
const MAX_BYTES = 4 * 1024 * 1024;
const TIPOS = ["image/jpeg", "image/png", "image/webp"];
/** Destinos que no son ranura de ninguna plantilla. */
const DESTINOS_EXTRA = ["og", "galeria"];

let cliente: ReturnType<typeof createAdmin> | null = null;
function admin() {
  if (cliente) return cliente;
  cliente = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  return cliente;
}

export async function POST(req: NextRequest) {
  const ctx = await getRealtyContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    assertRealtyPermission(ctx, "web.edit");
  } catch (e) {
    if (e instanceof RealtyForbiddenError) {
      return NextResponse.json({ error: "No tienes permiso para editar la web." }, { status: 403 });
    }
    throw e;
  }

  if (!realtyPlanHasFeature(ctx.plan, "webEditor")) {
    return NextResponse.json(
      { error: "El editor visual de la web no está incluido en tu plan.", necesitaPlan: true },
      { status: 403 },
    );
  }

  // Freno por CUENTA, no por IP: el cupo de almacenamiento del plan todavía
  // no se descuenta aquí (storageUsedBytes lo lleva la ola de inmuebles), así
  // que sin esto una sesión con permiso puede llenar el bucket a 4 MB por
  // petición. No sustituye al cupo; lo acota mientras llega.
  if (!rateLimitKey(`realty-web-upload:${ctx.accountId}`, 30, 60_000)) {
    return NextResponse.json(
      { error: "Estás subiendo demasiadas imágenes seguidas. Espera un minuto." },
      { status: 429 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const file = form.get("file");
  const destino = String(form.get("destino") ?? "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta la imagen" }, { status: 400 });
  }
  if (!destino || (!DESTINOS_EXTRA.includes(destino) && !esRanuraDeFotoRealtyWeb(destino))) {
    return NextResponse.json({ error: "Destino inválido" }, { status: 400 });
  }
  if (!TIPOS.includes(file.type)) {
    return NextResponse.json({ error: "Solo aceptamos JPG, PNG o WebP." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "La imagen pesa más de 4 MB." }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const malo = await validateMagicNumber(bytes, TIPOS);
  if (malo) return NextResponse.json({ error: "Ese archivo no es una imagen." }, { status: 400 });

  const ext =
    (file.name.split(".").pop() ?? "webp").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() ||
    "webp";
  // El accountId sale de la SESIÓN, nunca del formulario.
  const ruta = `realty/${ctx.accountId}/${destino}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;

  try {
    const sb = admin();
    const { error } = await sb.storage
      .from(BUCKETS.CLINIC_PUBLIC)
      .upload(ruta, bytes, { contentType: file.type, upsert: false });
    if (error) {
      console.error("[realty-landing] subida falló:", error);
      return NextResponse.json({ error: "No se pudo subir la imagen." }, { status: 500 });
    }
    const { data } = sb.storage.from(BUCKETS.CLINIC_PUBLIC).getPublicUrl(ruta);
    if (!data?.publicUrl) {
      return NextResponse.json({ error: "No se pudo subir la imagen." }, { status: 500 });
    }
    return NextResponse.json({ url: data.publicUrl, bytes: file.size });
  } catch (e) {
    console.error("[realty-landing] subida falló:", e);
    return NextResponse.json({ error: "No se pudo subir la imagen." }, { status: 500 });
  }
}
