/**
 * La tarjeta de detalles al pasar el mouse (decisión de Rafael, 28-oct-2026) — la parte PURA.
 *
 * Run: npm run test:agenda-detalles-al-pasar
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avisosAlPasar,
  CacheDeDetalles,
  claveDeDetalles,
  confirmoPorWhatsapp,
  detallesDesdeRespuesta,
  edadEnAnios,
  estadoAlPasar,
  posicionDeLaTarjeta,
  RETARDO_DETALLES_MS,
  type DetallesPesados,
} from "../detalles-al-pasar";

const TZ = "America/Mexico_City";

test("edad: años cumplidos en el día de la CLÍNICA (no del servidor); sin fecha o absurda, null", () => {
  const dob = new Date("1990-10-28T00:00:00Z");
  // 28-oct 03:00Z = 27-oct 21:00 en CDMX: aún no cumple.
  assert.equal(edadEnAnios(dob, new Date("2026-10-28T03:00:00Z"), TZ), 35);
  assert.equal(edadEnAnios(dob, new Date("2026-10-28T18:00:00Z"), TZ), 36);
  assert.equal(edadEnAnios("2020-02-29T00:00:00Z", new Date("2026-02-28T18:00:00Z"), TZ), 5);
  assert.equal(edadEnAnios(null, new Date(), TZ), null);
  assert.equal(edadEnAnios("no-es-fecha", new Date(), TZ), null);
  assert.equal(edadEnAnios("2030-01-01T00:00:00Z", new Date("2026-01-01T18:00:00Z"), TZ), null, "nacido en el futuro");
});

test("el retardo es ~300 ms (pasar por encima sin detenerse no pide nada)", () => {
  assert.ok(RETARDO_DETALLES_MS >= 250 && RETARDO_DETALLES_MS <= 400);
});

const DET: DetallesPesados = {
  paciente: { edad: 34, primeraVez: false, telefono: "55 1234 5678" },
  alergias: ["Penicilina"],
  confirmadaPorWhatsapp: true,
  enEstaCita: [{ id: "f1", nombre: "Resina 16 (MO)", importe: 700, estado: "pendiente" }],
  debeHoy: 700,
};

test("caché por cita: vale su vigencia, luego se vuelve a pedir; no crece sin fin", () => {
  const c = new CacheDeDetalles(60_000, 3);
  c.guardar("a", DET, 1_000);
  assert.equal(c.leer("a", 30_000), DET);
  assert.equal(c.leer("a", 62_000), null, "pasada la vigencia");
  for (const k of ["a", "b", "c", "d"]) c.guardar(k, DET, 100_000);
  assert.equal(c.leer("a", 100_001), null, "la más vieja salió");
  assert.equal(c.leer("d", 100_001), DET);
});

test("la llave cambia si la cita cambia de estado u hora (lo pedido ya no vale)", () => {
  const base = { id: "a1", estado: "CONFIRMED", dto: { startsAt: "2026-10-28T16:00:00Z", endsAt: "2026-10-28T16:30:00Z" } };
  const k = claveDeDetalles(base);
  assert.notEqual(k, claveDeDetalles({ ...base, estado: "CHECKED_IN" }));
  assert.notEqual(k, claveDeDetalles({ ...base, dto: { ...base.dto, startsAt: "2026-10-28T17:00:00Z" } }));
  assert.equal(k, claveDeDetalles({ ...base }));
});

test("la respuesta del servidor se lee sin confiar en su forma", () => {
  assert.equal(detallesDesdeRespuesta(null), null);
  assert.equal(detallesDesdeRespuesta("x"), null);
  const r = detallesDesdeRespuesta({
    paciente: { edad: "34", primeraVez: "sí", telefono: "  " },
    alergias: ["Látex", 3, " ", " Penicilina "],
    enEstaCita: [{ id: "f1", nombre: "Resina", importe: "700.5", estado: "hecho" }, { nombre: "sin id" }],
    debeHoy: -5,
  })!;
  assert.deepEqual(r, {
    paciente: { edad: null, primeraVez: false, telefono: null },
    alergias: ["Látex", "Penicilina"],
    confirmadaPorWhatsapp: false,
    enEstaCita: [{ id: "f1", nombre: "Resina", importe: 700.5, estado: "hecho" }],
    debeHoy: 0,
  });
});

test("confirmada POR WHATSAPP: la respuesta al recordatorio es la que confirmó (±2 min); si no, solo «Confirmada»", () => {
  const c = "2026-10-27T15:00:00Z";
  assert.equal(confirmoPorWhatsapp(c, [{ repliedAt: "2026-10-27T15:00:01Z" }]), true);
  assert.equal(confirmoPorWhatsapp(c, [{ repliedAt: "2026-10-27T14:00:00Z" }]), false, "contestó otra cosa una hora antes");
  assert.equal(confirmoPorWhatsapp(null, [{ repliedAt: c }]), false);
  assert.equal(confirmoPorWhatsapp(c, []), false);
});

test("estado (v2, m5): el MISMO chip que la cita, más lo que la cita dice en su segunda línea", () => {
  const c = (estado: string, chip: string, e: number | null = null, k: number | null = null) => ({
    estado,
    chip,
    minutosEsperando: e,
    minutosEnConsulta: k,
  });
  assert.deepEqual(estadoAlPasar(c("SCHEDULED", "Agendada"), null), { chip: "Agendada", extra: "sinConfirmar", minutos: null });
  assert.deepEqual(estadoAlPasar(c("CONFIRMED", "Confirmada"), null), { chip: "Confirmada", extra: null, minutos: null }, "mientras llega lo pesado");
  assert.equal(estadoAlPasar(c("CONFIRMED", "Confirmada"), true).extra, "porWhatsapp");
  assert.deepEqual(
    estadoAlPasar(c("CHECKED_IN", "Registrado · 12 min", 12), null),
    { chip: "Registrado · 12 min", extra: null, minutos: null },
    "los minutos ya van en el chip: no se repiten",
  );
  assert.equal(estadoAlPasar(c("IN_CHAIR", "En sillón", 9), null).minutos, 9);
  assert.equal(estadoAlPasar(c("IN_CHAIR", "En sillón", 0), null).minutos, null, "«0 min» no se dice");
  assert.deepEqual(estadoAlPasar(c("IN_PROGRESS", "En consulta", null, 25), null), { chip: "En consulta", extra: null, minutos: 25 });
  assert.equal(estadoAlPasar(c("NO_SHOW", "No asistió"), null).chip, "No asistió");
});

test("avisos: anticipo pagado / apartada / pedido, mensualidad de orto vencida, sobreagendada, por validar", () => {
  const base = {
    estado: "SCHEDULED",
    notaAnticipo: null as string | null,
    avisoMensualidadVencida: false,
    sobreagendada: false,
    esperaValidacion: false,
    dto: {} as { anticipoPedido?: number; depositoPagado?: boolean },
  };
  assert.deepEqual(avisosAlPasar(base), []);
  assert.deepEqual(avisosAlPasar({ ...base, dto: { anticipoPedido: 300 } }), [{ clave: "anticipoPedido", monto: 300, tono: "ambar" }]);
  assert.deepEqual(
    avisosAlPasar({ ...base, notaAnticipo: "Apartada · paga antes de 19:00", dto: { anticipoPedido: 300 } }),
    [{ clave: "apartada", texto: "Apartada · paga antes de 19:00", tono: "ambar" }],
    "apartada manda sobre «pedido» (es lo mismo, con plazo)",
  );
  assert.deepEqual(avisosAlPasar({ ...base, estado: "CONFIRMED", notaAnticipo: "Anticipo pagado" }), [{ clave: "anticipoPagado", tono: "verde" }]);
  assert.deepEqual(avisosAlPasar({ ...base, estado: "CHECKED_IN", dto: { depositoPagado: true } }), [{ clave: "anticipoPagado", tono: "verde" }]);
  assert.deepEqual(
    avisosAlPasar({ ...base, avisoMensualidadVencida: true, sobreagendada: true, esperaValidacion: true }).map((a) => a.clave),
    ["mensualidadVencida", "sobreagendada", "porValidar"],
  );
});

test("posición: a la derecha si cabe, si no a la izquierda; nunca fuera de la ventana (también a 390 px)", () => {
  const ventana = { ancho: 1440, alto: 900 };
  const tarjeta = { ancho: 320, alto: 300 };
  assert.deepEqual(posicionDeLaTarjeta({ left: 100, top: 200, right: 300, bottom: 260 }, ventana, tarjeta), { left: 308, top: 200, lado: "derecha" });
  assert.deepEqual(posicionDeLaTarjeta({ left: 1200, top: 200, right: 1400, bottom: 260 }, ventana, tarjeta), { left: 872, top: 200, lado: "izquierda" });
  assert.equal(posicionDeLaTarjeta({ left: 100, top: 800, right: 300, bottom: 860 }, ventana, tarjeta).top, 592, "sube para caber");
  const angosta = posicionDeLaTarjeta({ left: 60, top: 100, right: 380, bottom: 160 }, { ancho: 390, alto: 800 }, { ancho: 320, alto: 300 });
  assert.ok(angosta.left >= 8 && angosta.left + 320 <= 390 - 8 + 0.01, JSON.stringify(angosta));
});

test("posición: si la cita ocupa casi todo el ancho (Día con un doctor), se ancla al puntero y no tapa el cursor", () => {
  const ventana = { ancho: 1440, alto: 900 };
  const tarjeta = { ancho: 320, alto: 300 };
  const ancha = { left: 120, top: 200, right: 1300, bottom: 312 };
  const p = posicionDeLaTarjeta(ancha, ventana, tarjeta, { x: 400, y: 250 });
  assert.deepEqual(p, { left: 416, top: 266, lado: "puntero" });
  const cerca = posicionDeLaTarjeta(ancha, ventana, tarjeta, { x: 1250, y: 800 });
  assert.equal(cerca.lado, "puntero");
  assert.ok(cerca.left + 320 <= 1250 - 16, "a la izquierda del cursor si a la derecha no cabe");
  assert.ok(cerca.top + 300 <= 800 - 16, "arriba del cursor si abajo no cabe");
  assert.equal(posicionDeLaTarjeta(ancha, ventana, tarjeta).lado, "derecha", "sin puntero, como siempre (y dentro)");
});
