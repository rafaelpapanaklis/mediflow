// GET /api/consent/preview — el texto que se generaría, para editarlo antes de crear.
//
// El modal de alta enseña la carta ya redactada y deja modificarla. Ese texto
// se pide AQUÍ en vez de armarlo en el navegador por una razón concreta: así lo
// que el doctor ve es, carácter por carácter, lo que produciría el servidor. Si
// el cliente tuviera su propia copia del generador, bastaría con que una de las
// dos cambiara para que el paciente firmara algo distinto de lo que se revisó.
//
// De paso, el nombre de la clínica, su domicilio y la cédula del profesional no
// tienen que viajar al bundle del navegador para nada.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { buildConsentContent, findConsentTemplate } from "@/lib/consent/templates";
// Único cálculo de edad del repo (lógica de cumpleaños, no resta de años): un
// off-by-one aquí saldría impreso en un documento legal.
import { calculateAge } from "@/lib/pediatrics/age";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, 60);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "consents.create");
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  const patientId = sp.get("patientId") ?? "";
  const procedureKey = (sp.get("procedureKey") ?? "").trim();
  const doctorId = (sp.get("doctorId") ?? "").trim();
  const signerName = (sp.get("signerName") ?? "").trim();
  const signerRelation = (sp.get("signerRelation") ?? "").trim();

  const template = findConsentTemplate(procedureKey);
  if (!patientId || !template) {
    return NextResponse.json({ error: "Faltan datos para generar la carta." }, { status: 400 });
  }

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
    // dob y patientNumber: la carta identifica al paciente con su edad y su
    // número de expediente, como se firma en la práctica mexicana.
    select: { firstName: true, lastName: true, dob: true, patientNumber: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const hidden = await assertPatientVisible(patientId, {
    userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  const [clinic, doctor] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { name: true, address: true, city: true },
    }),
    prisma.user.findFirst({
      where: { id: doctorId || ctx.userId, clinicId: ctx.clinicId, isActive: true },
      select: { firstName: true, lastName: true, cedulaProfesional: true },
    }),
  ]);

  const content = buildConsentContent(template.key, {
    clinicName: clinic?.name ?? "",
    clinicAddress: clinic?.address ?? null,
    clinicCity: clinic?.city ?? null,
    patientName: `${patient.firstName} ${patient.lastName}`.trim(),
    patientAge: patient.dob ? calculateAge(patient.dob).years : null,
    patientNumber: patient.patientNumber ?? null,
    doctorName: doctor ? `${doctor.firstName ?? ""} ${doctor.lastName ?? ""}`.trim() : "",
    doctorLicense: doctor?.cedulaProfesional ?? null,
    signerName: signerName || null,
    signerRelation: signerRelation || null,
  });

  return NextResponse.json({ procedure: template.label, content });
}
