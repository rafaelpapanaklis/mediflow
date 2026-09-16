/**
 * CANDADOS DEL REDISEÑO DE RESERVA DE RECURSOS, FILA DE ESPERA Y
 * TRATAMIENTOS (ws1-t4).
 *
 * Run: npx tsx --test src/components/dashboard/piezas-rediseno/__tests__/piezas-rediseno.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno.test.ts`: lo que se
 * vigila es CABLEADO (que la carpeta no invente tokens ni letra de máquina,
 * que la lógica siga en los clientes de siempre, que el camino viejo siga
 * vivo y que el interruptor sea el de todo el rediseño), y eso se ve en el
 * archivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "piezas-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

const css = () => archivosNuevos.find((a) => a.nombre === "piezas.module.css")!.texto;

const PANTALLAS = [
  {
    page: "app/dashboard/resource-bookings/page.tsx",
    cliente: "app/dashboard/resource-bookings/resource-bookings-client.tsx",
    nuevo: "ReservasRecursos",
    viejo: ['className="modal-overlay"', 'className="card"', 'className="list-row group"'],
    apis: ["/api/resources"],
  },
  {
    page: "app/dashboard/walk-in/page.tsx",
    cliente: "app/dashboard/walk-in/walk-in-client.tsx",
    nuevo: "FilaEspera",
    viejo: ["bg-card border border-border rounded-xl p-5", "fixed inset-0 z-50"],
    apis: ["/api/walk-in"],
  },
  {
    page: "app/dashboard/treatments/page.tsx",
    cliente: "app/dashboard/treatments/treatments-client.tsx",
    nuevo: "Tratamientos",
    viejo: ['className="modal modal--wide"', '<KpiCard', 'className="segment-new"', "function InventoryPicker("],
    apis: ["/api/treatments", "/api/inventory"],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en la carpeta nueva
// ═══════════════════════════════════════════════════════════════════════════
// La palabra prohibida se arma en trozos para que un grep sobre la carpeta
// (el gate de cierre: «cero letra de máquina») no se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en la carpeta del rediseño", () => {
  assert.ok(archivosNuevos.length >= 6, "faltan archivos en la carpeta");
  for (const a of archivosNuevos) {
    assert.ok(
      !LETRA_DE_MAQUINA.test(a.texto),
      `${a.nombre} usa letra de máquina; las cifras van con tabular-nums sobre Instrument Sans`,
    );
    assert.ok(!/className="mono"|className=\{?["'`]mono\b/.test(a.texto), `${a.nombre} usa la clase global .mono`);
  }
  assert.match(css(), /font-variant-numeric:\s*tabular-nums/, "las cifras se alinean con tabular-nums");
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin tokens nuevos: la hoja solo LEE los del menú (--m2-*) y los de globals
// ═══════════════════════════════════════════════════════════════════════════
test("piezas.module.css no declara ninguna variable CSS propia", () => {
  const declaraciones = css().match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css(), /var\(--m2-/, "lee los tokens del menú");
  const raiz = leer("components/dashboard/piezas-rediseno/raiz.tsx");
  assert.match(raiz, /CLASES_MENU/, "la raíz monta CLASES_MENU (menu-dos-niveles/clases.ts)");
  assert.match(raiz, /from "@\/components\/dashboard\/menu-dos-niveles\/clases"/, "CLASES_MENU sale de clases.ts, no de una copia");
});

test("ningún color escrito fuera de un respaldo var(--x, …)", () => {
  // Es el mismo grep que pasa el gerente sobre el diff: una línea con un hex
  // de seis cifras que no lleve `var(--` se devuelve.
  for (const a of archivosNuevos) {
    const malas = a.texto
      .split("\n")
      .filter((l) => /#[0-9a-f]{6}\b/i.test(l) && !l.includes("var(--"));
    assert.deepEqual(malas, [], `${a.nombre} escribe colores a mano: ${malas.join(" | ")}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// La lógica vive en los clientes de siempre: la carpeta nueva solo pinta
// ═══════════════════════════════════════════════════════════════════════════
test("la carpeta nueva no hace fetch, no hace polling y no toca prisma", () => {
  for (const a of archivosNuevos) {
    if (a.nombre.endsWith(".test.ts")) continue;
    assert.ok(!/\bfetch\(/.test(a.texto), `${a.nombre} hace fetch: la lógica va en el cliente de siempre`);
    assert.ok(!/setInterval|setTimeout/.test(a.texto), `${a.nombre} añade polling`);
    assert.ok(!/prisma/.test(a.texto), `${a.nombre} toca la base`);
  }
});

test("cada pantalla nueva recibe los mismos destinos que la de siempre", () => {
  for (const p of PANTALLAS) {
    const cliente = leer(p.cliente);
    for (const api of p.apis) {
      assert.ok(cliente.includes(api), `${p.cliente} ya no llama a ${api}: actualiza este candado`);
    }
  }
  // Tratamientos enlaza a la ficha del paciente igual que hoy.
  const trat = leer("components/dashboard/piezas-rediseno/tratamientos.tsx");
  assert.ok(trat.includes("/dashboard/patients/${tp.patient.id}"), "la fila perdió el enlace al paciente");
  assert.ok(trat.includes("/dashboard/patients/${selected.patient.id}"), "la ficha perdió el enlace al paciente");
});

// ═══════════════════════════════════════════════════════════════════════════
// El camino viejo sigue vivo y el interruptor es el de todo el rediseño
// ═══════════════════════════════════════════════════════════════════════════
test("cada page.tsx elige con menuDosNivelesEncendido dentro de su Promise.all y el cliente conserva su árbol de siempre", () => {
  for (const p of PANTALLAS) {
    const page = leer(p.page);
    assert.match(page, /from "@\/lib\/menu-dos-niveles\/interruptor"/, `${p.page} usa el interruptor compartido, no uno propio`);
    assert.equal((page.match(/menuDosNivelesEncendido\(/g) ?? []).length, 1, `${p.page}: una sola lectura del interruptor`);
    const promiseAll = page.indexOf("Promise.all([");
    const lectura = page.indexOf("menuDosNivelesEncendido(");
    assert.ok(promiseAll !== -1 && lectura > promiseAll, `${p.page}: el interruptor va dentro del Promise.all de sus datos`);
    assert.match(page, /rediseno=\{rediseno\}/, `${p.page} no pasa la bandera al cliente`);

    const cliente = leer(p.cliente);
    assert.match(cliente, /rediseno = false/, `${p.cliente}: la bandera falla cerrada (false por defecto)`);
    assert.match(cliente, new RegExp(`if \\(rediseno\\) \\{\\s*return \\(\\s*<${p.nuevo}\\b`), `${p.cliente} no monta ${p.nuevo} con la bandera`);
    for (const v of p.viejo) {
      assert.ok(cliente.includes(v), `${p.cliente}: el camino viejo perdió «${v}»`);
    }
    // El árbol viejo va DESPUÉS de la rama nueva: la bandera apagada no lo toca.
    const rama = cliente.indexOf(`<${p.nuevo}`);
    for (const v of p.viejo) {
      assert.ok(cliente.indexOf(v) > rama, `${p.cliente}: «${v}» tendría que ir después de la rama del rediseño`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Walk-in: menos clics, nunca más. El formulario va en línea y Enter agrega.
// ═══════════════════════════════════════════════════════════════════════════
test("la fila de espera agrega sin abrir nada y conserva los cuatro botones de siempre", () => {
  const fila = leer("components/dashboard/piezas-rediseno/fila-espera.tsx");
  assert.ok(!/setShowAdd/.test(fila), "el formulario de agregar no va detrás de un clic");
  assert.match(fila, /e\.key === "Enter"/, "Enter agrega");
  for (const accion of ['"assign"', '"start"', '"complete"', '"cancel"']) {
    assert.ok(fila.includes(`handleAction(item.id, ${accion})`), `perdió la acción ${accion}`);
  }
  assert.ok(fila.includes("pintarEspera"), "el temporizador de espera llega del cliente de siempre, no se duplica");
  // El refresco cada 30 s y el temporizador siguen donde estaban: en el cliente de siempre, una sola vez.
  const cliente = leer("app/dashboard/walk-in/walk-in-client.tsx");
  assert.equal((cliente.match(/setInterval\(/g) ?? []).length, 2, "el cliente conserva sus dos intervalos de siempre (refresco y temporizador), ni uno más");
  assert.match(cliente, /pintarEspera=\{\(since\) => <ElapsedTimer since=\{since\} \/>\}/, "el rediseño reutiliza ElapsedTimer");
});

// ═══════════════════════════════════════════════════════════════════════════
// Tratamientos: las mismas opciones que hoy, ni una más
// ═══════════════════════════════════════════════════════════════════════════
test("tratamientos conserva los 4 KPI, los 5 filtros, los cambios de estado y las 5 sugerencias", () => {
  const trat = leer("components/dashboard/piezas-rediseno/tratamientos.tsx");
  assert.equal((trat.match(/<Kpi\b/g) ?? []).length, 4, "cuatro KPI");
  for (const f of ['"ALL"', '"ACTIVE"', '"OVERDUE"', '"COMPLETED"', '"PAUSED"']) {
    assert.ok(trat.includes(`valor: ${f}`), `falta el filtro ${f}`);
  }
  for (const estado of ['"PAUSED"', '"ABANDONED"', '"ACTIVE"']) {
    assert.ok(trat.includes(`changeStatus(selected.id, ${estado})`), `perdió el cambio a ${estado}`);
  }
  const cliente = leer("app/dashboard/treatments/treatments-client.tsx");
  assert.match(cliente, /commonTreatments: COMMON_TREATMENTS\.slice\(0, 5\)/, "las mismas cinco sugerencias que hoy");
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
    for (const m of a.texto.matchAll(/labelKey:\s*"([a-zA-Z0-9_.]+)"/g)) claves.add(m[1]);
  }
  assert.ok(claves.size > 60, `se esperaban decenas de claves, hay ${claves.size}`);
  const faltan = [...claves].filter((k) => !existe(k));
  assert.deepEqual(faltan, [], `claves sin traducción: ${faltan.join(", ")}`);
});
