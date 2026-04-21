import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";

/**
 * Marca la clínica como "cancelRequested" — no cancela inmediatamente,
 * solo registra la intención del usuario para que el admin / proceso de cobro
 * no cobre al terminar el trial.
 */
export async function POST() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!ctx.isAdmin) {
    return NextResponse.json({ error: "Solo administradores pueden cancelar" }, { status: 403 });
  }

  try {
    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data: {
        cancelRequested: true,
        cancelRequestedAt: new Date(),
      },
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("cancel-request error:", err);
    return NextResponse.json({ error: err.message ?? "Error interno" }, { status: 500 });
  }
}
