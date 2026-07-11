import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";

export const dynamic = "force-dynamic";

async function getCtx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  if (activeClinicId) {
    const u = await prisma.user.findFirst({ where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true } });
    if (u) return { clinicId: u.clinicId, userId: u.id };
  }
  const dbUser = await prisma.user.findFirst({ where: { supabaseId: user.id, isActive: true }, orderBy: { createdAt: "asc" } });
  return dbUser ? { clinicId: dbUser.clinicId, userId: dbUser.id } : null;
}

// GET /api/invoices/by-appointment/[appointmentId]
// Devuelve la factura vinculada a una cita (Invoice.appointmentId @unique),
// con sus pagos, para abrir el cobro inline desde la agenda sin navegar al
// perfil. Multi-tenant: scope por clinicId desde la sesión (la cita y la
// factura deben pertenecer a la clínica activa). 404 si la cita no tiene
// factura todavía — el caller muestra el aviso de "genera la factura desde
// el expediente".
export async function GET(_req: NextRequest, { params }: { params: { appointmentId: string } }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { clinicId } = ctx;

  // La cita debe ser de esta clínica (evita fuga cross-tenant del invoiceId).
  const appt = await prisma.appointment.findFirst({
    where: { id: params.appointmentId, clinicId },
    select: { id: true },
  });
  if (!appt) return NextResponse.json({ error: "appointment_not_found" }, { status: 404 });

  const invoice = await prisma.invoice.findFirst({
    where: { appointmentId: params.appointmentId, clinicId },
    include: {
      payments: { orderBy: { paidAt: "asc" } },
      patient:  { select: { rfcPaciente: true, razonSocialPac: true, regimenFiscalPac: true, cpPaciente: true } },
    },
  });
  if (!invoice) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });

  return NextResponse.json({ invoice });
}
