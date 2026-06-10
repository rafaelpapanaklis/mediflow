import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PatientPortalClient } from "./portal-client";
import { dateISOInTz, timeHHMMInTz, durationMinutes } from "@/lib/agenda/legacy-helpers";
import { signMaybeUrls } from "@/lib/storage";
import type { Metadata } from "next";

interface Props { params: { token: string } }

export const metadata: Metadata = { title: "Mi Portal — DaleControl" };

export default async function PatientPortalPage({ params }: Props) {
  // Minimización de datos (NOM-024/LFPDPPP): select explícito de SOLO lo que
  // el portal renderiza. Sin spreads del modelo completo — eso filtraba al
  // HTML público notes internas, SOAP completo (aun con isPrivate), CURP/RFC,
  // portalToken y tokens de telemedicina.
  const patient = await prisma.patient.findFirst({
    where: { portalToken: params.token },
    select: {
      firstName: true,
      lastName: true,
      patientNumber: true,
      email: true,
      phone: true,
      dob: true,
      bloodType: true,
      allergies: true,
      chronicConditions: true,
      // Solo para validar expiración server-side; NO se serializa al cliente.
      portalTokenExpiry: true,
      clinic: {
        select: {
          id: true, name: true, logoUrl: true, phone: true,
          specialty: true, address: true, city: true, timezone: true,
        },
      },
      appointments: {
        orderBy: { startsAt: "desc" },
        take: 20,
        select: {
          id: true, type: true, status: true, startsAt: true, endsAt: true,
          doctor: { select: { firstName: true, lastName: true, color: true } },
        },
      },
      records: {
        orderBy: { visitDate: "desc" },
        take: 10,
        select: {
          id: true, visitDate: true,
          doctor: { select: { firstName: true, lastName: true } },
        },
      },
      invoices: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true, status: true, total: true, paid: true,
          balance: true, createdAt: true,
        },
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

  // El bucket patient-files es privado: las URLs guardadas se firman
  // on-demand con TTL corto (como /api/consent), todas en UN round-trip.
  const signed = await signMaybeUrls([
    ...patient.files.map((f) => f.url),
    ...patient.consentForms.map((c) => c.signatureUrl),
  ]);
  const fileUrls = signed.slice(0, patient.files.length);
  const signatureUrls = signed.slice(patient.files.length);

  const tz = patient.clinic.timezone;
  const serialized = {
    firstName: patient.firstName,
    lastName: patient.lastName,
    patientNumber: patient.patientNumber,
    email: patient.email,
    phone: patient.phone,
    bloodType: patient.bloodType,
    allergies: patient.allergies,
    chronicConditions: patient.chronicConditions,
    dob: patient.dob?.toISOString() ?? null,
    clinic: patient.clinic,
    appointments: patient.appointments.map(a => ({
      id:           a.id,
      type:         a.type,
      status:       a.status,
      date:         dateISOInTz(a.startsAt, tz),
      startTime:    timeHHMMInTz(a.startsAt, tz),
      endTime:      timeHHMMInTz(a.endsAt,   tz),
      durationMins: durationMinutes(a.startsAt, a.endsAt),
      startsAt:     a.startsAt.toISOString(),
      endsAt:       a.endsAt.toISOString(),
      doctor:       a.doctor,
    })),
    records: patient.records.map(r => ({
      id:        r.id,
      visitDate: r.visitDate instanceof Date ? r.visitDate.toISOString() : String(r.visitDate),
      doctor:    r.doctor,
    })),
    invoices: patient.invoices.map(i => ({
      id:        i.id,
      status:    i.status,
      total:     i.total,
      paid:      i.paid,
      balance:   i.balance,
      createdAt: i.createdAt.toISOString(),
    })),
    files: patient.files.map((f, idx) => ({
      id:        f.id,
      name:      f.name,
      url:       fileUrls[idx] || "",
      category:  f.category,
      mimeType:  f.mimeType,
      notes:     f.notes,
      createdAt: f.createdAt.toISOString(),
      takenAt:   f.takenAt?.toISOString() ?? null,
    })),
    consentForms: patient.consentForms.map((c, idx) => ({
      id:           c.id,
      procedure:    c.procedure,
      content:      c.content,
      signedAt:     c.signedAt?.toISOString() ?? null,
      expiresAt:    c.expiresAt.toISOString(),
      signatureUrl: signatureUrls[idx] || null,
    })),
  };

  return <PatientPortalClient patient={serialized as any} />;
}
