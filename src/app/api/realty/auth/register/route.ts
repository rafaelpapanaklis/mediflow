import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { isRealtyMode, makeRealtySlug, type RealtyMode } from "@/lib/realty/types";
import { MX_PHONE_ERROR, mxTenDigits } from "@/lib/phone-mx";

// Alta pública de una cuenta de INMUEBLES — espejo de
// /api/barber/auth/register. Crea el usuario en Supabase Auth y, en UNA
// transacción Prisma: RealtyAccount + RealtyUser OWNER + la oficina matriz.
// NO inicia sesión (el cliente manda a /login).
//
// Estado inicial de suscripción = igual que barber y el dental: sin trial →
// "pending_payment" (default del schema; se setea explícito por claridad).
//
// 🔴 `mode` (AGENCY | AGENT | OWNER) se captura AQUÍ y no después: decide
// qué pantallas existen en el panel. Un alta sin modo dejaría cuentas que
// hay que clasificar a mano más tarde.

// Admin client (mismo patrón que barber — no hay helper compartido, se
// replica intencionalmente).
function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
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

const TEAM_SIZES = new Set(["1", "2-5", "6-15", "16+"]);

/** Nombre de la oficina matriz que nace con la cuenta, según el modo. */
function nombreOficinaMatriz(mode: RealtyMode): string {
  if (mode === "AGENCY") return "Oficina principal";
  if (mode === "AGENT") return "Mi oficina";
  return "Mis inmuebles";
}

export async function POST(req: Request) {
  // a) Rate-limit por IP.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Demasiados intentos. Espera un minuto e inténtalo de nuevo." },
      { status: 429 },
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

  const mode: RealtyMode = isRealtyMode(b.mode) ? b.mode : "AGENCY";
  const accountName = typeof b.accountName === "string" ? b.accountName.trim() : "";
  const firstName = typeof b.firstName === "string" ? b.firstName.trim() : "";
  const lastName = typeof b.lastName === "string" ? b.lastName.trim() : "";
  const rawEmail = typeof b.email === "string" ? b.email.trim() : "";
  const password = typeof b.password === "string" ? b.password : "";
  const rawPhone = typeof b.phone === "string" ? b.phone : "";
  const city = typeof b.city === "string" ? b.city.trim() : "";
  const state = typeof b.state === "string" ? b.state.trim() : "";
  const teamSizeRaw = typeof b.teamSize === "string" ? b.teamSize : "";
  const teamSize = TEAM_SIZES.has(teamSizeRaw) ? teamSizeRaw : null;

  if (!accountName) {
    return NextResponse.json({ error: "El nombre de la cuenta es obligatorio." }, { status: 400 });
  }
  if (!firstName) {
    return NextResponse.json({ error: "El nombre es obligatorio." }, { status: 400 });
  }
  if (!lastName) {
    return NextResponse.json({ error: "El apellido es obligatorio." }, { status: 400 });
  }
  if (!rawEmail) {
    return NextResponse.json({ error: "El correo electrónico es obligatorio." }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json(
      { error: "La contraseña debe tener al menos 8 caracteres." },
      { status: 400 },
    );
  }
  // WhatsApp: OBLIGATORIO (mismo criterio que barber y el dental — es el
  // canal de contacto si se registra y no paga).
  const phone = mxTenDigits(rawPhone);
  if (!phone) {
    return NextResponse.json({ error: MX_PHONE_ERROR }, { status: 400 });
  }

  const email = rawEmail.toLowerCase();

  // c) Crear el usuario en Supabase Auth (el login es COMPARTIDO). La
  //    contraseña la hashea GoTrue: aquí no se guarda ni se deriva nada.
  const { data: created, error: createError } = await getAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { firstName, lastName, realtyAccountName: accountName },
  });

  if (createError || !created?.user) {
    const msg = createError?.message ?? "";
    if (msg.includes("already been registered") || msg.includes("already exists")) {
      return NextResponse.json({ error: "Este correo ya tiene una cuenta." }, { status: 400 });
    }
    return NextResponse.json({ error: msg || "No se pudo crear la cuenta." }, { status: 400 });
  }

  // d) Slug único. El sufijo NO es aleatorio a la primera: se prueba el
  //    limpio, y solo si choca se le pega un sufijo. Si tras 5 intentos
  //    sigue chocando, el @unique de la BD lo atrapa y cae en el catch.
  let slug = makeRealtySlug(accountName);
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await prisma.realtyAccount.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!existing) break;
    const suffix = Math.random().toString(36).slice(2, 6);
    slug = `${makeRealtySlug(accountName)}-${suffix}`;
  }

  // e) Cuenta + usuario OWNER + oficina matriz, en UNA transacción.
  try {
    await prisma.$transaction(async (tx) => {
      const account = await tx.realtyAccount.create({
        data: {
          mode,
          name: accountName,
          slug,
          email,
          phone,
          city: city || null,
          state: state || null,
          teamSize,
          // plan usa el default PROPIETARIO del schema. Sin trial: la cuenta
          // nace sin acceso al panel hasta que pague.
          subscriptionStatus: "pending_payment",
        },
      });

      await tx.realtyUser.create({
        data: {
          accountId: account.id,
          supabaseId: created.user.id,
          email,
          firstName,
          lastName,
          active: true,
          // role usa el default OWNER del schema.
        },
      });

      // La oficina matriz nace con la cuenta: sin ella,
      // getAccessibleOfficeIds devuelve [] y cualquier consulta que filtre
      // por oficina se queda en blanco desde el primer minuto.
      await tx.realtyOffice.create({
        data: {
          accountId: account.id,
          name: nombreOficinaMatriz(mode),
          phone,
          isMain: true,
          isActive: true,
        },
      });
    });
  } catch (err) {
    console.error("[realty-register] transacción falló", err);
    // f) Rollback del usuario de Supabase (best-effort) si Prisma falló.
    try {
      await getAdminClient().auth.admin.deleteUser(created.user.id);
    } catch {
      /* ignore — el cleanup es best-effort */
    }
    return NextResponse.json(
      { error: "No se pudo completar el registro. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  // g) Éxito. El cliente manda a /login (login compartido).
  return NextResponse.json({ ok: true }, { status: 201 });
}
