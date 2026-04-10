import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createConnectAccount, createOnboardingLink } from "@/lib/stripe-connect";
import getStripe from "@/lib/stripe";

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const doctorId = body.doctorId ?? ctx.userId;

    // Admins can onboard any doctor; doctors can only onboard themselves
    if (!ctx.isAdmin && doctorId !== ctx.userId) {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }

    const doctor = await prisma.user.findFirst({
      where: { id: doctorId, clinicId: ctx.clinicId },
      select: { id: true, firstName: true, lastName: true, email: true, stripeAccountId: true },
    });

    if (!doctor) {
      return NextResponse.json({ error: "Doctor no encontrado" }, { status: 404 });
    }

    let accountId = doctor.stripeAccountId;

    if (!accountId) {
      accountId = await createConnectAccount(
        doctor.email,
        `${doctor.firstName} ${doctor.lastName}`
      );
      await prisma.user.update({
        where: { id: doctor.id },
        data: { stripeAccountId: accountId },
      });
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
