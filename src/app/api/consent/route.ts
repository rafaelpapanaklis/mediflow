import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";
import { logMutation } from "@/lib/audit";
import { signMaybeUrl } from "@/lib/storage";

const CONSENT_TEMPLATES: Record<string, string> = {
  "Extracción simple": `CONSENTIMIENTO INFORMADO PARA EXTRACCIÓN DENTAL

Yo, [NOMBRE_PACIENTE], autorizo al Dr./Dra. [NOMBRE_DOCTOR] de [NOMBRE_CLINICA] a realizar la extracción del diente indicado.

He sido informado/a sobre:
• El procedimiento consistirá en la extracción del diente bajo anestesia local
• Riesgos: dolor postoperatorio, inflamación, sangrado, infección (poco frecuente), lesión de dientes adyacentes
• Cuidados postoperatorios: no fumar 24h, dieta blanda, no enjuagarse con fuerza las primeras 24h
• Alternativas al tratamiento propuesto

Confirmo que he leído y comprendido esta información, he podido hacer preguntas y acepto el tratamiento.`,

  "Endodoncia": `CONSENTIMIENTO INFORMADO PARA TRATAMIENTO DE CONDUCTOS (ENDODONCIA)

Yo, [NOMBRE_PACIENTE], autorizo al Dr./Dra. [NOMBRE_DOCTOR] de [NOMBRE_CLINICA] a realizar el tratamiento de conductos del diente indicado.

He sido informado/a sobre:
• El procedimiento consiste en eliminar la pulpa del diente y sellar los conductos radiculares
• Puede requerir 1-3 sesiones dependiendo de la complejidad
• Riesgos: dolor postoperatorio 2-5 días, fractura del instrumento (raro), perforación (raro)
• El diente tratado puede requerir corona protésica posterior
• No existe garantía del 100% de éxito

Confirmo que he leído y comprendido esta información y acepto el tratamiento.`,

  "Implante dental": `CONSENTIMIENTO INFORMADO PARA IMPLANTE DENTAL

Yo, [NOMBRE_PACIENTE], autorizo al Dr./Dra. [NOMBRE_DOCTOR] de [NOMBRE_CLINICA] a realizar la colocación de implante dental.

He sido informado/a sobre:
• El implante es un tornillo de titanio que se coloca en el hueso para sustituir la raíz del diente
• El proceso completo dura 3-6 meses (integración ósea)
• Riesgos: infección, fracaso de oseointegración (~5%), lesión de nervio o seno maxilar (poco frecuente)
• No puedo fumar durante el período de cicatrización (afecta el éxito del implante)
• Contraindicaciones: diabetes no controlada, terapia de bifosfonatos, hueso insuficiente

Confirmo que he declarado mi historial médico completo y acepto el tratamiento.`,

  "Ortodoncia": `CONSENTIMIENTO INFORMADO PARA TRATAMIENTO DE ORTODONCIA

Yo, [NOMBRE_PACIENTE] (o tutor legal), autorizo al Dr./Dra. [NOMBRE_DOCTOR] de [NOMBRE_CLINICA] a iniciar el tratamiento de ortodoncia.

He sido informado/a sobre:
• Duración aproximada del tratamiento: según diagnóstico (generalmente 18-36 meses)
• Riesgos: descalcificación del esmalte por higiene deficiente, reabsorción radicular (poco frecuente)
• Es imprescindible mantener una higiene bucal óptima durante todo el tratamiento
• El uso de retenedores posterior al tratamiento es indefinido
• El incumplimiento en citas y uso de aparatos puede prolongar el tratamiento

Confirmo que he comprendido las instrucciones y acepto el tratamiento.`,

  "Blanqueamiento": `CONSENTIMIENTO INFORMADO PARA BLANQUEAMIENTO DENTAL

Yo, [NOMBRE_PACIENTE], autorizo al Dr./Dra. [NOMBRE_DOCTOR] de [NOMBRE_CLINICA] a realizar el blanqueamiento dental.

He sido informado/a sobre:
• El blanqueamiento utiliza peróxido de hidrógeno/carbamida de alta concentración
• Puede causar sensibilidad dental temporal durante y después del tratamiento
• Los resultados son variables y no se garantiza un tono específico
• El resultado no es permanente y depende de los hábitos de consumo (café, tabaco, vino)
• Contraindicaciones: embarazo, lactancia, caries activa, enfermedad periodontal

Confirmo que he comprendido la información y acepto el tratamiento.`,
};

// GET /api/consent?patientId=xxx
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patientId = new URL(req.url).searchParams.get("patientId");
  if (!patientId) return NextResponse.json({ error: "patientId required" }, { status: 400 });

  const forms = await prisma.consentForm.findMany({
    where: { patientId, clinicId: ctx.clinicId },
    orderBy: { createdAt: "desc" },
  });

  const signed = await Promise.all(
    forms.map(async (f) => ({
      ...f,
      signatureUrl: f.signatureUrl ? await signMaybeUrl(f.signatureUrl).catch(() => "") : null,
    })),
  );

  return NextResponse.json(signed);
}

// POST /api/consent — generate consent form with unique token
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { patientId, procedure } = await req.json();
  if (!patientId || !procedure) {
    return NextResponse.json({ error: "patientId y procedure requeridos" }, { status: 400 });
  }

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const clinic = await prisma.clinic.findUnique({
    where:  { id: ctx.clinicId },
    select: { name: true },
  });
  const doctor = await prisma.user.findUnique({
    where:  { id: ctx.userId },
    select: { firstName: true, lastName: true },
  });

  const template = CONSENT_TEMPLATES[procedure] ?? CONSENT_TEMPLATES["Extracción simple"];
  const content  = template
    .replace("[NOMBRE_PACIENTE]", `${patient.firstName} ${patient.lastName}`)
    .replace("[NOMBRE_DOCTOR]",   `${doctor?.firstName ?? ""} ${doctor?.lastName ?? ""}`)
    .replace("[NOMBRE_CLINICA]",  clinic?.name ?? "");

  const token     = randomBytes(20).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const form = await prisma.consentForm.create({
    data: {
      clinicId: ctx.clinicId,
      patientId,
      procedure,
      content,
      token,
      expiresAt,
    },
  });

  await logMutation({
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "consent",
    entityId: form.id,
    action: "create",
    after: { patientId: form.patientId, procedure: form.procedure },
  });

  const signUrl = `${process.env.NEXT_PUBLIC_APP_URL}/consentimiento/${token}`;

  return NextResponse.json({ ...form, signUrl }, { status: 201 });
}

