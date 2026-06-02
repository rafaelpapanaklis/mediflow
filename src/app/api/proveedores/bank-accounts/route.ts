import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSupplierContext, type SupplierContext } from "@/lib/supplier-auth";
import type { SupplierBankAccountDTO } from "@/lib/suppliers/types";

export const dynamic = "force-dynamic";

function serializeAccount(a: {
  id: string;
  bank: string;
  clabe: string;
  accountNumber: string | null;
  holderName: string;
  isPrimary: boolean;
}): SupplierBankAccountDTO {
  return {
    id: a.id,
    bank: a.bank,
    clabe: a.clabe,
    accountNumber: a.accountNumber ?? null,
    holderName: a.holderName,
    isPrimary: a.isPrimary,
  };
}

// Sólo OWNER/MANAGER de un proveedor APROBADO administra cuentas bancarias.
async function requireManager(): Promise<{ ctx: SupplierContext | null; error: NextResponse | null }> {
  const ctx = await getSupplierContext();
  if (!ctx) {
    return { ctx: null, error: NextResponse.json({ error: "No autenticado." }, { status: 401 }) };
  }
  if (ctx.status !== "APPROVED") {
    return {
      ctx: null,
      error: NextResponse.json({ error: "Tu cuenta de proveedor no está aprobada." }, { status: 403 }),
    };
  }
  if (ctx.role !== "OWNER" && ctx.role !== "MANAGER") {
    return {
      ctx: null,
      error: NextResponse.json(
        { error: "No tienes permiso para administrar las cuentas bancarias." },
        { status: 403 },
      ),
    };
  }
  return { ctx, error: null };
}

// ── GET /api/proveedores/bank-accounts ───────────────────────────────────
// Cuentas SPEI del proveedor en sesión. supplierId SIEMPRE de la sesión.
export async function GET() {
  const ctx = await getSupplierContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const accounts = await prisma.supplierBankAccount.findMany({
    where: { supplierId: ctx.supplierId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });

  return NextResponse.json(accounts.map(serializeAccount));
}

// ── POST /api/proveedores/bank-accounts ──────────────────────────────────
// Crea una cuenta bancaria para el proveedor en sesión.
export async function POST(req: NextRequest) {
  const { ctx, error } = await requireManager();
  if (error) return error;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400 });
  }

  const bank = typeof body?.bank === "string" ? body.bank.trim() : "";
  if (!bank) return NextResponse.json({ error: "El banco es requerido." }, { status: 400 });

  const holderName = typeof body?.holderName === "string" ? body.holderName.trim() : "";
  if (!holderName) {
    return NextResponse.json({ error: "El titular de la cuenta es requerido." }, { status: 400 });
  }

  const clabe = typeof body?.clabe === "string" ? body.clabe.replace(/\s/g, "") : "";
  if (!/^\d{18}$/.test(clabe)) {
    return NextResponse.json({ error: "La CLABE debe tener 18 dígitos." }, { status: 400 });
  }

  const accRaw = typeof body?.accountNumber === "string" ? body.accountNumber.trim() : "";
  const accountNumber = accRaw ? accRaw.slice(0, 30) : null;

  // La primera cuenta siempre es la principal; respeta isPrimary del body si no.
  const count = await prisma.supplierBankAccount.count({ where: { supplierId: ctx!.supplierId } });
  const makePrimary = body?.isPrimary === true || count === 0;

  const account = await prisma.$transaction(async (tx) => {
    if (makePrimary) {
      await tx.supplierBankAccount.updateMany({
        where: { supplierId: ctx!.supplierId },
        data: { isPrimary: false },
      });
    }
    return tx.supplierBankAccount.create({
      data: {
        supplierId: ctx!.supplierId, // SIEMPRE de la sesión, nunca del body.
        bank: bank.slice(0, 100),
        clabe,
        accountNumber,
        holderName: holderName.slice(0, 200),
        isPrimary: makePrimary,
      },
    });
  });

  return NextResponse.json(serializeAccount(account), { status: 201 });
}

// ── DELETE /api/proveedores/bank-accounts?id=<accountId> ──────────────────
// Si se elimina la principal y quedan otras, se promueve la más antigua.
export async function DELETE(req: NextRequest) {
  const { ctx, error } = await requireManager();
  if (error) return error;

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Falta el id de la cuenta." }, { status: 400 });

  // Multi-tenant guard: la cuenta DEBE pertenecer al proveedor en sesión.
  const existing = await prisma.supplierBankAccount.findFirst({
    where: { id, supplierId: ctx!.supplierId },
    select: { id: true, isPrimary: true },
  });
  if (!existing) return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.supplierBankAccount.delete({ where: { id: existing.id } });
    if (existing.isPrimary) {
      const next = await tx.supplierBankAccount.findFirst({
        where: { supplierId: ctx!.supplierId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (next) {
        await tx.supplierBankAccount.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    }
  });

  return NextResponse.json({ success: true });
}
