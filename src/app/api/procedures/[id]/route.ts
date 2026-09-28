import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { datosDeCambio, leerOrthoIncluido } from "../entrada";
import {
  aplicarOrthoIncluido,
  debeMarcarseComoControl,
  CODIGO_CONTROL_ORTO,
} from "@/lib/orthodontics/catalog-procedures";

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

    // El control de ortodoncia se reconoce por su llave, no por su nombre
    // (ws1-t5). Si esta fila es el control de siempre y aún no la lleva, se le
    // pone AHORA, antes de que el cambio de nombre lo deje irreconocible para
    // la facturación de «Pago por control». La llave la pone el servidor; la
    // que venga en el body se sigue ignorando.
    const marcaDeControl = debeMarcarseComoControl(existing) ? { code: CODIGO_CONTROL_ORTO } : {};

    const updated = await prisma.procedureCatalog.update({
      where: { id: params.id },
      data: { ...entrada.data, ...marcaDeControl },
    });

    // Ola 2 de ortodoncia (ws1-t1) — orthoIncludedInTreatment va aparte, por
    // SQL crudo (ver entrada.ts/catalog-procedures.ts).
    const orthoIncluido = leerOrthoIncluido(body.orthoIncludedInTreatment);
    if (orthoIncluido !== undefined) await aplicarOrthoIncluido(params.id, ctx.clinicId, orthoIncluido);

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
