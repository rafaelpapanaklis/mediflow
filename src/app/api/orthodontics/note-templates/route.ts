import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { TEMPLATES_WRITE_PERMISSION } from "@/lib/document-templates/permissions";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { auditClinicalShared } from "@/lib/clinical-shared/auth/guard";
import { ORTHO_DEFAULT_TEMPLATES } from "@/lib/clinical-shared/evolution-templates/seed-orthodontics";
import { crearPlantillaNota } from "@/lib/orthodontics/plantillas-nota-service";

export const dynamic = "force-dynamic";

const FABRICA = ORTHO_DEFAULT_TEMPLATES.map((t) => t.name);

// POST /api/orthodontics/note-templates — crea una plantilla de nota de la
// hoja de control (o una copia de otra: `copiaDe`). Mismo permiso que el resto
// de Administración → Plantillas; `clinicId` sale de la sesión, nunca del cuerpo.
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, TEMPLATES_WRITE_PERMISSION);
  if (denied) return denied;
  if (!(await hasActiveOrthodonticsModule(ctx.clinicId))) {
    return NextResponse.json({ code: "MODULE_REQUIRED", error: "Módulo de Ortodoncia no contratado" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  try {
    const r = await crearPlantillaNota(
      prisma,
      ctx.clinicId,
      ctx.userId,
      { name: body?.name, soap: body?.soap, copiaDe: body?.copiaDe },
      FABRICA,
    );
    if (r.ok === false) return NextResponse.json({ code: r.codigo }, { status: r.status });
    await auditClinicalShared({
      ctx,
      action: "clinical-shared.evolution-template.created",
      entityType: "clinical-evolution-template",
      entityId: r.plantilla.id,
      changes: { module: "orthodontics", name: r.plantilla.name, copiaDe: typeof body?.copiaDe === "string" ? body.copiaDe : null },
    });
    return NextResponse.json(r.plantilla, { status: 201 });
  } catch (err) {
    console.error("Create ortho note template error:", err);
    return NextResponse.json({ error: "Error al crear la plantilla" }, { status: 500 });
  }
}
