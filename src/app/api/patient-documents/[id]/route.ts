// Una nota de evolución: leerla tal y como se guardó, o editar su borrador.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { entrar, pacienteOculto, respuestaDeFallo, leerJson, VER, ESCRIBIR } from "../_lib/http";
import { getNotaParaEditar, updateNotaDraft } from "../_lib/service";
import { logMutation } from "@/lib/audit";

export const dynamic = "force-dynamic";

// La nota se busca por (id, clinicId) y DESPUÉS se comprueba la visibilidad de
// SU paciente: con solo el id no se puede leer la nota de un paciente restringido.
async function notaVisible(ctx: Parameters<typeof pacienteOculto>[0], id: string) {
  const fila = await prisma.patientDocument.findFirst({
    where: { id, clinicId: ctx.clinicId, kind: "NOTA_EVOLUCION" },
    select: { patientId: true },
  });
  if (!fila) return NextResponse.json({ error: "Nota no encontrada", code: "NOT_FOUND" }, { status: 404 });
  return pacienteOculto(ctx, fila.patientId);
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const e = await entrar(req, VER, 60);
  if ("res" in e) return e.res;
  const { ctx } = e;
  try {
    const oculto = await notaVisible(ctx, params.id);
    if (oculto) return oculto;
    // Lo firmado (y lo ajeno) sale tal cual se guardó; solo el borrador propio
    // lleva la cabecera de hoy, que es la que se congelará al firmar.
    const nota = await getNotaParaEditar(prisma, ctx.clinicId, params.id, ctx.userId, new Date());
    if (!nota) return NextResponse.json({ error: "Nota no encontrada", code: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json(nota);
  } catch (err) {
    console.error("Get patient document error:", err);
    return NextResponse.json({ error: "Error al abrir la nota" }, { status: 500 });
  }
}

// PATCH { body } — solo borradores, solo su autor. Lo firmado no se reescribe.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const e = await entrar(req, ESCRIBIR, 30);
  if ("res" in e) return e.res;
  const { ctx } = e;
  const body = await leerJson(req);
  try {
    const oculto = await notaVisible(ctx, params.id);
    if (oculto) return oculto;
    const r = await updateNotaDraft(prisma, ctx.clinicId, params.id, ctx.userId, body.body, new Date());
    if (r.ok === false) return respuestaDeFallo(r);
    await logMutation({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "record",
      entityId: r.value.id,
      action: "update",
      before: { documento: "NOTA_EVOLUCION", borrador: "anterior" },
      after: { documento: "NOTA_EVOLUCION", borrador: "editado", largo: r.value.body.length },
    });
    return NextResponse.json(r.value);
  } catch (err) {
    console.error("Update patient document error:", err);
    return NextResponse.json({ error: "Error al guardar la nota" }, { status: 500 });
  }
}
