// GET /api/consent/preview — la hoja con la que arranca «Nuevo consentimiento».
//
// SIN plantilla es la HOJA EN BLANCO: la cabecera (paciente, CURP, doctor,
// cédula, especialidad, clínica, logo, fecha) y el aviso de lo que falta, con el
// texto vacío. Así la abre el panel siempre, igual que la nota de evolución: una
// clínica sin plantillas escribe su carta igual. La plantilla es un botón dentro
// del editor, y al pulsarlo se pide esto mismo CON `templateId`.
//
// Con plantilla, el texto que se generaría, para editarlo antes de crear. Ese texto
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
import { buildConsentContent, fillConsentTemplate, findConsentTemplate } from "@/lib/consent/templates";
import { resolveClinicConsentTemplate } from "@/lib/consent/clinic-templates";
// Único cálculo de edad del repo (lógica de cumpleaños, no resta de años): un
// off-by-one aquí saldría impreso en un documento legal.
import { calculateAge } from "@/lib/pediatrics/age";
import { missingConsentData } from "@/lib/consent/document-data";
import { consentTimeZone } from "@/lib/consent/dates";
import { encabezadoDeCarta } from "@/lib/consent/documento";

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
  // Plantilla de la clínica (DocumentTemplate kind CONSENTIMIENTO). Es el camino
  // de la pantalla; `procedureKey` se conserva para quien aún llame al catálogo.
  const templateId = (sp.get("templateId") ?? "").trim();
  const doctorId = (sp.get("doctorId") ?? "").trim();
  const signerName = (sp.get("signerName") ?? "").trim();
  const signerRelation = (sp.get("signerRelation") ?? "").trim();

  const template = findConsentTemplate(procedureKey);
  // Solo el paciente es obligatorio. Sin plantilla ni clave, hoja en blanco.
  if (!patientId) {
    return NextResponse.json({ error: "Faltan datos para generar la carta." }, { status: 400 });
  }
  // Acotada a la clínica de la sesión: el id de una plantilla ajena da 404.
  const clinicTemplate = templateId
    ? await resolveClinicConsentTemplate(ctx.clinicId, templateId)
    : null;
  if (templateId && !clinicTemplate) {
    return NextResponse.json({ error: "La plantilla no existe en esta clínica." }, { status: 404 });
  }

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
    // dob y patientNumber: la carta identifica al paciente con su edad y su
    // número de expediente, como se firma en la práctica mexicana.
    // curp y curpStatus: el CURP va en la carta, y un paciente extranjero no
    // tiene CURP que "falte".
    select: {
      firstName: true, lastName: true, dob: true, patientNumber: true,
      curp: true, curpStatus: true,
    },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const hidden = await assertPatientVisible(patientId, {
    userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  const [clinic, doctor] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      // timezone: la vista previa tiene que fechar EXACTAMENTE igual que el POST
      // que guarda la carta. Si aquí faltara, el doctor revisaría un día y el
      // paciente firmaría otro.
      // logoUrl y phone no entran en el texto: van a la cabecera de la hoja.
      select: { name: true, address: true, city: true, timezone: true, logoUrl: true, phone: true },
    }),
    prisma.user.findFirst({
      where: { id: doctorId || ctx.userId, clinicId: ctx.clinicId, isActive: true },
      // `especialidad` = la de Equipo. `specialty` es el módulo del panel: no va.
      select: {
        firstName: true, lastName: true,
        cedulaProfesional: true, cedulaEspecialidad: true, especialidad: true,
      },
    }),
  ]);

  const vars = {
    fullIdentification: true,
    clinicName: clinic?.name ?? "",
    clinicAddress: clinic?.address ?? null,
    clinicCity: clinic?.city ?? null,
    timezone: clinic?.timezone ?? null,
    patientName: `${patient.firstName} ${patient.lastName}`.trim(),
    patientAge: patient.dob ? calculateAge(patient.dob).years : null,
    patientNumber: patient.patientNumber ?? null,
    patientCurp: patient.curp ?? null,
    doctorName: doctor ? `${doctor.firstName ?? ""} ${doctor.lastName ?? ""}`.trim() : "",
    doctorLicense: doctor?.cedulaProfesional ?? null,
    doctorSpecialtyLicense: doctor?.cedulaEspecialidad ?? null,
    doctorSpecialty: doctor?.especialidad ?? null,
    signerName: signerName || null,
    signerRelation: signerRelation || null,
  };
  const content = clinicTemplate
    ? fillConsentTemplate(clinicTemplate.text, vars)
    : template
      ? buildConsentContent(template.key, vars)
      : "";

  // Lo que falta se dice ANTES de crear la carta, para que el modal lo avise
  // con el enlace a donde se captura. No bloquea: la carta se puede crear igual.
  const missing = missingConsentData({
    clinicAddress: clinic?.address ?? null,
    clinicLogoUrl: clinic?.logoUrl ?? null,
    doctorLicense: doctor?.cedulaProfesional ?? null,
    doctorSpecialty: doctor?.especialidad ?? null,
    patientCurp: patient.curp ?? null,
    patientCurpStatus: patient.curpStatus ?? null,
  });

  // La MISMA cabecera que llevará la carta guardada (`encabezadoDeCarta`), con
  // la fecha de hoy en la zona de la clínica: es la que tendrá al crearse.
  const encabezado = encabezadoDeCarta({
    createdAt: new Date(),
    timeZone: consentTimeZone(clinic?.timezone),
    clinicName: clinic?.name ?? "",
    clinicAddress: clinic?.address ?? null,
    clinicCity: clinic?.city ?? null,
    clinicPhone: clinic?.phone ?? null,
    clinicLogoUrl: clinic?.logoUrl ?? null,
    patientName: vars.patientName,
    patientNumber: patient.patientNumber ?? null,
    patientCurp: patient.curp ?? null,
    patientCurpStatus: patient.curpStatus ?? null,
    doctorName: vars.doctorName,
    doctorLicense: vars.doctorLicense,
    doctorSpecialtyLicense: vars.doctorSpecialtyLicense,
    doctorSpecialty: vars.doctorSpecialty,
  });

  return NextResponse.json({
    // Vacíos en la hoja en blanco: no salió de ninguna plantilla.
    templateId: clinicTemplate ? templateId : null,
    procedure: clinicTemplate?.name ?? template?.label ?? "",
    content,
    missing,
    encabezado,
  });
}
