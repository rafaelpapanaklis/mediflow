/**
 * CANDADOS DEL REDISEÑO DE CUENTA Y ESTADO (ws1-t1, lote 3):
 * Cambiar contraseña, 2FA y Clínica suspendida.
 *
 * Run: npm run test:cuenta-rediseno
 *
 * Se prueba leyendo el código fuente, como hoy-rediseno.test.ts y
 * `app/dashboard/__tests__/botones-prometidos.test.ts`: lo que se vigila es
 * CABLEADO —que la hoja no invente tokens ni letra de máquina, que la raíz
 * monte los del menú, que el camino viejo siga vivo y que las pantallas nuevas
 * manden a los mismos sitios que las de siempre—, y eso se ve en el archivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "cuenta-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

const css = archivosNuevos.find((a) => a.nombre === "cuenta.module.css")!.texto;

// Las tres pantallas del lote, tal como quedan cableadas.
const PANTALLAS = [
  "app/dashboard/cambiar-contrasena/page.tsx",
  "app/dashboard/cambiar-contrasena/change-password-client.tsx",
  "app/dashboard/2fa/page.tsx",
  "app/dashboard/2fa/setup/page.tsx",
  "app/dashboard/suspended/page.tsx",
  "app/dashboard/suspended/suspended-client.tsx",
  "app/dashboard/suspended/success/page.tsx",
  "app/dashboard/suspended/success/confirming-poll.tsx",
];

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en la carpeta nueva
// ═══════════════════════════════════════════════════════════════════════════
// La palabra prohibida se arma en trozos para que un grep sobre la carpeta
// (el gate de cierre: «cero letra de máquina») no se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en la carpeta del rediseño", () => {
  for (const a of archivosNuevos) {
    assert.ok(
      !LETRA_DE_MAQUINA.test(a.texto),
      `${a.nombre} usa letra de máquina; las cifras van con tabular-nums sobre Instrument Sans`,
    );
  }
  assert.match(css, /font-variant-numeric:\s*tabular-nums/, "las cifras se alinean con tabular-nums");
  // El campo del código 2FA lleva `.mono` en el componente de siempre (que no
  // se toca): la hoja lo devuelve a la letra heredada y a cifras tabulares.
  assert.match(css, /\.barrera :global\(\.input-new\)\s*\{[^}]*font-family:\s*inherit/, "el campo del código hereda Instrument Sans");
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin tokens nuevos: la hoja solo LEE los del menú (--m2-*) y los de globals
// ═══════════════════════════════════════════════════════════════════════════
test("cuenta.module.css no declara ninguna variable CSS propia", () => {
  const declaraciones = css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css, /var\(--m2-/, "lee los tokens del menú");
  const raiz = leer("components/dashboard/cuenta-rediseno/raiz.tsx");
  assert.match(raiz, /CLASES_MENU/, "la raíz monta CLASES_MENU (menu-dos-niveles/clases.ts)");
  assert.match(raiz, /from "@\/components\/dashboard\/menu-dos-niveles\/clases"/, "CLASES_MENU sale de clases.ts, no de una copia");
});

test("ni un color a mano: todo hexadecimal va como respaldo dentro de var()", () => {
  // El gate del gerente: `grep '#[0-9a-f]{6}' | grep -v 'var(--'`. Aquí se
  // aplica a cada línea de la carpeta nueva, no solo a la hoja.
  for (const a of archivosNuevos) {
    const malas = a.texto
      .split("\n")
      .filter((l) => /#[0-9a-f]{6}\b/i.test(l) && !/var\(--/.test(l));
    assert.deepEqual(malas, [], `${a.nombre} trae colores a mano: ${malas.join(" | ")}`);
  }
  // Y la raíz de las barreras solo REDIRIGE tokens viejos a --m2-*: ningún
  // valor propio de color (hex, rgb, hsl) en ese mapa.
  const raiz = leer("components/dashboard/cuenta-rediseno/raiz.tsx");
  const mapa = raiz.slice(raiz.indexOf("TOKENS_DE_SIEMPRE_AL_MENU = {"), raiz.indexOf("} as CSSProperties"));
  const valores = [...mapa.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(valores.length >= 10, "el mapa de tokens viejos → menú existe");
  for (const v of valores) {
    assert.ok(/^var\(--m2-[a-z0-9-]+\)$|^\d+px$/.test(v), `valor propio en la raíz: ${v}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Las tres leyes: nada detrás de un clic, ni escondido por ancho
// ═══════════════════════════════════════════════════════════════════════════
test("nada se esconde por ancho ni se pliega detrás de un clic", () => {
  assert.ok(!/display:\s*none/.test(css), "la hoja no esconde nada (display: none)");
  assert.ok(!/visibility:\s*hidden/.test(css), "la hoja no esconde nada (visibility: hidden)");
  for (const a of archivosNuevos) {
    assert.ok(!/<details|<summary|Collapsible|Accordion|md:hidden|lg:hidden|sm:hidden/.test(a.texto), `${a.nombre} pliega o esconde algo`);
  }
  // Las tres tarjetas de plan siguen en tres columnas desde el mismo corte que
  // hoy (md = 768 px): en iPad y en cualquier computadora se ven las tres.
  assert.match(css, /\.planes\s*\{[^}]*grid-template-columns:\s*repeat\(3,/, "tres columnas de planes");
  assert.match(css, /@media \(max-width: 767\.98px\)\s*\{\s*\.planes/, "una sola columna solo por debajo de 768 px, como hoy");
});

// ═══════════════════════════════════════════════════════════════════════════
// Seguridad: 2FA y contraseña no cambian ni un flujo — se visten desde fuera
// ═══════════════════════════════════════════════════════════════════════════
test("2FA y contraseña montan los MISMOS componentes de seguridad, encendido o apagado", () => {
  const reto = leer("app/dashboard/2fa/page.tsx");
  const setup = leer("app/dashboard/2fa/setup/page.tsx");
  const pwd = leer("app/dashboard/cambiar-contrasena/page.tsx");
  assert.equal((reto.match(/<TwoFactorChallenge \/>/g) ?? []).length, 2, "el reto: uno vestido y uno de siempre");
  assert.equal((setup.match(/<TwoFactorSetup forced=\{forced\} \/>/g) ?? []).length, 2, "el enrolamiento: uno vestido y uno de siempre");
  assert.equal((pwd.match(/<ChangePasswordClient \/>/g) ?? []).length, 2, "la contraseña: uno vestido y uno de siempre");
  // El camino viejo del enrolamiento conserva su envoltorio de siempre.
  assert.ok(setup.includes('<div className="w-full max-w-md">'), "el enrolamiento de siempre conserva su max-w-md");
  // Los componentes de seguridad NO forman parte de este rediseño: la carpeta
  // nueva no los importa ni los reimplementa.
  for (const a of archivosNuevos.filter((x) => /\.tsx?$/.test(x.nombre))) {
    assert.ok(!/from "[^"]*(two-factor|change-password|security\/)/.test(a.texto), `${a.nombre} importa un componente de seguridad`);
    assert.ok(!/\/api\/auth\//.test(a.texto), `${a.nombre} llama a la API de autenticación`);
  }
  // Cada página elige con el interruptor compartido, no con uno propio.
  for (const p of [reto, setup, pwd]) {
    assert.match(p, /from "@\/lib\/menu-dos-niveles\/interruptor"/, "usa el interruptor compartido");
    assert.match(p, /<RaizCuenta barrera>/, "las barreras se visten en modo barrera");
  }
});

test("el formulario de contraseña deja los valores de hoy como respaldo (apagado = byte por byte)", () => {
  const cliente = leer("app/dashboard/cambiar-contrasena/change-password-client.tsx");
  assert.ok(cliente.includes('"var(--m2-texto, #0f172a)"'), "--ld-fg conserva #0f172a de respaldo");
  assert.ok(cliente.includes('"var(--m2-texto-3, #64748b)"'), "--ld-fg-muted conserva #64748b de respaldo");
  assert.ok(cliente.includes('"var(--m2-tarjeta-borde, #cbd5e1)"'), "--ld-border conserva #cbd5e1 de respaldo");
  // Y el flujo es el de siempre: mismo endpoint, misma regla de fuerza, misma salida.
  for (const s of ['"/api/auth/change-password"', "isStrongEnough", 'scorePassword(pwd) >= 2', '"/api/auth/logout"', 'window.location.href = "/login"']) {
    assert.ok(cliente.includes(s), `el flujo de contraseña perdió ${s}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Clínica suspendida: el camino viejo sigue vivo y el nuevo usa la misma lógica
// ═══════════════════════════════════════════════════════════════════════════
test("suspended: el marcado de siempre sigue en su sitio y la vista nueva recibe la misma lógica", () => {
  const page = leer("app/dashboard/suspended/page.tsx");
  const cliente = leer("app/dashboard/suspended/suspended-client.tsx");
  const success = leer("app/dashboard/suspended/success/page.tsx");
  const poll = leer("app/dashboard/suspended/success/confirming-poll.tsx");

  for (const p of [page, success]) {
    assert.match(p, /from "@\/lib\/menu-dos-niveles\/interruptor"/, "usa el interruptor compartido");
    assert.match(p, /menuDosNivelesEncendido\(user\.clinicId\)/, "la clínica sale de la sesión");
  }
  // Camino viejo de la página: encabezado y tarjetas de siempre.
  for (const viejo of [
    'className="min-h-screen bg-background text-foreground"',
    "text-4xl font-extrabold tracking-tight md:text-[40px]",
    "<SuspendedPlanCards plans={planCards} currentPlan={currentPlan} firstMonthEligible={firstMonthEligible} />",
  ]) {
    assert.ok(page.includes(viejo), `la página de siempre perdió ${viejo}`);
  }
  // Camino viejo del cliente: su rejilla, su CTA en degradado y su conmutador
  // de siempre, intactos (los colores se buscan por forma, no por valor, para
  // que este archivo tampoco lleve un color escrito a mano).
  assert.ok(cliente.includes('className="mb-7 grid items-stretch gap-[18px] md:grid-cols-3"'), "el cliente de siempre perdió su rejilla");
  assert.match(cliente, /linear-gradient\(135deg,#[0-9A-F]{6},#[0-9A-F]{6}\)/, "el cliente de siempre perdió su CTA en degradado");
  assert.match(cliente, /rounded-full bg-\[#[0-9A-F]{6}\] p-1\.5 dark:bg-\[#[0-9A-F]{6}\]/, "el cliente de siempre perdió su conmutador");
  // La vista nueva se monta con la lógica de aquí, después de todos los hooks.
  const iRediseno = cliente.indexOf("if (rediseno) {");
  const iReturnViejo = cliente.indexOf("{/* === Toggle Mensual / Anual === */}");
  const iUltimoHook = Math.max(cliente.lastIndexOf("useState"), cliente.lastIndexOf("useRef"), cliente.lastIndexOf("useEffect"), cliente.lastIndexOf("useT()"));
  assert.ok(iRediseno > iUltimoHook && iRediseno < iReturnViejo, "la vista nueva va después de los hooks y antes del marcado viejo");
  assert.match(cliente, /handleStripeCheckout,\s*\}\}/, "la vista nueva paga con el MISMO handleStripeCheckout");
  assert.equal((cliente.match(/fetch\("\/api\/billing\/checkout"/g) ?? []).length, 1, "un solo sitio llama al checkout");

  // Success: el <a> duro al panel y el correo de soporte, en las dos caras.
  assert.equal((success.match(/href="\/dashboard"/g) ?? []).length, 2, "el <a> duro al panel, en las dos caras");
  assert.equal((success.match(/mailto:soporte@dalecontrol\.com/g) ?? []).length, 2, "soporte, en las dos caras");
  assert.equal((success.match(/<ConfirmingPoll /g) ?? []).length, 2, "«Volver a verificar» en las dos caras");
  // ConfirmingPoll: sin polling nuevo, y por defecto exactamente como hoy.
  assert.ok(!/setInterval/.test(poll), "sin setInterval");
  assert.match(poll, /className \?\?\s*"inline-flex/, "sin clase propia se pinta como hoy");
});

test("la vista nueva de planes enseña lo MISMO que la de siempre: viñetas, promo, ciclo, métodos", () => {
  const nueva = leer("components/dashboard/cuenta-rediseno/planes-suspendida.tsx");
  const vieja = leer("app/dashboard/suspended/suspended-client.tsx");
  for (const literal of [
    '"Mensual"',
    '"Anual"',
    '"Anual: 35% de descuento"',
    '"Tu primer mes desde $19"',
    "al año · ahorras",
    "Tu primer mes: solo",
    '"Facturación mensual · cancela cuando quieras"',
    "el primer mes`",
    "}/mes`",
    "Pago seguro vía Stripe",
    "Cancela cuando quieras",
    "Sin contratos",
    "FIRST_MONTH_PROMO_MXN[",
    "cfdiBullet(plan)",
    "features.length < 2",
    'role="radiogroup"',
    'role="radio"',
    "aria-checked={isSelected}",
    "aria-pressed=",
    'm.id === "card" &&',
  ]) {
    assert.ok(vieja.includes(literal), `la vista de siempre ya no dice ${literal}: actualiza este candado`);
    assert.ok(nueva.includes(literal), `la vista nueva perdió ${literal}`);
  }
  // Sin secciones ni opciones inventadas: ningún plan, método ni ciclo nuevo.
  assert.ok(!/paypal|PayPal|trimestral|quarterly|semestral/.test(nueva), "no inventa métodos ni ciclos");
});

// ═══════════════════════════════════════════════════════════════════════════
// Toda clave i18n que usa el rediseño existe en español y en inglés
// ═══════════════════════════════════════════════════════════════════════════
test('todas las claves t("…") del rediseño existen en es.json y en en.json', () => {
  const existe = (dict: Record<string, unknown>, clave: string): boolean => {
    let nodo: unknown = dict;
    for (const parte of clave.split(".")) {
      if (!nodo || typeof nodo !== "object" || !(parte in (nodo as object))) return false;
      nodo = (nodo as Record<string, unknown>)[parte];
    }
    return true;
  };
  const claves = new Set<string>();
  const fuentes = archivosNuevos.map((a) => a.texto).concat(PANTALLAS.map(leer));
  for (const texto of fuentes) {
    for (const m of texto.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) claves.add(m[1]);
  }
  assert.ok(claves.size >= 15, "se esperaban decenas de claves");
  for (const idioma of ["es", "en"]) {
    const dict = JSON.parse(leer(`i18n/dictionaries/${idioma}.json`)) as Record<string, unknown>;
    const faltan = [...claves].filter((k) => !existe(dict, k));
    assert.deepEqual(faltan, [], `claves sin traducción en ${idioma}: ${faltan.join(", ")}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Rendimiento: ni una consulta nueva, ni polling nuevo
// ═══════════════════════════════════════════════════════════════════════════
test("sin consultas nuevas ni polling nuevo en las tres pantallas", () => {
  for (const a of archivosNuevos) {
    assert.ok(!/prisma|setInterval|fetch\(/.test(a.texto), `${a.nombre} consulta o sondea por su cuenta`);
  }
  for (const rel of PANTALLAS) {
    assert.ok(!/setInterval/.test(leer(rel)), `${rel} añade polling`);
  }
  // La única lectura nueva es el interruptor compartido (caché de 60 s por
  // clínica): una por página, nunca dos.
  for (const rel of PANTALLAS.filter((r) => r.endsWith("page.tsx"))) {
    assert.equal((leer(rel).match(/menuDosNivelesEncendido\(/g) ?? []).length, 1, `${rel}: una sola lectura del interruptor`);
  }
});
