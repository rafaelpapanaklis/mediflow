/**
 * Caja (ws1-t1): el PIN nuevo SIEMPRE se escribe dos veces; «Cambiar mi PIN»
 * pide el actual; «¿Olvidaste tu PIN?» solo explica.
 *
 * `npm run test:caja-pin-equipo`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claveDelTextoOlvidePin, cuerpoDePinNuevo, soloDigitosDelPin, validarCambioDePin, validarPinDoble } from "../pin-doble";

const AQUI = join(__dirname, "..");
const leer = (f: string) => readFileSync(join(AQUI, f), "utf8");
const dic = (l: "es" | "en") => JSON.parse(readFileSync(join(AQUI, "..", "..", "..", "i18n", "dictionaries", `${l}.json`), "utf8"));

test("dos PIN idénticos de 6 dígitos: se continúa", () => {
  assert.deepEqual(validarPinDoble("482913", "482913"), { ok: true, pin: "482913" });
});

test("no coinciden: no se continúa, con el motivo", () => {
  assert.deepEqual(validarPinDoble("482913", "482914"), { ok: false, motivo: "no-coinciden" });
  assert.deepEqual(validarPinDoble("482913", ""), { ok: false, motivo: "no-coinciden" });
});

test("de 6 dígitos EXACTOS: ni 5, ni 7, ni letras — aunque sean idénticos", () => {
  for (const pin of ["12345", "1234567", "abcdef", "12 456", ""]) {
    assert.deepEqual(validarPinDoble(pin, pin), { ok: false, motivo: "formato" }, JSON.stringify(pin));
  }
});

test("el campo deja solo dígitos y corta a 6", () => {
  assert.equal(soloDigitosDelPin("12a3-45 6789"), "123456");
});

test("cambiar mi PIN: exige el actual de 6 dígitos", () => {
  const r = validarCambioDePin({ tieneActual: true, actual: "", nuevo: "482913", confirmacion: "482913" });
  assert.deepEqual(r, { ok: false, motivo: "actual-formato" });
});

test("cambiar mi PIN: el nuevo dos veces idéntico; si no, no se manda", () => {
  const mal = validarCambioDePin({ tieneActual: true, actual: "111111", nuevo: "482913", confirmacion: "482910" });
  assert.deepEqual(mal, { ok: false, motivo: "no-coinciden" });
  const bien = validarCambioDePin({ tieneActual: true, actual: "111111", nuevo: "482913", confirmacion: "482913" });
  assert.deepEqual(bien, { ok: true, pin: "482913", currentPin: "111111" });
});

test("sin PIN todavía (primera vez o restablecido): no hay actual que pedir, sí las dos veces", () => {
  assert.deepEqual(validarCambioDePin({ tieneActual: false, actual: "", nuevo: "482913", confirmacion: "482913" }), { ok: true, pin: "482913" });
  assert.deepEqual(validarCambioDePin({ tieneActual: false, actual: "", nuevo: "482913", confirmacion: "x" }), { ok: false, motivo: "no-coinciden" });
});

test("el cuerpo a /api/caja/pin SIEMPRE lleva pinConfirm; currentPin solo al cambiar", () => {
  assert.deepEqual(cuerpoDePinNuevo({ pin: "482913", confirmacion: "482913" }), { action: "set", pin: "482913", pinConfirm: "482913" });
  assert.deepEqual(
    cuerpoDePinNuevo({ pin: "482913", confirmacion: "482913", currentPin: "111111" }),
    { action: "set", pin: "482913", pinConfirm: "482913", currentPin: "111111" },
  );
});

test("«¿Olvidaste tu PIN?» dice lo que dijo Rafael, en es y en en", () => {
  assert.equal(dic("es").cashRegister.pin.olvidaste, "¿Olvidaste tu PIN?");
  assert.equal(dic("es").cashRegister.pin.olvidasteTexto, "Pídele al dueño de la clínica que lo restablezca en Equipo.");
  assert.ok(dic("en").cashRegister.pin.olvidasteTexto.length > 10);
  assert.equal(dic("es").cashRegister.pin.noCoinciden, "Los PIN no coinciden, escríbelo igual las dos veces.");
});

test("es y en traen las mismas claves de cashRegister.pin", () => {
  assert.deepEqual(Object.keys(dic("es").cashRegister.pin).sort(), Object.keys(dic("en").cashRegister.pin).sort());
});

test("cableado: abrir Caja por primera vez valida las dos con validarPinDoble y manda pinConfirm", () => {
  const c = leer("caja-client.tsx");
  assert.match(c, /validarPinDoble\(openPin, openPinConfirm\)/);
  assert.match(c, /cuerpoDePinNuevo\(\{ pin: openPin, confirmacion: openPinConfirm \}\)/);
  // Antes de pedir el PIN al servidor, el rechazo corta (return) sin llamar.
  const i = c.indexOf("validarPinDoble(openPin, openPinConfirm)");
  const j = c.indexOf('post("/api/caja/pin"');
  assert.ok(i > 0 && j > i, "la validación va ANTES del POST");
});

test("cableado: «Cambiar mi PIN» y «¿Olvidaste tu PIN?» están donde se pide el PIN", () => {
  const c = leer("caja-client.tsx");
  assert.equal((c.match(/<OlvidePin esSuperAdmin=\{esSuperAdmin\} \/>/g) ?? []).length, 3, "apertura, retiro y cierre");
  assert.equal((c.match(/<OlvidePin/g) ?? []).length, 3, "ninguno sin el rol");
  assert.match(c, /data-cambiar-pin/);
  assert.match(c, /<ModalCambiarPin/);
  const m = leer("pin-caja.tsx");
  assert.match(m, /cuerpoDePinNuevo\(\{ pin: r\.pin, confirmacion, currentPin: r\.currentPin \}\)/);
  // La validación corta antes del fetch.
  assert.ok(m.indexOf("validarCambioDePin(") < m.indexOf('fetch("/api/caja/pin"'));
});

test("abrir, retirar y cerrar siguen pidiendo el PIN igual que hoy (verify por servidor)", () => {
  const c = leer("caja-client.tsx");
  assert.match(c, /post\("\/api\/caja\/open", \{ openingBalance: bal, pin: openPin \}/);
  assert.match(c, /post\("\/api\/caja\/withdrawal", \{ amount: amt, reason: wReason\.trim\(\), pin: wPin \}/);
  assert.match(c, /pin: closePin,/);
});

// ── ws1-t1 (3 detalles de la revisión): «¿Olvidaste tu PIN?» del dueño ─────

test("«¿Olvidaste tu PIN?»: el dueño lee «Restablécelo…»; cualquier otro rol, «Pídele al dueño…»", () => {
  assert.equal(claveDelTextoOlvidePin(true), "cashRegister.pin.olvidasteTextoDueno");
  assert.equal(claveDelTextoOlvidePin(false), "cashRegister.pin.olvidasteTexto");
  const es = dic("es").cashRegister.pin;
  assert.equal(es.olvidasteTextoDueno, "Restablécelo en Equipo, en tu propia ficha.");
  assert.equal(es.olvidasteTexto, "Pídele al dueño de la clínica que lo restablezca en Equipo.");
  assert.ok(dic("en").cashRegister.pin.olvidasteTextoDueno.length > 10);
});

test("el rol sale del servidor (user.role de page.tsx) y llega a los cuatro sitios del PIN", () => {
  const page = readFileSync(join(AQUI, "page.tsx"), "utf8");
  assert.match(page, /esSuperAdmin=\{user\.role === "SUPER_ADMIN"\}/);
  const c = leer("caja-client.tsx");
  // Ni un fetch ni una deducción del rol en el cliente.
  assert.doesNotMatch(c, /role\s*===\s*["']SUPER_ADMIN["']/);
  assert.match(c, /<ModalCambiarPin[^>]*esSuperAdmin=\{esSuperAdmin\}/s);
  const m = leer("pin-caja.tsx");
  assert.match(m, /t\(claveDelTextoOlvidePin\(esSuperAdmin\)\)/);
  assert.match(m, /<OlvidePin esSuperAdmin=\{esSuperAdmin\} \/>/);
});

// ── «Cambiar mi PIN» arriba y nada que salte al cargar ───────────────────────

test("«Cambiar mi PIN» es lo primero de la pantalla: antes de CobrosFueraDeCorte y de la lista", () => {
  const c = leer("caja-client.tsx");
  const pin = c.indexOf("data-cambiar-pin");
  const fuera = c.indexOf("<CobrosFueraDeCorte");
  const rama = c.indexOf("{rediseno ? (\n        /* CAJA REESTRUCTURADA");
  assert.ok(pin > 0 && fuera > pin && rama > fuera, "PIN → fuera de corte → encabezado");
  // Una sola fila, fuera de las dos ramas (se ve igual con el rediseño y sin él).
  assert.equal((c.match(/data-cambiar-pin/g) ?? []).length, 1);
});

test("lo que carga en cliente va al FINAL y nada vive debajo: no empuja Abrir caja", () => {
  const c = leer("caja-client.tsx");
  const inicioRoot = c.indexOf("{rediseno ? (\n        /* CAJA REESTRUCTURADA");
  const bloque = c.indexOf("data-avisos-tardios");
  const modalAbrir = c.indexOf("{/* ── Modal: Abrir caja");
  assert.ok(inicioRoot > 0 && bloque > inicioRoot && modalAbrir > bloque, "tras las dos ramas y antes de los modales (que flotan)");
  // Los cuatro avisos que se piden a la red están en ese bloque, y ya no arriba.
  const cierreBloque = c.indexOf("</div>", bloque);
  const dentro = c.slice(bloque, cierreBloque);
  for (const a of ["<AvisoAnticiposPorRevisar />", "<AjustesDineroCaja", "<AvisoCobrosAutomaticos />", "<ListaMensualidades />"]) {
    assert.ok(dentro.includes(a), a);
    assert.equal(c.split(a).length - 1, 1, `${a} aparece una sola vez`);
  }
  // Y el contenedor vacío no deja hueco.
  const css = readFileSync(join(AQUI, "..", "..", "..", "components", "dashboard", "caja-rediseno", "avisos-caja.module.css"), "utf8");
  assert.match(css, /\.tardios:empty\s*\{\s*display:\s*none;/);
});

test("CobrosFueraDeCorte es del servidor (props): se queda arriba sin ningún viaje", () => {
  const c = leer("caja-client.tsx");
  assert.match(c, /<CobrosFueraDeCorte cobros=\{caja\.fueraDeCorte\}/);
});
