import "server-only";
import { prisma } from "@/lib/prisma";
import type { AiWallet } from "@prisma/client";
import { computeCostUsdMicros, getPricingConfig, usdMicrosToBilledCents } from "./pricing";
import { triggerAutoRechargeIfNeeded } from "./recharge";
import { RESERVA_TTL_MS, costoEstimadoCents, decidirGasto, type LlamadaEstimada } from "./reserva-core";
import type { ChargeUsageInput, ChargeUsageResult } from "./types";

/**
 * Monedero de IA por clínica: alta perezosa, control de gasto y cobro ATÓMICO
 * del consumo del bot. Multi-tenant: SIEMPRE por clinicId. Dinero en centavos
 * MXN (Int). billedCents ya incluye fx + fee (la clínica nunca ve USD ni %).
 */

/** Devuelve el monedero de la clínica; lo crea (saldo 0) si no existe. */
export async function getOrCreateWallet(clinicId: string): Promise<AiWallet> {
  return prisma.aiWallet.upsert({
    where: { clinicId },
    create: { clinicId },
    update: {},
  });
}

/**
 * ¿La clínica puede gastar IA ahora, en una llamada que cuesta como mucho
 * `costoEstimadoCents`? Descuenta del saldo lo que ya tienen reservado otras
 * llamadas en curso. Con auto-recarga + tarjeta se permite el sobregiro de
 * gracia (hasta -GRACE_OVERDRAFT_CENTS) y se dispara la recarga. Si no, false
 * (el motor del bot cae a handoff; la FAQ por reglas sigue siendo gratis).
 *
 * Es solo una CONSULTA: no reserva nada, así que dos llamadas a la vez pueden
 * pasarla las dos. Sirve como filtro barato antes de preparar la llamada; la
 * puerta de verdad es `reservarSaldo`. Sin costo estimado se comporta como
 * siempre: basta con 1 centavo libre.
 */
export async function canSpend(clinicId: string, costoEstimadoCents = 1): Promise<boolean> {
  const wallet = await getOrCreateWallet(clinicId);
  const decision = decidirGasto(wallet, await reservadoVivo(clinicId), costoEstimadoCents);
  if (decision.puede && decision.sobregiro) {
    // Marca para recargar (best-effort; nunca bloquea la respuesta).
    void triggerAutoRechargeIfNeeded(clinicId);
  }
  return decision.puede;
}

/** Una reserva de saldo en curso. `id: null` = se decidió sin tabla de reservas (SQL sin aplicar). */
export interface ReservaSaldo {
  id: string | null;
  clinicId: string;
  amountCents: number;
}

/**
 * Lo que COMO MUCHO van a costar estas llamadas, en centavos MXN, con el
 * precio, el fx y el fee vigentes (los mismos que usará `chargeUsage`).
 */
export async function estimarCostoCents(llamadas: readonly LlamadaEstimada[]): Promise<number> {
  return costoEstimadoCents(llamadas, await getPricingConfig());
}

/**
 * La puerta de verdad antes de llamar a Claude (H6). Decide si alcanza el saldo
 * para `costoEstimadoCents` y, si alcanza, lo RESERVA en la misma transacción,
 * con la fila del monedero bloqueada (FOR UPDATE): dos llamadas a la vez de la
 * misma clínica pasan por aquí de una en una, y la segunda ya ve la reserva de
 * la primera. Así 20 preguntas simultáneas con saldo para 2 dejan pasar 2, no 20.
 *
 * Devuelve null si no alcanza (el llamador hace lo mismo que con `canSpend` en
 * false). La reserva hay que soltarla con `liberarReserva` al terminar, cuando
 * ya se cobró lo real; si nadie la suelta, caduca sola a los RESERVA_TTL_MS.
 *
 * Si la tabla `ai_wallet_holds` todavía no existe (sql/ai-wallet-holds.sql sin
 * aplicar), decide igual con el costo estimado pero sin reservar, y lo avisa en
 * el log: mejor que dejar a todas las clínicas sin IA hasta que se pegue el SQL.
 */
export async function reservarSaldo(
  clinicId: string,
  feature: string,
  costoEstimadoCents: number,
): Promise<ReservaSaldo | null> {
  const estimado = Math.max(1, Math.ceil(costoEstimadoCents));
  // El FOR UPDATE necesita que la fila exista.
  await getOrCreateWallet(clinicId);

  let resultado: { reserva: ReservaSaldo | null; sobregiro: boolean };
  try {
    resultado = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ai_wallets WHERE "clinicId" = ${clinicId} FOR UPDATE`;
      const wallet = await tx.aiWallet.findUnique({ where: { clinicId } });
      if (!wallet) return { reserva: null, sobregiro: false };

      const ahora = new Date();
      // Las caducadas no cuentan; se barren aquí para que la tabla no crezca.
      await tx.aiWalletHold.deleteMany({ where: { clinicId, expiresAt: { lte: ahora } } });
      const vivas = await tx.aiWalletHold.aggregate({
        where: { clinicId, expiresAt: { gt: ahora } },
        _sum: { amountCents: true },
      });

      const decision = decidirGasto(wallet, vivas._sum.amountCents ?? 0, estimado);
      if (!decision.puede) return { reserva: null, sobregiro: false };

      const hold = await tx.aiWalletHold.create({
        data: { clinicId, feature, amountCents: estimado, expiresAt: new Date(ahora.getTime() + RESERVA_TTL_MS) },
      });
      return { reserva: { id: hold.id, clinicId, amountCents: estimado }, sobregiro: decision.sobregiro };
    });
  } catch (e) {
    if (!faltaTablaDeReservas(e)) throw e;
    avisarFaltaTablaDeReservas();
    const wallet = await getOrCreateWallet(clinicId);
    const decision = decidirGasto(wallet, 0, estimado);
    resultado = {
      reserva: decision.puede ? { id: null, clinicId, amountCents: estimado } : null,
      sobregiro: decision.sobregiro,
    };
  }

  if (resultado.reserva && resultado.sobregiro) void triggerAutoRechargeIfNeeded(clinicId);
  return resultado.reserva;
}

/**
 * Suelta una reserva. Va en un `finally`, DESPUÉS de cobrar lo real: soltarla
 * antes dejaría un instante en que ni la reserva ni el cobro cuentan. Nunca
 * lanza: si falla, la reserva caduca sola.
 */
export async function liberarReserva(reserva: ReservaSaldo | null | undefined): Promise<void> {
  if (!reserva?.id) return;
  try {
    await prisma.aiWalletHold.deleteMany({ where: { id: reserva.id, clinicId: reserva.clinicId } });
  } catch (e) {
    console.error("[ai-billing] no se pudo soltar la reserva de saldo; caduca sola", {
      clinicId: reserva.clinicId,
      err: e instanceof Error ? e.message : "desconocido",
    });
  }
}

/** Centavos reservados por llamadas en curso de la clínica (0 si aún no hay tabla). */
async function reservadoVivo(clinicId: string): Promise<number> {
  try {
    const vivas = await prisma.aiWalletHold.aggregate({
      where: { clinicId, expiresAt: { gt: new Date() } },
      _sum: { amountCents: true },
    });
    return vivas._sum.amountCents ?? 0;
  } catch (e) {
    if (!faltaTablaDeReservas(e)) throw e;
    avisarFaltaTablaDeReservas();
    return 0;
  }
}

/** P2021 = la tabla no existe (Prisma); 42P01 = lo mismo dicho por Postgres en una consulta cruda. */
function faltaTablaDeReservas(e: unknown): boolean {
  const err = e as { code?: string; meta?: { code?: string }; message?: string } | null;
  if (err?.code === "P2021") return true;
  if (err?.code === "P2010" && err.meta?.code === "42P01") return true;
  return typeof err?.message === "string" && err.message.includes("ai_wallet_holds") && err.message.includes("does not exist");
}

let avisadoFaltaTabla = false;
function avisarFaltaTablaDeReservas(): void {
  if (avisadoFaltaTabla) return;
  avisadoFaltaTabla = true;
  console.error(
    "[ai-billing] FALTA_TABLA_AI_WALLET_HOLDS: se decide sin reservar saldo; aplica sql/ai-wallet-holds.sql",
  );
}

/**
 * Cobra una llamada facturable: calcula costo (USD) → centavos MXN (fee oculto)
 * y, en UNA transacción, descuenta el saldo (decremento ATÓMICO, sin carrera de
 * sobregiro) y registra AiUsageEvent + AiWalletTransaction(CHARGE). Tras cobrar,
 * dispara la auto-recarga si el saldo quedó bajo el umbral. NO llamar con tokens
 * en 0 ni con llamadas mock/error (de eso se encarga meter.ts). Devuelve null si
 * no había nada que cobrar.
 */
export async function chargeUsage(input: ChargeUsageInput): Promise<ChargeUsageResult | null> {
  const inputTokens = Math.max(0, Math.floor(input.inputTokens || 0));
  const outputTokens = Math.max(0, Math.floor(input.outputTokens || 0));
  const cacheTokens = Math.max(0, Math.floor(input.cacheTokens || 0));
  const cacheWriteTokens = Math.max(0, Math.floor(input.cacheWriteTokens || 0));
  if (inputTokens === 0 && outputTokens === 0 && cacheTokens === 0 && cacheWriteTokens === 0) return null;

  const cfg = await getPricingConfig();
  // 🔴 Los tokens de caché NO cuestan lo mismo: leer vale 0,1× la entrada y
  // escribir 1,25×, o sea 12,5 veces más. Meterlos en el mismo saco —como se
  // hacía antes de que Sabina cacheara— le cobraría de MÁS a la clínica en cada
  // primera pregunta y de menos en las siguientes. `computeCostUsdMicros` ya
  // sabía repartirlo (`pricing-core.ts`); lo que faltaba era pasárselo.
  const costUsdMicros = computeCostUsdMicros(
    input.model,
    inputTokens,
    outputTokens,
    cacheTokens,
    cfg,
    cacheWriteTokens,
  );
  const billedCents = usdMicrosToBilledCents(costUsdMicros, cfg);

  // Asegura el monedero ANTES de la TX (el update atómico exige que exista).
  await getOrCreateWallet(input.clinicId);

  const result = await prisma.$transaction(async (tx) => {
    // Decremento atómico: lee-y-escribe en una sola operación, así el
    // balanceAfter es consistente aunque haya cobros concurrentes.
    const updated = await tx.aiWallet.update({
      where: { clinicId: input.clinicId },
      data: { balanceCents: { decrement: billedCents } },
    });

    const event = await tx.aiUsageEvent.create({
      data: {
        clinicId: input.clinicId,
        feature: input.feature,
        model: input.model,
        inputTokens,
        outputTokens,
        // La columna guarda el TOTAL de tokens de caché (lectura + escritura),
        // igual que en `record-usage.ts`: el reparto por precio ya quedó dentro
        // de `costUsdMicros`, y así esto no depende de un SQL sin aplicar.
        cacheTokens: cacheTokens + cacheWriteTokens,
        costUsdMicros,
        fxRate: cfg.usdToMxnRate,
        feePct: cfg.feePct,
        billedCents,
        threadId: input.threadId ?? null,
      },
    });

    await tx.aiWalletTransaction.create({
      data: {
        clinicId: input.clinicId,
        type: "CHARGE",
        amountCents: -billedCents,
        balanceAfterCents: updated.balanceCents,
        source: "USAGE",
        reference: event.id,
      },
    });

    return {
      billedCents,
      balanceAfterCents: updated.balanceCents,
      eventId: event.id,
      autoRecharge: updated.autoRecharge,
      thresholdCents: updated.autoRechargeThresholdCents,
    };
  });

  // Auto-recarga si quedó bajo el umbral (best-effort, fuera de la TX).
  if (result.autoRecharge && result.balanceAfterCents < result.thresholdCents) {
    void triggerAutoRechargeIfNeeded(input.clinicId);
  }

  return {
    billedCents: result.billedCents,
    balanceAfterCents: result.balanceAfterCents,
    eventId: result.eventId,
  };
}
