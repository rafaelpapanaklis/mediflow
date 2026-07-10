import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { canUseCaja, hashCajaPin, verifyCajaPin, isValidCajaPin } from "@/lib/caja-pin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Gestión del PIN de Caja del usuario autenticado. Body: { action, pin?, currentPin? }.
 *  - status: ¿el usuario ya tiene PIN configurado?  → { hasPin }
 *  - set:    fija/cambia el PIN. Si ya tiene, exige currentPin correcto.
 *  - verify: valida un PIN contra el hash guardado   → { valid }
 *
 * Exige canUseCaja PRIMERO (403 si no). El PIN vive en el usuario de la sesión
 * (ctx.userId), aislado por clínica vía getAuthContext.
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  if (!canUseCaja(ctx.user)) {
    return NextResponse.json(
      { error: "No tienes permiso para operar la Caja. Pide a un administrador que te habilite el acceso.", code: "CAJA_NO_ACCESS" },
      { status: 403 },
    );
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const action = body?.action;

  const me = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { cajaPinHash: true },
  });
  const hasPin = !!me?.cajaPinHash;

  if (action === "status") {
    return NextResponse.json({ ok: true, hasPin, canUseCaja: true });
  }

  if (action === "set") {
    const pin = String(body?.pin ?? "");
    if (!isValidCajaPin(pin)) {
      return NextResponse.json({ error: "El PIN debe ser exactamente 6 dígitos." }, { status: 400 });
    }
    // Si ya hay PIN, exige el actual para cambiarlo (no cambios silenciosos).
    if (hasPin) {
      const currentPin = String(body?.currentPin ?? "");
      if (!(await verifyCajaPin(currentPin, me!.cajaPinHash))) {
        return NextResponse.json({ error: "El PIN actual es incorrecto.", code: "CAJA_PIN_INVALID" }, { status: 403 });
      }
    }
    const cajaPinHash = await hashCajaPin(pin);
    await prisma.user.update({ where: { id: ctx.userId }, data: { cajaPinHash } });
    return NextResponse.json({ ok: true, hasPin: true });
  }

  if (action === "verify") {
    const pin = String(body?.pin ?? "");
    if (!hasPin) {
      return NextResponse.json({ ok: true, valid: false, hasPin: false });
    }
    const valid = await verifyCajaPin(pin, me!.cajaPinHash);
    return NextResponse.json({ ok: true, valid, hasPin: true });
  }

  return NextResponse.json({ error: "Acción inválida. Usa status | set | verify." }, { status: 400 });
}
