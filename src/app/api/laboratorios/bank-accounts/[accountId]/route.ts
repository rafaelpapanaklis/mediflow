import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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

// ── PATCH /api/laboratorios/bank-accounts/[accountId] ────────────────────
export async function PATCH(req: NextRequest, { params }: { params: { accountId: string } }) {
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

  // Multi-tenant guard: la cuenta DEBE pertenecer al lab en sesión.
  const existing = await prisma.dentalLabBankAccount.findFirst({
    where: { id: params.accountId, labId: ctx.labId },
    select: { id: true, isPrimary: true },
  });
  if (!existing) return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400 });
  }

  const data: Prisma.DentalLabBankAccountUpdateInput = {};

  if (typeof body?.bank === "string") {
    const bank = body.bank.trim();
    if (!bank) return NextResponse.json({ error: "El banco es requerido." }, { status: 400 });
    data.bank = bank.slice(0, 100);
  }
  if (typeof body?.holderName === "string") {
    const holderName = body.holderName.trim();
    if (!holderName) return NextResponse.json({ error: "El titular de la cuenta es requerido." }, { status: 400 });
    data.holderName = holderName.slice(0, 200);
  }
  if (body?.clabe !== undefined) {
    const clabe = typeof body.clabe === "string" ? body.clabe.replace(/\s/g, "") : "";
    if (!/^\d{18}$/.test(clabe)) {
      return NextResponse.json({ error: "La CLABE debe tener 18 dígitos." }, { status: 400 });
    }
    data.clabe = clabe;
  }
  if (body?.accountNumber !== undefined) {
    const accRaw = typeof body.accountNumber === "string" ? body.accountNumber.trim() : "";
    data.accountNumber = accRaw ? accRaw.slice(0, 30) : null;
  }

  const setPrimary = body?.isPrimary === true;
  if (Object.keys(data).length === 0 && !setPrimary && body?.isPrimary !== false) {
    return NextResponse.json({ error: "No hay cambios que aplicar." }, { status: 400 });
  }
  if (body?.isPrimary === false) {
    data.isPrimary = false;
  }

  const demotingPrimary = existing.isPrimary === true && body?.isPrimary === false;

  // Si se marca como principal: desmarca las demás. Si se degrada la principal
  // actual: promueve la cuenta más antigua restante para no quedar sin principal
  // (si es la única cuenta, se mantiene como principal). Todo en una transacción.
  const updated = await prisma.$transaction(async (tx) => {
    if (setPrimary) {
      await tx.dentalLabBankAccount.updateMany({
        where: { labId: ctx.labId },
        data: { isPrimary: false },
      });
      data.isPrimary = true;
    } else if (demotingPrimary) {
      const replacement = await tx.dentalLabBankAccount.findFirst({
        where: { labId: ctx.labId, id: { not: existing.id } },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (replacement) {
        await tx.dentalLabBankAccount.update({
          where: { id: replacement.id },
          data: { isPrimary: true },
        });
      } else {
        // Es la única cuenta: no puede quedar sin principal.
        data.isPrimary = true;
      }
    }
    return tx.dentalLabBankAccount.update({ where: { id: existing.id }, data });
  });

  return NextResponse.json(serializeAccount(updated));
}

// ── DELETE /api/laboratorios/bank-accounts/[accountId] ───────────────────
// Si se elimina la principal y quedan otras, se promueve la más antigua.
export async function DELETE(_req: NextRequest, { params }: { params: { accountId: string } }) {
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

  const existing = await prisma.dentalLabBankAccount.findFirst({
    where: { id: params.accountId, labId: ctx.labId },
    select: { id: true, isPrimary: true },
  });
  if (!existing) return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.dentalLabBankAccount.delete({ where: { id: existing.id } });
    if (existing.isPrimary) {
      const next = await tx.dentalLabBankAccount.findFirst({
        where: { labId: ctx.labId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (next) {
        await tx.dentalLabBankAccount.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    }
  });

  return NextResponse.json({ success: true });
}
