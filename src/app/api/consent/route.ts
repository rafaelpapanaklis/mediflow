// Consentimiento informado — lista y alta.
//
// El TEXTO de la carta ya no vive aquí: lo genera `lib/consent/templates` a
// partir del catálogo de nueve procedimientos (riesgos, alternativas, cuidados)
// con la estructura que pide la NOM-004-SSA3-2012 numeral 10.1.1. Antes este
// archivo tenía cinco plantillas cortas embebidas y el paciente firmaba esas,
// mientras el catálogo bueno solo se usaba en una herramienta pública.
//
// Lo que se guarda en `content` es un SNAPSHOT INMUTABLE: exactamente el texto
// que el paciente va a leer y firmar. Si el doctor lo editó en el modal, se
// guarda lo editado. `contentHash` (sha256) permite demostrar después que nadie
// lo cambió.
//
// Multi-tenant: clinicId SIEMPRE de la sesión, nunca del body.

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { logMutation } from "@/lib/audit";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { buildConsentContent, findConsentTemplate } from "@/lib/consent/templates";
// Mismo helper de edad que el preview: la carta creada no puede decir una edad
// distinta de la que el doctor acaba de revisar en el modal.
import { calculateAge } from "@/lib/pediatrics/age";
import { CONSENT_DTO_SELECT, toConsentDTO } from "@/lib/consent/types";
import { consentLinkExpiry, consentPublicUrl, newConsentToken } from "@/lib/consent/link";

// GET /api/consent?patientId=xxx — lista del tab del expediente.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, 60);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "consents.view");
  if (denied) return denied;

  const patientId = new URL(req.url).searchParams.get("patientId");
  if (!patientId) return NextResponse.json({ error: "patientId required" }, { status: 400 });

  // Visibilidad por paciente: sin este gate se leían los consentimientos de un
  // paciente restringido con solo su id.
  const hidden = await assertPatientVisible(patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  const forms = await prisma.consentForm.findMany({
    where: { patientId, clinicId: ctx.clinicId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: CONSENT_DTO_SELECT,
  });

  // Las imágenes de las firmas NO viajan al panel (el DTO solo dice si existen);
  // se ven en el PDF, que las firma on-demand con TTL corto.
  const now = new Date();
  return NextResponse.json(forms.map((f) => toConsentDTO(f, now)));
}

// POST /api/consent — genera la carta con su liga única de firma.
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, 20);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "consents.create");
  if (denied) return denied;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const patientId = typeof body.patientId === "string" ? body.patientId : "";
  const procedureKeyRaw = typeof body.procedureKey === "string" ? body.procedureKey.trim() : "";
  const customContent = typeof body.content === "string" ? body.content.trim() : "";
  const customProcedure = typeof body.procedure === "string" ? body.procedure.trim() : "";
  const doctorIdRaw = typeof body.doctorId === "string" ? body.doctorId.trim() : "";
  const signerName = typeof body.signerName === "string" ? body.signerName.trim() : "";
  const signerRelation = typeof body.signerRelation === "string" ? body.signerRelation.trim() : "";

  const template = findConsentTemplate(procedureKeyRaw);
  if (!patientId) {
    return NextResponse.json({ error: "patientId requerido" }, { status: 400 });
  }
  // O una clave del catálogo, o un texto propio con su nombre de procedimiento.
  if (!template && !(customContent && customProcedure)) {
    return NextResponse.json(
      { error: "Elige un procedimiento del catálogo o escribe el texto y el nombre del acto." },
      { status: 400 },
    );
  }
  if (signerName && !signerRelation) {
    return NextResponse.json(
      { error: "Indica el parentesco o la relación del representante legal con el paciente." },
      { status: 400 },
    );
  }

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
    // dob y patientNumber alimentan la identificación de la carta (edad y
    // número de expediente). Mismos campos que lee /api/consent/preview: el
    // texto que el doctor revisó tiene que ser el que se guarda.
    select: { id: true, firstName: true, lastName: true, dob: true, patientNumber: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  // Visibilidad por paciente: no generar consentimientos sobre un paciente restringido.
  const hidden = await assertPatientVisible(patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  const [clinic, doctor] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { name: true, address: true, city: true },
    }),
    // Estomatólogo responsable: el elegido en el modal o, si no se eligió, quien
    // crea la carta. Se busca dentro de la clínica de la sesión — un id de otra
    // clínica no puede colarse por el body.
    prisma.user.findFirst({
      where: { id: doctorIdRaw || ctx.userId, clinicId: ctx.clinicId, isActive: true },
      select: { id: true, firstName: true, lastName: true, cedulaProfesional: true },
    }),
  ]);
  if (doctorIdRaw && !doctor) {
    return NextResponse.json({ error: "El doctor seleccionado no existe en esta clínica." }, { status: 400 });
  }

  const patientName = `${patient.firstName} ${patient.lastName}`.trim();
  const doctorName = doctor ? `${doctor.firstName ?? ""} ${doctor.lastName ?? ""}`.trim() : "";

  // El texto editado en el modal MANDA: es lo que el doctor revisó y lo que el
  // paciente va a leer. Solo si no viene se genera desde la plantilla.
  const content =
    customContent ||
    buildConsentContent(template!.key, {
      clinicName: clinic?.name ?? "",
      clinicAddress: clinic?.address ?? null,
      clinicCity: clinic?.city ?? null,
      patientName,
      patientAge: patient.dob ? calculateAge(patient.dob).years : null,
      patientNumber: patient.patientNumber ?? null,
      doctorName,
      doctorLicense: doctor?.cedulaProfesional ?? null,
      signerName: signerName || null,
      signerRelation: signerRelation || null,
    });

  const procedure = template?.label ?? customProcedure;
  // Huella del texto EXACTO que se firmará. El PDF la imprime como evidencia de
  // que el documento no se alteró después de la firma.
  const contentHash = createHash("sha256").update(content, "utf8").digest("hex");
  const token = newConsentToken();
  const expiresAt = consentLinkExpiry();

  const form = await prisma.consentForm.create({
    data: {
      clinicId: ctx.clinicId,
      patientId,
      procedure,
      procedureKey: template?.key ?? null,
      content,
      contentHash,
      createdById: ctx.userId,
      doctorId: doctor?.id ?? null,
      signerName: signerName || null,
      signerRelation: signerRelation || null,
      token,
      expiresAt,
    },
    select: CONSENT_DTO_SELECT,
  });

  await logMutation({
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "consent",
    entityId: form.id,
    action: "create",
    after: {
      patientId: form.patientId,
      procedure: form.procedure,
      procedureKey: form.procedureKey,
      doctorId: form.doctorId,
      signerName: form.signerName,
      contentHash,
    },
  });

  const signUrl = consentPublicUrl(token, req.nextUrl.origin);

  return NextResponse.json({ ...toConsentDTO(form), signUrl }, { status: 201 });
}
