import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { stripClinicSecrets } from "@/lib/clinic-secrets";

const ALLOWED = [
  "landingActive","landingThemeColor","landingCoverUrl","landingGallery",
  "landingTestimonials","landingFaqs","landingServices","landingHours",
  "landingWhatsapp","landingInstagram","landingFacebook","landingTiktok",
  "landingMapEmbed","landingTagline",
  "description","landingTemplate","landingYearsExperience","landingPatients",
  // Landing v2 (sql/landing-v2.sql) — el editor por manifiesto.
  "landingSections","landingPhotos","landingUrgentText","landingMsiPlazos",
];

export async function PATCH(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const data: Record<string, any> = {};
  for (const key of ALLOWED) {
    if (key in body) data[key] = body[key];
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const clinic = await prisma.clinic.update({
    where: { id: ctx.clinicId },
    data,
  });

  // /[slug] es ISR con revalidate 300: sin esto la clínica guardaba, iba a ver
  // su sitio, no veía el cambio y creía que se había perdido. Ahora la página
  // pública se regenera al guardar. Best-effort: si falla, el cambio YA está
  // en la base y a los 5 minutos se ve igual.
  try {
    revalidatePath(`/${clinic.slug}`);
    revalidatePath(`/landing-preview/${clinic.slug}`);
    revalidatePath(`/descubre/clinica/${clinic.slug}`);
  } catch (err) {
    console.error("[clinic-landing] revalidate falló:", err);
  }

  // Se devuelve la fila completa: se filtran las credenciales (Live Secret Key de
  // Facturapi, tokens de WhatsApp/Twilio/Google…) antes de llegar al navegador.
  return NextResponse.json(stripClinicSecrets(clinic));
}

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clinic = await prisma.clinic.findUnique({ where: { id: ctx.clinicId } });
  return NextResponse.json(stripClinicSecrets(clinic));
}
