import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { stripClinicSecrets } from "@/lib/clinic-secrets";

const ALLOWED = [
  "landingActive","landingThemeColor","landingCoverUrl","landingGallery",
  "landingTestimonials","landingFaqs","landingServices","landingHours",
  "landingWhatsapp","landingInstagram","landingFacebook","landingTiktok",
  "landingMapEmbed","landingTagline",
  "description","landingTemplate","landingYearsExperience","landingPatients",
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
