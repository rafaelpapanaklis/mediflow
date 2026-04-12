import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const cookieStore = cookies();
  const activeClinicId = cookieStore.get("activeClinicId")?.value;
  if (activeClinicId) {
    const u = await prisma.user.findFirst({ where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true }, include: { clinic: true } });
    if (u) return u;
  }
  return prisma.user.findFirst({ where: { supabaseId: user.id, isActive: true }, include: { clinic: true }, orderBy: { createdAt: "asc" } });
}

export async function GET(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patientId = req.nextUrl.searchParams.get("patientId");
  if (!patientId) return NextResponse.json({ error: "patientId required" }, { status: 400 });
  const records = await prisma.medicalRecord.findMany({
    where: { clinicId: dbUser.clinicId, patientId },
    include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { visitDate: "desc" },
  });
  return NextResponse.json(records);
}

export async function POST(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();

  // Verify patient belongs to this clinic
  const patient = await prisma.patient.findFirst({
    where: { id: body.patientId, clinicId: dbUser.clinicId },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const record = await prisma.medicalRecord.create({
    data: { clinicId: dbUser.clinicId, patientId: body.patientId, doctorId: dbUser.id,
      visitDate: new Date(), subjective: body.subjective, objective: body.objective,
      assessment: body.assessment, plan: body.plan, diagnoses: body.diagnoses,
      vitals: body.vitals, specialtyData: body.specialtyData },
    include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
  });

  // ── Auto-create draft invoice from procedures (if any had prices) ──────────
  let draftInvoice = null;
  if (body.autoInvoice && Array.isArray(body.specialtyData?.procedures) && body.specialtyData.procedures.length > 0) {
    try {
      const procedures = body.specialtyData.procedures as Array<{ id?: string; name: string; price: number; quantity: number }>;
      const validProcs = procedures.filter(p => p.name && typeof p.price === "number" && p.price > 0);

      if (validProcs.length > 0) {
        const items = validProcs.map(p => ({
          description: p.name,
          quantity: p.quantity || 1,
          unitPrice: p.price,
          total: (p.quantity || 1) * p.price,
        }));
        const subtotal = items.reduce((s, i) => s + i.total, 0);

        // Generate invoice number (clinic-scoped)
        const lastInvoice = await prisma.invoice.findFirst({
          where: { clinicId: dbUser.clinicId },
          orderBy: { createdAt: "desc" },
          select: { invoiceNumber: true },
        });
        const lastNum = lastInvoice?.invoiceNumber ? parseInt(lastInvoice.invoiceNumber.replace(/\D/g, "")) || 0 : 0;
        const invoiceNumber = `MF-${String(lastNum + 1).padStart(4, "0")}`;

        draftInvoice = await prisma.invoice.create({
          data: {
            clinicId: dbUser.clinicId,
            patientId: body.patientId,
            invoiceNumber,
            items: items as any,
            subtotal,
            discount: 0,
            total: subtotal,
            paid: 0,
            balance: subtotal,
            status: "DRAFT",
            notes: `Auto-generada desde expediente clínico del ${new Date().toLocaleDateString("es-MX")}`,
          },
        });
      }
    } catch (err) {
      console.error("Error creating draft invoice:", err);
      // Don't fail the clinical record creation if invoice fails
    }
  }

  revalidatePath("/dashboard/clinical");
  revalidatePath("/dashboard/patients");
  revalidatePath("/dashboard/billing");
  return NextResponse.json({ ...record, draftInvoice }, { status: 201 });
}
