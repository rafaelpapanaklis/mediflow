import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getBarberContext, assertBarberPermission, BarberForbiddenError } from "@/lib/barber-auth";
import { getBarberPlan } from "@/lib/barber/plans";
import { esRanuraDeFotoBarberWeb } from "@/lib/barber/landing";
import { validateMagicNumber } from "@/lib/validate-upload";
import { BUCKETS } from "@/lib/storage";

/* ═══════════════════════════════════════════════════════════════════════
   SUBIR UNA FOTO DE LA PÁGINA WEB.

   Mismas tres puertas que el guardado (sesión, `web.edit`, plan con
   miniWebEditor). Subir NUNCA puede ser más permisivo que guardar: si no
   lo fuera, cualquiera con sesión podría dejar objetos en un bucket
   público a nombre de la barbería.

   ── EL TOPE ES 4 MB, Y EL NAVEGADOR COMPRIME ANTES ────────────────
   El runtime serverless corta el cuerpo de la petición en ~4,5 MB. Una
   foto de celular pesa 8-15 MB y NUNCA llegaría hasta aquí: el error que
   vería la barbería no explicaría nada. Por eso el cliente
   (components/barber/landing/imagen.ts) redimensiona a 1600 px de lado y
   recodifica en WebP 0.8 ANTES de subir. Este tope es la última red, no
   la primera.

   ── EL BUCKET ─────────────────────────────────────────────────────
   Se reusa el bucket PÚBLICO que ya existe (`clinic-public`) bajo el
   prefijo `barber/<barbershopId>/`. Un bucket propio del vertical sería
   más limpio, pero crearlo es un cambio manual en Supabase que esta
   terminal no puede hacer sola; queda anotado en el reporte. Público es
   correcto aquí: estas fotos se pintan en una página indexable y sin
   contraseña, así que una URL firmada de TTL corto rompería la caché de
   ISR y caducaría a los cinco minutos.

   `destino` entra en la RUTA del objeto, así que no puede ser texto
   libre del cliente: o es una ranura declarada en el manifiesto, o es
   una de las dos excepciones de abajo.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

/** Tope real del cuerpo de la petición serverless. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Destinos que NO son ranura del manifiesto:
 *   galeria · el portafolio de cortes (una lista, no una ranura)
 *   og      · la imagen que se ve al compartir el enlace
 */
const DESTINOS_EXTRA = ["galeria", "og"];

const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export async function POST(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    assertBarberPermission(ctx, "web.edit");
  } catch (e) {
    if (e instanceof BarberForbiddenError) {
      return NextResponse.json({ error: "No tienes permiso para editar tu página." }, { status: 403 });
    }
    throw e;
  }

  const plan = await getBarberPlan(ctx.barbershop.plan);
  if (plan.features.miniWebEditor !== true) {
    return NextResponse.json(
      { error: "El editor de tu página está en los planes Avanzado y Profesional.", necesitaPlan: true },
      { status: 403 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "No pudimos leer el archivo." }, { status: 400 });
  }

  const file = form.get("file");
  const destino = String(form.get("destino") ?? "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No llegó ninguna imagen." }, { status: 400 });
  }
  if (!destino || (!DESTINOS_EXTRA.includes(destino) && !esRanuraDeFotoBarberWeb(destino))) {
    return NextResponse.json({ error: "Destino de imagen no válido." }, { status: 400 });
  }
  if (!TIPOS.includes(file.type)) {
    return NextResponse.json(
      { error: "Solo aceptamos JPG, PNG, WebP o GIF." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return NextResponse.json(
      {
        error: `La imagen pesa ${mb} MB y el máximo son 4 MB. Súbela desde el navegador, que la comprime sola.`,
      },
      { status: 400 },
    );
  }

  const bytes = await file.arrayBuffer();

  // El tipo que declara el navegador es falseable: esto mira los primeros
  // bytes de verdad. Un .jpg que por dentro es otra cosa no entra.
  const malo = await validateMagicNumber(bytes, TIPOS);
  if (malo) return NextResponse.json({ error: malo }, { status: 400 });

  const ext =
    (file.name.split(".").pop() ?? "webp").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "webp";
  // El barbershopId sale de la SESIÓN, nunca del formulario: una barbería
  // no puede escribir en la carpeta de otra.
  const ruta = `barber/${ctx.barbershopId}/${destino}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;

  const sb = admin();
  const { error } = await sb.storage
    .from(BUCKETS.CLINIC_PUBLIC)
    .upload(ruta, bytes, { contentType: file.type, upsert: false });

  if (error) {
    console.error("[barber-landing/upload] falló la subida:", error);
    return NextResponse.json({ error: "No se pudo subir la imagen." }, { status: 500 });
  }

  const { data } = sb.storage.from(BUCKETS.CLINIC_PUBLIC).getPublicUrl(ruta);
  if (!data?.publicUrl) {
    return NextResponse.json({ error: "No se pudo generar la liga de la imagen." }, { status: 500 });
  }

  return NextResponse.json({ url: data.publicUrl, bytes: file.size });
}
