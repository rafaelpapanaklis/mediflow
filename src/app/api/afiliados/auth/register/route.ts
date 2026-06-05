import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateReferralCode } from "@/lib/affiliates";
import { createClient as createAdminClient } from "@supabase/supabase-js";

// Admin client (mismo patrón que src/app/api/laboratorios/auth/register/route.ts
// — no hay helper compartido, se replica intencionalmente).
function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

// ── Rate-limit básico in-memory por IP. Ventana 60s, máx 5 intentos. ──────
// Se reinicia con cada cold start del runtime; suficiente como freno anti-abuso
// del endpoint público de registro (no es una garantía dura).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

// Slug legible derivado del nombre del afiliado.
function slugifyAffiliate(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "afiliado"
  );
}

// Métodos de pago aceptados (free-form pero validado contra catálogo fijo).
const VALID_PAYOUT_METHODS = new Set(["SPEI", "PAYPAL", "OTHER"]);

export async function POST(req: Request) {
  // a) Rate-limit por IP.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Demasiados intentos. Espera un minuto e intenta de nuevo." },
      { status: 429 }
    );
  }

  // b) Parseo + validación.
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400 });
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const rawEmail = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const payoutMethodRaw = typeof body?.payoutMethod === "string" ? body.payoutMethod.trim().toUpperCase() : "";
  const payoutMethod = VALID_PAYOUT_METHODS.has(payoutMethodRaw) ? payoutMethodRaw : "";
  const payoutDetails = typeof body?.payoutDetails === "string" ? body.payoutDetails.trim().slice(0, 300) : "";

  if (!name) {
    return NextResponse.json({ error: "Tu nombre o el de tu empresa es requerido." }, { status: 400 });
  }
  if (!rawEmail) {
    return NextResponse.json({ error: "El correo electrónico es requerido." }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json(
      { error: "La contraseña debe tener al menos 8 caracteres." },
      { status: 400 }
    );
  }

  const email = rawEmail.toLowerCase();

  // c) Email ya registrado como afiliado → cortar temprano con mensaje claro.
  const existingAffiliate = await prisma.affiliate.findUnique({ where: { email } });
  if (existingAffiliate) {
    return NextResponse.json({ error: "Este email ya tiene una cuenta de afiliado." }, { status: 400 });
  }

  // d) Crear el usuario en Supabase Auth.
  const { data: created, error: createError } = await getAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { affiliateName: name },
  });

  if (createError || !created?.user) {
    const msg = createError?.message ?? "";
    if (msg.includes("already been registered") || msg.includes("already exists")) {
      return NextResponse.json({ error: "Este email ya tiene una cuenta." }, { status: 400 });
    }
    return NextResponse.json({ error: msg || "No se pudo crear la cuenta." }, { status: 400 });
  }

  // e) Slug único.
  let slug = slugifyAffiliate(name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await prisma.affiliate.findUnique({ where: { slug } });
    if (!existing) break;
    const suffix = Math.random().toString(36).slice(2, 6);
    slug = `${slugifyAffiliate(name)}-${suffix}`;
  }

  // f) referralCode único (helper de la fundación).
  const referralCode = await generateReferralCode();

  // g) Crear Affiliate + AffiliateUser en una transacción.
  try {
    await prisma.$transaction(async (tx) => {
      const affiliate = await tx.affiliate.create({
        data: {
          name,
          slug,
          email,
          referralCode,
          payoutMethod: payoutMethod || null,
          payoutDetails: payoutDetails || null,
          // status usa el default PENDING; commissionPct usa el default (20).
        },
      });

      await tx.affiliateUser.create({
        data: {
          affiliateId: affiliate.id,
          supabaseId: created.user.id,
          isActive: true,
        },
      });
    });
  } catch (err) {
    // h) Rollback del usuario de Supabase (best-effort) si Prisma falló.
    try {
      await getAdminClient().auth.admin.deleteUser(created.user.id);
    } catch {
      /* ignore — el cleanup es best-effort */
    }
    return NextResponse.json(
      { error: "No se pudo completar el registro. Intenta de nuevo." },
      { status: 500 }
    );
  }

  // i) Éxito.
  return NextResponse.json({ ok: true }, { status: 201 });
}
