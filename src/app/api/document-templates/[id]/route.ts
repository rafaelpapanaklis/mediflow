import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { TEMPLATES_WRITE_PERMISSION } from "@/lib/document-templates/permissions";
import { deleteTemplate, getTemplate, updateTemplate } from "@/lib/document-templates/service";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const template = await getTemplate(prisma, ctx.clinicId, params.id);
    if (!template) return NextResponse.json({ error: "Plantilla no encontrada", code: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json(template);
  } catch (err) {
    console.error("Get document template error:", err);
    return NextResponse.json({ error: "Error al cargar la plantilla" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, TEMPLATES_WRITE_PERMISSION);
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  try {
    // `kind` no se edita; `clinicId` sale de la sesión, nunca del cuerpo.
    const r = await updateTemplate(prisma, ctx.clinicId, params.id, {
      name: body?.name,
      body: body?.body,
      isActive: body?.isActive,
    });
    if (r.ok === false) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
    return NextResponse.json(r.template);
  } catch (err) {
    console.error("Update document template error:", err);
    return NextResponse.json({ error: "Error al guardar la plantilla" }, { status: 500 });
  }
}

// Borrado lógico: los documentos ya hechos con la plantilla no se tocan.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, TEMPLATES_WRITE_PERMISSION);
  if (denied) return denied;

  try {
    const r = await deleteTemplate(prisma, ctx.clinicId, params.id);
    if (r.ok === false) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Delete document template error:", err);
    return NextResponse.json({ error: "Error al eliminar la plantilla" }, { status: 500 });
  }
}
