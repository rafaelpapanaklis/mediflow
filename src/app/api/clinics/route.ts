import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { getPlanLimits } from "@/lib/plans";
import { writeActiveClinicCookie } from "@/lib/active-clinic";
import { getBranchQuota, countOwnedClinics, generateClinicSlug } from "@/lib/branches";
import { persistentRateLimit } from "@/lib/failban";
import { logMutation } from "@/lib/audit";
import { logError } from "@/lib/safe-log";
import { DIRECTORY_CATEGORIES } from "@/lib/directory/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/clinics — MULTI-CLÍNICA · FASE 1: crear una SUCURSAL ligada al
 * mismo dueño (mismo supabaseId) que la clínica activa.
 *
 * OJO, no confundir con /api/clinic (singular) = ajustes de la clínica activa.
 *
 * Reusa el runtime multi-clínica que YA existía: 1 supabaseId → N filas User
 * (una por clínica), cookie de clínica activa firmada y aislamiento por
 * clinicId. Aquí sólo se CREA la sede y se GATEA por plan; NO se toca el
 * aislamiento — Fase 1 no comparte pacientes ni ninguna otra entidad.
 *
 * Anti-IDOR: el dueño y el conteo salen SIEMPRE de la sesión del server
 * (getAuthContext → supabaseId), nunca de un id del body.
 */

/** Anti-flood del patrón auth (persistentRateLimit). Crear sedes es raro y el
 *  tope de plan corta a las pocas; 5/min por IP sobra y frena ráfagas. */
const BRANCH_CREATE_RATE_LIMIT = { limit: 5, windowSec: 60 };

/** Valores válidos del enum ClinicCategory (las 17 del directorio + OTHER). */
const CATEGORY_VALUES = new Set<string>([
  ...DIRECTORY_CATEGORIES.map((c) => c.category),
  "OTHER",
]);

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  category: z.string().refine((v) => CATEGORY_VALUES.has(v), "Categoría inválida"),
  city: z.string().trim().max(60).optional(),
  state: z.string().trim().max(60).optional(),
  phone: z.string().trim().max(30).optional(),
});

/** Mensaje al dueño según por qué NO puede crear la sede. */
const BLOCKED_COPY: Record<string, { status: number; error: string; code: string }> = {
  ROLE: {
    status: 403,
    code: "BRANCH_ROLE",
    error: "Solo el dueño de la cuenta puede crear sucursales.",
  },
  PLAN: {
    status: 403,
    code: "BRANCH_PLAN",
    error: "Tu plan no incluye sucursales. Cambia al plan Clínica para abrir más sedes.",
  },
  SUBSCRIPTION: {
    status: 403,
    code: "BRANCH_SUBSCRIPTION",
    error: "Activa tu suscripción para poder abrir sucursales.",
  },
};

export async function POST(req: NextRequest) {
  const rl = await persistentRateLimit(req, BRANCH_CREATE_RATE_LIMIT);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // GATE. Recuenta contra la BD con el supabaseId de la SESIÓN (el `used` que
  // pinta el sidebar es sólo espejo). El plan que manda es el de la clínica
  // ACTIVA: es la suscripción que paga la cobertura de las sedes incluidas.
  const supabaseId: string = ctx.user.supabaseId;
  const ownedCount = await countOwnedClinics(supabaseId);
  const quota = await getBranchQuota({
    clinic: ctx.clinic,
    isOwner: ctx.role === "SUPER_ADMIN",
    ownedCount,
  });

  if (!quota.canCreate) {
    if (quota.blockedReason === "LIMIT") {
      return NextResponse.json(
        {
          error: `Tu plan incluye ${quota.max} sucursal(es) y ya las usaste. Contrata una sucursal adicional para seguir creciendo.`,
          code: "PLAN_LIMIT_CLINICS",
          limit: quota.max,
          used: quota.used,
        },
        { status: 402 },
      );
    }
    const copy = BLOCKED_COPY[quota.blockedReason ?? "ROLE"];
    return NextResponse.json({ error: copy.error, code: copy.code }, { status: copy.status });
  }

  try {
    const slug = await generateClinicSlug(data.name);

    // La sucursal HEREDA el plan de la clínica madre (hoy siempre CLINIC: es el
    // único plan con maxClinics > 1). Heredar en vez de fijar "CLINIC" evita
    // que, si algún día se le habilitan sucursales a un plan menor desde
    // /admin, sus sedes nazcan con un plan superior gratis.
    const plan = ctx.clinic.plan;
    const planLimits = await getPlanLimits(plan);

    // COBERTURA DE BILLING: la sede va INCLUIDA en la suscripción de la madre
    // → nace con acceso completo y SIN suscripción Stripe propia
    // (subscriptionStatus "active" + monthlyPrice 0 + sin stripeSubscriptionId).
    // trialEndsAt es NOT NULL en el schema: se pone "ahora" (ya vencido) porque
    // la sede no tiene trial propio; quien la mantiene con acceso es el
    // subscriptionStatus "active". FOLLOW-UP conocido: si la suscripción madre
    // vence, estas sedes se quedan "active" — hay que sincronizarlas (ver
    // ORQUESTA.md, follow-up a).
    const clinic = await prisma.clinic.create({
      data: {
        name: data.name,
        slug,
        category: data.category as any,
        specialty: data.category.toLowerCase(),
        country: ctx.clinic.country ?? "MX",
        locale: ctx.clinic.locale ?? "es",
        state: data.state || null,
        city: data.city || null,
        phone: data.phone || null,
        email: ctx.user.email,
        plan: plan as any,
        trialEndsAt: new Date(),
        subscriptionStatus: "active",
        monthlyPrice: 0,
        aiTokensLimit: planLimits.aiTokensDefault,
        // Nested write = 1 sola transacción (Prisma envuelve el árbol):
        // Clinic + User dueño + horarios L-V, o nada.
        users: {
          create: {
            supabaseId,
            email: ctx.user.email,
            firstName: ctx.user.firstName,
            lastName: ctx.user.lastName,
            role: "SUPER_ADMIN",
            specialty: data.category.toLowerCase(),
          },
        },
        schedules: {
          createMany: {
            data: [0, 1, 2, 3, 4].map((day) => ({
              dayOfWeek: day,
              enabled: true,
              openTime: "09:00",
              closeTime: "18:00",
            })),
          },
        },
      },
      select: { id: true, name: true, slug: true, plan: true, category: true },
    });

    // Auditoría en la clínica DESDE la que se creó (ahí vive el actor).
    await logMutation({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "clinic",
      entityId: clinic.id,
      action: "create",
      after: { name: clinic.name, slug: clinic.slug, plan: clinic.plan, branchOf: ctx.clinicId },
    });

    // El dueño cae directo en la sede nueva.
    const response = NextResponse.json({
      clinicId: clinic.id,
      name: clinic.name,
      slug: clinic.slug,
      used: quota.used + 1,
      max: quota.max,
    });
    writeActiveClinicCookie(response, clinic.id);
    return response;
  } catch (err: any) {
    logError("[api/clinics POST]", err);
    return NextResponse.json({ error: "No se pudo crear la sucursal" }, { status: 500 });
  }
}
