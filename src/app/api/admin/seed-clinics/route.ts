import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/seed-clinics
 * Creates one clinic per category for the requesting user (for dev/testing).
 * Only works for the specified email. Safe to call multiple times — skips existing.
 */
export async function POST(req: NextRequest) {
  try {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ALLOWED_EMAIL = "rafaelpapanaklis@gmail.com";
  if (user.email !== ALLOWED_EMAIL) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const CATEGORIES = [
    { id: "MEDICINE",            name: "Clínica Medicina General Demo",  slug: "demo-medicina" },
    { id: "NUTRITION",           name: "Centro Nutrición Demo",          slug: "demo-nutricion" },
    { id: "PSYCHOLOGY",          name: "Consultorio Psicología Demo",    slug: "demo-psicologia" },
    { id: "DERMATOLOGY",         name: "Clínica Dermatología Demo",      slug: "demo-dermatologia" },
    { id: "AESTHETIC_MEDICINE",   name: "Centro Med. Estética Demo",     slug: "demo-estetica" },
    { id: "HAIR_RESTORATION",    name: "Clínica Capilar Demo",           slug: "demo-capilar" },
    { id: "BEAUTY_CENTER",       name: "Centro de Belleza Demo",         slug: "demo-belleza" },
    { id: "BROW_LASH",           name: "Studio Cejas y Pestañas Demo",   slug: "demo-cejas" },
    { id: "MASSAGE",             name: "Centro de Masajes Demo",         slug: "demo-masajes" },
    { id: "LASER_HAIR_REMOVAL",  name: "Clínica Láser Demo",             slug: "demo-laser" },
    { id: "HAIR_SALON",          name: "Peluquería Demo",                slug: "demo-peluqueria" },
    { id: "ALTERNATIVE_MEDICINE",name: "Centro Med. Alternativa Demo",   slug: "demo-alternativa" },
    { id: "NAIL_SALON",          name: "Salón de Uñas Demo",             slug: "demo-unas" },
    { id: "SPA",                 name: "Spa & Wellness Demo",            slug: "demo-spa" },
    { id: "PHYSIOTHERAPY",       name: "Clínica Fisioterapia Demo",      slug: "demo-fisioterapia" },
    { id: "PODIATRY",            name: "Centro Podología Demo",          slug: "demo-podologia" },
    { id: "OTHER",               name: "Clínica General Demo",           slug: "demo-otra" },
  ];

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 365); // 1 year trial for dev

  const created: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const cat of CATEGORIES) {
    try {
    // Check if clinic with this slug already exists
    const existing = await prisma.clinic.findUnique({ where: { slug: cat.slug } });
    if (existing) {
      // Check if user already has access
      const existingUser = await prisma.user.findFirst({
        where: { supabaseId: user.id, clinicId: existing.id },
      });
      if (!existingUser) {
        // Create user in existing clinic
        await prisma.user.create({
          data: {
            supabaseId: user.id,
            clinicId: existing.id,
            email: user.email!,
            firstName: "Rafael",
            lastName: "Papanaklis",
            role: "SUPER_ADMIN",
            specialty: cat.id,
          },
        });
        created.push(`${cat.id} (user added to existing clinic)`);
      } else {
        skipped.push(cat.id);
      }
      continue;
    }

    // Create new clinic + user
    await prisma.clinic.create({
      data: {
        name: cat.name,
        slug: cat.slug,
        specialty: cat.id.toLowerCase(),
        category: cat.id as any,
        country: "México",
        city: "Mérida",
        email: user.email,
        plan: "PRO",
        trialEndsAt,
        users: {
          create: {
            supabaseId: user.id,
            email: user.email!,
            firstName: "Rafael",
            lastName: "Papanaklis",
            role: "SUPER_ADMIN",
            specialty: cat.id,
          },
        },
        schedules: {
          createMany: {
            data: [0, 1, 2, 3, 4].map(day => ({
              dayOfWeek: day,
              enabled: true,
              openTime: "09:00",
              closeTime: "18:00",
            })),
          },
        },
      },
    });

    created.push(cat.id);
    } catch (err: any) {
      console.error(`Seed error for ${cat.id}:`, err);
      errors.push(`${cat.id}: ${err.message ?? "Unknown error"}`);
    }
  }

  return NextResponse.json({
    message: `Done. Created: ${created.length}, Skipped: ${skipped.length}, Errors: ${errors.length}`,
    created,
    skipped,
    errors,
  });
  } catch (err: any) {
    console.error("Seed clinics fatal error:", err);
    return NextResponse.json({ error: err.message ?? "Internal server error", stack: err.stack?.split("\n").slice(0, 5) }, { status: 500 });
  }
}
