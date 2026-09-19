import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { datosDeCambio } from "../entrada";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // EQ-07: "Editar procedimientos" (antes `isAdmin`, mismos roles por default).
  const denied = denyIfMissingPermission(ctx, "procedures.edit");
  if (denied) return denied;

  try {
    const existing = await prisma.procedureCatalog.findFirst({
      where: { id: params.id, clinicId: ctx.clinicId },
    });
    if (!existing) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    const body = await req.json();
    // `code` jamás se escribe desde aquí aunque venga en el body: es la llave
    // ODO_* del odontograma (ver ../entrada).
    const entrada = datosDeCambio(body);
    if (!entrada.ok) return NextResponse.json({ error: entrada.error }, { status: 400 });

    const updated = await prisma.procedureCatalog.update({
      where: { id: params.id },
      data: entrada.data,
    });
    revalidateAfter("procedures");
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("Update procedure error:", err);
    return NextResponse.json({ error: err.message ?? "Error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // EQ-07: "Editar procedimientos" (antes `isAdmin`, mismos roles por default).
  const denied = denyIfMissingPermission(ctx, "procedures.edit");
  if (denied) return denied;

  try {
    await prisma.procedureCatalog.deleteMany({ where: { id: params.id, clinicId: ctx.clinicId } });
    revalidateAfter("procedures");
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Error" }, { status: 500 });
  }
}
