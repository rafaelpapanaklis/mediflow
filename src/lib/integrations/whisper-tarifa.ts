/**
 * TARIFA DE LA TRANSCRIPCIÓN (Whisper) EN TOKENS DEL CUPO DE IA.
 *
 * Una sola tarifa para todo lo que pasa por `transcribeAudio`: el dictado del
 * panel (/api/ai/transcribe) y las notas de voz que el bot de WhatsApp
 * transcribe (lib/whatsapp/bot/nota-de-voz.ts). Puro: lo importan las pruebas.
 *
 * Whisper cobra por MINUTO de audio ($0.006 USD/min en whisper-1), no por
 * tokens de Claude. Para que la transcripción entre en el MISMO contador que el
 * resto de la IA (Clinic.aiTokensUsed / aiTokensLimit) se convierte usando el
 * precio de referencia que ya vive en el repo para tokens de entrada:
 * `inputUsdPerMtok = 3` USD por millón (src/lib/ai-billing/pricing.ts).
 *
 *   0.006 USD/min ÷ (3 USD / 1 000 000 tok) = 2 000 tokens por minuto de audio
 *
 * ⇒ ~33 tokens por segundo. Una grabación de 60 s cuesta 2 000 tokens, así que
 * un plan Profesional (200 mil/mes) da para ~100 minutos. El plan Básico tiene
 * 0 tokens ⇒ queda bloqueado, coherente con el "Sin IA" de su tarifa.
 *
 * Si cambia el precio de Whisper o el de referencia, se ajusta AQUÍ y el número
 * sigue siendo explicable con la división de arriba.
 */
export const AUDIO_TOKENS_PER_MINUTE = 2000;

/** Tokens del cupo que cuestan `seconds` de audio (mínimo 1: ningún clip sale gratis). */
export function tokensDeAudio(seconds: number): number {
  return Math.max(1, Math.round((seconds * AUDIO_TOKENS_PER_MINUTE) / 60));
}
