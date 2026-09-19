// Lo que se le dice al paciente al mandarle un documento, y lo que se le dice al
// equipo cuando NO se pudo mandar. PURO: sin Prisma, sin red, sin Meta.

import { WhatsAppBlockedError } from "@/lib/whatsapp/errors";
import { htmlATexto } from "./html-a-bloques";

export interface DocumentoParaEnviar {
  tipo: string;
  titulo: string;
  fecha: string;
  clinicaNombre: string;
  pacienteNombre: string;
  doctorNombre: string;
  cedula: string | null;
  cuerpoHtml: string;
}

/** Texto libre del WhatsApp. El documento va DESPUÉS, como PDF adjunto. */
export function mensajeDeWhatsApp(d: DocumentoParaEnviar): string {
  const nombre = d.pacienteNombre.trim() || "paciente";
  return (
    `Hola ${nombre}, de parte de ${d.clinicaNombre.trim() || "tu clínica"} te compartimos tu documento ` +
    `«${d.titulo}» del ${d.fecha}. Va adjunto en PDF. Cualquier duda respóndenos por este medio.`
  );
}

/**
 * Por qué no salió un WhatsApp, dicho para quien está en la pantalla.
 *
 * El caso que importa es la VENTANA DE 24 HORAS: fuera de ella Meta solo deja
 * plantillas de pago, y un documento clínico no tiene plantilla (ni puede
 * llevar adjunto si la tuviera). `sendWhatsAppLogged` lo detecta ANTES de
 * llamar a Meta —no se gasta nada— y lanza `WhatsAppBlockedError` con el
 * motivo. Aquí se le añade qué hacer, y sale con su propio `code` para que la
 * pantalla lo pinte como aviso y no como error.
 */
export function explicarFalloDeWhatsApp(err: unknown): { status: number; code: string; error: string } {
  if (err instanceof WhatsAppBlockedError) {
    return {
      status: 409,
      code: "WA_FUERA_DE_VENTANA",
      error:
        `No se envió. ${err.message} ` +
        "Pídele al paciente que le escriba a la clínica por WhatsApp y vuelve a intentarlo, " +
        "o mándaselo por correo o descarga el PDF.",
    };
  }
  const detalle = err instanceof Error && err.message ? err.message : "WhatsApp no aceptó el mensaje.";
  return { status: 502, code: "WA_FALLO", error: `No se envió. ${detalle}` };
}

/** «•••• 1234»: confirma a dónde salió sin repetir el número entero en un toast. */
export function enmascararTelefono(telefono: string): string {
  const digitos = telefono.replace(/\D/g, "");
  return digitos.length >= 4 ? `•••• ${digitos.slice(-4)}` : "••••";
}

/** «an•••@gmail.com». */
export function enmascararCorreo(correo: string): string {
  const [usuario, dominio] = correo.split("@");
  if (!dominio) return "•••";
  return `${usuario.slice(0, 2)}•••@${dominio}`;
}

const escapar = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * El documento DENTRO del correo, como carta. `sendEmail` no sabe adjuntar
 * archivos, así que el correo no lleva el PDF: lleva el documento mismo.
 *
 * `cuerpoHtml` se inyecta tal cual porque viene SIEMPRE saneado del servidor
 * (etiquetas de la lista blanca sin atributos, texto escapado). Todo lo demás
 * se escapa aquí. Un dato que falte (cédula) se omite: en un correo no hay
 * raya que llenar a mano. Colores fijos: un cliente de correo no lee tokens.
 */
export function correoDelDocumento(d: DocumentoParaEnviar): { subject: string; html: string; text: string } {
  const clinica = d.clinicaNombre.trim() || "Tu clínica";
  const subject = `${d.titulo} — ${clinica}`;
  const cedula = d.cedula ? `<br><span style="color:#6b6b78;font-size:13px;">Cédula profesional: ${escapar(d.cedula)}</span>` : "";
  const html = `
<div style="background:#f4f3f8;padding:24px 12px;font-family:Georgia,'Times New Roman',serif;color:#1a1826;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #ebeaf0;border-radius:8px;padding:40px 36px;">
    <table role="presentation" width="100%" style="border-collapse:collapse;"><tr>
      <td style="font-family:Arial,sans-serif;font-size:18px;font-weight:bold;">${escapar(clinica)}</td>
      <td align="right" style="font-family:Arial,sans-serif;font-size:13px;color:#464357;">${escapar(d.fecha)}</td>
    </tr></table>
    <hr style="border:none;border-top:1px solid #ebeaf0;margin:16px 0 20px;">
    <p style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7f7c90;margin:0;">${escapar(d.tipo)} · ${escapar(d.pacienteNombre)}</p>
    <h1 style="font-size:22px;margin:6px 0 20px;">${escapar(d.titulo)}</h1>
    <div style="font-size:16px;line-height:1.7;">${d.cuerpoHtml}</div>
    <p style="margin:36px 0 0;padding-top:10px;border-top:1px solid #1a1826;display:inline-block;min-width:240px;">
      <strong>${escapar(d.doctorNombre)}</strong>${cedula}
    </p>
  </div>
  <p style="max-width:640px;margin:14px auto 0;font-family:Arial,sans-serif;font-size:12px;color:#7f7c90;text-align:center;">
    Este correo contiene información clínica confidencial de ${escapar(d.pacienteNombre)}. Si no eres la persona a quien va dirigido, bórralo.
  </p>
</div>`;
  const text =
    `${clinica} — ${d.fecha}\n${d.tipo} · ${d.pacienteNombre}\n\n${d.titulo}\n\n${htmlATexto(d.cuerpoHtml)}\n\n` +
    `${d.doctorNombre}${d.cedula ? `\nCédula profesional: ${d.cedula}` : ""}`;
  return { subject, html, text };
}
