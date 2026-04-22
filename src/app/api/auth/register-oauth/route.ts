import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { sendWelcomeEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/seo";

/**
 * Completar registro para usuarios que entraron via OAuth (Google/Microsoft).
 * NO crea un nuevo usuario en Supabase — usa la sesión actual.
 * Solo crea Clinic + User en Prisma.
 */
const schema = z.object({
  clinicName: z.string().min(2),
  specialty: z.string().optional(),
  category: z.string().optional(),
  country: z.string().default("México"),
  state: z.string().optional(),
  city: z.string().optional(),
  clinicSize: z.string().optional(),
  phone: z.string().optional(),
  plan: z.enum(["BASIC", "PRO", "CLINIC"]).default("PRO"),
  slug: z.string().optional(),
  paymentMethod: z.enum(["stripe", "transfer", "card", "paypal"]).default("transfer"),
  paymentMethodLast4: z.string().regex(/^\d{4}$/).optional(),
  billing: z.enum(["monthly", "annual"]).default("monthly"),
});

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

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 5);
  if (rl) return rl;

  try {
    const body = await req.json();
    const data = schema.parse(body);

    const supabase = createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json(
        { error: "No hay sesión activa — inicia sesión con OAuth primero" },
        { status: 401 },
      );
    }
    const supabaseUser = userData.user;
    const email = supabaseUser.email ?? "";
    if (!email) {
      return NextResponse.json(
        { error: "Tu cuenta OAuth no tiene email público. Usa el registro con correo." },
        { status: 400 },
      );
    }

    // Si el user ya tiene una Clinic vinculada, rechazar (ya pasó por aquí)
    const existing = await prisma.user.findFirst({
      where: { supabaseId: supabaseUser.id, isActive: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Ya existe una clínica registrada con esta cuenta. Inicia sesión." },
        { status: 409 },
      );
    }

    // También bloquear si el email ya existe bajo otro supabaseId
    // (caso: usuario se registró con email+password y ahora intenta OAuth con el mismo correo).
    // User.email no es @unique en el schema, por eso lo validamos aquí.
    const existingByEmail = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, isActive: true },
    });
    if (existingByEmail) {
      return NextResponse.json(
        { error: "Ya existe una clínica registrada con esta cuenta. Inicia sesión." },
        { status: 409 },
      );
    }

    if (data.slug) {
      const clash = await prisma.clinic.findUnique({ where: { slug: data.slug } });
      if (clash) return NextResponse.json({ error: "Ese subdominio ya está en uso" }, { status: 400 });
    }

    // Extraer first/last name del user metadata de supabase o fallback al email
    const meta = (supabaseUser.user_metadata ?? {}) as Record<string, unknown>;
    const fullName = String(meta.full_name ?? meta.name ?? "").trim();
    const [metaFirst, ...metaRest] = fullName.split(/\s+/);
    const firstName = String(meta.first_name ?? metaFirst ?? email.split("@")[0] ?? "");
    const lastName = String(meta.last_name ?? metaRest.join(" ") ?? firstName);

    const slug = data.slug ?? (await generateSlug(data.clinicName));
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    const resolvedCategory = data.category ?? "OTHER";
    const specialtyLabel = data.specialty ?? data.category ?? "other";

    const paymentMethodType =
      data.paymentMethod === "card" || data.paymentMethod === "stripe"
        ? "card"
        : data.paymentMethod;
    const paymentMethodCollected =
      paymentMethodType === "card"
        ? !!data.paymentMethodLast4
        : paymentMethodType === "paypal" || paymentMethodType === "transfer";

    await prisma.clinic.create({
      data: {
        name: data.clinicName,
        slug,
        specialty: specialtyLabel,
        category: resolvedCategory as any,
        country: data.country,
        state: data.state,
        city: data.city,
        clinicSize: data.clinicSize,
        phone: data.phone,
        email,
        plan: data.plan as any,
        trialEndsAt,
        subscriptionStatus: "trialing",
        preferredPaymentMethod: paymentMethodType,
        paymentMethodCollected,
        paymentMethodType,
        paymentMethodLast4: paymentMethodType === "card" ? data.paymentMethodLast4 : undefined,
        users: {
          create: {
            supabaseId: supabaseUser.id,
            email,
            firstName,
            lastName,
            role: "SUPER_ADMIN",
            specialty: specialtyLabel,
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

    sendWelcomeEmail({
      email,
      firstName,
      clinicName: data.clinicName,
      trialEndsAt,
      dashboardUrl: `${SITE_URL}/dashboard`,
    }).catch(err => console.error("[register-oauth] welcome email failed:", err));

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("register-oauth error:", err);
    return NextResponse.json({ error: err.message ?? "Error interno" }, { status: 500 });
  }
}
