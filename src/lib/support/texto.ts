// Texto plano de soporte (sin HTML crudo). Módulo puro: lo comparten el service
// y las reglas de edición de mensajes sin arrastrar prisma.

/** Texto plano: quita chars de control (excepto \n y \t), normaliza saltos. */
export function sanitizeSupportText(input: unknown, maxLen: number): string {
  const raw = typeof input === "string" ? input : "";
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLen);
}
