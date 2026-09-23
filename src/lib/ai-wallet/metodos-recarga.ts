import { env } from "@/env";

/**
 * ¿Se puede ofrecer Mercado Pago para recargar el saldo de IA?
 *
 * Depende de que exista `MERCADOPAGO_ACCESS_TOKEN` (el token de PLATAFORMA con
 * el que cobra `/api/ai-wallet/mercadopago/checkout`), no de una línea
 * comentada: hoy DaleControl no tiene cuenta de Mercado Pago y la opción no se
 * pinta; el día que aparezca el token, vuelve sola. La decide el servidor
 * (página de Saldo y ruta de checkout), nunca el navegador.
 *
 * Falla cerrado: si la configuración no se puede leer, no se ofrece.
 */
export function mercadoPagoConfigurado(): boolean {
  try {
    return Boolean(env.MERCADOPAGO_ACCESS_TOKEN?.trim());
  } catch {
    return false;
  }
}
