import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createAffiliateAccount,
  normalizePayoutMethod,
  sendAffiliateSignupEmails,
} from "@/lib/affiliates/signup";
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

/**
 * ¿El error de `createUser` significa "ese correo ya existe en Supabase Auth"?
 *
 * Afiliados y usuarios de clínica comparten el MISMO proyecto de Supabase Auth,
 * así que el correo de un dueño de clínica ya existe cuando intenta registrarse
 * como afiliado. Detectarlo por el error es intencional: el SDK instalado
 * (@supabase/supabase-js ^2.45) expone `admin.listUsers({ page, perPage })` SIN
 * filtro por correo, así que no hay búsqueda directa; recorrer todas las páginas
 * de usuarios en cada registro no es viable.
 *
 * `admin.createUser` es un INSERT puro: cuando el correo ya existe devuelve
 * 422 email_exists y NO modifica al usuario existente (no cambia su contraseña
 * ni sus metadatos). Por eso usarlo como sonda es seguro.
 */
function isEmailTakenError(err: { message?: string; code?: string; status?: number } | null): boolean {
  if (!err) return false;
  const code = (err as any).code ?? "";
  if (code === "email_exists" || code === "user_already_exists") return true;
  const msg = err.message ?? "";
  return /already\s+(been\s+)?registered|already\s+exists|email\s+address\s+is\s+already/i.test(msg);
}

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
  const payoutMethod = normalizePayoutMethod(body?.payoutMethod);
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
  //    `Affiliate.email` es @unique y TODO Affiliate nace junto a su
  //    AffiliateUser en la misma transacción (createAffiliateAccount), así que
  //    este check cubre el caso "ya tiene cuenta de afiliado".
  const existingAffiliate = await prisma.affiliate.findUnique({ where: { email } });
  if (existingAffiliate) {
    return NextResponse.json(
      {
        error: "Este correo ya tiene una cuenta de afiliado.",
        loginUrl: "/afiliados/login",
      },
      { status: 400 }
    );
  }

  // d) Crear el usuario en Supabase Auth.
  const { data: created, error: createError } = await getAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { affiliateName: name },
  });

  if (createError || !created?.user) {
    // d.1) El correo YA existe en Supabase Auth pero NO es de un afiliado (c ya
    //      descartó eso): es un dueño/staff de clínica, o un vendedor de equipo.
    //      Ser cliente y ser afiliado son roles independientes, así que esto no
    //      es un error: es el camino de VINCULACIÓN.
    //
    //      SEGURIDAD — regla innegociable: aquí NO se crea usuario, NO se cambia
    //      la contraseña y NO se toca esa cuenta de ninguna forma. Si lo
    //      hiciéramos, cualquiera que conozca el correo de un dentista podría
    //      secuestrar su cuenta mandando este formulario con una contraseña
    //      nueva. La única vía es que la persona demuestre que es dueña del
    //      correo iniciando sesión: /afiliados/vincular →
    //      POST /api/afiliados/auth/link, que saca el supabaseId de una sesión
    //      verificada en el servidor.
    //
    //      409 + `needsLogin` para que el formulario lo distinga de un error
    //      muerto y ofrezca el siguiente paso.
    if (isEmailTakenError(createError)) {
      return NextResponse.json(
        {
          needsLogin: true,
          error: "Ya tienes una cuenta en DaleControl con este correo.",
          linkUrl: "/afiliados/vincular",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: createError?.message || "No se pudo crear la cuenta." },
      { status: 400 }
    );
  }

  // e) Affiliate + AffiliateUser (slug, referralCode y status PENDING salen del
  //    helper compartido con la vinculación).
  let newAffiliateId = "";
  try {
    newAffiliateId = await createAffiliateAccount({
      name,
      email,
      supabaseId: created.user.id,
      payoutMethod,
      payoutDetails,
    });
  } catch (err) {
    // f) Rollback del usuario de Supabase (best-effort) si Prisma falló. Sólo
    //    aplica a `created.user`, el usuario que ESTE request acaba de crear —
    //    jamás se borra un usuario preexistente (esa rama sale en d.1 sin llegar
    //    aquí).
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

  // g) Avisos por correo (fire-and-forget, ver helper).
  sendAffiliateSignupEmails({ affiliateId: newAffiliateId, name, email, payoutMethod });

  // h) Éxito.
  return NextResponse.json({ ok: true }, { status: 201 });
}
