// POST /api/patients/[id]/portal-invite — invitar a un paciente al portal con
// CUENTA REAL (PatientAccount). Staff-only. La clínica crea/liga la cuenta y el
// paciente define SU propia contraseña desde el correo (reusa el flujo de reset
// /paciente/recuperar). La clínica NUNCA ve la contraseña.
//
// Guard idéntico a /api/portal (staff que PUEDE ver al paciente de su clínica).
// Estados de respuesta { status }:
//   · "invited"        → no existía cuenta: se creó invitada + correo.
//   · "resent"         → existía invitada (sin activar): token nuevo + reenvío.
//   · "already_active" → ya tiene contraseña: NO se reenvía; solo se asegura el link.
//
// TODO el cuerpo va envuelto en try/catch: cualquier fallo de Prisma/email/infra
// responde `{ error }` con status 500 en vez de un cuerpo vacío que reventaría
// el `res.json()` del cliente con "Unexpected end of JSON input".
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { persistentRateLimit } from "@/lib/failban";
import { sendEmail } from "@/lib/email";
import { generateResetToken, sha256 } from "@/lib/patient-portal/crypto";
import { buildInviteEmail } from "@/lib/patient-portal/emails";
import { INVITE_TOKEN_TTL_DAYS } from "@/lib/patient-portal/types";
import { logAudit, extractAuditMeta } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    // Anti-abuso: freno de spam de invitaciones por IP (bombardeo de correo a un
    // paciente). Generoso; el endpoint ya exige sesión de staff.
    const limited = await persistentRateLimit(req, { limit: 10, windowSec: 60 });
    if (limited) return limited;

    const patientId = params.id;

    // Mismo guard que /api/portal: el paciente debe ser de la clínica activa…
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, clinicId: ctx.clinicId },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    });
    if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

    // …y quien invita debe PODER ver al paciente (visibilidad por-paciente). 404
    // idéntico a "no encontrado" para no revelar existencia.
    const denied = await assertPatientVisible(patientId, {
      userId: ctx.userId,
      role: ctx.role,
      clinicId: ctx.clinicId,
    });
    if (denied) return denied;

    const email = patient.email?.trim().toLowerCase() || "";
    if (!email) {
      return NextResponse.json(
        { error: "El paciente necesita un email para invitarlo" },
        { status: 400 },
      );
    }

    const now = new Date();
    const inviteToken = generateResetToken();
    const inviteExpiry = new Date(now.getTime() + INVITE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    const patientName = `${patient.firstName} ${patient.lastName}`.trim() || email;

    let account = await prisma.patientAccount.findUnique({ where: { email } });
    let status: "invited" | "resent" | "already_active";

    if (!account) {
      // No existe → cuenta invitada sin contraseña; el token de invitación va en
      // los mismos campos resetToken* que consume /paciente/recuperar.
      account = await prisma.patientAccount.create({
        data: {
          email,
          emailVerified: false,
          name: patientName,
          phone: patient.phone ?? null,
          passwordHash: null,
          invitedByUserId: ctx.userId,
          invitedAt: now,
          resetTokenHash: sha256(inviteToken),
          resetTokenExpiry: inviteExpiry,
        },
      });
      status = "invited";
    } else if (account.passwordHash === null) {
      // Invitada, sin activar → regenera el token y reenvía.
      account = await prisma.patientAccount.update({
        where: { id: account.id },
        data: {
          invitedByUserId: ctx.userId,
          invitedAt: now,
          resetTokenHash: sha256(inviteToken),
          resetTokenExpiry: inviteExpiry,
        },
      });
      status = "resent";
    } else {
      // Ya activa → NO se reenvía contraseña; solo aseguramos el link (abajo).
      status = "already_active";
    }

    // Link cuenta↔paciente idempotente (@@unique([accountId, patientId])).
    try {
      await prisma.patientAccountLink.create({
        data: { accountId: account.id, patientId: patient.id, clinicId: ctx.clinicId },
      });
    } catch (err) {
      // Ya existía (violación de @@unique) → idempotente, seguimos. Cualquier
      // otro error se propaga al catch externo para responder 500 con JSON.
      if ((err as { code?: string })?.code !== "P2002") throw err;
    }

    // Correo solo cuando (re)generamos un token de invitación.
    if (status !== "already_active") {
      const origin = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/+$/, "");
      const inviteUrl = `${origin}/paciente/recuperar?token=${inviteToken}`;
      try {
        const content = buildInviteEmail({
          name: account.name,
          inviteUrl,
          clinicName: ctx.clinic?.name ?? null,
        });
        await sendEmail({ to: email, subject: content.subject, html: content.html, text: content.text });
      } catch (err) {
        // El correo es best-effort: la cuenta/link ya existen, así que un fallo
        // de envío NO tumba la invitación (se puede reenviar). Solo lo logueamos.
        console.error("[patients/portal-invite] sendEmail error:", err);
      }
    }

    // Auditoría (sin token ni datos sensibles): quién invitó, a qué paciente, resultado.
    await logAudit({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "patient",
      entityId: patient.id,
      action: "update",
      changes: { portalInvite: { before: null, after: status } },
      ...extractAuditMeta(req),
    });

    return NextResponse.json({ ok: true, status });
  } catch (err) {
    // Red de seguridad: cualquier throw de Prisma/infra sale como JSON 500 (no
    // como respuesta vacía). Logueamos el error real para poder diagnosticarlo.
    console.error("[patients/portal-invite] error:", err);
    return NextResponse.json(
      { error: "No se pudo enviar la invitación" },
      { status: 500 },
    );
  }
}
