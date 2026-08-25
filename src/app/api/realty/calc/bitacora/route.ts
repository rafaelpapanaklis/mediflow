// POST /api/realty/calc/bitacora — guarda un cálculo en la línea de tiempo
// del prospecto.
//
// RealtyLeadActivity no tiene columna Json, así que el cálculo se guarda
// como TEXTO. No es una limitación disfrazada: la bitácora la lee una
// persona, y un JSON crudo en la línea de tiempo no le sirve a nadie. El
// marcador de la primera línea es lo que permite volver a encontrarlos.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { MARCA_BITACORA } from "@/lib/realty/calc/catalog";
import { filtroLeadsDelRol } from "@/lib/realty/calc/access";
import { requireCalcApi } from "../_guard";

export const dynamic = "force-dynamic";

/** Tope del texto. `note` es @db.Text, pero una nota infinita no le sirve a nadie. */
const MAX_TEXTO = 4000;

export async function POST(req: NextRequest) {
  // leads.edit: esto ESCRIBE en el expediente del prospecto.
  const guard = await requireCalcApi("leads.edit");
  if (!guard.ok) return guard.res;
  const ctx = guard.ctx!;

  let body: Record<string, unknown> | null = null;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const leadId = typeof body?.leadId === "string" ? body.leadId.trim() : "";
  const texto = typeof body?.texto === "string" ? body.texto.trim() : "";
  if (!leadId) return NextResponse.json({ error: "Falta el prospecto." }, { status: 400 });
  if (texto.length < 10) {
    return NextResponse.json({ error: "No hay resultado que guardar." }, { status: 400 });
  }

  try {
    // El prospecto tiene que ser de ESTA cuenta y estar al alcance del rol.
    // Sin esta lectura, un id copiado de otra cuenta escribiría en su
    // bitácora: el accountId del body nunca decide nada.
    const lead = await prisma.realtyLead.findFirst({
      where: { id: leadId, accountId: ctx.accountId, ...filtroLeadsDelRol(ctx) },
      select: { id: true },
    });
    if (!lead) {
      return NextResponse.json({ error: "Ese prospecto no existe o no es tuyo." }, { status: 404 });
    }

    const nota = `${MARCA_BITACORA}${texto}`.slice(0, MAX_TEXTO);
    const creada = await prisma.realtyLeadActivity.create({
      data: {
        accountId: ctx.accountId,
        leadId: lead.id,
        kind: "NOTA",
        note: nota,
        userId: ctx.realtyUserId,
      },
      select: { id: true },
    });
    return NextResponse.json({ ok: true, id: creada.id }, { status: 201 });
  } catch (e) {
    console.error("[realty-calc] no se pudo guardar en la bitácora:", e);
    return NextResponse.json({ error: "No se pudo guardar el cálculo." }, { status: 500 });
  }
}
