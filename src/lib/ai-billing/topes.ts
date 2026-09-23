/**
 * Topes de las operaciones a mano de la Tesorería de IA. Módulo PURO (sin
 * prisma, sin `server-only`): lo leen las rutas de /api/admin/ai-billing para
 * rechazar y la pantalla /admin/ai-billing para avisar ANTES de mandar, así los
 * dos lados hablan del mismo número.
 *
 * Un dedazo (50000 en vez de 500) no debe poder mover dinero de más sin que
 * nada chille: el ajuste ya tenía su tope; la recarga a Anthropic no tenía
 * ninguno.
 */

/** Tope por ajuste manual de saldo (valor absoluto, centavos MXN): ±$50,000 MXN. */
export const MAX_ADJUST_ABS_CENTS = 5_000_000;

/**
 * Tope por recarga registrada en Anthropic (centavos USD): $5,000 USD. Las
 * recargas reales son de cientos de dólares; una de cinco mil ya es rara, y
 * una mayor casi seguro es un dedazo.
 */
export const MAX_RECHARGE_USD_CENTS = 500_000;

/**
 * A partir de aquí la pantalla pide confirmar antes de registrar la recarga:
 * $1,000 USD. No es un rechazo, es un «¿seguro?».
 */
export const RECHARGE_WARN_USD_CENTS = 100_000;

/**
 * Ventana en la que un ajuste IDÉNTICO (misma clínica, mismo importe, misma
 * nota) se considera repetido y se rechaza. Dos minutos cubren el doble clic,
 * la petición reintentada y la pestaña vieja; dos ajustes iguales a propósito
 * (dos cortesías de $100 el mismo día) caben fuera de ella o con otra nota.
 */
export const ADJUST_DUPLICATE_WINDOW_MS = 2 * 60_000;

/** Prefijo con el que el ajuste guarda su clave de idempotencia en `reference`. */
export const ADJUST_REFERENCE_PREFIX = "admin-adjust:";
