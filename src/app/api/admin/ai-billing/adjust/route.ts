import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/admin-auth";
import { logAdminClinicMutation } from "@/lib/admin-audit";
import {
  ADJUST_DUPLICATE_WINDOW_MS,
  ADJUST_REFERENCE_PREFIX,
  MAX_ADJUST_ABS_CENTS,
} from "@/lib/ai-billing/topes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Clave de idempotencia que manda la pantalla: un UUID por modal abierto. */
const REQUEST_ID_RE = /^[0-9a-f-]{8,64}$/i;

// Ajuste manual del saldo (MXN cents) de una clínica. amountCents puede ser
// positivo (abono) o negativo (cargo). Atómico, mismo patrón que chargeUsage
// (src/lib/ai-billing/wallet.ts): upsert del monedero + asiento en el libro
// mayor (type ADJUSTMENT, source ADMIN) con balanceAfterCents consistente.
//
// CANDADO. Mueve dinero y antes no era idempotente: un doble clic aplicaba
// dos ajustes. El cobro por Stripe se protege por `gatewayRef`; aquí, dos
// capas dentro de la MISMA transacción, en serie por clínica
// (pg_advisory_xact_lock), para que dos peticiones simultáneas no se cuelen
// entre la comprobación y el asiento:
//   1. `requestId` de la pantalla, guardado en `reference` del asiento. La
//      misma petición repetida (reintento, doble clic que se saltó el botón)
//      devuelve el asiento ya hecho, sin aplicar nada: 200 `repeated`. La
//      misma clave con otro importe u otra nota es un error (409).
//   2. Un ajuste IDÉNTICO (misma clínica, importe y nota) en la ventana de
//      ADJUST_DUPLICATE_WINDOW_MS se rechaza con 409 aunque venga sin
//      requestId o con otro (una pestaña vieja). Dos cortesías iguales a
//      propósito caben fuera de la ventana o con otra nota.
//
// Y nunca se crea un monedero en negativo: sin monedero, un ajuste negativo
// se rechaza (409 SIN_MONEDERO). Con monedero, dejar el saldo en negativo
// sigue permitido (es una deuda); la pantalla avisa y pide confirmación.
export async function POST(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
  const amountCents = Math.round(Number(body?.amountCents));
  const note =
    typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  const requestId =
    typeof body?.requestId === "string" && REQUEST_ID_RE.test(body.requestId.trim())
      ? body.requestId.trim()
      : null;
  const reference = requestId ? `${ADJUST_REFERENCE_PREFIX}${requestId}` : null;

  if (!clinicId) return NextResponse.json({ error: "clinicId requerido" }, { status: 400 });
  if (!Number.isFinite(amountCents) || amountCents === 0) {
    return NextResponse.json({ error: "amountCents debe ser un entero distinto de 0" }, { status: 400 });
  }
  if (Math.abs(amountCents) > MAX_ADJUST_ABS_CENTS) {
    return NextResponse.json(
      { error: `amountCents excede el tope de ±$${MAX_ADJUST_ABS_CENTS / 100} MXN por ajuste` },
      { status: 400 },
    );
  }

  try {
    // La clínica debe existir (multi-tenant: no crear monederos huérfanos).
    const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { id: true } });
    if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

    const result = await prisma.$transaction(async (tx) => {
      // Un ajuste a la vez por clínica, hasta que la transacción termine.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-wallet-adjust:${clinicId}`}))`;

      // Capa 1: la misma petición, ya aplicada.
      if (reference) {
        const previo = await tx.aiWalletTransaction.findFirst({
          where: { clinicId, reference },
          select: { id: true, amountCents: true, balanceAfterCents: true, note: true },
        });
        // La clave es de UN ajuste: reutilizada con otro importe u otra nota
        // no se aplica ni se da por hecha (el admin creería que entró).
        if (previo && (previo.amountCents !== amountCents || previo.note !== note)) {
          return { kind: "key-reused" as const, previousAmountCents: previo.amountCents };
        }
        if (previo) {
          return {
            kind: "repeated" as const,
            balanceAfterCents: previo.balanceAfterCents,
            transactionId: previo.id,
          };
        }
      }

      // Capa 2: un ajuste idéntico hace un momento.
      const reciente = await tx.aiWalletTransaction.findFirst({
        where: {
          clinicId,
          type: "ADJUSTMENT",
          source: "ADMIN",
          amountCents,
          note,
          createdAt: { gte: new Date(Date.now() - ADJUST_DUPLICATE_WINDOW_MS) },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      });
      if (reciente) return { kind: "duplicate" as const, previousAt: reciente.createdAt };

      // Sin monedero no se crea uno en negativo.
      const existing = await tx.aiWallet.findUnique({ where: { clinicId }, select: { id: true } });
      if (!existing && amountCents < 0) return { kind: "no-wallet" as const };

      const wallet = await tx.aiWallet.upsert({
        where: { clinicId },
        create: { clinicId, balanceCents: amountCents },
        update: { balanceCents: { increment: amountCents } },
      });
      const txn = await tx.aiWalletTransaction.create({
        data: {
          clinicId,
          type: "ADJUSTMENT",
          amountCents,
          balanceAfterCents: wallet.balanceCents,
          source: "ADMIN",
          reference,
          note,
        },
      });
      return { kind: "applied" as const, balanceAfterCents: wallet.balanceCents, transactionId: txn.id };
    });

    if (result.kind === "duplicate") {
      const hace = Math.max(1, Math.round((Date.now() - result.previousAt.getTime()) / 1000));
      return NextResponse.json(
        {
          error: `Ya se aplicó un ajuste idéntico hace ${hace} s. Si es otro ajuste, cambia la nota o espera ${Math.round(ADJUST_DUPLICATE_WINDOW_MS / 60_000)} min.`,
          code: "AJUSTE_DUPLICADO",
          previousAt: result.previousAt.toISOString(),
        },
        { status: 409 },
      );
    }
    if (result.kind === "key-reused") {
      return NextResponse.json(
        {
          error: `Desde esta ventana ya se aplicó un ajuste de ${(result.previousAmountCents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" })}. Revisa el saldo antes de repetir; si hace falta otro ajuste, cierra y vuelve a abrir «Ajustar saldo».`,
          code: "CLAVE_REUTILIZADA",
        },
        { status: 409 },
      );
    }
    if (result.kind === "no-wallet") {
      return NextResponse.json(
        {
          error: "La clínica no tiene monedero de IA: no se crea uno con saldo negativo. Abona primero.",
          code: "SIN_MONEDERO",
        },
        { status: 409 },
      );
    }
    if (result.kind === "repeated") {
      return NextResponse.json(
        {
          ok: true,
          repeated: true,
          clinicId,
          amountCents,
          balanceAfterCents: result.balanceAfterCents,
          transactionId: result.transactionId,
        },
        { status: 200 },
      );
    }

    await logAdminClinicMutation({
      req, admin: admin.user, clinicId,
      entityType: "ai-wallet", entityId: clinicId, action: "update",
      after: {
        op: "adjust",
        amountCents,
        balanceAfterCents: result.balanceAfterCents,
        transactionId: result.transactionId,
        requestId,
        note,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        clinicId,
        amountCents,
        balanceAfterCents: result.balanceAfterCents,
        transactionId: result.transactionId,
      },
      { status: 201 },
    );
  } catch (err: any) {
    console.error("[admin/ai-billing/adjust POST]", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Error" }, { status: 500 });
  }
}
