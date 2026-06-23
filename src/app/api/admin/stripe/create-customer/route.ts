import { isAdminAuthed } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";


export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const stripe = getStripeSafe();
  if (!stripe) return NextResponse.json(stripeUnavailableResponse(), { status: 503 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const clinicId = String(body?.clinicId ?? "");
  if (!clinicId) return NextResponse.json({ error: "clinicId requerido" }, { status: 400 });

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    include: { users: { select: { email: true }, take: 1 } },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  // Si ya existe Stripe customer, devolverlo.
  if (clinic.stripeCustomerId) {
    const customer = await stripe.customers.retrieve(clinic.stripeCustomerId);
    return NextResponse.json({ customer, reused: true });
  }

  const email = clinic.email || clinic.users[0]?.email;
  const customer = await stripe.customers.create({
    email: email ?? undefined,
    name: clinic.name,
    metadata: { clinicId: clinic.id },
  });

  await prisma.clinic.update({
    where: { id: clinic.id },
    data:  { stripeCustomerId: customer.id },
  });

  return NextResponse.json({ customer, reused: false });
}
