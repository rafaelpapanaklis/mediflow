import { NextResponse, type NextRequest } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { barberApiError } from "@/lib/barber/branches";
import { setBarberLogo } from "@/lib/barber/settings";
import { validateMagicNumber } from "@/lib/validate-upload";
import { BUCKETS } from "@/lib/storage";
import { gateSettings, revalidateShopWeb } from "../_gate";

/* ═══════════════════════════════════════════════════════════════════════
   LOGO DE LA BARBERÍA.

   Misma receta que /api/barber/landing/upload (la foto de portada de la
   mini-web), porque el logo es igual de público: se pinta en /b/<slug>,
   en la reserva, en el portal del cliente y en el ticket. Por eso va al
   bucket PÚBLICO `clinic-public` bajo `barber/<barbershopId>/logo/` —
   una URL firmada de TTL corto rompería la caché ISR de la página.

   Lo que cambia respecto a la subida de la mini-web: la puerta es
   `settings.edit` y NO depende del plan (un Básico también tiene logo).

   El navegador comprime antes (prepararFoto en components/barber/landing/
   imagen.ts): el tope de 4 MB de aquí es la última red, no la primera.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

/** Tope real del cuerpo de la petición serverless. */
const MAX_BYTES = 4 * 1024 * 1024;
const TIPOS = ["image/jpeg", "image/png", "image/webp"];

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

/** POST multipart { file } → sube, guarda logoUrl y devuelve la liga. */
export async function POST(req: NextRequest) {
  const gate = await gateSettings();
  if ("response" in gate) return gate.response;
  const { ctx } = gate;

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
  if (!TIPOS.includes(file.type)) {
    return NextResponse.json({ error: "Solo aceptamos JPG, PNG o WebP." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return NextResponse.json(
      { error: `La imagen pesa ${mb} MB y el máximo son 4 MB. Súbela desde el navegador, que la comprime sola.` },
      { status: 400 },
    );
  }

  const bytes = await file.arrayBuffer();
  // El tipo que declara el navegador es falseable: esto mira los bytes.
  const malo = await validateMagicNumber(bytes, TIPOS);
  if (malo) return NextResponse.json({ error: malo }, { status: 400 });

  const ext =
    (file.name.split(".").pop() ?? "webp").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "webp";
  // El barbershopId sale de la SESIÓN, nunca del formulario.
  const ruta = `barber/${ctx.barbershopId}/logo/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  try {
    const sb = admin();
    const { error } = await sb.storage
      .from(BUCKETS.CLINIC_PUBLIC)
      .upload(ruta, bytes, { contentType: file.type, upsert: false });
    if (error) {
      console.error("[barber/settings/logo] falló la subida:", error);
      return NextResponse.json({ error: "No se pudo subir el logo." }, { status: 500 });
    }
    const { data } = sb.storage.from(BUCKETS.CLINIC_PUBLIC).getPublicUrl(ruta);
    if (!data?.publicUrl) {
      return NextResponse.json({ error: "No se pudo generar la liga del logo." }, { status: 500 });
    }
    const logoUrl = await setBarberLogo(ctx, data.publicUrl);
    revalidateShopWeb(ctx.barbershop.slug);
    return NextResponse.json({ logoUrl });
  } catch (e) {
    return barberApiError(e, "settings/logo:POST");
  }
}

/** DELETE → quita el logo (logoUrl = null). El archivo se borra best-effort. */
export async function DELETE() {
  const gate = await gateSettings();
  if ("response" in gate) return gate.response;
  const { ctx } = gate;
  try {
    const previous = ctx.barbershop.logoUrl;
    await setBarberLogo(ctx, null);
    revalidateShopWeb(ctx.barbershop.slug);

    // Solo se toca un objeto que esté en NUESTRA carpeta de logos; una liga
    // pegada a mano o de otra carpeta se deja en paz.
    const prefix = `/${BUCKETS.CLINIC_PUBLIC}/barber/${ctx.barbershopId}/logo/`;
    const idx = previous ? previous.indexOf(prefix) : -1;
    if (previous && idx >= 0) {
      const objeto = previous.slice(idx + prefix.length - `barber/${ctx.barbershopId}/logo/`.length);
      try {
        await admin().storage.from(BUCKETS.CLINIC_PUBLIC).remove([objeto.split("?")[0]]);
      } catch (e) {
        console.warn("[barber/settings/logo] no se pudo borrar el archivo anterior:", e);
      }
    }
    return NextResponse.json({ logoUrl: null });
  } catch (e) {
    return barberApiError(e, "settings/logo:DELETE");
  }
}
