import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validations";
import { z } from "zod";

const extendedSchema = registerSchema.extend({
  slug:          z.string().min(3).max(40).regex(/^[a-z0-9-]+$/).optional(),
  paymentMethod: z.enum(["stripe","transfer"]).default("transfer"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = extendedSchema.parse(body);
    const supabase = createClient();

    // Check slug availability
    if (data.slug) {
      const existing = await prisma.clinic.findUnique({ where: { slug: data.slug } });
      if (existing) {
        return NextResponse.json({ error: "Ese subdominio ya está en uso. Elige otro." }, { status: 400 });
      }
    }

    // 1. Create Supabase auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email:    data.email,
      password: data.password,
      options:  { data: { first_name: data.firstName, last_name: data.lastName } },
    });

    if (authError || !authData.user) {
      return NextResponse.json({ error: authError?.message ?? "Error al crear cuenta" }, { status: 400 });
    }

    // Generate slug if not provided
    const slug = data.slug ?? await generateSlug(data.clinicName);

    // 2. Create clinic + user in DB
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    await prisma.clinic.create({
      data: {
        name:        data.clinicName,
        slug,
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
            data: [0,1,2,3,4].map(day => ({ dayOfWeek: day, enabled: true, openTime: "09:00", closeTime: "18:00" })),
          },
        },
      },
    });

    // 3. If Stripe, create checkout session (placeholder until Stripe key is added)
    if (data.paymentMethod === "stripe") {
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      if (stripeKey) {
        // TODO: Create Stripe checkout session
        // For now return success and redirect to dashboard
        return NextResponse.json({ success: true, checkoutUrl: null });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Register error:", err);
    return NextResponse.json({ error: err.message ?? "Error interno" }, { status: 500 });
  }
}

async function generateSlug(name: string) {
  let base = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 30);
  let slug = base;
  let i = 1;
  while (await prisma.clinic.findUnique({ where: { slug } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}
