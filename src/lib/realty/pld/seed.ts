// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · PLD — la SEMILLA de los parámetros antilavado.
//
// ── Por qué los números están en este archivo y no es una contradicción ─
// La regla del vertical es "ningún valor fiscal escrito en código", y se
// cumple: NADA en tiempo de ejecución lee un número de aquí. Todo el módulo
// lee `realty_calc_params`. Este archivo es el equivalente exacto de
// src/lib/realty/calc/seed.ts: una CAPTURA INICIAL que un administrador
// dispara a mano, una vez, y que a partir de ese momento se edita en
// /admin/inmobiliarias/parametros sin volver a tocar código.
//
// ── Dónde vive el bloque ───────────────────────────────────────────────
// Dentro del `meta` de la fila `kind: "UMA"`, `stateCode: "MX"`, en un
// sub-objeto `pld`. La razón está explicada en umbrales.ts: los umbrales
// SON múltiplos de la UMA, así que compartir fila y vigencia con ella hace
// imposible que se desincronicen.
//
// ── 🔴 EL BLOQUE VA EN TODAS LAS FILAS UMA, NO SOLO EN LA DEL AÑO ──────
// Un umbral en VECES la UMA no cambia de año a año: 8 025 UMA son 8 025 UMA
// en 2025 y en 2026; lo que cambia es cuánto vale una UMA. Si el bloque
// existiera solo en la fila de 2026, una operación cerrada en 2025 elegiría
// la fila de 2025 (pickVigente) y el módulo diría "falta el parámetro" para
// una venta perfectamente normal. Por eso la siembra COMPLETA todas las
// filas UMA que no lo tengan, sin tocar su `value` ni sus otras llaves.
//
// ── 🔴 SEMBRAR NO PISA ─────────────────────────────────────────────────
// Si una fila ya trae `pld`, se cuenta como omitida y se deja intacta. Es
// el mismo contrato que `sembrarParametros` de las calculadoras: si alguien
// corrigió un umbral a mano contra el texto de la ley, volver a sembrar NO
// puede devolverle el número de fábrica.
// ═══════════════════════════════════════════════════════════════════════

/** Año de la UMA que se siembra si la tabla no tiene ninguna fila del año. */
export const PLD_SEED_YEAR = 2026;

/**
 * La UMA entra en vigor el 1 de febrero, no el 1 de enero. Misma convención
 * que src/lib/realty/calc/seed.ts.
 */
export const PLD_SEED_EFFECTIVE_FROM = `${PLD_SEED_YEAR}-02-01`;

/** UMA diaria del año sembrado, en pesos. */
export const PLD_SEED_UMA_DIARIA = 117.31;
/** Mensual = diaria × 30.4, y anual = mensual × 12 (la fórmula del INEGI). */
export const PLD_SEED_UMA_MENSUAL = 3566.22;
export const PLD_SEED_UMA_ANUAL = 42794.64;

/**
 * EL BLOQUE. Cada número con su fuente al lado.
 *
 * 🔴 `porVerificar: true` a propósito. Estos valores salen del brief del
 * vertical y de la investigación de mercado, NO de una lectura confrontada
 * del Diario Oficial. Mientras la bandera esté en true la pantalla lo dice
 * en ámbar y el aviso lo repite. La apaga quien haya cotejado el texto
 * vigente, desde /admin, sin desplegar nada.
 */
export const PLD_BLOQUE_SEMILLA: Record<string, unknown> = {
  etiqueta: "Umbrales antilavado (LFPIORPI) para inmuebles",
  // Umbrales en VECES la UMA. El peso se deriva; nunca se guarda derivado.
  identificacionUma: 8025,
  avisoUma: 16000,
  efectivoUma: 8025,
  // Plazos.
  diaLimiteAviso: 17,
  horasAvisoUrgente: 24,
  aniosConservacion: 10,
  mesesVigenciaComprobante: 3,
  fuente:
    "Umbrales de identificación (8 025 UMA), de aviso (16 000 UMA) y tope de efectivo " +
    "(8 025 UMA) para la compraventa y desarrollo de inmuebles; corte el día 17 del mes " +
    "siguiente; aviso urgente de 24 horas; conservación 10 años. Valores del brief del " +
    "vertical, NO confrontados todavía contra el texto vigente de la LFPIORPI ni contra " +
    "la reforma publicada el 27 de marzo de 2026.",
  nota:
    "Los tres umbrales se miden en veces la UMA, así que se mueven solos cuando el INEGI " +
    "publica la nueva. La vigencia de 3 meses del comprobante de domicilio es práctica de " +
    "mercado, no un plazo de ley: ajústala si tu oficial de cumplimiento usa otra.",
  porVerificar: true,
};

/** El `meta` completo de una fila UMA recién sembrada. */
export function metaUmaSemilla(): Record<string, unknown> {
  return {
    etiqueta: "UMA (Unidad de Medida y Actualización)",
    mensual: PLD_SEED_UMA_MENSUAL,
    anual: PLD_SEED_UMA_ANUAL,
    nota:
      `Vigente del 1 de febrero de ${PLD_SEED_YEAR} al 31 de enero de ${PLD_SEED_YEAR + 1}. ` +
      "El INEGI publica la nueva en enero y entra en vigor el 1 de febrero.",
    fuente:
      "Valor del brief del vertical. PENDIENTE de confrontar contra la publicación del INEGI " +
      "en el Diario Oficial de la Federación.",
    porVerificar: true,
    pld: { ...PLD_BLOQUE_SEMILLA },
  };
}
