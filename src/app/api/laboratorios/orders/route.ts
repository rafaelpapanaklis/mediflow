import { type NextRequest, NextResponse } from "next/server";
import { getDentalLabContext } from "@/lib/lab-auth";
import { prisma } from "@/lib/prisma";
import type { DentalLabOrderStatus } from "@/lib/laboratorios/types";

export const dynamic = "force-dynamic";

const VALID_STATUSES = [
  "SOLICITADA",
  "RECIBIDA",
  "ATENDIENDO",
  "ENVIADA",
  "ENTREGADA",
  "CANCELADA",
] as const;

// GET /api/laboratorios/orders → pedidos recibidos por el laboratorio en sesión.
// Filtro opcional ?status=SOLICITADA|RECIBIDA|ATENDIENDO|ENVIADA|ENTREGADA|CANCELADA.
export async function GET(req: NextRequest) {
  const ctx = await getDentalLabContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Cuenta no aprobada." }, { status: 403 });
  }

  const statusParam = req.nextUrl.searchParams.get("status");
  const status =
    statusParam && (VALID_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as DentalLabOrderStatus)
      : undefined;

  const orders = await prisma.dentalLabOrder.findMany({
    // Multi-tenant: siempre scopeado por el labId de la sesión.
    where: { labId: ctx.labId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      clinic: { select: { name: true } },
      service: { select: { name: true } },
    },
  });

  return NextResponse.json(orders, {
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}
