import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { failbanGuard, persistentRateLimit, recordAuthFailure } from "@/lib/failban";
import { esCorreoYaRegistrado, traducirErrorDeAuth } from "@/lib/auth/errores-contrasena";
import { BARBER_DEFAULT_SERVICES, makeBarberSlug } from "@/lib/barber/types";
import { normalizeBarberPhone } from "@/lib/barber/phone-countries";
import { checkBarberCaptcha } from "@/lib/barber/captcha";
import { BARBER_CAPTCHA_ACTIONS } from "@/lib/barber/captcha-core";

// Alta pública de barbería (DaleControl Barber) — espejo de
// /api/laboratorios/auth/register. Crea el usuario en Supabase Auth y, en UNA
// transacción Prisma: Barbershop + BarberUser OWNER + siembra del catálogo
// BARBER_DEFAULT_SERVICES. NO inicia sesión (el cliente manda a /barber/entrar).
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

// ── Freno del alta: el PERSISTENTE del dental (src/lib/failban.ts) ────────
// Antes era un Map en memoria: en Vercel cada instancia tiene el suyo y se
// vacía en cada arranque en frío, así que no frenaba nada (auditoría de
// seguridad 14-nov, G3 y M5). Ahora son las mismas dos piezas que usa
// /api/auth/register, reutilizadas por import:
//   · persistentRateLimit — ventana deslizante por IP (Upstash si está
//     configurado; si no, memoria, igual que en el dental).
//   · failbanGuard + recordAuthFailure — bloqueo con espera creciente tras
//     varios fallos seguidos. «Ese correo ya tiene cuenta» cuenta como fallo:
//     es lo que frena usar el alta para averiguar qué correos existen.
//
// 5 por minuto por IP es el MISMO número que tenía el freno anterior; lo que
// cambia es que ahora se cumple. (El dental usa 15: AUTH_FLOOD_RATE_LIMIT.)
const BARBER_REGISTER_RATE_LIMIT = { limit: 5, windowSec: 60 } as const;
const LOCKOUT_SCOPE = "barber-register";

const TEAM_SIZES = new Set(["1", "2-3", "4-5", "6+"]);

export async function POST(req: NextRequest) {
  // a) Freno por IP y bloqueo por fallos (el correo aún no se ha leído).
  const flood = await persistentRateLimit(req, BARBER_REGISTER_RATE_LIMIT);
  if (flood) return flood;
  const locked = await failbanGuard(req, { scope: LOCKOUT_SCOPE });
  if (locked) return locked;

  // b) Parseo + validación.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  // Captcha (Cloudflare Turnstile) antes de validar o crear nada: es lo que
  // frena a un bot que da de alta miles de barberías en segundos. Sin sus
  // dos variables el alta sigue como antes y queda en el log.
  const captcha = await checkBarberCaptcha(req, b.captchaToken, BARBER_CAPTCHA_ACTIONS.register);
  if (captcha.response) return captcha.response;

  const shopName = typeof b.shopName === "string" ? b.shopName.trim() : "";
  const firstName = typeof b.firstName === "string" ? b.firstName.trim() : "";
  const lastName = typeof b.lastName === "string" ? b.lastName.trim() : "";
  const rawEmail = typeof b.email === "string" ? b.email.trim() : "";
  const password = typeof b.password === "string" ? b.password : "";
  const rawPhone = typeof b.phone === "string" ? b.phone : "";
  // País del teléfono (ISO-2). No se guarda en ninguna columna — barber_shops
  // no la tiene y esta ola no lleva SQL: solo decide CÓMO se valida y se
  // normaliza el número. Si no llega, México (barberPhoneCountry lo resuelve).
  const rawCountry = typeof b.country === "string" ? b.country : "";
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
  //
  // El servidor NO confía en lo que armó el navegador: vuelve a normalizar
  // con la MISMA función del formulario (normalizeBarberPhone). México sale
  // en 10 dígitos limpios, exactamente como antes de que hubiera países; el
  // resto en E.164 ("+" + lada + número), sin espacios ni guiones.
  const tel = normalizeBarberPhone(rawCountry, rawPhone);
  if (!tel.ok) {
    return NextResponse.json({ error: tel.error }, { status: 400 });
  }
  const phone = tel.stored;

  const email = rawEmail.toLowerCase();

  // c) Crear el usuario en Supabase Auth.
  const { data: created, error: createError } = await getAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { firstName, lastName, barbershopName: shopName },
  });

  if (createError || !created?.user) {
    // Todo fallo al crear la cuenta cuenta para el bloqueo (IP y correo).
    await recordAuthFailure(req, { scope: LOCKOUT_SCOPE, account: email });
    if (esCorreoYaRegistrado(createError)) {
      // `code` es para el formulario: con él pinta «Iniciar sesión» y
      // «Recuperar contraseña» junto al error (G5: sin esas salidas lo
      // natural era registrarse otra vez con otro correo).
      return NextResponse.json(
        {
          error: "Este correo ya tiene una cuenta. Inicia sesión o recupera tu contraseña.",
          code: "EMAIL_TAKEN",
        },
        { status: 400 },
      );
    }
    // Supabase contesta en inglés y con detalle interno: su mensaje se queda
    // en el log y al navegador solo sale un texto nuestro, en español
    // (contraseña filtrada o débil, correo inválido… o el de respaldo).
    console.error("[barber-register] createUser falló:", createError?.message ?? "sin usuario");
    return NextResponse.json(
      { error: traducirErrorDeAuth(createError, "No se pudo crear la cuenta. Intenta de nuevo.") },
      { status: 400 },
    );
  }

  // d) + e) Slug único y alta, DENTRO del mismo try: si la base falla al
  // buscar el slug, el usuario de Supabase recién creado también se deshace
  // (antes quedaba huérfano y esa persona ya no podía registrarse).
  let shopId: string;
  try {
    // Slug único (con retries; sufijo aleatorio si el nombre choca).
    let slug = makeBarberSlug(shopName);
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await prisma.barbershop.findUnique({ where: { slug }, select: { id: true } });
      if (!existing) break;
      const suffix = Math.random().toString(36).slice(2, 6);
      slug = `${makeBarberSlug(shopName)}-${suffix}`;
    }

    // Barbershop + BarberUser OWNER + catálogo semilla, en UNA transacción.
    shopId = await prisma.$transaction(async (tx) => {
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

      return shop.id;
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

  // g) PROGRAMA DE SOCIOS. Si el visitante llegó por la liga de otra
  // barbería, la cookie dcb_aff sigue en su navegador y aquí se sella la
  // atribución (los candados de auto-referido viven en el módulo, no aquí).
  //
  // Aislamiento a propósito: import DINÁMICO + try/catch. Si el módulo de
  // afiliados truena, o sus tablas todavía no existen, el alta de la
  // barbería sigue exactamente igual que antes de que esto existiera.
  try {
    const { claimBarberReferral } = await import("@/lib/barber/affiliates");
    await claimBarberReferral(shopId, req.headers.get("cookie"));
  } catch (err) {
    console.error("[barber-register] atribución de socio (ignorada)", err);
  }

  // h) Éxito. El cliente manda a /barber/entrar (la entrada del vertical).
  return NextResponse.json({ ok: true }, { status: 201 });
}
