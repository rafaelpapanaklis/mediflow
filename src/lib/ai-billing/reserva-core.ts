/**
 * Núcleo PURO de la reserva de saldo (H6 de la auditoría del 22-sep-2026): sin
 * Prisma, sin red y sin `server-only`, para probar la regla sin base de datos
 * (`npm run test:ai-reserva`). `wallet.ts` lo envuelve con el candado de la base.
 *
 * Hasta aquí, `canSpend` solo pedía `balanceCents > 0` y el cobro llegaba
 * DESPUÉS de la llamada, con un `decrement` sin suelo: con 1 centavo de saldo y
 * las 20 preguntas a Sabina que deja el freno, el monedero acababa en ≈ −$102.
 *
 * Ahora, antes de llamar a Claude, se RESERVA lo que la llamada puede costar:
 *
 *   disponible = saldo − reservas vivas de la clínica
 *   pasa       ⇔ disponible − costoEstimado ≥ piso
 *
 * El piso es 0, o −GRACE_OVERDRAFT_CENTS si la clínica tiene auto-recarga con
 * tarjeta (el sobregiro de gracia que ya existía). La reserva se suelta al
 * terminar la llamada, cuando ya se cobró lo real; si el proceso muere a medias,
 * caduca sola a los RESERVA_TTL_MS y no deja saldo bloqueado para siempre.
 */
import { resolveModelPrice, usdMicrosToBilledCents } from "./pricing-core";
import { GRACE_OVERDRAFT_CENTS, type PricingConfig } from "./types";

/**
 * Vida máxima de una reserva que nadie soltó. Tiene que ser más larga que la
 * llamada más larga que protege: Sabina tiene `maxDuration = 60` s y el bot y
 * la redacción web van por debajo. Si el proceso muere, la reserva deja de
 * contar pasado este plazo.
 */
export const RESERVA_TTL_MS = 3 * 60 * 1000;

/**
 * Tokens de un texto, a lo PRUDENTE: 2 caracteres por token. El español ronda
 * los 3,5–4 y el JSON los 3; contar de más solo reserva de más durante unos
 * segundos, contar de menos deja pasar una llamada que no alcanza a pagarse.
 */
export function tokensPorTexto(caracteres: number): number {
  return Math.max(0, Math.ceil(caracteres / 2));
}

/** Una llamada (o un grupo de llamadas iguales) que se va a hacer. */
export interface LlamadaEstimada {
  model: string;
  entrada: number;
  salida: number;
  cacheLectura?: number;
  cacheEscritura?: number;
  /** Cuántas veces se repite esta llamada. Por defecto, 1. */
  veces?: number;
}

/**
 * Lo que COMO MUCHO se le va a cobrar a la clínica por estas llamadas, en
 * centavos MXN, con el mismo precio, fx y fee que usa `chargeUsage`. Se redondea
 * hacia arriba y nunca baja de 1 centavo: una reserva de 0 no reserva nada.
 *
 * El precio sale de `resolveModelPrice`, el mismo que usa
 * `computeCostUsdMicros`, pero sin su registro de «precio de respaldo»: eso se
 * apunta en cada COBRO, y una estimación no es un cobro.
 */
export function costoEstimadoCents(llamadas: readonly LlamadaEstimada[], cfg: PricingConfig): number {
  let micros = 0;
  for (const l of llamadas) {
    const veces = Math.max(1, Math.floor(l.veces ?? 1));
    const { price } = resolveModelPrice(l.model, cfg);
    micros +=
      veces *
      (Math.max(0, l.entrada) * price.inputUsdPerMtok +
        Math.max(0, l.salida) * price.outputUsdPerMtok +
        Math.max(0, l.cacheLectura ?? 0) * price.cacheReadUsdPerMtok +
        Math.max(0, l.cacheEscritura ?? 0) * price.cacheWriteUsdPerMtok);
  }
  return usdMicrosToBilledCents(Math.ceil(micros), cfg) + 1;
}

/** Lo que la regla necesita saber del monedero. */
export interface MonederoParaGastar {
  status: string;
  balanceCents: number;
  autoRecharge: boolean;
  stripePaymentMethodId: string | null;
}

/** Hasta dónde puede bajar el saldo: 0, o el sobregiro de gracia con auto-recarga + tarjeta. */
export function pisoDelMonedero(w: MonederoParaGastar): number {
  return w.autoRecharge && w.stripePaymentMethodId ? -GRACE_OVERDRAFT_CENTS : 0;
}

export interface DecisionDeGasto {
  /** ¿Se puede hacer la llamada? */
  puede: boolean;
  /** true si pasa gracias al sobregiro de gracia: toca disparar la auto-recarga. */
  sobregiro: boolean;
  /** Saldo que quedaría libre tras reservar (para el registro). */
  disponibleTrasReservar: number;
}

/**
 * La regla. Con `estimadoCents = 1` y sin reservas vivas es EXACTAMENTE la de
 * antes (`saldo > 0`, o `saldo > −gracia` con auto-recarga): así el `canSpend`
 * de siempre sigue diciendo lo mismo a quien no sabe cuánto va a gastar.
 */
export function decidirGasto(
  w: MonederoParaGastar,
  reservadoCents: number,
  estimadoCents: number,
): DecisionDeGasto {
  const estimado = Math.max(1, Math.ceil(estimadoCents));
  const despues = w.balanceCents - Math.max(0, reservadoCents) - estimado;
  if (w.status !== "ACTIVE") return { puede: false, sobregiro: false, disponibleTrasReservar: despues };
  if (despues < pisoDelMonedero(w)) return { puede: false, sobregiro: false, disponibleTrasReservar: despues };
  return { puede: true, sobregiro: despues < 0, disponibleTrasReservar: despues };
}
