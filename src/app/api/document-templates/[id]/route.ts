import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { TEMPLATES_WRITE_PERMISSION } from "@/lib/document-templates/permissions";
import { deleteTemplate, getTemplate, updateTemplate } from "@/lib/document-templates/service";
import { restaurableDe, volverAFabricaConsentimiento } from "@/lib/plantillas-fabrica/consentimiento";
import { repoVersiones } from "@/lib/plantillas-fabrica/db";
import { anotarFilaDeModulo } from "@/lib/movimientos-paciente/modulos";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
    // «Volver a la de fábrica» (solo consentimientos precargados): el texto de la clínica
    // se archiva, no se borra. Ver lib/plantillas-fabrica/consentimiento.ts.
    if (body?.volverAFabrica === true) {
      const v = await volverAFabricaConsentimiento(prisma, repoVersiones, ctx.clinicId, params.id, ctx.userId);
      if (v.ok === false) return NextResponse.json({ code: v.code }, { status: v.status });
      try {
        await anotarFilaDeModulo({
          clinicId: ctx.clinicId,
          userId: ctx.userId,
          entityType: "document-template",
          entityId: v.template.id,
          action: "update",
          changes: { volverAFabrica: { before: true, after: false } },
        });
      } catch (e) {
        console.error("[plantillas] bitácora (volver a la de fábrica):", e);
      }
      return NextResponse.json(v.template);
    }
    // `kind` no se edita; `clinicId` sale de la sesión, nunca del cuerpo.
    const r = await updateTemplate(prisma, ctx.clinicId, params.id, {
      name: body?.name,
      body: body?.body,
      isActive: body?.isActive,
    });
    if (r.ok === false) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
    // `restaurable` para que la tarjeta ofrezca «Volver a la de fábrica» sin recargar (ws1-t8 · P6).
    return NextResponse.json({ ...r.template, restaurable: restaurableDe(r.template) });
  } catch (err) {
    console.error("Update document template error:", err);
    return NextResponse.json({ error: "Error al guardar la plantilla" }, { status: 500 });
  }
}

// Borrado lógico: los documentos ya hechos con la plantilla no se tocan.
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
