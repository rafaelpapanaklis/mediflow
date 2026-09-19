// GET /api/patient-documents/templates — lo que sale en «Nueva nota de
// evolución»: SOLO las plantillas de tipo NOTA_EVOLUCION, activas, de la
// clínica de la sesión. Solo id y nombre: el texto se pide al elegir una.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { entrar, ESCRIBIR } from "../_lib/http";
import { listNotaTemplates } from "../_lib/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const e = await entrar(req, ESCRIBIR, 60);
  if ("res" in e) return e.res;
  try {
    return NextResponse.json(await listNotaTemplates(prisma, e.ctx.clinicId));
  } catch (err) {
    console.error("List nota templates error:", err);
    return NextResponse.json({ error: "Error al cargar las plantillas" }, { status: 500 });
  }
}
