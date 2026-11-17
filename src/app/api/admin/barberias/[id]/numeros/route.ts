import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { numerosDelNegocio } from "@/lib/barber/admin-numeros";

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/barberias/[id]/numeros?mes=YYYY-MM — los números del
// negocio de una barbería por mes (clientes, citas, tickets y dinero,
// gastos, membresías, tienda, barberos, usuarios, estrellas), con desglose
// por sede (ws6-t1).
//
// Solo admins de DaleControl: el MISMO guard que la ficha de clínica del
// dental y que …/actividad (isAdminAuthed, sesión en BD con revocación).
// Las sedes que se suman salen de la base a partir del [id]: la matriz y sus
// sucursales, o solo la sucursal. Solo agregados: ningún dato de un cliente.
// ═══════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const data = await numerosDelNegocio(params.id, req.nextUrl.searchParams.get("mes"));
    if (!data) return NextResponse.json({ error: "Barbería no encontrada" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/admin/barberias/[id]/numeros error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
