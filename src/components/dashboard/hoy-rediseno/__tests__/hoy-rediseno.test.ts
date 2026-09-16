/**
 * CANDADOS DEL REDISEÑO DE «HOY» (ws1-t3).
 *
 * Run: npx tsx --test src/components/dashboard/hoy-rediseno/__tests__/hoy-rediseno.test.ts
 *
 * Se prueba leyendo el código fuente, como `app/dashboard/__tests__/
 * botones-prometidos.test.ts`: lo que se vigila es CABLEADO (que la pantalla
 * nueva mande a los mismos sitios que la de siempre, que no invente tokens ni
 * letra de máquina, que el camino viejo siga vivo), y eso se ve en el archivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "hoy-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en la pantalla nueva
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
  const css = archivosNuevos.find((a) => a.nombre === "hoy.module.css")!.texto;
  assert.match(css, /font-variant-numeric:\s*tabular-nums/, "las cifras se alinean con tabular-nums");
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin tokens nuevos: la hoja solo LEE los del menú (--m2-*) y los de globals
// ═══════════════════════════════════════════════════════════════════════════
test("hoy.module.css no declara ninguna variable CSS propia", () => {
  const css = archivosNuevos.find((a) => a.nombre === "hoy.module.css")!.texto;
  const declaraciones = css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css, /var\(--m2-/, "lee los tokens del menú");
  const raiz = leer("components/dashboard/hoy-rediseno/raiz.tsx");
  assert.match(raiz, /CLASES_MENU/, "la raíz monta CLASES_MENU (menu-dos-niveles/clases.ts)");
});

// ═══════════════════════════════════════════════════════════════════════════
// Mismos destinos que la home de siempre: ni un botón que lleve a otro sitio
// ═══════════════════════════════════════════════════════════════════════════
test("la pantalla nueva manda a los mismos sitios que la de siempre", () => {
  const todo = archivosNuevos.map((a) => a.texto).join("\n");
  const viejo = [
    "components/dashboard/home/home-receptionist.tsx",
    "components/dashboard/home/home-doctor.tsx",
    "components/dashboard/home/home-admin.tsx",
    "components/dashboard/home/parts/today-appointment-row.tsx",
    "components/dashboard/home/parts/hero-next-patient.tsx",
    "components/dashboard/home/parts/upcoming-appointments-card.tsx",
    "components/dashboard/home/parts/revenue-trend-card.tsx",
  ].map(leer).join("\n");

  const destinos = [
    "/dashboard/walk-in?waitlist=1",
    "/api/appointments/${id}/check-in",
    "/dashboard/whatsapp?appt=${id}",
    "/dashboard/agenda?highlight=${id}",
    "/dashboard/agenda?highlight=${appt.id}",
    "/dashboard/appointments",
    "/dashboard/reports",
    "/dashboard/xrays?filter=unanalyzed",
    "/dashboard/ai-assistant?patient=${appt.patient.id}",
    "/dashboard/patients/${appt.patient.id}",
    "/api/dashboard/home/revenue?range=",
    "/api/dashboard/home/upcoming?limit=",
    "/dashboard/agenda?date=${",
  ];
  for (const d of destinos) {
    assert.ok(viejo.includes(d), `la home de siempre ya no usa ${d}: actualiza este candado`);
    assert.ok(todo.includes(d), `el rediseño perdió el destino ${d}`);
  }
  // Los dos botones del vacío de «Agenda de hoy» (EmptyAppointmentsToday).
  assert.ok(todo.includes("/dashboard/appointments?new=1"), "falta «Nueva cita» del vacío");
  assert.ok(todo.includes("/dashboard/appointments?view=week"), "falta «Ver agenda semanal» del vacío");
});

// ═══════════════════════════════════════════════════════════════════════════
// Toda clave i18n que usa el rediseño existe en el diccionario en español
// ═══════════════════════════════════════════════════════════════════════════
test("todas las claves t(\"…\") del rediseño existen en es.json", () => {
  const dict = JSON.parse(leer("i18n/dictionaries/es.json")) as Record<string, unknown>;
  const existe = (clave: string): boolean => {
    let nodo: unknown = dict;
    for (const parte of clave.split(".")) {
      if (!nodo || typeof nodo !== "object" || !(parte in (nodo as object))) return false;
      nodo = (nodo as Record<string, unknown>)[parte];
    }
    return true;
  };
  const claves = new Set<string>();
  for (const a of archivosNuevos) {
    for (const m of a.texto.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) claves.add(m[1]);
    // Los mapas de estado y de rangos guardan la clave en una propiedad.
    for (const m of a.texto.matchAll(/(?:clave|labelKey|subtitleKey|unitKey):\s*"([a-zA-Z0-9_.]+)"/g)) claves.add(m[1]);
  }
  assert.ok(claves.size > 40, "se esperaban decenas de claves");
  const faltan = [...claves].filter((k) => !existe(k));
  assert.deepEqual(faltan, [], `claves sin traducción: ${faltan.join(", ")}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// Los estados de cita dicen lo MISMO que la ficha del paciente y la Agenda
// ═══════════════════════════════════════════════════════════════════════════
test("las etiquetas de estado son las unificadas (pacientesRediseno.cita.*)", () => {
  const piezas = leer("components/dashboard/hoy-rediseno/piezas.tsx");
  const bloque = piezas.slice(piezas.indexOf("const ESTADO"), piezas.indexOf("export function EtiquetaEstado"));
  const estados = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS", "COMPLETED", "CHECKED_OUT", "CANCELLED", "NO_SHOW"];
  for (const e of estados) {
    assert.match(bloque, new RegExp(`${e}:\\s*\\{\\s*clave:\\s*"pacientesRediseno\\.cita\\.`), `${e} no usa la clave unificada`);
  }
  assert.ok(!/home\.apptRow\.status|home\.upcoming\.status/.test(piezas), "no se mezclan los nombres viejos");
});

// ═══════════════════════════════════════════════════════════════════════════
// El camino viejo sigue vivo y el interruptor es el de todo el rediseño
// ═══════════════════════════════════════════════════════════════════════════
test("page.tsx conserva la home de siempre y elige con menuDosNivelesEncendido", () => {
  const page = leer("app/dashboard/page.tsx");
  assert.match(page, /from "@\/lib\/menu-dos-niveles\/interruptor"/, "usa el interruptor compartido, no uno propio");
  for (const viejo of ["HomeShell", "HomeReceptionist", "HomeDoctor", "HomeAdmin"]) {
    assert.ok(page.includes(`<${viejo}`), `el camino viejo ya no monta ${viejo}`);
  }
  for (const nuevo of ["RaizHoy", "HoyRecepcion", "HoyDoctor", "HoyAdmin"]) {
    assert.ok(page.includes(`<${nuevo}`), `el rediseño no monta ${nuevo}`);
  }
  // Cada vista resuelve el interruptor en el MISMO Promise.all que sus datos.
  assert.equal((page.match(/menuDosNivelesEncendido\(clinic\.id\)/g) ?? []).length, 4, "una lectura por vista, dentro de su Promise.all");
});
