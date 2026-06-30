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

/**
 * Devuelve `{ delivered }` para que quien llame pueda distinguir un envío
 * real de un stub/error sin romperse: `delivered` es `false` cuando no hay
 * transporte configurado o el provider falla, `true` solo si Resend aceptó
 * el correo. Los llamadores que ignoran el retorno siguen funcionando igual.
 */
export async function sendEmail(payload: EmailPayload): Promise<{ delivered: boolean }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "DaleControl <no-reply@dalecontrol.com>";

  if (!key) {
    // Stub: log en desarrollo y en producción hasta que se configure el provider.
    // eslint-disable-next-line no-console
    console.log(
      `[email stub] would send to ${payload.to}: "${payload.subject}"\n` +
        `  (configure RESEND_API_KEY para enviar de verdad)`,
    );
    return { delivered: false };
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
      return { delivered: false };
    }
    return { delivered: true };
  } catch (err) {
    console.error("[email] transport error:", err);
    return { delivered: false };
  }
}

/**
 * Email de bienvenida post-signup (modelo sin prueba gratis: se paga para activar).
 */
export async function sendWelcomeEmail(opts: {
  email: string;
  firstName: string;
  clinicName: string;
  trialEndsAt: Date;
  dashboardUrl: string;
}) {
  const { email, firstName, clinicName, dashboardUrl } = opts;

  const html = `
<!doctype html>
<html lang="es">
<body style="font-family: system-ui, -apple-system, sans-serif; background: #0b0815; color: #f5f5f7; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #121020; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 40px 32px;">
    <div style="font-size: 22px; font-weight: 600; letter-spacing: -0.02em; color: #a78bfa; margin-bottom: 20px;">
      DaleControl
    </div>
    <h1 style="font-size: 24px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 12px 0; color: #f5f5f7;">
      ¡Bienvenido${firstName ? `, ${firstName}` : ""}! 🎉
    </h1>
    <p style="font-size: 15px; color: rgba(245,245,247,0.7); line-height: 1.55; margin: 0 0 24px 0;">
      Tu cuenta de DaleControl está lista y tu clínica <strong style="color: #f5f5f7;">${clinicName}</strong> ya puede empezar a operar.
    </p>

    <div style="padding: 18px 20px; background: rgba(124,58,237,0.1); border: 1px solid rgba(124,58,237,0.3); border-radius: 10px; margin: 24px 0;">
      <div style="font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #a78bfa; font-weight: 600; margin-bottom: 6px;">
        Activa tu plan
      </div>
      <div style="font-size: 14px; color: rgba(245,245,247,0.85); line-height: 1.5;">
        Elige tu plan para activar tu cuenta y desbloquear todos los módulos.
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
        <li>Invita a tu equipo según tu plan.</li>
      </ul>
    </div>

    <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 28px 0;" />

    <div style="font-size: 11px; color: rgba(245,245,247,0.4); line-height: 1.5;">
      ¿Tienes dudas? Responde este correo o escríbenos a
      <a href="mailto:soporte@dalecontrol.com" style="color: #a78bfa;">soporte@dalecontrol.com</a>.
      <br /><br />
      DaleControl — Software médico 🇲🇽
    </div>
  </div>
</body>
</html>`;

  const text =
    `¡Bienvenido${firstName ? `, ${firstName}` : ""}!\n\n` +
    `Tu cuenta de DaleControl está lista y tu clínica "${clinicName}" ya puede empezar a operar.\n\n` +
    `Activa tu plan para empezar a usar todos los módulos.\n\n` +
    `Accede a tu dashboard: ${dashboardUrl}\n\n` +
    `Tips para empezar:\n` +
    `• Agrega tu primer paciente desde Pacientes\n` +
    `• Agenda tu primera cita con WhatsApp\n` +
    `• Configura tu RFC emisor para CFDI\n` +
    `• Invita a tu equipo\n\n` +
    `¿Dudas? soporte@dalecontrol.com\n` +
    `DaleControl — Software médico MX`;

  await sendEmail({
    to: email,
    subject: "Bienvenido a DaleControl · Activa tu plan",
    html,
    text,
  });
}

/** Formatea un monto a moneda local. Cae a "$X.XX CUR" si Intl no soporta la
 *  divisa (jamás lanza). */
function formatBillingMoney(amount: number, currency: string): string {
  const cur = (currency || "MXN").toUpperCase();
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: cur }).format(amount);
  } catch {
    return `$${amount.toFixed(2)} ${cur}`;
  }
}

/** Fecha larga en español (ej. "15 de julio de 2026"). Devuelve null si la
 *  fecha es inválida — Intl.format LANZA con un Invalid Date. */
function formatBillingDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric" }).format(date);
  } catch {
    return null;
  }
}

/**
 * Correo "Plan activado" — primer pago COMPLETADO de una clínica
 * (invoice.billing_reason = "subscription_create"). Tono de bienvenida +
 * primeros pasos. Mismo estilo dark/branded que sendWelcomeEmail.
 */
export async function sendPlanActivatedEmail(opts: {
  email: string;
  firstName?: string | null;
  clinicName: string;
  planName: string;
  dashboardUrl: string;
}): Promise<void> {
  const { email, firstName, clinicName, planName, dashboardUrl } = opts;
  const hi = firstName ? `, ${firstName}` : "";

  const html = `
<!doctype html>
<html lang="es">
<body style="font-family: system-ui, -apple-system, sans-serif; background: #0b0815; color: #f5f5f7; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #121020; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 40px 32px;">
    <div style="font-size: 22px; font-weight: 600; letter-spacing: -0.02em; color: #a78bfa; margin-bottom: 20px;">
      DaleControl
    </div>
    <h1 style="font-size: 24px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 12px 0; color: #f5f5f7;">
      ¡Listo${hi}! Tu plan ${planName} está activo 🎉
    </h1>
    <p style="font-size: 15px; color: rgba(245,245,247,0.7); line-height: 1.55; margin: 0 0 24px 0;">
      Confirmamos tu pago. Tu clínica <strong style="color: #f5f5f7;">${clinicName}</strong> ya está operando con el plan <strong style="color: #f5f5f7;">${planName}</strong> y todos sus módulos desbloqueados.
    </p>

    <div style="padding: 18px 20px; background: rgba(124,58,237,0.1); border: 1px solid rgba(124,58,237,0.3); border-radius: 10px; margin: 24px 0;">
      <div style="font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #a78bfa; font-weight: 600; margin-bottom: 6px;">
        Suscripción activa
      </div>
      <div style="font-size: 14px; color: rgba(245,245,247,0.85); line-height: 1.5;">
        Plan ${planName} · tu cuenta quedó activada.
      </div>
    </div>

    <a href="${dashboardUrl}" style="display: inline-block; padding: 14px 28px; background: linear-gradient(180deg, #8b5cf6, #7c3aed); color: #fff; font-weight: 600; text-decoration: none; border-radius: 10px; font-size: 15px; margin: 8px 0 32px 0;">
      Ir a mi panel →
    </a>

    <div style="font-size: 13px; color: rgba(245,245,247,0.6); line-height: 1.6;">
      <div style="font-weight: 600; color: rgba(245,245,247,0.85); margin-bottom: 10px;">Primeros pasos:</div>
      <ul style="margin: 0; padding-left: 20px;">
        <li>Agrega tu primer paciente desde el módulo <em>Pacientes</em>.</li>
        <li>Agenda una cita y activa los recordatorios por WhatsApp.</li>
        <li>Configura tu RFC emisor para facturar CFDI.</li>
        <li>Invita a tu equipo según tu plan.</li>
      </ul>
    </div>

    <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 28px 0;" />

    <div style="font-size: 11px; color: rgba(245,245,247,0.4); line-height: 1.5;">
      ¿Tienes dudas? Responde este correo o escríbenos a
      <a href="mailto:soporte@dalecontrol.com" style="color: #a78bfa;">soporte@dalecontrol.com</a>.
      <br /><br />
      DaleControl — Software médico 🇲🇽
    </div>
  </div>
</body>
</html>`;

  const text =
    `¡Listo${hi}! Tu plan ${planName} está activo.\n\n` +
    `Confirmamos tu pago. Tu clínica "${clinicName}" ya está operando con el plan ${planName} y todos sus módulos desbloqueados.\n\n` +
    `Ir a mi panel: ${dashboardUrl}\n\n` +
    `Primeros pasos:\n` +
    `• Agrega tu primer paciente desde Pacientes\n` +
    `• Agenda una cita y activa los recordatorios por WhatsApp\n` +
    `• Configura tu RFC emisor para CFDI\n` +
    `• Invita a tu equipo\n\n` +
    `¿Dudas? soporte@dalecontrol.com\n` +
    `DaleControl — Software médico MX`;

  await sendEmail({
    to: email,
    subject: `¡Tu plan ${planName} está activo! · DaleControl`,
    html,
    text,
  });
}

/**
 * Correo "Plan renovado" — cada RENOVACIÓN del ciclo
 * (invoice.billing_reason = "subscription_cycle"). Tono de recibo: monto,
 * plan y próxima fecha de cobro. Mismo estilo dark/branded.
 */
export async function sendPlanRenewedEmail(opts: {
  email: string;
  firstName?: string | null;
  clinicName: string;
  planName: string;
  /** Monto cobrado YA en unidades mayores (Stripe amount_paid / 100). */
  amountPaid: number;
  /** Código ISO de la divisa de la factura (ej. "mxn"). */
  currency: string;
  /** Próxima fecha de cobro (fin del periodo facturado o nextBillingDate). */
  nextBillingDate?: Date | null;
  receiptsUrl: string;
}): Promise<void> {
  const { email, firstName, clinicName, planName, amountPaid, currency, nextBillingDate, receiptsUrl } = opts;
  const hi = firstName ? `, ${firstName}` : "";
  const amountLabel = formatBillingMoney(amountPaid, currency);
  const nextLabel = formatBillingDate(nextBillingDate);

  const cell = "padding: 6px 0; font-size: 13px; line-height: 1.4;";
  const rows =
    `<tr><td style="${cell} color: rgba(245,245,247,0.6);">Plan</td><td style="${cell} text-align: right; color: #f5f5f7; font-weight: 600;">${planName}</td></tr>` +
    `<tr><td style="${cell} color: rgba(245,245,247,0.6);">Monto cobrado</td><td style="${cell} text-align: right; color: #f5f5f7; font-weight: 600;">${amountLabel}</td></tr>` +
    (nextLabel
      ? `<tr><td style="${cell} color: rgba(245,245,247,0.6);">Próximo cobro</td><td style="${cell} text-align: right; color: #f5f5f7; font-weight: 600;">${nextLabel}</td></tr>`
      : "");

  const html = `
<!doctype html>
<html lang="es">
<body style="font-family: system-ui, -apple-system, sans-serif; background: #0b0815; color: #f5f5f7; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #121020; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 40px 32px;">
    <div style="font-size: 22px; font-weight: 600; letter-spacing: -0.02em; color: #a78bfa; margin-bottom: 20px;">
      DaleControl
    </div>
    <h1 style="font-size: 24px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 12px 0; color: #f5f5f7;">
      Renovación confirmada ✅
    </h1>
    <p style="font-size: 15px; color: rgba(245,245,247,0.7); line-height: 1.55; margin: 0 0 24px 0;">
      Hola${hi}, confirmamos la renovación de tu plan <strong style="color: #f5f5f7;">${planName}</strong> para <strong style="color: #f5f5f7;">${clinicName}</strong>. Tu servicio sigue activo sin interrupciones.
    </p>

    <div style="padding: 18px 20px; background: rgba(124,58,237,0.08); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; margin: 24px 0;">
      <table style="width: 100%; border-collapse: collapse;">
        ${rows}
      </table>
    </div>

    <a href="${receiptsUrl}" style="display: inline-block; padding: 14px 28px; background: linear-gradient(180deg, #8b5cf6, #7c3aed); color: #fff; font-weight: 600; text-decoration: none; border-radius: 10px; font-size: 15px; margin: 8px 0 32px 0;">
      Ver mis recibos →
    </a>

    <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 28px 0;" />

    <div style="font-size: 11px; color: rgba(245,245,247,0.4); line-height: 1.5;">
      Este es el comprobante de tu renovación. ¿Dudas con tu factura? Escríbenos a
      <a href="mailto:soporte@dalecontrol.com" style="color: #a78bfa;">soporte@dalecontrol.com</a>.
      <br /><br />
      DaleControl — Software médico 🇲🇽
    </div>
  </div>
</body>
</html>`;

  const text =
    `Renovación confirmada\n\n` +
    `Hola${hi}, confirmamos la renovación de tu plan ${planName} para "${clinicName}".\n\n` +
    `Plan: ${planName}\n` +
    `Monto cobrado: ${amountLabel}\n` +
    (nextLabel ? `Próximo cobro: ${nextLabel}\n` : "") +
    `\nVer mis recibos: ${receiptsUrl}\n\n` +
    `¿Dudas? soporte@dalecontrol.com\n` +
    `DaleControl — Software médico MX`;

  await sendEmail({
    to: email,
    subject: `Renovación confirmada · Plan ${planName} · DaleControl`,
    html,
    text,
  });
}
