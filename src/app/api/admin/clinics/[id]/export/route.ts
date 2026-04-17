import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import archiver from "archiver";
import { PassThrough } from "node:stream";

function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}

function toCsv(rows: Record<string, any>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const body = rows.map(r => headers.map(h => csvEscape(r[h])).join(",")).join("\n");
  return headers.join(",") + "\n" + body;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clinicId = params.id;
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, name: true, slug: true },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  const [patients, appointments, records, invoices, payments, files] = await Promise.all([
    prisma.patient.findMany({
      where: { clinicId },
      select: {
        id: true, patientNumber: true, firstName: true, lastName: true, email: true, phone: true,
        dob: true, gender: true, status: true, createdAt: true, notes: true,
        insuranceProvider: true, insurancePolicy: true, rfcPaciente: true,
      },
    }),
    prisma.appointment.findMany({
      where: { clinicId },
      select: {
        id: true, patientId: true, doctorId: true, type: true, date: true,
        startTime: true, endTime: true, status: true, mode: true, price: true, isPaid: true,
        room: true, notes: true, createdAt: true,
      },
    }),
    prisma.medicalRecord.findMany({
      where: { clinicId },
      select: {
        id: true, patientId: true, doctorId: true, visitDate: true,
        subjective: true, objective: true, assessment: true, plan: true,
        diagnoses: true, vitals: true, specialtyData: true, createdAt: true,
      },
    }),
    prisma.invoice.findMany({
      where: { clinicId },
      select: {
        id: true, patientId: true, invoiceNumber: true, subtotal: true, discount: true,
        total: true, paid: true, balance: true, status: true, paymentMethod: true,
        createdAt: true, paidAt: true,
      },
    }),
    prisma.payment.findMany({
      where: { invoice: { clinicId } },
      select: {
        id: true, invoiceId: true, amount: true, method: true, reference: true,
        notes: true, paidAt: true,
      },
    }),
    prisma.patientFile.findMany({
      where: { clinicId },
      select: {
        id: true, patientId: true, name: true, category: true, mimeType: true,
        size: true, url: true, createdAt: true, notes: true, doctorNotes: true,
      },
    }),
  ]);

  const archive = archiver("zip", { zlib: { level: 9 } });
  const pass = new PassThrough();
  archive.pipe(pass);

  const manifest = {
    clinicId: clinic.id,
    clinicName: clinic.name,
    exportedAt: new Date().toISOString(),
    counts: {
      patients: patients.length,
      appointments: appointments.length,
      records: records.length,
      invoices: invoices.length,
      payments: payments.length,
      files: files.length,
    },
  };

  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
  archive.append(toCsv(patients as any),            { name: "patients.csv" });
  archive.append(toCsv(appointments as any),        { name: "appointments.csv" });
  archive.append(JSON.stringify(records, null, 2),   { name: "medical-records.json" });
  archive.append(toCsv(invoices as any),            { name: "invoices.csv" });
  archive.append(toCsv(payments as any),            { name: "payments.csv" });
  archive.append(toCsv(files as any),               { name: "files-manifest.csv" });

  archive.finalize();

  // Collect into a Buffer (suficiente para clínicas pequeñas/medianas).
  // Para multi-GB habría que stream-piping directo a Response, pero requiere
  // ReadableStream<Uint8Array>; se deja como TODO si el uso lo pide.
  const chunks: Buffer[] = [];
  for await (const chunk of pass) chunks.push(chunk as Buffer);
  const buffer = Buffer.concat(chunks);

  const fname = `mediflow-export-${clinic.slug || clinic.id}-${new Date().toISOString().slice(0, 10)}.zip`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
