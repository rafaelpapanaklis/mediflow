// Email de recordatorio de cita (canal email de recordatorios automáticos).
// Lo consume el queue-worker para filas APPT_AUTO con payload.channel "email".

export interface ReminderEmailInput {
  clinicName: string;
  logoUrl?: string | null;
  patientName: string;
  fecha: string;
  hora: string;
  doctorName: string;
  confirmUrl: string;
  /** Texto plano del recordatorio ya renderizado (mismo cuerpo que WhatsApp). */
  message: string;
  subject?: string;
}

/** Escapa valores dinámicos para HTML (texto y atributos). */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildAppointmentReminderEmail(input: ReminderEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = input.subject ?? `Recordatorio de cita — ${input.clinicName}`;

  const clinicName = escapeHtml(input.clinicName);
  const patientName = escapeHtml(input.patientName);
  const doctorName = escapeHtml(input.doctorName);
  const fecha = escapeHtml(input.fecha);
  const hora = escapeHtml(input.hora);
  const confirmUrl = escapeHtml(input.confirmUrl);
  const logoUrl = input.logoUrl ? escapeHtml(input.logoUrl) : null;

  const html = `
<!doctype html>
<html lang="es">
<body style="font-family: system-ui, -apple-system, sans-serif; background: #0b0815; color: #f5f5f7; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #121020; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 40px 32px;">
    <div style="margin-bottom: 24px;">
      ${logoUrl ? `<img src="${logoUrl}" alt="${clinicName}" style="max-height: 48px; display: block; margin-bottom: 12px;" />` : ""}
      <div style="font-size: 20px; font-weight: 600; letter-spacing: -0.02em; color: #f5f5f7;">
        ${clinicName}
      </div>
      <div style="font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: #a78bfa; margin-top: 4px;">
        DaleControl
      </div>
    </div>

    <p style="font-size: 15px; color: rgba(245,245,247,0.85); line-height: 1.55; margin: 0 0 20px 0;">
      Hola ${patientName},<br />
      te recordamos tu cita:
    </p>

    <div style="padding: 18px 20px; background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.3); border-radius: 10px; margin: 0 0 28px 0;">
      <div style="font-size: 15px; color: #f5f5f7; line-height: 1.7;">
        <div>📅 <strong style="color: #f5f5f7;">${fecha}</strong></div>
        <div>🕐 <strong style="color: #f5f5f7;">${hora}</strong></div>
        <div>👨‍⚕️ <strong style="color: #f5f5f7;">${doctorName}</strong></div>
      </div>
    </div>

    <div style="text-align: center; margin: 0 0 28px 0;">
      <a href="${confirmUrl}" style="display: inline-block; padding: 16px 36px; background: #10b981; color: #fff; font-weight: 600; text-decoration: none; border-radius: 10px; font-size: 16px;">
        Confirmar asistencia
      </a>
      <div style="margin-top: 14px;">
        <a href="${confirmUrl}" style="font-size: 13px; color: #f87171; text-decoration: underline;">
          Ya no puedo asistir
        </a>
      </div>
    </div>

    <div style="font-size: 12px; color: rgba(245,245,247,0.55); line-height: 1.6; margin: 0 0 8px 0;">
      Si los botones no funcionan, copia este enlace:<br />
      <span style="color: rgba(245,245,247,0.7); word-break: break-all;">${confirmUrl}</span>
    </div>

    <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 28px 0;" />

    <div style="font-size: 11px; color: rgba(245,245,247,0.4); line-height: 1.5;">
      Enviado por DaleControl — Software médico 🇲🇽
    </div>
  </div>
</body>
</html>`;

  const text = input.message.includes(input.confirmUrl)
    ? input.message
    : `${input.message}\n\nConfirmar: ${input.confirmUrl}`;

  return { subject, html, text };
}
