import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { BARBER_DEFAULT_SERVICES, makeBarberSlug } from "@/lib/barber/types";
import { MX_PHONE_ERROR, mxTenDigits } from "@/lib/phone-mx";

// Alta pública de barbería (DaleControl Barber) — espejo de
// /api/laboratorios/auth/register. Crea el usuario en Supabase Auth y, en UNA
// transacción Prisma: Barbershop + BarberUser OWNER + siembra del catálogo
// BARBER_DEFAULT_SERVICES. NO inicia sesión (el cliente redirige a /login).
// Estado inicial de suscripción = igual al dental: sin trial →
// "pending_payment" (default del schema; se setea explícito por claridad).

// Admin client (mismo patrón que /api/laboratorios/auth/register — no hay
// helper compartido, se replica intencionalmente).
function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

// ── Rate-limit básico in-memory por IP. Ventana 60s, máx 5 intentos. ──────
// Se reinicia con cada cold start del runtime; suficiente como freno
// anti-abuso del endpoint público de registro (no es una garantía dura).
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

const TEAM_SIZES = new Set(["1", "2-3", "4-5", "6+"]);

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
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const shopName = typeof b.shopName === "string" ? b.shopName.trim() : "";
  const firstName = typeof b.firstName === "string" ? b.firstName.trim() : "";
  const lastName = typeof b.lastName === "string" ? b.lastName.trim() : "";
  const rawEmail = typeof b.email === "string" ? b.email.trim() : "";
  const password = typeof b.password === "string" ? b.password : "";
  const rawPhone = typeof b.phone === "string" ? b.phone : "";
  const city = typeof b.city === "string" ? b.city.trim() : "";
  const state = typeof b.state === "string" ? b.state.trim() : "";
  const teamSizeRaw = typeof b.teamSize === "string" ? b.teamSize : "";
  const teamSize = TEAM_SIZES.has(teamSizeRaw) ? teamSizeRaw : null;

  if (!shopName) {
    return NextResponse.json({ error: "El nombre de la barbería es requerido." }, { status: 400 });
  }
  if (!firstName) {
    return NextResponse.json({ error: "El nombre es requerido." }, { status: 400 });
  }
  if (!lastName) {
    return NextResponse.json({ error: "El apellido es requerido." }, { status: 400 });
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
  // WhatsApp de la barbería: OBLIGATORIO (mismo criterio que el registro
  // dental: es el canal de contacto si se registra y no paga).
  const phone = mxTenDigits(rawPhone);
  if (!phone) {
    return NextResponse.json({ error: MX_PHONE_ERROR }, { status: 400 });
  }

  const email = rawEmail.toLowerCase();

  // c) Crear el usuario en Supabase Auth.
  const { data: created, error: createError } = await getAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { firstName, lastName, barbershopName: shopName },
  });

  if (createError || !created?.user) {
    const msg = createError?.message ?? "";
    if (msg.includes("already been registered") || msg.includes("already exists")) {
      return NextResponse.json({ error: "Este email ya tiene una cuenta." }, { status: 400 });
    }
    return NextResponse.json({ error: msg || "No se pudo crear la cuenta." }, { status: 400 });
  }

  // d) Slug único (con retries; sufijo aleatorio si el nombre choca).
  let slug = makeBarberSlug(shopName);
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await prisma.barbershop.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) break;
    const suffix = Math.random().toString(36).slice(2, 6);
    slug = `${makeBarberSlug(shopName)}-${suffix}`;
  }

  // e) Barbershop + BarberUser OWNER + catálogo semilla, en UNA transacción.
  try {
    await prisma.$transaction(async (tx) => {
      const shop = await tx.barbershop.create({
        data: {
          name: shopName,
          slug,
          email,
          phone,
          city: city || null,
          state: state || null,
          teamSize,
          // plan usa el default BASICO del schema. Sin trial, igual que el
          // registro dental de hoy: la cuenta nace sin acceso hasta pagar.
          subscriptionStatus: "pending_payment",
        },
      });

      await tx.barberUser.create({
        data: {
          barbershopId: shop.id,
          supabaseId: created.user.id,
          email,
          firstName,
          lastName,
          isActive: true,
          // role usa el default OWNER del schema.
        },
      });

      await tx.barberService.createMany({
        data: BARBER_DEFAULT_SERVICES.map((s) => ({
          barbershopId: shop.id,
          name: s.name,
          durationMin: s.durationMin,
          price: s.price,
          category: s.category,
          sortOrder: s.sortOrder,
          isActive: true,
        })),
      });
    });
  } catch (err) {
    console.error("[barber-register] transacción falló", err);
    // f) Rollback del usuario de Supabase (best-effort) si Prisma falló.
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

  // g) Éxito. El cliente redirige a /login (login compartido).
  return NextResponse.json({ ok: true }, { status: 201 });
}
