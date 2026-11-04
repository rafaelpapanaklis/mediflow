import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createConnectAccount, createOnboardingLink } from "@/lib/stripe-connect";
import { logAudit, extractAuditMeta } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import getStripe from "@/lib/stripe";

/**
 * Roles que pueden tener una cuenta Stripe Connect propia: el doctor (cobros de su teleconsulta) y el
 * ADMIN/dueño (además, el destino de los pagos del portal del paciente, ver online-payment.ts).
 * Recepción y solo lectura no reciben dinero (ola 2b, lead 1).
 */
const ROLES_CON_CUENTA_CONNECT = ["SUPER_ADMIN", "ADMIN", "DOCTOR"];

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const body = await req.json().catch(() => ({}));

    // Cada quien liga SOLO su cuenta y recibe SOLO su link (ola 2b, lead 2): el link de alta es el que
    // fija la identidad y la cuenta bancaria, así que nadie —tampoco un ADMIN ni el dueño— lo pide por otro.
    if (body?.doctorId != null && body.doctorId !== ctx.userId) {
      return NextResponse.json({ error: "Solo puedes conectar tu propia cuenta de cobro." }, { status: 403 });
    }
    // «Ver como clínica» de /admin entra con la sesión del dueño: elegir a dónde va su dinero no es soporte.
    if (ctx.suplantacion) {
      return NextResponse.json({ error: "No disponible en «Ver como clínica»." }, { status: 403 });
    }
    if (!ROLES_CON_CUENTA_CONNECT.includes(ctx.role)) {
      return NextResponse.json({ error: "Tu rol no puede conectar una cuenta de cobro." }, { status: 403 });
    }
    // Un ADMIN puede acabar siendo el destino de los cobros del portal (online-payment.ts): como la cuenta de
    // cobro de Mercado Pago, eso pide «Editar configuración» (revisión t8, M2). El doctor liga la suya para su
    // teleconsulta y no la necesita.
    if (ctx.role === "ADMIN") {
      const denied = denyIfMissingPermission(ctx, "settings.edit");
      if (denied) return denied;
    }

    const doctor = await prisma.user.findFirst({
      where: { id: ctx.userId, clinicId: ctx.clinicId },
      select: { id: true, firstName: true, lastName: true, email: true, stripeAccountId: true },
    });

    if (!doctor) {
      return NextResponse.json({ error: "Doctor no encontrado" }, { status: 404 });
    }

    let accountId = doctor.stripeAccountId;

    if (!accountId) {
      const creada = await createConnectAccount(
        doctor.email,
        `${doctor.firstName} ${doctor.lastName}`
      );
      // Solo si sigue vacía: dos clics a la vez no se pisan la cuenta.
      const { count } = await prisma.user.updateMany({
        where: { id: doctor.id, clinicId: ctx.clinicId, stripeAccountId: null },
        data: { stripeAccountId: creada },
      });
      if (count === 1) {
        accountId = creada;
        const { ipAddress, userAgent } = extractAuditMeta(req);
        await logAudit({
          clinicId: ctx.clinicId,
          userId: ctx.userId,
          entityType: "user",
          entityId: doctor.id,
          action: "update",
          changes: { stripeAccountId: { before: null, after: creada } },
          ipAddress,
          userAgent,
        });
      } else {
        const actual = await prisma.user.findFirst({
          where: { id: doctor.id, clinicId: ctx.clinicId },
          select: { stripeAccountId: true },
        });
        accountId = actual?.stripeAccountId ?? null;
        if (!accountId) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
      }
    }

    const url = await createOnboardingLink(accountId, ctx.clinicId);

    return NextResponse.json({ url });
  } catch (error) {
    console.error("Error creating Stripe Connect link:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    if (!ctx.user.stripeAccountId) {
      return NextResponse.json({ onboarded: false });
    }

    const stripe = getStripe();
    const account = await stripe.accounts.retrieve(ctx.user.stripeAccountId);

    await prisma.user.update({
      where: { id: ctx.userId },
      data: { stripeOnboarded: account.charges_enabled },
    });

    return NextResponse.json({
      onboarded: account.charges_enabled,
      accountId: ctx.user.stripeAccountId,
    });
  } catch (error) {
    console.error("Error checking Stripe Connect status:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
