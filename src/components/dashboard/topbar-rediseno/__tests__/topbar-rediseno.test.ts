/**
 * CANDADOS DE LAS PIEZAS DE LA BARRA SUPERIOR DEL REDISEÑO (ws1-t6).
 *
 * Run: npx tsx --test src/components/dashboard/topbar-rediseno/__tests__/topbar-rediseno.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno.test.ts`: lo que se
 * vigila es CABLEADO (que la barra nueva vista las cinco piezas y la de
 * siempre no, que las piezas sin ropa reciban EXACTAMENTE lo de antes, que la
 * hoja no invente tokens ni letra de máquina, que con la bandera los enlaces
 * a la agenda vayan a la nueva y que la agenda nueva conserve la bandeja de
 * solicitudes de la mini-web), y eso se ve en el archivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RUTA_AGENDA, vestidor } from "../apariencia";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "topbar-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

/** Las cinco piezas que monta la barra, con su archivo y su componente. */
const PIEZAS = [
  { archivo: "components/dashboard/command-palette.tsx",          componente: "CommandPalette" },
  { archivo: "components/dashboard/keyboard-shortcuts-panel.tsx", componente: "KeyboardShortcutsPanel" },
  { archivo: "components/dashboard/notifications-popover.tsx",    componente: "NotificationsPopover" },
  { archivo: "components/dashboard/insights-popover.tsx",         componente: "InsightsPopover" },
  { archivo: "components/dashboard/waiting-room-alert.tsx",       componente: "WaitingRoomAlert" },
];
const BARRA_NUEVA = "components/dashboard/menu-dos-niveles/topbar-dos-niveles.tsx";
const BARRA_VIEJA = "components/dashboard/topbar.tsx";

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
  const css = archivosNuevos.find((a) => a.nombre === "piezas-topbar.module.css")!.texto;
  assert.match(css, /font-variant-numeric:\s*tabular-nums/, "las cifras se alinean con tabular-nums");
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin tokens nuevos: la hoja solo LEE los del menú (--m2-*) y los de globals
// ═══════════════════════════════════════════════════════════════════════════
test("piezas-topbar.module.css no declara ninguna variable CSS propia ni colores sueltos", () => {
  const css = archivosNuevos.find((a) => a.nombre === "piezas-topbar.module.css")!.texto;
  const declaraciones = css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css, /var\(--m2-/, "lee los tokens del menú");
  // Un color escrito solo vale como respaldo dentro de var(--x, #hex).
  const sinRespaldos = css.replace(/var\([^)]*\)/g, "");
  const hex = sinRespaldos.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
  assert.deepEqual(hex, [], `colores escritos a mano: ${hex.join(", ")}`);
  // Cada capa flotante monta CLASES_MENU (los tokens del menú llegan al portal).
  for (const { archivo, componente } of PIEZAS) {
    if (componente === "WaitingRoomAlert") continue; // la pastilla vive dentro de la barra, que ya lleva los tokens
    assert.match(leer(archivo), /CLASES_MENU/, `${componente} monta CLASES_MENU en su capa flotante`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// La ropa: sin apariencia, EXACTAMENTE lo de antes; con "nueva", solo clases
// ═══════════════════════════════════════════════════════════════════════════
test("vestidor: sin apariencia devuelve solo el style de siempre; con «nueva», solo la clase", () => {
  const estilo = { color: "var(--text-1)", fontSize: 12 };
  assert.deepEqual(vestidor(undefined)(estilo, "x"), { style: estilo });
  assert.deepEqual(vestidor("clasica")(estilo, "x"), { style: estilo });
  assert.deepEqual(vestidor("nueva")(estilo, "x"), { className: "x" });
  assert.deepEqual(vestidor(undefined)(undefined, "x"), { style: undefined });
});

test("las cinco piezas aceptan la ropa como prop opcional y la barra de siempre no la pasa", () => {
  for (const { archivo, componente } of PIEZAS) {
    const src = leer(archivo);
    assert.match(src, /apariencia\?: AparienciaTopbar/, `${componente} acepta apariencia opcional`);
    assert.match(src, /from "@\/components\/dashboard\/topbar-rediseno\/apariencia"/, `${componente} usa la ropa compartida`);
  }
  const vieja = leer(BARRA_VIEJA);
  assert.doesNotMatch(vieja, /apariencia|topbar-rediseno/, "la barra de siempre no sabe nada de la ropa nueva");
  for (const { componente } of PIEZAS) {
    assert.match(vieja, new RegExp(`<${componente}\\b`), `la barra de siempre sigue montando ${componente}`);
  }
});

// El aviso de sala de espera («X pacientes esperan >20 min») es la única pieza
// que la barra nueva NO monta: Rafael lo quitó. Y como el sondeo de 60 s a
// /api/analytics/waiting-room vive DENTRO del componente, no montarlo es lo
// que apaga la consulta. La barra de siempre lo sigue montando (test de arriba).
const SIN_MONTAR_EN_LA_NUEVA = "WaitingRoomAlert";

test("la barra del menú de dos niveles viste sus cuatro piezas con apariencia=\"nueva\"", () => {
  const nueva = leer(BARRA_NUEVA);
  const montadas = PIEZAS.filter((p) => p.componente !== SIN_MONTAR_EN_LA_NUEVA);
  for (const { componente } of montadas) {
    assert.match(
      nueva,
      new RegExp(`<${componente}\\b[^>]*apariencia="nueva"`),
      `${componente} va con la ropa nueva en la barra nueva`,
    );
  }
  assert.equal((nueva.match(/<[A-Z]\w*\b[^>]*apariencia="nueva"/g) ?? []).length, montadas.length, "ni una pieza más ni una menos");
});

test("la barra nueva no monta el aviso de sala de espera, y por eso tampoco sondea", () => {
  const nueva = leer(BARRA_NUEVA);
  assert.doesNotMatch(nueva, /<WaitingRoomAlert\b/, "la barra nueva no pinta el aviso");
  assert.doesNotMatch(nueva, /from "[^"]*waiting-room-alert"/, "ni lo importa");
  assert.doesNotMatch(nueva, /api\/analytics\/waiting-room"/, "ni pregunta por su cuenta");
  // El sondeo sigue viviendo solo dentro del componente: si alguien lo saca a
  // un hook compartido, este test obliga a volver a mirar la barra nueva.
  const aviso = leer("components/dashboard/waiting-room-alert.tsx");
  // (ws1-t1: con `?solo=alerta`, el conteo ligero en vez del reporte entero.)
  assert.match(aviso, /fetch\("\/api\/analytics\/waiting-room(\?solo=alerta)?"/, "el sondeo vive dentro del componente");
  // Y la barra de siempre no pierde nada.
  assert.match(leer(BARRA_VIEJA), /<WaitingRoomAlert \/>/, "la barra de siempre lo monta igual que hoy");
});

// ═══════════════════════════════════════════════════════════════════════════
// Con la bandera, «Agenda» manda a la agenda nueva; sin ella, a la de siempre
// ═══════════════════════════════════════════════════════════════════════════
test("RUTA_AGENDA: la de siempre y la nueva", () => {
  assert.equal(RUTA_AGENDA.clasica, "/dashboard/appointments");
  assert.equal(RUTA_AGENDA.nueva, "/dashboard/agenda");
});

test("«G A» y la paleta: la barra nueva pasa la agenda nueva; sin ella, la de siempre", () => {
  const atajos = leer("lib/command-palette/shortcuts.ts");
  assert.match(atajos, /a: "\/dashboard\/appointments"/, "sin rutaAgenda, «G A» sigue en la agenda de siempre");
  assert.match(atajos, /key === "a" && rutaAgenda \? rutaAgenda : GO_TO_MAP\[key\]/);
  assert.match(leer(BARRA_NUEVA), /useGoToShortcuts\(\{ enabled: modalsClosed, rutaAgenda: RUTA_AGENDA\.nueva \}\)/);
  assert.match(leer(BARRA_VIEJA), /useGoToShortcuts\(\{ enabled: modalsClosed \}\)/, "la barra de siempre no pasa ruta");

  const acciones = leer("lib/command-palette/actions.ts");
  assert.match(acciones, /opciones\?\.rutaAgenda \?\? "\/dashboard\/appointments"/);
  assert.match(acciones, /id: "go:appointments"[\s\S]*?run: \(ctx\) => ctx\.push\(rutaAgenda\)/);
  assert.match(leer(PIEZAS[0].archivo), /buildGlobalActions\(nueva \? \{ rutaAgenda: RUTA_AGENDA\.nueva \} : undefined\)/);
});

test("la campana: con la bandera manda a la agenda nueva (cita resaltada y bandeja de solicitudes)", () => {
  const ruta = leer("app/api/dashboard/activity/route.ts");
  assert.match(ruta, /from "@\/lib\/menu-dos-niveles\/interruptor"/, "usa el interruptor compartido, no uno propio");
  assert.match(ruta, /menuDosNivelesEncendido\(ctx\.clinicId\)/);
  assert.match(ruta, /\/dashboard\/agenda\?date=\$\{dateISOInTz\(a\.startsAt, zona\)\}&highlight=\$\{a\.id\}/);
  assert.match(ruta, /\/dashboard\/appointments\?focus=\$\{a\.id\}/, "sin la bandera, el enlace de siempre");
  assert.match(ruta, /`\/dashboard\/agenda\?solicitudes=1`/);
  assert.match(ruta, /`\/dashboard\/appointments\?solicitudes=1`/, "sin la bandera, el enlace de siempre");
});

test("«Agendar siguiente»: con la ropa nueva abre la Nueva cita nueva con el paciente; sin ella, la agenda de siempre", () => {
  const modal = leer("components/dashboard/patient-context-end-modal.tsx");
  assert.match(modal, /apariencia === "nueva"/);
  assert.match(modal, /initialPatient: patientName \? \{ id: patientId, name: patientName \} : undefined,\s*openAgendaAfter: true,/);
  assert.match(modal, /router\.push\(`\/dashboard\/appointments\?new=1&patient=\$\{patientId\}`\)/, "el camino de siempre sigue vivo");
  // La señal llega por el contexto de Nueva cita, que la recibe del layout.
  assert.match(leer("lib/new-appointment/types.ts"), /apariencia: "clasica" \| "nueva"/);
  assert.match(leer("components/dashboard/new-appointment/new-appointment-provider.tsx"), /\(\{ open, close, apariencia \}\)/);
  assert.match(leer("app/dashboard/layout.tsx"), /<NewAppointmentProvider apariencia=\{menuDosNiveles \? "nueva" : "clasica"\}>/);
});

// ═══════════════════════════════════════════════════════════════════════════
// Las solicitudes de la mini-web no se pierden: la agenda nueva las monta
// ═══════════════════════════════════════════════════════════════════════════
test("la agenda nueva monta la bandeja de solicitudes de la mini-web y la abre con ?solicitudes=1", () => {
  const agenda = leer("components/dashboard/agenda-nueva/agenda-nueva.tsx");
  assert.match(agenda, /import \{ BookingRequestsPanel \} from "@\/app\/dashboard\/appointments\/booking-requests-panel"/);
  assert.match(agenda, /<BookingRequestsPanel initialOpen=\{searchParams\.get\("solicitudes"\) === "1"\} \/>/);
  // Y la agenda de siempre la sigue montando igual.
  assert.match(
    leer("app/dashboard/appointments/appointments-client.tsx"),
    /<BookingRequestsPanel initialOpen=\{searchParams\.get\("solicitudes"\) === "1"\} \/>/,
  );
});
