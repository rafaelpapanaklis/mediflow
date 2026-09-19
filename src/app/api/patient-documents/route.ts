// Nota de evolución como documento — lista y alta. SOLO kind = NOTA_EVOLUCION
// (eso lo garantiza el servicio). Multi-tenant: clinicId SIEMPRE de la sesión.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";
import { entrar, pacienteOculto, respuestaDeFallo, leerJson, VER, ESCRIBIR } from "./_lib/http";
import { createNota, listNotas } from "./_lib/service";

export const dynamic = "force-dynamic";

// GET /api/patient-documents?patientId=xxx
export async function GET(req: NextRequest) {
  const e = await entrar(req, VER, 60);
  if ("res" in e) return e.res;
  const { ctx } = e;

  const patientId = new URL(req.url).searchParams.get("patientId");
  if (!patientId) return NextResponse.json({ error: "patientId requerido" }, { status: 400 });
  const oculto = await pacienteOculto(ctx, patientId);
  if (oculto) return oculto;

  try {
    return NextResponse.json(await listNotas(prisma, ctx.clinicId, patientId));
  } catch (err) {
    console.error("List patient documents error:", err);
    return NextResponse.json({ error: "Error al cargar las notas" }, { status: 500 });
  }
}

// POST /api/patient-documents { patientId, templateId, body?, sign? }
// El doctor de la nota es SIEMPRE quien tiene la sesión: no se acepta del body.
export async function POST(req: NextRequest) {
  const e = await entrar(req, ESCRIBIR, 20);
  if ("res" in e) return e.res;
  const { ctx } = e;

  const body = await leerJson(req);
  const patientId = typeof body.patientId === "string" ? body.patientId : "";
  const templateId = typeof body.templateId === "string" ? body.templateId : "";
  if (!patientId || !templateId) {
    return NextResponse.json({ error: "patientId y templateId requeridos" }, { status: 400 });
  }
  const oculto = await pacienteOculto(ctx, patientId);
  if (oculto) return oculto;

  try {
    const r = await createNota(
      prisma,
      ctx.clinicId,
      { patientId, templateId, doctorId: ctx.userId, body: body.body, sign: body.sign === true },
      new Date(),
    );
    if (r.ok === false) return respuestaDeFallo(r);

    await logMutation({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "record",
      entityId: r.value.id,
      action: "create",
      after: { documento: "NOTA_EVOLUCION", patientId, templateId, title: r.value.title, status: r.value.status },
    });
    return NextResponse.json(r.value, { status: 201 });
  } catch (err) {
    console.error("Create patient document error:", err);
    return NextResponse.json({ error: "Error al guardar la nota" }, { status: 500 });
  }
}
