// GET /api/realty/calc/prospectos?q= — buscador para guardar un cálculo en
// la bitácora. Devuelve lo MÍNIMO que necesita la lista: nombre, teléfono y
// etapa. Nada de correos, presupuestos ni notas internas: lo que sale por
// aquí viaja al navegador y se lee entero con "ver código fuente".
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { mxTenDigits } from "@/lib/phone-mx";
import { filtroLeadsDelRol, limpiarBusqueda } from "@/lib/realty/calc/access";
import { requireCalcApi } from "../_guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // leads.view además de calculators.use: este endpoint devuelve la libreta
  // de contactos, y un override de solo "calculators.use" no puede darla.
  const guard = await requireCalcApi("leads.view");
  if (!guard.ok) return guard.res;
  const ctx = guard.ctx!;

  const q = limpiarBusqueda((req.nextUrl.searchParams.get("q") ?? "").slice(0, 80));
  if (q.length < 2) return NextResponse.json({ items: [] });

  // El teléfono se compara NORMALIZADO. Un contains sobre "33 1234 5678"
  // contra una columna que guarda "3312345678" no compara nada.
  const digitos = q.replace(/\D/g, "");
  const telefono = mxTenDigits(q) ?? (digitos.length >= 3 ? digitos : null);

  const or: Record<string, unknown>[] = [{ contact: { name: { contains: q, mode: "insensitive" } } }];
  if (telefono) or.push({ contact: { phone: { contains: telefono } } });

  try {
    const filas = await prisma.realtyLead.findMany({
      where: {
        accountId: ctx.accountId,
        ...filtroLeadsDelRol(ctx),
        OR: or,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        stage: true,
        contact: { select: { name: true, phone: true } },
      },
    });
    return NextResponse.json({
      items: filas.map((f) => ({
        id: f.id,
        nombre: f.contact?.name ?? "—",
        telefono: f.contact?.phone ?? null,
        etapa: f.stage,
      })),
    });
  } catch (e) {
    console.error("[realty-calc] búsqueda de prospectos falló:", e);
    return NextResponse.json({ error: "No se pudo buscar." }, { status: 500 });
  }
}
