import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const VALID_TYPES = new Set(["ACCESS", "RECTIFICATION", "CANCELLATION", "OPPOSITION"]);
const PRIVACY_INBOX = process.env.PRIVACY_INBOX_EMAIL ?? "privacidad@dalecontrol.com";

/**
 * POST /api/arco/request — solicitudes ARCO bajo LFPDPPP.
 *
 * Body:
 *   {
 *     type: "ACCESS"|"RECTIFICATION"|"CANCELLATION"|"OPPOSITION",
 *     reason: string,
 *     email: string,
 *     patientId?: string  // opcional, si el paciente conoce su id
 *   }
 *
 * Multi-tenant:
 *  - Si patientId viene, validamos contra patients y heredamos su
 *    clinicId. La solicitud queda scoped a esa clínica.
 *  - Si no viene patientId, la solicitud queda con clinicId=null
 *    (anónima, gestionada por el equipo de privacidad de DaleControl,
 *    no por una clínica específica).
 *  - NUNCA aceptamos clinicId del request body.
 *
 * Endpoint público (sin auth) porque las solicitudes ARCO se reciben
 * desde el aviso de privacidad. Rate-limited para evitar spam.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 5); // 5 solicitudes por minuto por IP
  if (rl) return rl;

  let body: { type?: string; reason?: string; email?: string; patientId?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const type = String(body.type ?? "").toUpperCase();
  if (!VALID_TYPES.has(type)) {
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }
  const reason = String(body.reason ?? "").trim();
  if (reason.length < 10) {
    return NextResponse.json({ error: "reason_too_short" }, { status: 400 });
  }
  if (reason.length > 4000) {
    return NextResponse.json({ error: "reason_too_long" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "email_invalid" }, { status: 400 });
  }

  // Si llega patientId, validamos pertenencia y heredamos clinicId.
  // NUNCA confiamos en clinicId del request body.
  //
  // B3 (auditoría 30-sep-2026): sin oráculo. Antes un patientId inexistente daba
  // 404 y uno con otro correo 403: se podía comprobar si un paciente existe en
  // alguna clínica y cuál es (o no es) su correo. Ahora los tres casos —paciente
  // y correo coinciden, paciente que no existe, correo que no coincide— reciben
  // el MISMO 201. Solo el primero queda asignado a la clínica; los otros dos
  // caen como anónimos (los atiende el equipo de privacidad de la plataforma,
  // que verifica la identidad) y el patientId declarado viaja solo en el aviso
  // interno.
  let clinicId: string | null = null;
  let patientId: string | null = null;
  const patientIdDeclarado: string | null =
    typeof body.patientId === "string" && body.patientId.trim() ? body.patientId.trim().slice(0, 64) : null;
  if (patientIdDeclarado) {
    const patient = await prisma.patient.findUnique({
      where: { id: patientIdDeclarado },
      select: { id: true, clinicId: true, email: true },
    });
    // Si el paciente tiene correo registrado, el del request tiene que ser ese
    // (evita pedir ARCO de otro conociendo solo el id).
    const coincide = patient && (!patient.email || patient.email.toLowerCase() === email);
    if (patient && coincide) {
      clinicId = patient.clinicId;
      patientId = patient.id;
    }
  }

  const request = await prisma.arcoRequest.create({
    data: {
      clinicId,
      patientId,
      type: type as "ACCESS" | "RECTIFICATION" | "CANCELLATION" | "OPPOSITION",
      reason,
      email,
      status: "PENDING",
    },
  });

  // Notificación al equipo de privacidad. sendEmail no tira excepciones,
  // así que si falla, la solicitud queda persistida en DB igual.
  await sendEmail({
    to: PRIVACY_INBOX,
    subject: `[ARCO ${type}] Nueva solicitud · ${email}`,
    html: `
      <p>Se recibió una nueva solicitud ARCO:</p>
      <ul>
        <li><b>ID:</b> ${request.id}</li>
        <li><b>Tipo:</b> ${type}</li>
        <li><b>Email solicitante:</b> ${email}</li>
        <li><b>Clínica:</b> ${clinicId ?? "anónima (sin patientId)"}</li>
        <li><b>PatientId:</b> ${patientId ?? "—"}</li>
        ${!patientId && patientIdDeclarado
          ? `<li><b>PatientId declarado (NO verificado — no existe o el correo no coincide):</b> ${patientIdDeclarado.replace(/[^A-Za-z0-9_-]/g, "")}</li>`
          : ""}
      </ul>
      <p><b>Razón:</b></p>
      <p style="white-space:pre-wrap;">${reason.replace(/[<>]/g, "")}</p>
      <p>Plazo legal de respuesta: 20 días hábiles (LFPDPPP art. 32).</p>
    `,
  });

  return NextResponse.json({
    ok: true,
    requestId: request.id,
    eta: "20 días hábiles (LFPDPPP art. 32)",
  }, { status: 201 });
}
