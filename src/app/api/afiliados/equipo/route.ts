// "Mi equipo" del afiliado: lista de vendedores (GET) y alta de vendedor (POST).
// La identidad SIEMPRE sale de getAffiliateContext() (sesión Supabase), NUNCA
// del request body — un afiliado solo gestiona a SUS vendedores.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { currentParentLevelPct } from "@/lib/affiliates/team";
import { getSellerStatsForAffiliate, emptySellerStat } from "@/lib/affiliates/seller-stats";
import { createClient as createAdminClient } from "@supabase/supabase-js";

// Admin client de Supabase (mismo patrón que api/afiliados/auth/register —
// no hay helper compartido, se replica intencionalmente).
function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

// Tope de vendedores por afiliado (freno anti-abuso).
const MAX_SELLERS_PER_AFFILIATE = 50;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── GET: lista de vendedores + stats por vendedor + cap del nivel ─────────
export async function GET() {
  const ctx = await getAffiliateContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta aún no está aprobada." }, { status: 401 });
  }

  // cap = % del nivel vigente del padre (nunca lanza; cae a legacy).
  const cap = await currentParentLevelPct(ctx.affiliateId, ctx.affiliate.commissionPct);

  try {
    const [sellers, stats] = await Promise.all([
      prisma.affiliateSeller.findMany({
        where: { affiliateId: ctx.affiliateId },
        orderBy: { createdAt: "asc" },
      }),
      getSellerStatsForAffiliate(ctx.affiliateId),
    ]);

    return NextResponse.json({
      ready: true,
      levelPct: cap,
      sellers: sellers.map((s) => {
        const st = stats.get(s.id) ?? emptySellerStat(s.id);
        return {
          id: s.id,
          name: s.name,
          email: s.email,
          phone: s.phone,
          commissionPct: s.commissionPct,
          isActive: s.isActive,
          hasLogin: !!s.supabaseId,
          createdAt: s.createdAt.toISOString(),
          clicks: st.clicks,
          clinics: st.clinics,
          pendingMxn: st.pendingMxn,
          paidMxn: st.paidMxn,
        };
      }),
    });
  } catch (err: any) {
    // Tabla affiliate_sellers aún no existe en la BD (SQL sin correr) →
    // degrada sin romper; la UI muestra "pendiente de activar".
    if (err?.code === "P2021") {
      return NextResponse.json({ ready: false, levelPct: cap, sellers: [] });
    }
    throw err;
  }
}

// ── POST: alta de un vendedor (crea usuario Supabase + AffiliateSeller) ───
export async function POST(req: Request) {
  const ctx = await getAffiliateContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta aún no está aprobada." }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const rawEmail = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const commissionPct = typeof body?.commissionPct === "number" ? body.commissionPct : NaN;

  if (!name) {
    return NextResponse.json({ error: "El nombre del vendedor es requerido." }, { status: 400 });
  }
  if (!rawEmail || !EMAIL_RE.test(rawEmail)) {
    return NextResponse.json({ error: "Ingresa un correo electrónico válido." }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json(
      { error: "La contraseña debe tener al menos 8 caracteres." },
      { status: 400 }
    );
  }

  // cap = % del nivel vigente del padre. El % del vendedor va en [0, cap].
  const cap = await currentParentLevelPct(ctx.affiliateId, ctx.affiliate.commissionPct);
  if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > cap) {
    return NextResponse.json(
      { error: `El porcentaje debe estar entre 0 y ${cap}% (tu nivel vigente).` },
      { status: 400 }
    );
  }

  const email = rawEmail.toLowerCase();

  // Tope de vendedores + email duplicado dentro del mismo afiliado. Si la
  // tabla no existe aún, avisamos para que se corra el SQL.
  try {
    const count = await prisma.affiliateSeller.count({ where: { affiliateId: ctx.affiliateId } });
    if (count >= MAX_SELLERS_PER_AFFILIATE) {
      return NextResponse.json(
        { error: `Alcanzaste el máximo de ${MAX_SELLERS_PER_AFFILIATE} vendedores.` },
        { status: 400 }
      );
    }
    const existing = await prisma.affiliateSeller.findUnique({
      where: { affiliateId_email: { affiliateId: ctx.affiliateId, email } },
    });
    if (existing) {
      return NextResponse.json({ error: "Ya tienes un vendedor con ese correo." }, { status: 400 });
    }
  } catch (err: any) {
    if (err?.code === "P2021") {
      return NextResponse.json(
        { error: "El módulo de equipo aún no está activado. Intenta más tarde." },
        { status: 503 }
      );
    }
    throw err;
  }

  // Crear el usuario en Supabase Auth (login del vendedor).
  const { data: created, error: createError } = await getAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { sellerName: name, affiliateId: ctx.affiliateId },
  });

  if (createError || !created?.user) {
    const msg = createError?.message ?? "";
    if (msg.includes("already been registered") || msg.includes("already exists")) {
      return NextResponse.json({ error: "Este email ya tiene una cuenta." }, { status: 400 });
    }
    return NextResponse.json({ error: msg || "No se pudo crear la cuenta." }, { status: 400 });
  }

  // Crear el AffiliateSeller. Si Prisma falla, rollback best-effort del
  // usuario de Supabase para no dejar cuentas huérfanas.
  try {
    const seller = await prisma.affiliateSeller.create({
      data: {
        affiliateId: ctx.affiliateId,
        supabaseId: created.user.id,
        name,
        email,
        phone: phone || null,
        commissionPct,
        isActive: true,
      },
    });

    return NextResponse.json(
      {
        seller: {
          id: seller.id,
          name: seller.name,
          email: seller.email,
          phone: seller.phone,
          commissionPct: seller.commissionPct,
          isActive: seller.isActive,
          hasLogin: !!seller.supabaseId,
          createdAt: seller.createdAt.toISOString(),
          clicks: 0,
          clinics: 0,
          pendingMxn: 0,
          paidMxn: 0,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    try {
      await getAdminClient().auth.admin.deleteUser(created.user.id);
    } catch {
      /* ignore — cleanup best-effort */
    }
    return NextResponse.json(
      { error: "No se pudo crear el vendedor. Intenta de nuevo." },
      { status: 500 }
    );
  }
}
