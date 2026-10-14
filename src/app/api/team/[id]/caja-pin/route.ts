import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";
import { revalidateAfter } from "@/lib/cache/revalidate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/team/[id]/caja-pin   body: { action: "reset" }
//
// «Restablecer PIN de Caja»: el dueño borra el PIN de un miembro (cajaPinHash
// = null). No le pone uno nuevo ni se entera de cuál será: la próxima vez que
// la persona abra Caja, la pantalla le pide crear el suyo (dos veces), igual
// que la primera vez. Por eso aquí no hay PIN en el cuerpo ni en la respuesta.
//
// Solo SUPER_ADMIN, y solo sobre miembros de SU clínica: el clinicId sale de
// la sesión, nunca del cliente. Un id de otra clínica contesta 404, igual que
// uno que no existe, para no confirmar que existe.
//
// ⛔ El hash no se devuelve ni se registra en la bitácora: el movimiento dice
// solo que había PIN y ya no (`tieneCajaPin`).
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!ctx.isSuperAdmin) {
    return NextResponse.json(
      { error: "Solo el dueño de la clínica puede restablecer el PIN de Caja" },
      { status: 403 },
    );
  }
  if (!ctx.clinicId) return NextResponse.json({ error: "Sin clínica activa" }, { status: 400 });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  if (body?.action !== "reset") {
    return NextResponse.json({ error: "Acción inválida. Usa reset." }, { status: 400 });
  }

  // Los ids de usuarios importados no siempre son uuid: se compara tal cual
  // con la columna, igual que el resto de /api/team.
  const id = typeof params.id === "string" ? params.id.trim() : "";
  if (!id) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const target = await prisma.user.findFirst({
    where: { id, clinicId: ctx.clinicId },
    select: { id: true, cajaPinHash: true },
  });
  if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const teniaPin = !!target.cajaPinHash;
  if (teniaPin) {
    // updateMany con la clínica en el WHERE: el candado de tenant va también
    // en la escritura, no solo en la lectura de arriba.
    await prisma.user.updateMany({
      where: { id: target.id, clinicId: ctx.clinicId },
      data: { cajaPinHash: null },
    });
    await logMutation({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "user",
      entityId: target.id,
      action: "update",
      before: { tieneCajaPin: true },
      after: { tieneCajaPin: false },
    });
    revalidateAfter("team");
  }

  return NextResponse.json({ ok: true, tieneCajaPin: false, teniaPin });
}
