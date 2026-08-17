import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { validateMagicNumber } from "@/lib/validate-upload";
import { BUCKETS } from "@/lib/storage";
import { allPhotoSlotIds } from "@/app/[slug]/_shared/template-manifest";

function getAdminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

/**
 * Tope real del cuerpo de la petición.
 *
 * Declaraba 50 MB, pero el runtime serverless corta la request en ~4.5 MB: una
 * foto de celular moderno (8-15 MB) nunca llegaba a este código y el error que
 * veía la clínica no explicaba nada. Los dos clientes comprimen en el navegador
 * antes de subir (@/lib/image-client), así que 4 MB es de sobra para una foto
 * de 2000 px en webp; el que se pase igual se lleva un mensaje que se entiende.
 */
const MAX_SIZE = 4 * 1024 * 1024;

// Destinos que NO son ranura del manifiesto:
//   cover/gallery — el uploader viejo de la pestaña General y la galería.
//   avatar        — la foto de cada miembro en /dashboard/team, que alimenta
//                   la sección "Equipo" de la landing (users[].avatarUrl).
// `avatar` se cayó de la lista cuando el manifiesto la introdujo (2a98c3d1):
// team-client seguía mandándolo y el endpoint respondía 400, así que desde
// entonces NINGUNA clínica podía subir la foto de un doctor.
const CAMPOS_LEGADO = ["cover", "gallery", "avatar"];

// Las imágenes de la landing pública de cada clínica viven en un bucket
// PÚBLICO separado (CLINIC_PUBLIC). El bucket clínico (PATIENT_FILES) está
// privado y sólo se accede con signed URLs de TTL corto.
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file     = formData.get("file") as File | null;
  // "cover" | "gallery" | "avatar" o el id de una RANURA del manifiesto
  // ("portada", "caso1_antes", "tecnologia1"…). Cualquier otra cosa se rechaza:
  // `field` entra en la ruta del objeto y no puede ser texto libre del cliente.
  const field    = formData.get("field") as string | null;

  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

  const destino = (field ?? "").trim();
  if (!destino || (!CAMPOS_LEGADO.includes(destino) && !allPhotoSlotIds().includes(destino))) {
    return NextResponse.json({ error: "Destino de imagen no válido" }, { status: 400 });
  }

  // PERMISOS — cada destino se gatea igual que la escritura que alimenta, para
  // que subir no sea nunca más permisivo que guardar:
  //   avatar → PATCH /api/team/[id] exige admin (requireAdmin).
  //   resto  → PATCH /api/clinic-landing exige "landing.edit".
  // Sin esto, cualquier usuario con sesión (incluido uno de solo lectura) podía
  // dejar objetos en el bucket público de la clínica.
  if (destino === "avatar") {
    const err = requireAdmin(ctx);
    if (err) return err;
  } else {
    const denied = denyIfMissingPermission(ctx, "landing.edit");
    if (denied) return denied;
  }

  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "image/bmp", "image/tiff"];
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Tipo de archivo no permitido" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return NextResponse.json(
      { error: `La imagen pesa ${mb} MB y el máximo son 4 MB. Recórtala o súbela desde el navegador, que la comprime sola.` },
      { status: 400 },
    );
  }

  const ext  = (file.name.split(".").pop() ?? "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "jpg";
  const path = `landing/${ctx.clinicId}/${destino}/${Date.now()}.${ext}`;

  const supabase = getAdminSupabase();
  const bytes    = await file.arrayBuffer();

  const magicError = await validateMagicNumber(bytes, ALLOWED_TYPES);
  if (magicError) return NextResponse.json({ error: magicError }, { status: 400 });

  const { error } = await supabase.storage
    .from(BUCKETS.CLINIC_PUBLIC)
    .upload(path, bytes, { contentType: file.type, upsert: false });

  if (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Error al subir imagen" }, { status: 500 });
  }

  // Public URL — la landing es pública e indexable, no usa signed URLs.
  const { data: publicData } = supabase.storage.from(BUCKETS.CLINIC_PUBLIC).getPublicUrl(path);
  if (!publicData?.publicUrl) {
    return NextResponse.json({ error: "Error generando URL" }, { status: 500 });
  }
  return NextResponse.json({ url: publicData.publicUrl });
}
