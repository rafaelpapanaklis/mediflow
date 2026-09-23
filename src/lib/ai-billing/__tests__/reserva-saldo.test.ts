/**
 * NO SE PUEDE GASTAR SIN TENER SALDO (H6 de la auditoría del 22-sep-2026).
 *
 * Run: npm run test:ai-reserva
 *
 * Antes: `canSpend` solo pedía `balanceCents > 0` y el cobro llegaba después,
 * sin suelo. Con 1 centavo y las 20 preguntas a Sabina que deja pasar el freno,
 * todas pasaban el chequeo a la vez y el monedero acababa en ≈ −$102.
 *
 * Qué fija:
 *   · la regla: el costo estimado cuenta, las reservas vivas cuentan, y sin
 *     estimación `canSpend` dice exactamente lo mismo que antes;
 *   · CONCURRENCIA: N llamadas a la vez con saldo para k dejan pasar k, y el
 *     saldo final nunca baja del piso aunque todas cuesten su peor caso;
 *   · la reserva se suelta al terminar (la siguiente pregunta pasa), y una que
 *     nadie soltó deja de contar al caducar;
 *   · sin la tabla `ai_wallet_holds` (SQL sin aplicar) no deja a nadie sin IA;
 *   · el bot (`chatMetered`) no llama a Claude si no alcanza, y cuando llama,
 *     cobra y suelta la reserva.
 *
 * Con el doble de `_monedero-doble.ts`, donde el candado lo toma el propio
 * `SELECT … FOR UPDATE` de `reservarSaldo`: quitándolo, estas pruebas fallan.
 * La prueba con Postgres real está en el reporte de la rama.
 */
import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { crearMonederoDoble, instalarDobles } from "./_monedero-doble";
import { costoEstimadoCents, decidirGasto, tokensPorTexto, RESERVA_TTL_MS } from "../reserva-core";
import { computeCostUsdMicros, pricingConfigFromRows, usdMicrosToBilledCents } from "../pricing-core";
import { GRACE_OVERDRAFT_CENTS } from "../types";

const base = crearMonederoDoble();
instalarDobles({ "src/lib/prisma.ts": { prisma: base.prisma } });

let wallet: typeof import("../wallet");
let meter: typeof import("../meter");

const CLINICA = "clinica_norte";
const OTRA = "clinica_sur";
const cfg = pricingConfigFromRows([]);

/** El peor caso de una pregunta a Sabina, igual que `llamadasPeorPregunta()` de /api/sabina. */
const PEOR_PREGUNTA = [
  { model: "claude-haiku-4-5", veces: 5, entrada: 3_000, cacheLectura: 9_000, salida: 1_200 },
  { model: "claude-haiku-4-5", entrada: 0, salida: 0, cacheEscritura: 9_000 },
  { model: "claude-sonnet-4-6", veces: 5, entrada: 3_000, cacheLectura: 9_000, salida: 1_200 },
  { model: "claude-sonnet-4-6", entrada: 0, salida: 0, cacheEscritura: 9_000 },
];

let llamadasAClaude = 0;
let ultimoUso = { input_tokens: 0, output_tokens: 0 };

before(async () => {
  process.env.ANTHROPIC_API_KEY = "sk-prueba-no-es-real";
  // Anthropic de mentira con un uso CREÍBLE: ~4 caracteres por token de entrada
  // y una salida que nunca pasa de max_tokens, como la API de verdad.
  globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
    assert.equal(String(url), "https://api.anthropic.com/v1/messages", "solo se habla con Anthropic");
    llamadasAClaude++;
    const cuerpo = JSON.parse(init?.body ?? "{}");
    const uso = {
      input_tokens: Math.ceil(((cuerpo.system ?? "").length + JSON.stringify(cuerpo.messages).length) / 4),
      output_tokens: Math.min(120, cuerpo.max_tokens),
    };
    ultimoUso = uso;
    await new Promise((r) => setTimeout(r, 5));
    return new Response(JSON.stringify({ content: [{ type: "text", text: "Hola" }], usage: uso }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  wallet = await import("../wallet");
  meter = await import("../meter");
});

beforeEach(() => {
  base.reiniciar();
  llamadasAClaude = 0;
});

async function monederoCon(clinicId: string, balanceCents: number, extra: Record<string, unknown> = {}) {
  await base.prisma.aiWallet.create({ data: { clinicId, balanceCents, ...extra } });
}

/**
 * Barrera: nadie cobra hasta que las `n` hayan pedido su reserva. Así «a la
 * vez» es a la vez de verdad: ninguna termina y suelta la suya antes de que
 * lleguen las demás (lo que dejaría pasar más, y con razón).
 */
function barrera(n: number) {
  let llegadas = 0;
  let abrir!: () => void;
  const abierta = new Promise<void>((r) => (abrir = r));
  return async () => {
    if (++llegadas >= n) abrir();
    await abierta;
  };
}

/** Una pregunta entera, como la hace /api/sabina: reservar → llamar → cobrar → soltar. */
async function pregunta(
  clinicId: string,
  estimado: number,
  cuesta: { model: string; entrada: number; salida: number },
  esperarALasDemas?: () => Promise<void>,
) {
  const reserva = await wallet.reservarSaldo(clinicId, "sabina", estimado);
  if (esperarALasDemas) await esperarALasDemas();
  if (!reserva) return false;
  try {
    await new Promise((r) => setTimeout(r, 1 + Math.random() * 10)); // la llamada a Claude
    await wallet.chargeUsage({
      clinicId, feature: "sabina", model: cuesta.model, inputTokens: cuesta.entrada, outputTokens: cuesta.salida,
    });
    return true;
  } finally {
    await wallet.liberarReserva(reserva);
  }
}

/* ── La regla, sin base ─────────────────────────────────────────────────── */

test("sin costo estimado, la regla es la de siempre: saldo > 0, o > −gracia con auto-recarga y tarjeta", () => {
  const w = (balanceCents: number, extra: Record<string, unknown> = {}) => ({
    status: "ACTIVE", balanceCents, autoRecharge: false, stripePaymentMethodId: null, ...extra,
  });
  assert.equal(decidirGasto(w(1), 0, 1).puede, true);
  assert.equal(decidirGasto(w(0), 0, 1).puede, false);
  assert.equal(decidirGasto(w(-5), 0, 1).puede, false);
  assert.equal(decidirGasto(w(500, { status: "PAUSED" }), 0, 1).puede, false);
  const conTarjeta = { autoRecharge: true, stripePaymentMethodId: "pm_1" };
  assert.equal(decidirGasto(w(-GRACE_OVERDRAFT_CENTS + 1, conTarjeta), 0, 1).puede, true);
  assert.equal(decidirGasto(w(-GRACE_OVERDRAFT_CENTS, conTarjeta), 0, 1).puede, false);
  assert.equal(decidirGasto(w(0, conTarjeta), 0, 1).sobregiro, true, "en sobregiro hay que disparar la recarga");
  // Auto-recarga SIN tarjeta no da sobregiro (como antes).
  assert.equal(decidirGasto(w(0, { autoRecharge: true }), 0, 1).puede, false);
});

test("con costo estimado y reservas vivas: tiene que alcanzar para lo que falta por pagar", () => {
  const w = { status: "ACTIVE", balanceCents: 1_000, autoRecharge: false, stripePaymentMethodId: null };
  assert.equal(decidirGasto(w, 0, 1_000).puede, true, "justo alcanza");
  assert.equal(decidirGasto(w, 0, 1_001).puede, false);
  assert.equal(decidirGasto(w, 600, 500).puede, false, "lo reservado por otra llamada ya no está libre");
  assert.equal(decidirGasto(w, 600, 400).puede, true);
});

test("la estimación nunca queda por debajo de lo que se cobra por esas mismas llamadas", () => {
  for (const model of ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-sonnet-5", "modelo-que-no-existe"]) {
    for (const [i, o, r, w] of [[0, 0, 0, 0], [1, 1, 0, 0], [1_500, 300, 0, 0], [3_000, 1_200, 9_000, 9_000]]) {
      const real = usdMicrosToBilledCents(computeCostUsdMicros(model, i, o, r, cfg, w), cfg);
      const est = costoEstimadoCents([{ model, entrada: i, salida: o, cacheLectura: r, cacheEscritura: w }], cfg);
      assert.ok(est >= real && est >= 1, `${model} ${i}/${o}: estimado ${est} < cobrado ${real}`);
    }
  }
  // El peor caso de Sabina es el que calculó la auditoría (≈ $5.12), más el centavo de margen.
  assert.equal(costoEstimadoCents(PEOR_PREGUNTA, cfg), 513);
  assert.equal(tokensPorTexto(9), 5, "a 2 caracteres por token, redondeando hacia arriba");
});

/* ── Concurrencia ───────────────────────────────────────────────────────── */

test("el caso de la auditoría: 1 centavo y 20 preguntas a la vez → no pasa ninguna y el saldo no se mueve", async () => {
  await monederoCon(CLINICA, 1);
  const estimado = costoEstimadoCents(PEOR_PREGUNTA, cfg);
  const aLaVez = barrera(20);
  const pasaron = await Promise.all(
    Array.from({ length: 20 }, () =>
      pregunta(CLINICA, estimado, { model: "claude-sonnet-4-6", entrada: 30_000, salida: 12_000 }, aLaVez),
    ),
  );
  assert.equal(pasaron.filter(Boolean).length, 0);
  assert.equal(base.monedero(CLINICA)!.balanceCents, 1);
});

test("saldo para UNA pregunta de peor caso y 20 a la vez: pasa una, y el saldo no queda negativo aunque cueste el máximo", async () => {
  const estimado = costoEstimadoCents(PEOR_PREGUNTA, cfg);
  await monederoCon(CLINICA, estimado + 300); // alcanza para una, no para dos
  // Cada pregunta cuesta lo MÁXIMO que se reservó (el peor caso de verdad).
  const cuestaElMaximo = async () => {
    const reserva = await wallet.reservarSaldo(CLINICA, "sabina", estimado);
    if (!reserva) return false;
    try {
      await new Promise((r) => setTimeout(r, Math.random() * 10));
      for (const l of PEOR_PREGUNTA) {
        for (let v = 0; v < (l.veces ?? 1); v++) {
          await wallet.chargeUsage({
            clinicId: CLINICA, feature: "sabina", model: l.model, inputTokens: l.entrada, outputTokens: l.salida,
            cacheTokens: l.cacheLectura ?? 0, cacheWriteTokens: l.cacheEscritura ?? 0,
          });
        }
      }
      return true;
    } finally {
      await wallet.liberarReserva(reserva);
    }
  };
  const pasaron = await Promise.all(Array.from({ length: 20 }, cuestaElMaximo));
  assert.equal(pasaron.filter(Boolean).length, 1);
  const final = base.monedero(CLINICA)!.balanceCents;
  // Hasta aquí, un par de centavos de redondeo (un redondeo por cobro, 12 cobros): tolerable.
  assert.ok(final >= 300 - 12, `el saldo quedó en ${final}`);
  assert.ok(base.medidor.esperas > 0, "las reservas no llegaron a cruzarse: la prueba no prueba nada");
});

test("bot: saldo para 3 mensajes y 20 a la vez → pasan 3, y ninguno deja el saldo bajo cero", async () => {
  await monederoCon(CLINICA, 100);
  const aLaVez = barrera(20);
  const pasaron = await Promise.all(
    Array.from({ length: 20 }, () => pregunta(CLINICA, 30, { model: "claude-sonnet-4-6", entrada: 400, salida: 60 }, aLaVez)),
  );
  assert.equal(pasaron.filter(Boolean).length, 3);
  assert.ok(base.medidor.esperas > 0, "las reservas no llegaron a cruzarse: la prueba no prueba nada");
  assert.ok(base.monedero(CLINICA)!.balanceCents >= 0);
});

test("las reservas son por clínica: lo que reserva una no le quita saldo a otra", async () => {
  await monederoCon(CLINICA, 600);
  await monederoCon(OTRA, 600);
  const a = await wallet.reservarSaldo(CLINICA, "sabina", 513);
  const b = await wallet.reservarSaldo(OTRA, "sabina", 513);
  assert.ok(a && b);
  assert.equal(await wallet.reservarSaldo(CLINICA, "sabina", 513), null);
  await wallet.liberarReserva(a);
  await wallet.liberarReserva(b);
});

/* ── Soltar y caducar ───────────────────────────────────────────────────── */

test("tras cobrar lo real y soltar la reserva, la siguiente pregunta pasa: no se queda muda a media conversación", async () => {
  await monederoCon(CLINICA, 1_100); // dos reservas de 513 no caben a la vez, pero una tras otra sí
  for (let i = 0; i < 5; i++) {
    assert.equal(
      await pregunta(CLINICA, 513, { model: "claude-haiku-4-5", entrada: 2_000, salida: 200 }),
      true,
      `la pregunta ${i + 1} no pasó`,
    );
  }
  assert.equal(base.tablas.aiWalletHold.filas.length, 0, "quedaron reservas colgadas");
  // Y cuando lo que queda ya no alcanza para el peor caso, dice que no (antes de llegar a 0).
  base.monedero(CLINICA)!.balanceCents = 400;
  assert.equal(await pregunta(CLINICA, 513, { model: "claude-haiku-4-5", entrada: 2_000, salida: 200 }), false);
});

test("una reserva que nadie soltó (el proceso murió) deja de contar al caducar", async () => {
  await monederoCon(CLINICA, 600);
  const colgada = await wallet.reservarSaldo(CLINICA, "sabina", 513);
  assert.ok(colgada);
  assert.equal(await wallet.reservarSaldo(CLINICA, "sabina", 513), null, "mientras vive, cuenta");
  // Pasa el plazo.
  base.tablas.aiWalletHold.filas[0].expiresAt = new Date(Date.now() - 1);
  assert.ok(await wallet.reservarSaldo(CLINICA, "sabina", 513), "caducada, ya no debería contar");
  assert.equal(base.tablas.aiWalletHold.filas.length, 1, "la caducada se barre al reservar");
  assert.ok(base.tablas.aiWalletHold.filas[0].expiresAt.getTime() - Date.now() <= RESERVA_TTL_MS);
});

test("canSpend descuenta lo reservado por otras llamadas en curso", async () => {
  await monederoCon(CLINICA, 600);
  assert.equal(await wallet.canSpend(CLINICA), true);
  const r = await wallet.reservarSaldo(CLINICA, "whatsapp_bot", 600);
  assert.equal(await wallet.canSpend(CLINICA), false, "todo el saldo está reservado");
  await wallet.liberarReserva(r);
  assert.equal(await wallet.canSpend(CLINICA), true);
  assert.equal(await wallet.canSpend(CLINICA, 601), false, "con costo estimado, tiene que alcanzar");
});

/* ── Sin la tabla (SQL sin aplicar) ─────────────────────────────────────── */

test("si falta la tabla de reservas, decide con el costo estimado y no deja a nadie sin IA", async () => {
  await monederoCon(CLINICA, 600);
  const original = base.prisma.aiWalletHold;
  const sinTabla = () => Promise.reject(Object.assign(new Error("The table `public.ai_wallet_holds` does not exist"), { code: "P2021" }));
  base.prisma.aiWalletHold = { deleteMany: sinTabla, aggregate: sinTabla, create: sinTabla };
  const errores: unknown[] = [];
  const consola = console.error;
  console.error = (...a: unknown[]) => { errores.push(a); };
  try {
    const r = await wallet.reservarSaldo(CLINICA, "sabina", 513);
    assert.ok(r, "con saldo para la pregunta, pasa");
    assert.equal(r!.id, null, "sin tabla no hay reserva que soltar");
    await wallet.liberarReserva(r);
    assert.equal(await wallet.reservarSaldo(CLINICA, "sabina", 601), null, "el costo estimado sigue contando");
    assert.equal(await wallet.canSpend(CLINICA), true);
  } finally {
    base.prisma.aiWalletHold = original;
    console.error = consola;
  }
  assert.ok(errores.length <= 1, "el aviso de la tabla que falta sale una vez, no en cada llamada");
});

/* ── El bot de WhatsApp (chatMetered) ───────────────────────────────────── */

test("bot sin saldo para el mensaje: no llama a Claude y devuelve un error (el bot deriva a una persona)", async () => {
  await monederoCon(CLINICA, 2);
  const r = await meter.chatMetered(CLINICA, "whatsapp_bot", {
    model: "claude-sonnet-4-6", maxTokens: 300, system: "x".repeat(4_000), messages: [{ role: "user", content: "hola" }],
  });
  assert.equal(r.error, meter.ERROR_SIN_SALDO);
  assert.equal(llamadasAClaude, 0, "llamó a Claude sin saldo");
  assert.equal(base.monedero(CLINICA)!.balanceCents, 2);
});

test("bot con saldo: llama, cobra lo real y suelta la reserva", async () => {
  await monederoCon(CLINICA, 5_000);
  const r = await meter.chatMetered(CLINICA, "whatsapp_bot", {
    model: "claude-sonnet-4-6", maxTokens: 300, messages: [{ role: "user", content: "hola" }],
  });
  assert.equal(r.text, "Hola");
  assert.equal(llamadasAClaude, 1);
  const cobrado = usdMicrosToBilledCents(
    computeCostUsdMicros("claude-sonnet-4-6", ultimoUso.input_tokens, ultimoUso.output_tokens, 0, cfg),
    cfg,
  );
  assert.ok(cobrado > 0);
  assert.equal(base.monedero(CLINICA)!.balanceCents, 5_000 - cobrado);
  assert.equal(base.tablas.aiWalletHold.filas.length, 0, "la reserva quedó colgada");
});

test("bot: 20 mensajes a la vez con saldo para pocos → Claude recibe solo los que se pueden pagar", async () => {
  const estimado = costoEstimadoCents(
    [{ model: "claude-sonnet-4-6", entrada: tokensPorTexto(JSON.stringify([{ role: "user", content: "hola" }]).length), salida: 300 }],
    cfg,
  );
  await monederoCon(CLINICA, estimado * 2 + 1);
  const res = await Promise.all(
    Array.from({ length: 20 }, () =>
      meter.chatMetered(CLINICA, "whatsapp_bot", { model: "claude-sonnet-4-6", maxTokens: 300, messages: [{ role: "user", content: "hola" }] }),
    ),
  );
  assert.ok(llamadasAClaude >= 2 && llamadasAClaude <= res.length, `llamadas: ${llamadasAClaude}`);
  assert.equal(res.filter((r) => r.error === meter.ERROR_SIN_SALDO).length, 20 - llamadasAClaude);
  assert.ok(base.monedero(CLINICA)!.balanceCents >= 0, `saldo final ${base.monedero(CLINICA)!.balanceCents}`);
});
