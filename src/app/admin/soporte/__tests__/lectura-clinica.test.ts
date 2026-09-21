/**
 * CANDADOS DE «¿YA LEYÓ LA CLÍNICA NUESTRA RESPUESTA?» (/admin/soporte).
 *
 * Run: npx tsx --test src/app/admin/soporte/__tests__/lectura-clinica.test.ts
 *      npm run test:admin-soporte-lectura
 *
 * Dos mitades, como en `soporte-rediseno.test.ts`:
 *  1. La REGLA (`estadoLectura`) — son TRES estados y no dos.
 *  2. El CABLEADO — que la lista y la ficha pinten esa regla, que el dato
 *     llegue al DTO de admin y que no se cuele un hex a mano.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  estadoLectura,
  LECTURA_DETALLE,
  LECTURA_LABEL,
  type EstadoLectura,
} from "@/app/admin/soporte/lectura-clinica";

const SRC = join(__dirname, "..", "..", "..", ".."); // src/
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const lista = leer(join("app", "admin", "soporte", "soporte-admin-client.tsx"));
const ficha = leer(join("app", "admin", "soporte", "[id]", "ticket-admin-client.tsx"));
const etiqueta = leer(join("app", "admin", "soporte", "etiqueta-lectura.tsx"));
const tipos = leer(join("lib", "support", "types.ts"));
const service = leer(join("lib", "support", "service.ts"));

// ── 1. La regla ────────────────────────────────────────────────────────────

test("respondido y sin abrir → sin leer", () => {
  assert.equal(estadoLectura({ hasSupportReply: true, clinicUnread: true }), "sin-leer");
});

test("respondido y ya abierto → leído", () => {
  assert.equal(estadoLectura({ hasSupportReply: true, clinicUnread: false }), "leido");
});

test("SIN respuesta nuestra → ni sin leer ni leído", () => {
  // El caso que no se puede mezclar: no hay nada que la clínica pueda leer.
  // clinicUnread puede estar en true por un cambio de estado (service.ts
  // changeStatus lo levanta), y eso NO es "no ha visto nuestra respuesta".
  for (const clinicUnread of [true, false]) {
    const e = estadoLectura({ hasSupportReply: false, clinicUnread });
    assert.equal(e, "sin-respuesta");
    assert.notEqual(e, "sin-leer");
    assert.notEqual(e, "leido");
  }
});

test("tras leer, un cambio de estado la devuelve a «sin leer» — y la frase no miente", () => {
  // Contraejemplo real (lo cazó el refutador): la clínica abre el hilo
  // (clinicUnread=false) y DESPUÉS soporte mueve el estado; changeTicketStatus
  // vuelve a poner clinicUnread=true sin tocar lastSupportMessageAt.
  // El estado que sale es "sin-leer" — y está bien, porque hay una novedad
  // nuestra sin abrir — pero la frase NO puede afirmar que no vio la respuesta.
  assert.equal(estadoLectura({ hasSupportReply: true, clinicUnread: true }), "sin-leer");
  const frase = LECTURA_DETALLE["sin-leer"];
  assert.match(frase, /novedad/, "la frase tiene que hablar de «novedad», no de «la respuesta»");
  assert.equal(
    /NO ha abierto nuestra respuesta/.test(frase),
    false,
    "afirmar que no abrió LA RESPUESTA es falso tras un cambio de estado posterior a la lectura",
  );
});

test("los tres estados tienen etiqueta y frase propias", () => {
  const estados: EstadoLectura[] = ["sin-respuesta", "sin-leer", "leido"];
  const labels = estados.map((e) => LECTURA_LABEL[e]);
  const frases = estados.map((e) => LECTURA_DETALLE[e]);
  for (const t of [...labels, ...frases]) {
    assert.ok(t && t.trim().length > 0, "texto vacío");
  }
  assert.equal(new Set(labels).size, 3, "etiquetas repetidas");
  assert.equal(new Set(frases).size, 3, "frases repetidas");
});

// ── 2. El cableado ─────────────────────────────────────────────────────────

test("el DTO de admin trae el dato, y sale de lastSupportMessageAt", () => {
  assert.match(tipos, /hasSupportReply: boolean/);
  assert.match(service, /hasSupportReply: t\.lastSupportMessageAt != null/);
});

test("la lista pinta la columna y deja filtrar por «sin leer»", () => {
  assert.match(lista, /<th>Leído<\/th>/);
  assert.match(lista, /<EtiquetaLectura estado=\{estadoLectura\(t\)\}/);
  assert.match(lista, /soloSinLeer/);
  assert.match(lista, /sinLeerCount/);
  // El filtro client-side tiene que contar como filtro, o el vacío "global"
  // aparecería con tickets traídos del server.
  assert.match(lista, /hasExtraFilters = [^\n]*soloSinLeer/);
});

test("la lista no se dejó columnas descuadradas", () => {
  const cols = (lista.match(/<th[ >]/g) ?? []).length;
  const colCount = Number(/const COL_COUNT = (\d+)/.exec(lista)?.[1]);
  const skel = /const SKEL_WIDTHS = \[([^\]]+)\]/.exec(lista)?.[1].split(",").length;
  assert.equal(cols, colCount, "COL_COUNT no coincide con los <th>");
  assert.equal(skel, colCount, "SKEL_WIDTHS no coincide con los <th>");
});

test("la ficha lo enseña, y el aviso fuerte solo cuando NO lo ha leído", () => {
  assert.match(ficha, /Leído por la clínica/);
  assert.match(ficha, /estadoLectura\(ticket\) === "sin-leer" && <EtiquetaLectura estado="sin-leer"/);
});

test("se lee por forma además de por color, y sin hex a mano", () => {
  // Dos iconos distintos: ojo tachado (sin leer) y doble palomita (leído).
  assert.match(etiqueta, /EyeOff/);
  assert.match(etiqueta, /CheckCheck/);
  // Tonos por BadgeNew (tokens), nunca un #rrggbb escrito aquí.
  assert.match(etiqueta, /<BadgeNew tone=/);
  for (const [nombre, texto] of [
    ["etiqueta-lectura.tsx", etiqueta],
    ["lectura-clinica.ts", leer(join("app", "admin", "soporte", "lectura-clinica.ts"))],
  ] as const) {
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(texto), false, `hex a mano en ${nombre}`);
  }
});

test("nadie tocó la lógica de clinicUnread", () => {
  // Se enseña el dato; no se "mejora" su ciclo de vida.
  assert.match(service, /data: \{ clinicUnread: false \}/); // la clínica abre el hilo
  assert.match(service, /clinicUnread: true,/); // soporte responde
});
