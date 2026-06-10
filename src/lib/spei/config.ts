/**
 * Datos bancarios para recibir transferencias SPEI (recargas del monedero de
 * IA por clinica). La clinica ve estos datos al iniciar una recarga por SPEI;
 * luego sube su comprobante y un admin lo confirma para acreditar el saldo.
 *
 * EDITA estos valores con tu cuenta real, o define las variables de entorno
 * SPEI_* en Vercel (tienen prioridad sobre los defaults de abajo). Dejar la
 * CLABE vacia hasta poner la real evita mostrar datos falsos a las clinicas.
 */
export const SPEI_ACCOUNT = {
  /** Razon social / titular de la cuenta receptora. */
  beneficiary: process.env.SPEI_BENEFICIARY_NAME || "DaleControl",
  /** Banco receptor (ej. "BBVA", "STP"). */
  bank: process.env.SPEI_BANK || "",
  /** CLABE interbancaria de 18 digitos. */
  clabe: process.env.SPEI_CLABE || "",
  /** Concepto/referencia sugerida para la transferencia (opcional). */
  reference: process.env.SPEI_REFERENCE || "",
  /** Instrucciones que se muestran a la clinica al iniciar la recarga. */
  instructions:
    process.env.SPEI_INSTRUCTIONS ||
    "Transfiere el monto exacto por SPEI a la CLABE indicada y sube tu comprobante. Acreditaremos tu saldo cuando confirmemos el pago, normalmente el mismo dia habil.",
} as const;
