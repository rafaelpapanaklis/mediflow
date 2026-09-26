import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/admin-auth";
import { logAdminClinicMutation } from "@/lib/admin-audit";
import { getResolvedPlan } from "@/lib/plans";
import {
  CLINIC_OVERRIDE_SELECT,
  activeOverrides,
  applyClinicOverrides,
  clearOverridesData,
  parseOverridesInput,
} from "@/lib/billing/plan-overrides";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PATCH /api/admin/clinics/[id]/plan-overrides
 *
 * Edita las CONDICIONES CONSERVADAS de UNA clínica (tope de usuarios, tope de
 * sedes, precio mensual y anual) que mandan sobre su plan. Mismo control de
 * acceso que el resto de /api/admin/clinics: sesión de admin viva
 * (getAdminSession) y bitácora admin de la mutación.
 *
 * Body (los cuatro campos son independientes; vacío/null = «sigue el plan»):
 *   { maxUsers, maxClinics: número ≥ 1 | "unlimited" | null,
 *     priceMxnMonthly, priceMxnAnnual: pesos enteros > 0 | null }
 * o `{ "clear": true }` para quitar todo (la clínica pasa a las condiciones
 * vigentes de su plan).
 *
 * Los overrides quedan atados al plan ACTUAL de la clínica (`planOverrideFor`):
 * si después cambia de plan, dejan de valer solos (ver @/lib/billing/plan-overrides).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // params.id viene de la ruta (admin); sin id Prisma descartaría el filtro.
  if (!params.id) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  const before = await prisma.clinic.findUnique({
    where: { id: params.id },
    select: CLINIC_OVERRIDE_SELECT,
  });
  if (!before) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  let data: Record<string, unknown>;
  if (body.clear === true) {
    data = clearOverridesData();
  } else {
    const parsed = parseOverridesInput(body);
    if (!parsed.ok || !parsed.data) {
      return NextResponse.json({ error: parsed.error ?? "Datos inválidos" }, { status: 400 });
    }
    const anyValue = Object.values(parsed.data).some((v) => v !== null);
    // Con algún valor, se atan al plan de HOY; sin ninguno, no queda nada conservado.
    data = { ...parsed.data, planOverrideFor: anyValue ? before.plan : null };
  }

  const saved = await prisma.clinic.update({
    where: { id: params.id },
    data,
    select: CLINIC_OVERRIDE_SELECT,
  });

  await logAdminClinicMutation({
    req, admin: admin.user, clinicId: params.id,
    entityType: "clinic", entityId: params.id, action: "update",
    before: { op: "plan-overrides", ...before },
    after: { op: "plan-overrides", ...saved },
  });

  // Lo que la clínica tiene AHORA (plan + sus condiciones), para que la pantalla
  // se repinte sin volver a cargar la ficha.
  const effective = applyClinicOverrides(await getResolvedPlan(saved.plan), saved);
  return NextResponse.json({
    overrides: saved,
    active: activeOverrides(saved) !== null,
    effective: {
      maxUsers: effective.maxUsers,
      maxClinics: effective.maxClinics,
      priceMxnMonthly: effective.priceMxnMonthly,
      priceMxnAnnual: effective.priceMxnAnnual,
    },
  });
}
