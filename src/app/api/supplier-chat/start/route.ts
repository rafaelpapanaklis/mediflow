export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  resolveChatCaller,
  serializeThread,
  lastMessageInclude,
} from "@/lib/suppliers/chat-access";

const NO_STORE = { "Cache-Control": "no-store, must-revalidate" };

/**
 * POST /api/supplier-chat/start — abre (o reutiliza) el hilo entre la clínica
 * y un proveedor. Hay un único hilo por par (clinicId, supplierId), así que
 * usamos upsert sobre el unique compuesto.
 *
 * Lado clínica (contrato): body { supplierId }. El clinicId sale de sesión.
 * Lado proveedor (extensión simétrica): body { clinicId }. El supplierId sale
 * de sesión. En ambos casos el id propio NUNCA se toma del body.
 */
export async function POST(req: Request) {
  const caller = await resolveChatCaller();
  if (!caller) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400, headers: NO_STORE });
  }

  if (caller.side === "CLINIC") {
    const supplierId = typeof body?.supplierId === "string" ? body.supplierId.trim() : "";
    if (!supplierId) {
      return NextResponse.json({ error: "supplierId es requerido." }, { status: 400, headers: NO_STORE });
    }
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });
    if (!supplier) {
      return NextResponse.json({ error: "Proveedor no encontrado." }, { status: 404, headers: NO_STORE });
    }
    const thread = await prisma.supplierChatThread.upsert({
      where: { clinicId_supplierId: { clinicId: caller.clinicId, supplierId } },
      create: { clinicId: caller.clinicId, supplierId },
      update: {},
      include: {
        messages: lastMessageInclude,
        supplier: { select: { id: true, businessName: true, logoUrl: true } },
      },
    });
    return NextResponse.json(serializeThread(thread), { status: 201, headers: NO_STORE });
  }

  // Lado proveedor.
  const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
  if (!clinicId) {
    return NextResponse.json({ error: "clinicId es requerido." }, { status: 400, headers: NO_STORE });
  }
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true },
  });
  if (!clinic) {
    return NextResponse.json({ error: "Clínica no encontrada." }, { status: 404, headers: NO_STORE });
  }
  const thread = await prisma.supplierChatThread.upsert({
    where: { clinicId_supplierId: { clinicId, supplierId: caller.supplierId } },
    create: { clinicId, supplierId: caller.supplierId },
    update: {},
    include: {
      messages: lastMessageInclude,
      clinic: { select: { id: true, name: true, logoUrl: true } },
    },
  });
  return NextResponse.json(serializeThread(thread), { status: 201, headers: NO_STORE });
}
