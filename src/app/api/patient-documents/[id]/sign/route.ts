// POST /api/patient-documents/:id/sign { body? } — firma un borrador. A partir
// de aquí `body` y `encabezado` quedan congelados.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";
import { entrar, pacienteOculto, respuestaDeFallo, leerJson, ESCRIBIR } from "../../_lib/http";
import { signNota } from "../../_lib/service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const e = await entrar(req, ESCRIBIR, 20);
  if ("res" in e) return e.res;
  const { ctx } = e;
  const body = await leerJson(req);

  try {
    const fila = await prisma.patientDocument.findFirst({
      where: { id: params.id, clinicId: ctx.clinicId, kind: "NOTA_EVOLUCION" },
      select: { patientId: true },
    });
    if (!fila) return NextResponse.json({ error: "Nota no encontrada", code: "NOT_FOUND" }, { status: 404 });
    const oculto = await pacienteOculto(ctx, fila.patientId);
    if (oculto) return oculto;

    const r = await signNota(prisma, ctx.clinicId, params.id, ctx.userId, body.body, new Date());
    if (r.ok === false) return respuestaDeFallo(r);

    await logMutation({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "record",
      entityId: r.value.id,
      action: "update",
      before: { status: "DRAFT" },
      after: { status: "SIGNED" },
    });
    return NextResponse.json(r.value);
  } catch (err) {
    console.error("Sign patient document error:", err);
    return NextResponse.json({ error: "Error al firmar la nota" }, { status: 500 });
  }
}
