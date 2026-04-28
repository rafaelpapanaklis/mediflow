import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PatientPortalClient } from "./portal-client";
import { dateISOInTz, timeHHMMInTz, durationMinutes } from "@/lib/agenda/legacy-helpers";
import type { Metadata } from "next";

interface Props { params: { token: string } }

export const metadata: Metadata = { title: "Mi Portal — MediFlow" };

export default async function PatientPortalPage({ params }: Props) {
  const patient = await prisma.patient.findFirst({
    where: { portalToken: params.token },
    include: {
      clinic: {
        select: {
          id: true, name: true, logoUrl: true, phone: true,
          specialty: true, address: true, city: true, timezone: true,
        },
      },
      appointments: {
        orderBy: { startsAt: "desc" },
        take: 20,
        include: {
          doctor: { select: { firstName: true, lastName: true, color: true } },
        },
      },
      records: {
        orderBy: { visitDate: "desc" },
        take: 10,
        include: {
          doctor: { select: { firstName: true, lastName: true } },
        },
      },
      invoices: {
        include: { payments: true },
        orderBy: { createdAt: "desc" },
      },
      files: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true, name: true, url: true, category: true,
          mimeType: true, createdAt: true, notes: true, takenAt: true,
        },
      },
      consentForms: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true, procedure: true, signedAt: true,
          expiresAt: true, signatureUrl: true, content: true,
        },
      },
    },
  });

  if (!patient) notFound();

  // Check token not expired
  if (patient.portalTokenExpiry && new Date(patient.portalTokenExpiry) < new Date()) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-white text-center">
        <div>
          <div className="text-5xl mb-4">⏰</div>
          <h1 className="text-2xl font-bold mb-2">Enlace expirado</h1>
          <p className="text-slate-400">Solicita un nuevo enlace a tu clínica.</p>
        </div>
      </div>
    );
  }

  // Serialize dates
  const serialized = {
    ...patient,
    dob: patient.dob?.toISOString() ?? null,
    createdAt: patient.createdAt.toISOString(),
    updatedAt: patient.updatedAt.toISOString(),
    appointments: patient.appointments.map(a => ({
      ...a,
      date:         dateISOInTz(a.startsAt, patient.clinic.timezone),
      startTime:    timeHHMMInTz(a.startsAt, patient.clinic.timezone),
      endTime:      timeHHMMInTz(a.endsAt,   patient.clinic.timezone),
      durationMins: durationMinutes(a.startsAt, a.endsAt),
      startsAt:     a.startsAt.toISOString(),
      endsAt:       a.endsAt.toISOString(),
      createdAt:    a.createdAt.toISOString(),
      updatedAt:    a.updatedAt.toISOString(),
      confirmedAt:  a.confirmedAt?.toISOString() ?? null,
      cancelledAt:  a.cancelledAt?.toISOString() ?? null,
    })),
    records: patient.records.map(r => ({
      ...r,
      visitDate: r.visitDate instanceof Date ? r.visitDate.toISOString() : String(r.visitDate),
      createdAt: r.createdAt.toISOString(),
    })),
    invoices: patient.invoices.map(i => ({
      ...i,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
      payments: i.payments.map(p => ({
        ...p,
        paidAt: p.paidAt instanceof Date ? p.paidAt.toISOString() : String(p.paidAt),
      })),
    })),
    files: patient.files.map(f => ({
      ...f,
      createdAt: (f as any).createdAt?.toISOString() ?? null,
      takenAt: (f as any).takenAt?.toISOString() ?? null,
    })),
    consentForms: patient.consentForms.map(c => ({
      ...c,
      signedAt: c.signedAt?.toISOString() ?? null,
      expiresAt: c.expiresAt.toISOString(),
    })),
  };

  return <PatientPortalClient patient={serialized as any} />;
}
