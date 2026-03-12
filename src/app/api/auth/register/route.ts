import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validations";

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 50);
}

async function uniqueSlug(base: string) {
  let slug = slugify(base);
  let exists = await prisma.clinic.findUnique({ where: { slug } });
  let i = 1;
  while (exists) { slug = `${slugify(base)}-${i++}`; exists = await prisma.clinic.findUnique({ where: { slug } }); }
  return slug;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = registerSchema.parse(body);
    const supabase = createClient();

    // 1. Create Supabase auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: { data: { first_name: data.firstName, last_name: data.lastName } },
    });

    if (authError || !authData.user) {
      return NextResponse.json({ error: authError?.message ?? "Error al crear cuenta" }, { status: 400 });
    }

    // 2. Create clinic + user + schedules in one transaction
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    await prisma.clinic.create({
      data: {
        name:        data.clinicName,
        slug:        await uniqueSlug(data.clinicName),
        specialty:   data.specialty,
        country:     data.country,
        city:        data.city,
        phone:       data.phone,
        email:       data.email,
        plan:        data.plan as any,
        trialEndsAt,
        users: {
          create: {
            supabaseId: authData.user.id,
            email:      data.email,
            firstName:  data.firstName,
            lastName:   data.lastName,
            role:       "SUPER_ADMIN",
            specialty:  data.specialty,
          },
        },
        schedules: {
          createMany: {
            data: [0,1,2,3,4].map((day) => ({ dayOfWeek: day, enabled: true, openTime: "09:00", closeTime: "18:00" })),
          },
        },
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Register error:", err);
    return NextResponse.json({ error: err.message ?? "Error interno" }, { status: 500 });
  }
}
