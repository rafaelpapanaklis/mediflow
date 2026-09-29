import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { datosDeCambio, leerOrthoIncluido } from "../entrada";
import { evaluarCambioDeOrtodoncia } from "@/lib/orthodontics/procedimiento-ortodoncia-reglas";
import { quitarProcedimiento } from "@/lib/procedures/quitar-procedimiento";
import { quitarDepsPrisma } from "@/lib/procedures/quitar-procedimiento-db";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import {
  aplicarOrthoIncluido,
  debeMarcarseComoControl,
  CODIGO_CONTROL_ORTO,
  ORTHO_CATALOG_CATEGORY,
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

    // Reglas de la categoría «Ortodoncia» (control fijo, módulo activo, cobro elegido).
    const orthoIncluido = leerOrthoIncluido(body.orthoIncludedInTreatment);
    const decision = evaluarCambioDeOrtodoncia({
      existente: { name: existing.name, code: existing.code, category: existing.category },
      categoria: typeof body.category === "string" ? body.category.trim() : undefined,
      nombre: typeof body.name === "string" ? body.name : undefined,
      incluido: orthoIncluido,
      // Solo se consulta cuando el cambio lleva la fila A Ortodoncia (es lo único que lo necesita).
      moduloActivo: body.category?.trim?.() === ORTHO_CATALOG_CATEGORY
        ? await hasActiveOrthodonticsModule(ctx.clinicId).catch(() => false)
        : false,
    });
    if (decision.error) return NextResponse.json({ error: decision.error }, { status: 400 });

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
    if (decision.aplicarIncluido && orthoIncluido !== undefined) await aplicarOrthoIncluido(params.id, ctx.clinicId, orthoIncluido);

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
    // Sin uso se elimina; con uso se ARCHIVA (isActive=false) para no romper
    // facturas, presupuestos ni hojas. El control de ortodoncia no se quita.
    const r = await quitarProcedimiento(quitarDepsPrisma, { clinicId: ctx.clinicId, id: params.id });
    if (r.ok === false) return NextResponse.json({ error: r.error }, { status: r.status });
    revalidateAfter("procedures");
    return NextResponse.json({ success: true, accion: r.accion, usos: r.usos });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Error" }, { status: 500 });
  }
}
