/**
 * Tercera auditoría de uso, grupo G6 (ws1-t8, ronda final, 4-oct-2026):
 * N-57 (el costo de Saldo IA no cuadraba con la regla que anunciaba) y las
 * siete Bajas F-02…F-08 de REPORTE-ws1-t12 (tercera auditoría).
 *
 * Run: npm run test:auditoria-uso-g6-final
 * Fallan con el código de antes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { desgloseConsumo, separarCache, NOTA_COSTO_CONSUMO } from "../ai-billing/consumo-legible";
import { ANTHROPIC_MODEL_PRICES } from "../ai-billing/pricing-core";
import { franjaDelDia, timeGreeting } from "../home/greet";
import { resumenDeCambio, resumenDeEdicion } from "../admin/audit-core";
import { TEXTOS_EQUIPO } from "../../app/dashboard/team/textos-equipo";

const SRC = join(__dirname, "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const HAIKU = ANTHROPIC_MODEL_PRICES["claude-haiku-4-5"];
const SONNET = ANTHROPIC_MODEL_PRICES["claude-sonnet-4-6"];

/** Lo que cobra la regla con un reparto dado (micro-USD). */
const costo = (p: typeof HAIKU, entrada: number, salida: number, releido: number, guardado: number) =>
  entrada * p.inputUsdPerMtok + salida * p.outputUsdPerMtok + releido * p.cacheReadUsdPerMtok + guardado * p.cacheWriteUsdPerMtok;

// ── N-57 · las filas «iguales» de la auditoría ─────────────────────────────
test("N-57: dos filas con los mismos tokens ($0.05 y $0.11) se distinguen por lo guardado en memoria", () => {
  // Filas reales de la clínica de prueba (1-oct-2026, Sabina, Haiku): 337 / 20 / 18,665 de caché.
  const barata = separarCache({ model: "claude-haiku-4-5", inputTokens: 337, outputTokens: 20, cacheTokens: 18665, costUsdMicros: 2304 }, HAIKU);
  const cara = separarCache({ model: "claude-haiku-4-5", inputTokens: 337, outputTokens: 20, cacheTokens: 18665, costUsdMicros: 5103 }, HAIKU);
  assert.equal(barata.guardado, 0);
  assert.ok(cara.guardado > 2400 && cara.guardado < 2450, String(cara.guardado));
  // Con el reparto, la regla da EXACTAMENTE el costo cobrado (±2 µUSD de redondeo).
  assert.ok(Math.abs(costo(HAIKU, 337, 20, cara.releido, cara.guardado) - 5103) <= 2);
});

test("N-57: 336 / 19 escritos que costó $0.48 fue guardar en memoria TODO el contexto", () => {
  const r = separarCache({ model: "claude-haiku-4-5", inputTokens: 336, outputTokens: 19, cacheTokens: 17870, costUsdMicros: 22769 }, HAIKU);
  assert.equal(r.guardado, 17870);
  assert.equal(r.releido, 0);
});

test("N-57: el «estándar» de $1.46 contra el de $0.33 (mismos ~31 mil de contexto)", () => {
  const caro = separarCache({ model: "claude-sonnet-4-6", inputTokens: 985, outputTokens: 185, cacheTokens: 31412, costUsdMicros: 69339 }, SONNET);
  const barato = separarCache({ model: "claude-sonnet-4-6", inputTokens: 998, outputTokens: 230, cacheTokens: 31412, costUsdMicros: 15868 }, SONNET);
  assert.ok(caro.guardado > 15000, String(caro.guardado));
  assert.equal(barato.guardado, 0);
  for (const [r, e, s, c] of [[caro, 985, 185, 69339], [barato, 998, 230, 15868]] as const) {
    assert.ok(Math.abs(costo(SONNET, e, s, r.releido, r.guardado) - c) <= 2);
  }
});

test("N-57: la tabla enseña lo guardado aparte y la nota dice la regla real", () => {
  assert.deepEqual(desgloseConsumo({ model: "x", inputTokens: 337, outputTokens: 20, cacheTokens: 18665, cacheGuardado: 2434 }), { leidos: 16568, guardados: 2434, escritos: 20, total: 19022 });
  assert.match(NOTA_COSTO_CONSUMO.es, /guardar el contexto en memoria la primera vez cuesta unas 12 veces más que releerlo/);
  assert.match(leer("app/api/ai-wallet/route.ts"), /cacheGuardado: separarCache\(e, resolveModelPrice\(e\.model, precios\)\.price\)\.guardado/);
  for (const f of ["components/dashboard/whatsapp-rediseno/saldo.tsx", "app/dashboard/whatsapp/bot/saldo/saldo-client.tsx"]) {
    assert.match(leer(f), /desgloseConsumo\(u\)\.guardados/, f);
  }
});

// ── F-02 · saludo ───────────────────────────────────────────────────────────
test("F-02: Inicio y Mensajes cortan el saludo a la misma hora (a las 03:00 es de noche)", () => {
  assert.equal(franjaDelDia(3), "noche");
  assert.equal(franjaDelDia(6), "manana");
  assert.equal(franjaDelDia(13), "tarde");
  assert.equal(franjaDelDia(20), "noche");
  assert.equal(timeGreeting(new Date("2026-10-04T09:00:00Z"), "America/Mexico_City"), "Buenas noches"); // 03:00 en CDMX
  assert.match(leer("app/dashboard/inbox/inbox-client.tsx"), /const franja = franjaDelDia\(h\);/);
});

// ── F-03 ────────────────────────────────────────────────────────────────────
test("F-03: bajo «Total activos» el inactivo es uno más, no «incluido»", () => {
  assert.equal(TEXTOS_EQUIPO.es.incluyeInactivos(1), "Hay 1 inactivo más (filtro «Inactivos»)");
  assert.equal(TEXTOS_EQUIPO.es.incluyeInactivos(3), "Hay 3 inactivos más (filtro «Inactivos»)");
});

// ── F-04 ────────────────────────────────────────────────────────────────────
test("F-04: las «Edición» de Usuario y Caja dicen qué pasó", () => {
  assert.equal(resumenDeCambio({ entityType: "user", changes: { phone: { before: null, after: "5550001234" } } }), "Editó Usuario: Teléfono");
  assert.equal(
    resumenDeCambio({ entityType: "user", changes: { especialidad: { before: null, after: "x" }, cedulaProfesional: { before: null, after: "1" }, cedulaEspecialidad: { before: null, after: "2" } } }),
    "Editó Usuario: Especialidad (cédula), Cédula profesional y Cédula de especialidad",
  );
  assert.equal(resumenDeEdicion({ entityType: "cash-register", changes: null }), "Movimiento en la caja (retiro o corte)");
  assert.equal(resumenDeEdicion({ entityType: "cash-register", changes: { withdrawal: { before: undefined, after: { amount: 200 } } } }), "Retiro de caja de $200");
});

// ── F-05 ────────────────────────────────────────────────────────────────────
test("F-05: las casillas de «Días festivos» crecen con el dedo", () => {
  assert.match(leer("components/dashboard/bloqueos/bloqueos.module.css"), /@media \(pointer: coarse\) \{\s*\.casilla \{\s*width: 22px;[\s\S]*\.festivoEtiqueta \{\s*min-height: 40px;/);
});

// ── F-06 ────────────────────────────────────────────────────────────────────
test("F-06: Anticipos y los bloqueos usan el formato único del panel", () => {
  assert.match(leer("app/dashboard/settings/anticipos/anticipos-client.tsx"), /return fechaHoraPanel\(iso, tz\);/);
  assert.match(leer("components/dashboard/bloqueos/lista-bloqueos.tsx"), /cuando: fechaPanel\(b\.creadoEl, timezone, locale\)/);
});

// ── F-07 ────────────────────────────────────────────────────────────────────
test("F-07: ni «hero» ni «FIEL/SAT» en los textos", () => {
  for (const f of ["i18n/dictionaries/es.json", "i18n/dictionaries/en.json"]) {
    const t = leer(f);
    assert.doesNotMatch(t, /FIEL\/SAT|del hero|Hero background/, f);
  }
});

// ── F-08 ────────────────────────────────────────────────────────────────────
test("F-08: Asistente IA no repite «Tokens usados este mes» en una tarjeta aparte", () => {
  const ajustes = leer("app/dashboard/settings/settings-client.tsx");
  assert.doesNotMatch(ajustes, /<Estadistica valor=\{aiUsed\.toLocaleString\(\)\}/);
  assert.doesNotMatch(ajustes, /label:t\("settings\.client\.aiTokensUsedThisMonth"\), val:aiUsed/);
});

// ── F-09 (comprobación final) ───────────────────────────────────────────────
test("F-09: Caja › Facturas cabe en 390: la fila de acciones y el selector «Enviar a» se encogen", () => {
  const css = leer("components/dashboard/factura-ficha-rediseno/ficha.module.css");
  // La fila de acciones no puede ser más ancha que la ficha (min-width:auto la estiraba a 414 de 338)…
  assert.match(css, /^\.fichaAcciones \{ min-width: 0; \}/m);
  // …ni la etiqueta, que además no parte «Enviar a» en dos renglones…
  assert.match(css, /^\.fichaAcciones > label\.motivo \{ min-width: 0; max-width: 100%; white-space: nowrap; \}/m);
  // …y el selector encoge (sin crecer en escritorio) y recorta el nombre del responsable.
  assert.match(css, /^\.fichaAcciones > label\.motivo > select \{ flex: 0 1 auto; min-width: 0; max-width: 100%; text-overflow: ellipsis; \}/m);
});
