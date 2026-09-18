// Le dice a quien movió o canceló una cita qué pasó con el WhatsApp al paciente.
//
// POR QUÉ EXISTE: las rutas de citas devuelven `whatsapp` cuando tocaba avisar
// (ver lib/whatsapp/avisos-cita.ts). Si la pantalla se lo calla, encender
// «Aviso al cancelar» y que el mensaje no salga es otro botón que miente — y
// fuera de la ventana de 24 h la cancelación NO sale (no hay plantilla).
//
// Vive junto a `mutations.ts` porque ahí pasan casi todos los cambios de la
// agenda. Sin hooks (no hay `t` aquí): las frases van en español, que es el
// idioma del panel dental; el diálogo de nueva cita sí usa el diccionario.
//
// SOLO CLIENTE (react-hot-toast).

import toast from "react-hot-toast";

export type ResultadoAvisoWhatsApp =
  | { enviado: true }
  | { enviado: false; motivo: string }
  | null
  | undefined;

const MOTIVO: Record<string, string> = {
  outside24h:
    "el paciente no ha escrito en las últimas 24 h y no hay plantilla aprobada para este aviso",
  templateNotConfigured: "falta la plantilla de este aviso (WhatsApp → Plantillas)",
  templatePending: "Meta todavía no aprueba la plantilla de este aviso",
  templateRejected: "Meta rechazó la plantilla de este aviso",
  billingRequired: "la cuenta de WhatsApp de la clínica no tiene método de pago en Meta",
  tokenExpired: "la conexión de WhatsApp caducó: hay que reconectar",
  notConnected: "la clínica no tiene WhatsApp conectado",
  noPhone: "el paciente no tiene un teléfono válido",
  undeliverable: "ese número no puede recibir WhatsApp",
  rateLimited: "WhatsApp está limitando los envíos de la clínica",
};

/** Motivos que NO son noticia: la clínica lo tiene apagado, o la cita ya pasó. */
const CALLADOS = new Set(["apagadoPorClinica", "citaPasada"]);

export function avisarResultadoWhatsApp(resultado: ResultadoAvisoWhatsApp): void {
  if (!resultado) return;
  if (resultado.enviado === true) {
    toast.success("Se le avisó al paciente por WhatsApp");
    return;
  }
  if (CALLADOS.has(resultado.motivo)) return;
  const porque = MOTIVO[resultado.motivo] ?? "no sabemos el motivo (revisa WhatsApp → Recordatorios recientes)";
  toast.error(`El aviso por WhatsApp al paciente NO salió: ${porque}. Avísale por otro medio.`, {
    duration: 8000,
  });
}
