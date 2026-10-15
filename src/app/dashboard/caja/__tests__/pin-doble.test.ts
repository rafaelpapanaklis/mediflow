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
  // ws1-t2: abajo solo quedan los dos que se piden a la red y no son alertas de dinero.
  const cierreBloque = c.indexOf("</div>", bloque);
  const dentro = c.slice(bloque, cierreBloque);
  for (const a of ["<AjustesDineroCaja", "<ListaMensualidades />"]) {
    assert.ok(dentro.includes(a), a);
    assert.equal(c.split(a).length - 1, 1, `${a} aparece una sola vez`);
  }
  assert.ok(!dentro.includes("<AvisoAnticiposPorRevisar") && !dentro.includes("<AvisoCobrosAutomaticos"), "las alertas de dinero ya no van abajo");
  // Y el contenedor vacío no deja hueco.
  const css = readFileSync(join(AQUI, "..", "..", "..", "components", "dashboard", "caja-rediseno", "avisos-caja.module.css"), "utf8");
  assert.match(css, /\.tardios:empty\s*\{\s*display:\s*none;/);
});

// ── ws1-t2: las alertas de dinero, ARRIBA y con la página ───────────────────

test("las alertas de dinero van arriba (tras «Cambiar mi PIN», antes del encabezado), una vez cada una y con datos del servidor", () => {
  const c = leer("caja-client.tsx");
  const pin = c.indexOf("data-cambiar-pin");
  const bloque = c.indexOf("data-avisos-dinero");
  const rama = c.indexOf("{rediseno ? (\n        /* CAJA REESTRUCTURADA");
  assert.ok(pin > 0 && bloque > pin && rama > bloque, "PIN → alertas de dinero → encabezado");
  const dentro = c.slice(bloque, c.indexOf("</div>", bloque));
  const orden = [
    "<AvisoAnticiposPorRevisar items={avisosDeDinero.anticipos} />",
    "<CobrosFueraDeCorte cobros={caja.fueraDeCorte}",
    "<AvisoCobrosAutomaticos items={avisosDeDinero.cobrosAutomaticos} />",
  ];
  let antes = -1;
  for (const a of orden) {
    const i = dentro.indexOf(a);
    assert.ok(i > antes, `${a} dentro del bloque y en orden`);
    antes = i;
    assert.equal(c.split(a).length - 1, 1, `${a} aparece una sola vez`);
  }
  // El mismo contenedor con el rediseño y sin él: nada de clase según la rama.
  assert.match(c, /<div className=\{avisosCaja\.superior\} data-avisos-dinero>/);
  // Con las tres calladas no deja hueco.
  const css = readFileSync(join(AQUI, "..", "..", "..", "components", "dashboard", "caja-rediseno", "avisos-caja.module.css"), "utf8");
  assert.match(css, /\.superior:empty\s*\{\s*display:\s*none;/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "sin hex");
});

test("page.tsx trae las alertas con las MISMAS funciones que sus rutas, por clinicId de la sesión y en paralelo", () => {
  const p = leer("page.tsx");
  // Las mismas funciones que GET /api/anticipos/por-revisar y GET /api/cobro-automatico/por-revisar.
  assert.match(p, /import \{ anticiposPorRevisar \} from "@\/lib\/anticipos\/avisos-recepcion\.server"/);
  assert.match(p, /import \{ porRevisar as cobrosAutomaticosPorRevisar \} from "@\/lib\/cobro-automatico\/servicio\.server"/);
  const rutaA = readFileSync(join(AQUI, "..", "..", "api", "anticipos", "por-revisar", "route.ts"), "utf8");
  const rutaC = readFileSync(join(AQUI, "..", "..", "api", "cobro-automatico", "por-revisar", "route.ts"), "utf8");
  assert.match(rutaA, /anticiposPorRevisar\(ctx\.clinicId\)/);
  assert.match(rutaC, /porRevisar\(ctx\.clinicId\)/);
  // Tenant de la sesión, nunca del cliente.
  assert.match(p, /anticiposPorRevisar\(user\.clinicId\)/);
  assert.match(p, /cobrosAutomaticosPorRevisar\(user\.clinicId\)/);
  // Se lanzan ANTES de la primera tanda y se esperan después de la segunda: no en serie.
  const lanza = p.indexOf("const avisosDeDinero = Promise.all([");
  const tanda1 = p.indexOf("const [caja, history, invoices, patients, clinic, creditTotal] = await Promise.all([");
  const tanda2 = p.indexOf("const [paidAgg, totalInvoices, monthInvoices, rediseno, historiaMigrada] = await Promise.all([");
  const espera = p.indexOf("= await avisosDeDinero;");
  assert.ok(lanza > 0 && tanda1 > lanza && tanda2 > tanda1 && espera > tanda2, "lanza → tanda 1 → tanda 2 → espera");
  // Después del portón de Caja: quien no puede usar Caja no las consulta.
  assert.ok(p.indexOf("if (!canUseCaja(user))") < lanza);
  // Si una falla, se calla (no tumba Caja).
  const tanda = p.slice(lanza, tanda1);
  assert.equal((tanda.match(/\.catch\(/g) ?? []).length, 2);
  assert.match(p, /avisosDeDinero=\{\{ anticipos: anticiposAlerta, cobrosAutomaticos: cobrosAutomaticosAlerta \}\}/);
});

test("los avisos con `items` del servidor no se piden a la red; sin `items`, como siempre", () => {
  const raiz = join(AQUI, "..", "..", "..", "components");
  for (const f of [join(raiz, "dashboard", "billing", "aviso-anticipos-por-revisar.tsx"), join(raiz, "cobro-automatico", "AvisoCobrosAutomaticos.tsx")]) {
    const c = readFileSync(f, "utf8");
    assert.match(c, /\{ items: delServidor \}: \{ items\?: /, f);
    assert.match(c, /useState<[^>]+>\(delServidor \?\? null\)/, f);
    assert.match(c, /if \(delServidor\) \{ setItems\(delServidor\); return; \}\n\s+let vivo = true;\n\s+fetch\(/, f);
  }
});

test("CobrosFueraDeCorte es del servidor (props): se queda arriba sin ningún viaje", () => {
  const c = leer("caja-client.tsx");
  assert.match(c, /<CobrosFueraDeCorte cobros=\{caja\.fueraDeCorte\}/);
});
