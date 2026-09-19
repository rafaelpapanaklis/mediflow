// GET /api/patient-documents/preview?patientId=&templateId= — la plantilla ya
// rellenada con los datos de hoy, la cabecera que va a llevar y QUÉ LE FALTA
// (cédula, logo), para avisar ANTES de firmar. No guarda nada.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { entrar, pacienteOculto, respuestaDeFallo, ESCRIBIR } from "../_lib/http";
import { previewNota } from "../_lib/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const e = await entrar(req, ESCRIBIR, 60);
  if ("res" in e) return e.res;
  const { ctx } = e;

  const q = new URL(req.url).searchParams;
  const patientId = q.get("patientId") ?? "";
  const templateId = q.get("templateId") ?? "";
  if (!patientId || !templateId) {
    return NextResponse.json({ error: "patientId y templateId requeridos" }, { status: 400 });
  }
  const oculto = await pacienteOculto(ctx, patientId);
  if (oculto) return oculto;

  try {
    const r = await previewNota(prisma, ctx.clinicId, { patientId, templateId, doctorId: ctx.userId }, new Date());
    return r.ok === false ? respuestaDeFallo(r) : NextResponse.json(r.value);
  } catch (err) {
    console.error("Preview patient document error:", err);
    return NextResponse.json({ error: "Error al preparar la nota" }, { status: 500 });
  }
}
