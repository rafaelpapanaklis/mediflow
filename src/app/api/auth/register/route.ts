import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";

const CATEGORY_MAP: Record<string, string> = {
  dental: "DENTAL", odontologia: "DENTAL",
  medicine: "MEDICINE", medicina: "MEDICINE",
  nutrition: "NUTRITION", nutricion: "NUTRITION",
  psychology: "PSYCHOLOGY", psicologia: "PSYCHOLOGY",
  dermatology: "DERMATOLOGY", dermatologia: "DERMATOLOGY",
};

const schema = z.object({
  firstName: z.string().min(2), lastName: z.string().min(2),
  email: z.string().email(), password: z.string().min(8),
  clinicName: z.string().min(2),
  specialty: z.string().optional(), // @deprecated — backwards compat
  category: z.string().optional(),  // new: ClinicCategory enum value
  country: z.string().min(1), city: z.string().optional(),
  state: z.string().optional(),           // MX state (signup step 2)
  clinicSize: z.string().optional(),      // 1 | 2-5 | 6-15 | 16+
  phone: z.string().optional(), plan: z.enum(["BASIC","PRO","CLINIC"]).default("PRO"),
  slug: z.string().optional(),
  // Accept both legacy (stripe/transfer) and new signup wire-values (card/paypal).
  // card → stripe, paypal → paypal, others pass through.
  paymentMethod: z
    .enum(["stripe", "transfer", "card", "paypal"])
    .default("transfer")
    .transform(v => (v === "card" ? "stripe" : v)),
  billing: z.enum(["monthly", "annual"]).default("monthly"),
});

async function generateSlug(name: string) {
  let base = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 30);
  let slug = base; let i = 1;
  while (await prisma.clinic.findUnique({ where: { slug } })) { slug = `${base}-${i++}`; }
  return slug;
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 5); // 5 requests per minute per IP
  if (rl) return rl;

  try {
    const body = await req.json();
    const data = schema.parse(body);
    const supabase = createClient();

    if (data.slug) {
      const existing = await prisma.clinic.findUnique({ where: { slug: data.slug } });
      if (existing) return NextResponse.json({ error: "Ese subdominio ya está en uso" }, { status: 400 });
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: data.email, password: data.password,
      options: { data: { first_name: data.firstName, last_name: data.lastName } },
    });
    if (authError || !authData.user) {
      return NextResponse.json({ error: authError?.message ?? "Error al crear cuenta" }, { status: 400 });
    }

    const slug = data.slug ?? await generateSlug(data.clinicName);
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    // Resolve category from new field or legacy specialty
    const resolvedCategory = data.category
      ? data.category
      : data.specialty
        ? (CATEGORY_MAP[data.specialty.toLowerCase()] ?? "OTHER")
        : "OTHER";
    const specialtyLabel = data.specialty ?? data.category ?? "other";

    // Embed state in address if provided (no dedicated state column in Clinic).
    const addressFromState = data.state
      ? [data.city, data.state].filter(Boolean).join(", ")
      : undefined;

    // Derive subscription status: if user picked card but Stripe is not wired,
    // we still create the clinic but flag it so billing can finish later.
    const hasStripe = !!process.env.STRIPE_SECRET_KEY;
    const subscriptionStatus =
      data.paymentMethod === "stripe" && !hasStripe
        ? "pending_payment_setup"
        : "trialing";

    if (data.paymentMethod === "stripe" && !hasStripe) {
      // eslint-disable-next-line no-console
      console.warn(
        `[signup] STRIPE_SECRET_KEY missing — clinic "${slug}" created with status "pending_payment_setup".`,
      );
    }

    await prisma.clinic.create({
      data: {
        name: data.clinicName, slug, specialty: specialtyLabel,
        category: resolvedCategory as any,
        country: data.country, city: data.city,
        address: addressFromState,
        phone: data.phone,
        email: data.email, plan: data.plan as any, trialEndsAt,
        preferredPaymentMethod: data.paymentMethod,
        subscriptionStatus,
        users: { create: { supabaseId: authData.user.id, email: data.email, firstName: data.firstName, lastName: data.lastName, role: "SUPER_ADMIN", specialty: specialtyLabel } },
        schedules: { createMany: { data: [0,1,2,3,4].map(day => ({ dayOfWeek: day, enabled: true, openTime: "09:00", closeTime: "18:00" })) } },
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Register error:", err);
    return NextResponse.json({ error: err.message ?? "Error interno" }, { status: 500 });
  }
}
