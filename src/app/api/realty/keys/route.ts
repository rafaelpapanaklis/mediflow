// ═══════════════════════════════════════════════════════════════════════
// GET  /api/realty/keys — el tablero de llaves fuera + la cartera para el
//                         selector de entrega
// POST /api/realty/keys — entregar una llave
//
// Permiso propio: `keys.manage`. Estaba declarado en el contrato desde la
// Ola 0 y hasta esta terminal NO tenía un solo consumidor.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getRealtyContext } from "@/lib/realty-auth";
import { getKeysBoard, handOverKey, keyErrorStatus, listKeyProperties, RealtyKeyError } from "@/lib/realty/keys";
import { checkVisitsAccess, listVisitAgents } from "@/lib/realty/visits";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getRealtyContext();
  const guard = checkVisitsAccess(ctx, "keys.manage");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  }
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const search = req.nextUrl.searchParams.get("search");
  const [board, properties, agents] = await Promise.all([
    getKeysBoard(ctx),
    listKeyProperties(ctx, search),
    listVisitAgents(ctx),
  ]);

  return NextResponse.json(
    { ...board, properties, agents },
    { headers: { "Cache-Control": "no-store" } },
  );
}

const HandOverSchema = z.object({
  propertyId: z.string().min(1).max(40),
  holderUserId: z.string().max(40).nullable().optional(),
  holderNote: z.string().max(300).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getRealtyContext();
  const guard = checkVisitsAccess(ctx, "keys.manage");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error ?? "Sin permiso" }, { status: guard.status ?? 403 });
  }
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = HandOverSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Faltan datos de la entrega", detail: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  try {
    const keyId = await handOverKey(ctx, {
      propertyId: parsed.data.propertyId,
      holderUserId: parsed.data.holderUserId ?? null,
      holderNote: parsed.data.holderNote ?? null,
    });
    return NextResponse.json({ keyId }, { status: 201 });
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
