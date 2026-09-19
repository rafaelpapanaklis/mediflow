import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { DOCUMENT_TEMPLATE_KINDS, type DocumentTemplateKindValue } from "@/lib/document-templates/kinds";
import { TEMPLATES_WRITE_PERMISSION } from "@/lib/document-templates/permissions";
import { createTemplate, listTemplates } from "@/lib/document-templates/service";

export const dynamic = "force-dynamic";

// GET /api/document-templates?kind=NOTA_EVOLUCION|CONSENTIMIENTO&all=1
// Abierto a cualquier sesión de la clínica (ver permissions.ts). `all=1`
// incluye las inactivas: lo usa la pantalla de Administración.
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const kindParam = searchParams.get("kind");
  let kind: DocumentTemplateKindValue | undefined;
  if (kindParam !== null) {
    kind = DOCUMENT_TEMPLATE_KINDS.find((k) => k === kindParam);
    if (!kind) {
      return NextResponse.json({ error: "Tipo de plantilla inválido", code: "KIND_INVALID" }, { status: 400 });
    }
  }

  try {
    const templates = await listTemplates(prisma, ctx.clinicId, {
      kind,
      includeInactive: searchParams.get("all") === "1",
    });
    return NextResponse.json(templates);
  } catch (err) {
    console.error("List document templates error:", err);
    return NextResponse.json({ error: "Error al cargar las plantillas" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
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
    // El saneado del HTML ocurre dentro de createTemplate, en el servidor.
    const r = await createTemplate(prisma, ctx.clinicId, ctx.userId, {
      kind: body?.kind,
      name: body?.name,
      body: body?.body,
    });
    if (r.ok === false) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
    return NextResponse.json(r.template, { status: 201 });
  } catch (err) {
    console.error("Create document template error:", err);
    return NextResponse.json({ error: "Error al crear la plantilla" }, { status: 500 });
  }
}
