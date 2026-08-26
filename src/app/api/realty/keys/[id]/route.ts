// ═══════════════════════════════════════════════════════════════════════
// PATCH /api/realty/keys/[id]
//
//   · { returned: true }        → devolver la llave
//   · { holderNote: "…" }       → corregir a quién se le prestó
//
// Devolver es idempotente-seguro: dos clics seguidos no reescriben la fecha
// de devolución con la del segundo; el segundo contesta 409 "ya estaba
// devuelta". Esa fecha es el dato con el que alguien reclama.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getRealtyContext } from "@/lib/realty-auth";
import { keyErrorStatus, RealtyKeyError, returnKey, updateKeyNote } from "@/lib/realty/keys";
import { checkVisitsAccess } from "@/lib/realty/visits";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

const PatchSchema = z.object({
  returned: z.literal(true).optional(),
  holderNote: z.string().max(300).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getRealtyContext();
  const guard = checkVisitsAccess(ctx, "keys.manage");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  }
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", detail: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.returned === true) {
      const key = await returnKey(ctx, params.id);
      return NextResponse.json({ key });
    }
    if (Object.prototype.hasOwnProperty.call(body, "holderNote")) {
      const key = await updateKeyNote(ctx, params.id, parsed.data.holderNote ?? null);
      return NextResponse.json({ key });
    }
    return NextResponse.json({ error: "No hay nada que cambiar" }, { status: 400 });
  } catch (err) {
    if (err instanceof RealtyKeyError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: keyErrorStatus(err.code) },
      );
    }
    throw err;
  }
}
