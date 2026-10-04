// GET /api/caja/para-cobrar — lo MÍNIMO de la caja que necesita quien cobra:
// si hay una abierta y quién la abrió. Nada de cifras ni de la lista del turno.
//
// Decisión 16 de la auditoría de uso (4-oct-2026, valor por defecto de Rafael:
// AVISAR, no bloquear): si recepción cobra en efectivo en una caja que abrió
// otra persona, se le dice («entra a la caja que abrió …»). Y como recepción no
// tiene acceso a Caja (/api/caja/current le da 403), tampoco se enteraba de que
// la caja estaba CERRADA: el aviso de «caja cerrada» lee de aquí.
//
// Permiso: el de cobrar (billing.charge). `clinicId` de la sesión.

import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.charge");
  if (denied) return denied;
  const reg = await prisma.cashRegister.findFirst({
    where: { clinicId: ctx.clinicId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    select: { operatorId: true, operator: { select: { firstName: true, lastName: true } } },
  });
  if (!reg) return NextResponse.json({ register: null });
  const nombre = `${reg.operator?.firstName ?? ""} ${reg.operator?.lastName ?? ""}`.trim() || null;
  return NextResponse.json({ register: { operatorName: nombre, esMia: reg.operatorId === ctx.userId } });
}
