import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { slugifyDentalLab, DENTAL_LAB_SERVICES } from "@/lib/laboratorios/types";
import { createClient as createAdminClient } from "@supabase/supabase-js";

// Admin client (mismo patrón que src/app/api/team/route.ts — no hay helper
// compartido, se replica intencionalmente).
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

const VALID_SERVICE_KEYS = new Set(DENTAL_LAB_SERVICES.map(s => s.key as string));

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
  const firstName = typeof body?.firstName === "string" ? body.firstName.trim() : "";
  const lastName = typeof body?.lastName === "string" ? body.lastName.trim() : "";
  const rawEmail = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const city = typeof body?.city === "string" ? body.city.trim() : "";
  const state = typeof body?.state === "string" ? body.state.trim() : "";
  const rfcRaw = typeof body?.rfc === "string" ? body.rfc.trim() : "";
  const rfc = rfcRaw ? rfcRaw.slice(0, 13) : "";
  const servicesRaw = Array.isArray(body?.services)
    ? body.services.filter((s: unknown): s is string => typeof s === "string")
    : [];
  // Aceptamos solo keys válidas del catálogo fijo (s1..s9).
  const services = servicesRaw.filter((s: string) => VALID_SERVICE_KEYS.has(s));

  if (!name) {
    return NextResponse.json({ error: "El nombre del laboratorio es requerido." }, { status: 400 });
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

  const email = rawEmail.toLowerCase();

  // c) Crear el usuario en Supabase Auth.
  const { data: created, error: createError } = await getAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { firstName, lastName, labName: name },
  });

  if (createError || !created?.user) {
    const msg = createError?.message ?? "";
    if (msg.includes("already been registered") || msg.includes("already exists")) {
      return NextResponse.json({ error: "Este email ya tiene una cuenta." }, { status: 400 });
    }
    return NextResponse.json({ error: msg || "No se pudo crear la cuenta." }, { status: 400 });
  }

  // d) Slug único.
  let slug = slugifyDentalLab(name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await prisma.dentalLab.findUnique({ where: { slug } });
    if (!existing) break;
    const suffix = Math.random().toString(36).slice(2, 6);
    slug = `${slugifyDentalLab(name)}-${suffix}`;
  }

  // e) Crear DentalLab + DentalLabUser en una transacción.
  try {
    await prisma.$transaction(async (tx) => {
      const lab = await tx.dentalLab.create({
        data: {
          name,
          slug,
          rfc: rfc || null,
          email,
          phone: phone || null,
          city: city || null,
          state: state || null,
          services,
          // status usa el default PENDING del schema.
        },
      });

      await tx.dentalLabUser.create({
        data: {
          labId: lab.id,
          supabaseId: created.user.id,
          email,
          firstName,
          lastName,
          isActive: true,
          // role usa el default OWNER del schema.
        },
      });
    });
  } catch (err) {
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

  // g) Éxito.
  return NextResponse.json({ ok: true }, { status: 201 });
}
