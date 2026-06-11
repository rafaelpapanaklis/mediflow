// Plantillas de email del portal del paciente. Implementa A3.
// Se envían con sendEmail() de src/lib/email.ts (Resend; hace stub-log si no
// hay RESEND_API_KEY). Estilo: replicar el HTML dark de sendWelcomeEmail en
// src/lib/email.ts (fondo #0b0815, card #121020, acento violeta #a78bfa,
// botón gradiente #8b5cf6→#7c3aed). Marca: DaleControl. Español neutro con tú.

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/** Escape mínimo para interpolar texto del usuario en el HTML del email. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Carcasa dark compartida (mismo estilo que sendWelcomeEmail en src/lib/email.ts). */
function darkShell(inner: string): string {
  return `
<!doctype html>
<html lang="es">
<body style="font-family: system-ui, -apple-system, sans-serif; background: #0b0815; color: #f5f5f7; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #121020; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 40px 32px;">
    <div style="font-size: 22px; font-weight: 600; letter-spacing: -0.02em; color: #a78bfa; margin-bottom: 20px;">
      DaleControl
    </div>
${inner}
    <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 28px 0;" />
    <div style="font-size: 11px; color: rgba(245,245,247,0.4); line-height: 1.5;">
      Si tienes dudas, escríbenos a
      <a href="mailto:soporte@dalecontrol.com" style="color: #a78bfa;">soporte@dalecontrol.com</a>.
      <br /><br />
      DaleControl — Portal del paciente 🇲🇽
    </div>
  </div>
</body>
</html>`;
}

/** Email con el código de verificación de 6 dígitos (expira en 15 min). */
export function buildVerifyCodeEmail(args: { name: string; code: string }): EmailContent {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const code = args.code;
  const safeName = name ? escapeHtml(name) : "";

  const subject = `Tu código de DaleControl: ${code}`;

  const html = darkShell(`
    <h1 style="font-size: 24px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 12px 0; color: #f5f5f7;">
      Verifica tu correo${safeName ? `, ${safeName}` : ""}
    </h1>
    <p style="font-size: 15px; color: rgba(245,245,247,0.7); line-height: 1.55; margin: 0 0 24px 0;">
      Usa este código para confirmar tu cuenta del portal de pacientes de DaleControl:
    </p>
    <div style="padding: 22px 20px; background: rgba(124,58,237,0.1); border: 1px solid rgba(124,58,237,0.3); border-radius: 10px; margin: 24px 0; text-align: center;">
      <div style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 34px; font-weight: 700; letter-spacing: 6px; color: #f5f5f7;">
        ${code}
      </div>
    </div>
    <p style="font-size: 13px; color: rgba(245,245,247,0.6); line-height: 1.6; margin: 0;">
      Expira en 15 minutos. Si no fuiste tú, ignora este correo.
    </p>`);

  const text =
    `Verifica tu correo${name ? `, ${name}` : ""}\n\n` +
    `Tu código de DaleControl: ${code}\n\n` +
    `Expira en 15 minutos. Si no fuiste tú, ignora este correo.\n\n` +
    `DaleControl — Portal del paciente MX`;

  return { subject, html, text };
}

/** Email de recuperación de contraseña con link a /paciente/recuperar?token=... (expira en 60 min). */
export function buildResetPasswordEmail(args: { name: string; resetUrl: string }): EmailContent {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const resetUrl = args.resetUrl;
  const safeName = name ? escapeHtml(name) : "";
  const safeUrl = escapeHtml(resetUrl);

  const subject = "Restablece tu contraseña · DaleControl";

  const html = darkShell(`
    <h1 style="font-size: 24px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 12px 0; color: #f5f5f7;">
      Restablece tu contraseña${safeName ? `, ${safeName}` : ""}
    </h1>
    <p style="font-size: 15px; color: rgba(245,245,247,0.7); line-height: 1.55; margin: 0 0 24px 0;">
      Recibimos una solicitud para restablecer la contraseña de tu cuenta del portal de pacientes.
      Haz clic en el botón para crear una nueva:
    </p>
    <a href="${safeUrl}" style="display: inline-block; padding: 14px 28px; background: linear-gradient(180deg, #8b5cf6, #7c3aed); color: #fff; font-weight: 600; text-decoration: none; border-radius: 10px; font-size: 15px; margin: 8px 0 24px 0;">
      Restablecer contraseña →
    </a>
    <p style="font-size: 13px; color: rgba(245,245,247,0.6); line-height: 1.6; margin: 0 0 16px 0;">
      Si el botón no funciona, copia y pega este enlace en tu navegador:
      <br />
      <a href="${safeUrl}" style="color: #a78bfa; word-break: break-all;">${safeUrl}</a>
    </p>
    <p style="font-size: 13px; color: rgba(245,245,247,0.6); line-height: 1.6; margin: 0;">
      El enlace expira en 60 minutos. Si no fuiste tú, ignora este correo.
    </p>`);

  const text =
    `Restablece tu contraseña${name ? `, ${name}` : ""}\n\n` +
    `Recibimos una solicitud para restablecer la contraseña de tu cuenta del portal de pacientes.\n\n` +
    `Abre este enlace para crear una contraseña nueva:\n${resetUrl}\n\n` +
    `El enlace expira en 60 minutos. Si no fuiste tú, ignora este correo.\n\n` +
    `DaleControl — Portal del paciente MX`;

  return { subject, html, text };
}
