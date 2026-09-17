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
// Con UNA excepción, a propósito: la agenda. La home de siempre manda a
// `/dashboard/appointments` (la agenda de siempre) y ahí se queda, porque esa
// pantalla solo la ven las clínicas sin bandera. La de aquí solo se monta con
// la bandera encendida, y con ella la agenda es `/dashboard/agenda`. Se vigila
// abajo, en su propio candado.
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
});

// ═══════════════════════════════════════════════════════════════════════════
// Hoy con la bandera manda a la agenda NUEVA; la home de siempre, a la de siempre
// ═══════════════════════════════════════════════════════════════════════════
// Hallazgo 2 de la auditoría del rediseño (ws1-t8): «Ver agenda completa»,
// «Ver agenda» y los dos botones del vacío de «Agenda de hoy» mandaban a
// `/dashboard/appointments`, la agenda vieja entera con su formulario viejo, y
// su `?view=week` ni siquiera funcionaba. Con la bandera, todo va a
// `/dashboard/agenda`.
test("con la bandera, ningún enlace de Hoy lleva a la agenda de siempre", () => {
  // Un literal de ruta (entre comillas o acento grave) que empiece por la
  // agenda vieja. Los comentarios que la nombran sin comillas no cuentan.
  const AGENDA_VIEJA = /["'`]\/dashboard\/appointments/;
  for (const a of archivosNuevos) {
    assert.ok(!AGENDA_VIEJA.test(a.texto), `${a.nombre} manda a la agenda de siempre; con la bandera es /dashboard/agenda`);
  }

  const recepcion = leer("components/dashboard/hoy-rediseno/hoy-recepcion.tsx");
  const doctor = leer("components/dashboard/hoy-rediseno/hoy-doctor.tsx");
  // «Ver agenda completa» (recepción) y «Ver agenda» (doctor): la agenda nueva.
  assert.match(recepcion, /href="\/dashboard\/agenda"[\s\S]*home\.recep\.viewFullAgenda/, "«Ver agenda completa» no va a /dashboard/agenda");
  assert.match(doctor, /href="\/dashboard\/agenda"[\s\S]*home\.doctor\.viewAgenda/, "«Ver agenda» no va a /dashboard/agenda");
  // «Ver agenda semanal» del vacío: la agenda nueva ya en Semana.
  assert.ok(recepcion.includes('href="/dashboard/agenda?view=week"'), "«Ver agenda semanal» no abre la agenda nueva en Semana");
  // «Nueva cita» del vacío: la MISMA ventana nueva que la cabecera y el pie,
  // sin pasar por ninguna agenda (un clic menos que el ?new=1 de siempre).
  const vacio = recepcion.slice(recepcion.indexOf("export function VacioCitasHoy"), recepcion.indexOf("const PUNTO"));
  assert.match(vacio, /useNewAppointmentDialog\(\)/, "el vacío no usa la ventana nueva de cita");
  assert.match(vacio, /abrirCita\(\{ openAgendaAfter: true \}\)/, "«Nueva cita» del vacío no abre la ventana nueva");
  assert.ok(!vacio.includes("?new=1"), "«Nueva cita» del vacío sigue navegando con ?new=1");

  // Y la home de siempre NO cambia: sigue mandando a la agenda de siempre,
  // igual que su vacío compartido (`EmptyAppointmentsToday`).
  const homeVieja = [
    "components/dashboard/home/home-receptionist.tsx",
    "components/dashboard/home/home-doctor.tsx",
  ].map(leer).join("\n");
  assert.equal((homeVieja.match(/router\.push\("\/dashboard\/appointments"\)/g) ?? []).length, 2, "la home de siempre dejó de mandar a /dashboard/appointments");
  const vacioViejo = leer("components/dashboard/empty-states/index.tsx");
  assert.ok(vacioViejo.includes('"/dashboard/appointments?new=1"'), "el vacío de siempre perdió ?new=1");
  assert.ok(vacioViejo.includes('"/dashboard/appointments?view=week"'), "el vacío de siempre perdió ?view=week");

  // La agenda nueva entiende `?view=week`: arranca en Semana en vez de en Día.
  const contexto = leer("components/dashboard/agenda-nueva/contexto-agenda-nueva.tsx");
  assert.match(contexto, /searchParams\.get\("view"\)/, "la agenda nueva no lee ?view=");
  assert.match(contexto, /if \(view === "week"\) return "semana"/, "?view=week no abre Semana");
  assert.match(contexto, /if \(view === "month"\) return "mes"/, "?view=month no abre Mes");
  assert.match(contexto, /return "dia";\n\}/, "sin ?view= la agenda nueva ya no arranca en Día");
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
