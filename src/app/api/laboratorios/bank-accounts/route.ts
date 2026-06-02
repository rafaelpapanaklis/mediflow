import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDentalLabContext } from "@/lib/lab-auth";
import type { DentalLabBankAccountDTO } from "@/lib/laboratorios/types";

export const dynamic = "force-dynamic";

function serializeAccount(a: any): DentalLabBankAccountDTO {
  return {
    id: a.id,
    bank: a.bank,
    clabe: a.clabe,
    accountNumber: a.accountNumber ?? null,
    holderName: a.holderName,
    isPrimary: a.isPrimary,
  };
}

// ── GET /api/laboratorios/bank-accounts ──────────────────────────────────
// Cuentas bancarias SPEI del laboratorio en sesión. labId SIEMPRE de la sesión.
export async function GET() {
  const ctx = await getDentalLabContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accounts = await prisma.dentalLabBankAccount.findMany({
    where: { labId: ctx.labId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });

  return NextResponse.json(accounts.map(serializeAccount));
}

// ── POST /api/laboratorios/bank-accounts ─────────────────────────────────
// Crea una cuenta bancaria para el laboratorio en sesión.
export async function POST(req: NextRequest) {
  const ctx = await getDentalLabContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta de laboratorio no está aprobada." }, { status: 403 });
  }
  if (ctx.role !== "OWNER" && ctx.role !== "MANAGER") {
    return NextResponse.json(
      { error: "No tienes permiso para administrar las cuentas bancarias." },
      { status: 403 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400 });
  }

  const bank = typeof body?.bank === "string" ? body.bank.trim() : "";
  if (!bank) return NextResponse.json({ error: "El banco es requerido." }, { status: 400 });

  const holderName = typeof body?.holderName === "string" ? body.holderName.trim() : "";
  if (!holderName) return NextResponse.json({ error: "El titular de la cuenta es requerido." }, { status: 400 });

  const clabe = typeof body?.clabe === "string" ? body.clabe.replace(/\s/g, "") : "";
  if (!/^\d{18}$/.test(clabe)) {
    return NextResponse.json({ error: "La CLABE debe tener 18 dígitos." }, { status: 400 });
  }

  const accRaw = typeof body?.accountNumber === "string" ? body.accountNumber.trim() : "";
  const accountNumber = accRaw ? accRaw.slice(0, 30) : null;

  // La primera cuenta siempre es la principal; respeta isPrimary del body si no.
  const count = await prisma.dentalLabBankAccount.count({ where: { labId: ctx.labId } });
  const makePrimary = body?.isPrimary === true || count === 0;

  const account = await prisma.$transaction(async (tx) => {
    if (makePrimary) {
      await tx.dentalLabBankAccount.updateMany({
        where: { labId: ctx.labId },
        data: { isPrimary: false },
      });
    }
    return tx.dentalLabBankAccount.create({
      data: {
        labId: ctx.labId, // SIEMPRE de la sesión, nunca del body.
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
