/**
 * Email sender wrapper — stub seguro hasta que haya transport configurado.
 *
 * Si RESEND_API_KEY existe, usa Resend. Si no, hace console.log del email
 * que se enviaría (útil para desarrollo y para registrar intent antes de
 * conectar el provider).
 *
 * Fallará "silenciosamente" (no rompe el signup) — errores se loguean pero no se tiran.
 */

type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  /** Texto plano opcional (fallback). */
  text?: string;
};

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "MediFlow <no-reply@mediflow.mx>";

  if (!key) {
    // Stub: log en desarrollo y en producción hasta que se configure el provider.
    // eslint-disable-next-line no-console
    console.log(
      `[email stub] would send to ${payload.to}: "${payload.subject}"\n` +
        `  (configure RESEND_API_KEY para enviar de verdad)`,
    );
    return;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[email] Resend API error:", res.status, body);
    }
  } catch (err) {
    console.error("[email] transport error:", err);
  }
}

/**
 * Email de bienvenida post-signup. Incluye fecha formateada de fin de trial.
 */
export async function sendWelcomeEmail(opts: {
  email: string;
  firstName: string;
  clinicName: string;
  trialEndsAt: Date;
  dashboardUrl: string;
}) {
  const { email, firstName, clinicName, trialEndsAt, dashboardUrl } = opts;
  const trialDate = trialEndsAt.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const html = `
<!doctype html>
<html lang="es">
<body style="font-family: system-ui, -apple-system, sans-serif; background: #0b0815; color: #f5f5f7; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #121020; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 40px 32px;">
    <div style="font-size: 22px; font-weight: 600; letter-spacing: -0.02em; color: #a78bfa; margin-bottom: 20px;">
      MediFlow
    </div>
    <h1 style="font-size: 24px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 12px 0; color: #f5f5f7;">
      ¡Bienvenido${firstName ? `, ${firstName}` : ""}! 🎉
    </h1>
    <p style="font-size: 15px; color: rgba(245,245,247,0.7); line-height: 1.55; margin: 0 0 24px 0;">
      Tu cuenta de MediFlow está lista y tu clínica <strong style="color: #f5f5f7;">${clinicName}</strong> ya puede empezar a operar.
    </p>

    <div style="padding: 18px 20px; background: rgba(124,58,237,0.1); border: 1px solid rgba(124,58,237,0.3); border-radius: 10px; margin: 24px 0;">
      <div style="font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #a78bfa; font-weight: 600; margin-bottom: 6px;">
        Prueba gratis · 14 días
      </div>
      <div style="font-size: 14px; color: rgba(245,245,247,0.85); line-height: 1.5;">
        Tu prueba termina el <strong style="color: #f5f5f7;">${trialDate}</strong>. Acceso completo a todos los módulos sin cargo hasta entonces.
      </div>
    </div>

    <a href="${dashboardUrl}" style="display: inline-block; padding: 14px 28px; background: linear-gradient(180deg, #8b5cf6, #7c3aed); color: #fff; font-weight: 600; text-decoration: none; border-radius: 10px; font-size: 15px; margin: 8px 0 32px 0;">
      Ir al dashboard →
    </a>

    <div style="font-size: 13px; color: rgba(245,245,247,0.6); line-height: 1.6;">
      <div style="font-weight: 600; color: rgba(245,245,247,0.85); margin-bottom: 10px;">Tips para empezar:</div>
      <ul style="margin: 0; padding-left: 20px;">
        <li>Agrega tu primer paciente desde el módulo <em>Pacientes</em>.</li>
        <li>Agenda tu primera cita con la integración de WhatsApp.</li>
        <li>Configura tu RFC emisor si vas a facturar CFDI.</li>
        <li>Invita a tu equipo (hasta ${"{clinicSize}"} miembros según tu plan).</li>
      </ul>
    </div>

    <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 28px 0;" />

    <div style="font-size: 11px; color: rgba(245,245,247,0.4); line-height: 1.5;">
      ¿Tienes dudas? Responde este correo o escríbenos a
      <a href="mailto:soporte@mediflow.mx" style="color: #a78bfa;">soporte@mediflow.mx</a>.
      <br /><br />
      MediFlow — Software médico 🇲🇽
    </div>
  </div>
</body>
</html>`;

  const text =
    `¡Bienvenido${firstName ? `, ${firstName}` : ""}!\n\n` +
    `Tu cuenta de MediFlow está lista y tu clínica "${clinicName}" ya puede empezar a operar.\n\n` +
    `Prueba gratis de 14 días — termina el ${trialDate}.\n\n` +
    `Accede a tu dashboard: ${dashboardUrl}\n\n` +
    `Tips para empezar:\n` +
    `• Agrega tu primer paciente desde Pacientes\n` +
    `• Agenda tu primera cita con WhatsApp\n` +
    `• Configura tu RFC emisor para CFDI\n` +
    `• Invita a tu equipo\n\n` +
    `¿Dudas? soporte@mediflow.mx\n` +
    `MediFlow — Software médico MX`;

  await sendEmail({
    to: email,
    subject: "Bienvenido a MediFlow · Tu prueba de 14 días empieza hoy",
    html,
    text,
  });
}
