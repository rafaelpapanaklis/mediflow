/**
 * CANDADOS DEL REDISEÑO DE «SOPORTE TÉCNICO» (ws1-t4).
 *
 * Run: npx tsx --test src/components/dashboard/soporte-rediseno/__tests__/soporte-rediseno.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno` y `app/dashboard/
 * __tests__/botones-prometidos.test.ts`: lo que se vigila es CABLEADO (que la
 * pantalla nueva no invente tokens ni letra de máquina, que no pida ni mande
 * datos por su cuenta, que el camino viejo siga vivo, que no esconda nada por
 * ancho), y eso se ve en el archivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  bytesHilo,
  bytesLista,
  fechaCorta,
  fechaLarga,
  horaMensaje,
  TONO_ESTADO,
  TONO_PRIORIDAD,
} from "@/components/dashboard/soporte-rediseno/formato";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
} from "@/lib/support/types";

const SRC = join(__dirname, "..", "..", "..", ".."); // src/
const CARPETA = join(SRC, "components", "dashboard", "soporte-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

const css = archivosNuevos.find((a) => a.nombre === "soporte.module.css")!.texto;
const todoNuevo = archivosNuevos.map((a) => a.texto).join("\n");

const VIEJO_LISTA = "app/dashboard/soporte/soporte-client.tsx";
const VIEJO_TICKET = "app/dashboard/soporte/[id]/ticket-client.tsx";
const PAGE_LISTA = "app/dashboard/soporte/page.tsx";
const PAGE_TICKET = "app/dashboard/soporte/[id]/page.tsx";

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en la pantalla nueva
// ═══════════════════════════════════════════════════════════════════════════
// La palabra prohibida se arma en trozos para que un grep sobre la carpeta
// (el gate de cierre: «cero letra de máquina») no se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en la carpeta del rediseño", () => {
  assert.ok(archivosNuevos.length >= 6, "faltan archivos en la carpeta del rediseño");
  for (const a of archivosNuevos) {
    assert.ok(
      !LETRA_DE_MAQUINA.test(a.texto),
      `${a.nombre} usa letra de máquina; las cifras van con tabular-nums sobre Instrument Sans`,
    );
  }
  assert.match(css, /font-variant-numeric:\s*tabular-nums/, "las cifras se alinean con tabular-nums");
  // La clase `.mono` de globals.css es letra de máquina con otro nombre.
  assert.ok(!/["'\s]mono["'\s]/.test(todoNuevo), "no se usa la clase global .mono");
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin tokens nuevos: la hoja solo LEE los del menú (--m2-*) y los de globals
// ═══════════════════════════════════════════════════════════════════════════
test("soporte.module.css no declara ninguna variable CSS propia", () => {
  const declaraciones = css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css, /var\(--m2-/, "lee los tokens del menú");
  const raiz = leer("components/dashboard/soporte-rediseno/raiz.tsx");
  assert.match(raiz, /CLASES_MENU/, "la raíz monta CLASES_MENU (menu-dos-niveles/clases.ts)");
  assert.match(raiz, /from "@\/components\/dashboard\/menu-dos-niveles\/clases"/, "CLASES_MENU sale de clases.ts, no de una copia");
});

test("ningún hex fuera de un respaldo dentro de var(), ni en la hoja ni en los .tsx", () => {
  // El gate del gerente: `grep '^+' | grep -iE '#[0-9a-f]{6}' | grep -v 'var(--'`.
  for (const a of archivosNuevos) {
    const lineas = a.texto.split("\n");
    lineas.forEach((l, i) => {
      if (/#[0-9a-f]{6}\b/i.test(l) && !/var\(--/.test(l)) {
        assert.fail(`${a.nombre}:${i + 1} tiene un color a mano: ${l.trim()}`);
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// La pantalla nueva no pide ni manda datos: eso sigue en los archivos de siempre
// ═══════════════════════════════════════════════════════════════════════════
test("la carpeta del rediseño no tiene fetch, ni polling, ni rutas de API", () => {
  assert.ok(!/\bfetch\s*\(/.test(todoNuevo), "el rediseño no pide datos por su cuenta");
  assert.ok(!/setInterval|setTimeout/.test(todoNuevo), "sin polling nuevo");
  assert.ok(!/\/api\//.test(todoNuevo.replace(/\/\/.*$/gm, "")), "ninguna ruta de API en el código del rediseño");
});

test("los archivos de siempre conservan sus destinos y se los prestan al rediseño", () => {
  const lista = leer(VIEJO_LISTA);
  const ticket = leer(VIEJO_TICKET);
  for (const d of ['"/api/support/tickets"', '"/api/support/attachments"', "/dashboard/soporte/${created.id}", "/dashboard/soporte/${tk.id}"]) {
    assert.ok(lista.includes(d), `soporte-client.tsx ya no usa ${d}`);
  }
  for (const d of ["/api/support/tickets/${ticketId}", "/api/support/tickets/${ticketId}/messages", '"/api/support/attachments"', 'action: "close"']) {
    assert.ok(ticket.includes(d), `ticket-client.tsx ya no usa ${d}`);
  }
  // El rediseño recibe las MISMAS acciones (no otras) desde los dueños.
  for (const prop of ["submitTicket={submitTicket}", "handleFilesSelected={handleFilesSelected}", "removeAttachment={removeAttachment}"]) {
    assert.ok(lista.includes(prop), `la lista rediseñada no recibe ${prop}`);
  }
  for (const prop of ["handleSend={handleSend}", "handleFiles={handleFiles}", "handleCloseTicket={handleCloseTicket}", "onComposerKeyDown={onComposerKeyDown}"]) {
    assert.ok(ticket.includes(prop), `el ticket rediseñado no recibe ${prop}`);
  }
  // El destino de una fila sigue siendo el hilo de ese ticket.
  assert.ok(lista.includes("abrirTicket={(id) => router.push(`/dashboard/soporte/${id}`)}"), "una fila ya no lleva al hilo");
});

// ═══════════════════════════════════════════════════════════════════════════
// El camino viejo sigue vivo y el interruptor es el de todo el rediseño
// ═══════════════════════════════════════════════════════════════════════════
test("con la bandera apagada se pinta la pantalla de siempre, sin tocar", () => {
  const lista = leer(VIEJO_LISTA);
  const ticket = leer(VIEJO_TICKET);
  assert.match(lista, /rediseno = false/, "la lista tiene la bandera apagada por defecto");
  assert.match(ticket, /rediseno = false/, "el ticket tiene la bandera apagada por defecto");
  // Las piezas del diseño de siempre siguen ahí, con sus clases globales.
  for (const viejo of ['className="card"', 'className="modal-overlay"', 'className="list-row w-full text-left"', "<AccountManagerCard"]) {
    assert.ok(lista.includes(viejo), `la lista de siempre perdió ${viejo}`);
  }
  for (const viejo of ["function MessageBubble", "function CloseDialog", "function StarPicker", "<MessageBubble key={m.id} msg={m} />", 'className="sticky bottom-0 z-10 pb-1 pt-1"']) {
    assert.ok(ticket.includes(viejo), `el hilo de siempre perdió ${viejo}`);
  }
  // El desvío al rediseño es un retorno temprano guardado por la bandera.
  assert.match(lista, /if \(rediseno\) \{\s*return \(\s*<ListaTicketsRediseno/, "la lista desvía solo con la bandera");
  assert.match(ticket, /if \(rediseno\) \{\s*return \(\s*<TicketRediseno/, "el ticket desvía solo con la bandera");
});

test("las dos páginas leen el interruptor compartido y bajan la bandera al cliente", () => {
  for (const rel of [PAGE_LISTA, PAGE_TICKET]) {
    const page = leer(rel);
    assert.match(page, /from "@\/lib\/menu-dos-niveles\/interruptor"/, `${rel}: usa el interruptor compartido, no uno propio`);
    assert.match(page, /menuDosNivelesEncendido\(/, `${rel}: no consulta el interruptor`);
    assert.match(page, /rediseno=\{rediseno\}/, `${rel}: no baja la bandera al cliente`);
  }
  // La lista lo resuelve en el MISMO Promise.all que el manager (sin cascada).
  assert.match(leer(PAGE_LISTA), /Promise\.all\(\[\s*getAccountManagerForClinic[\s\S]*menuDosNivelesEncendido\(ctx\.clinicId\),\s*\]\)/, "el interruptor va con el manager, no detrás");
  // El hilo usa getCurrentUser (React cache), no getAuthContext (sin caché).
  assert.match(leer(PAGE_TICKET), /getCurrentUser/, "el hilo usa getCurrentUser (cacheado por React)");
  assert.ok(!/getAuthContext/.test(leer(PAGE_TICKET)), "getAuthContext no está en cache(): sería una consulta nueva por carga");
});

// ═══════════════════════════════════════════════════════════════════════════
// Nada se esconde por ancho, nada queda detrás de un clic, nada se inventa
// ═══════════════════════════════════════════════════════════════════════════
test("dentro de un @media solo se oculta la fila de títulos de columna, nunca un dato", () => {
  // Se extraen los bloques @media y se buscan sus `display: none`.
  const bloques = css.match(/@media[^{]*\{([\s\S]*?)\n\}/g) ?? [];
  const ocultos: string[] = [];
  for (const b of bloques) {
    for (const m of b.matchAll(/\.([a-zA-Z0-9_-]+)\s*\{[^}]*display:\s*none/g)) ocultos.push(m[1]);
  }
  assert.deepEqual(ocultos, ["listaCabecera"], `se oculta por ancho: ${ocultos.join(", ")}`);
  // Y en los .tsx no hay clases de Tailwind que escondan por ancho.
  assert.ok(!/\bhidden\s+(sm|md|lg|xl):/.test(todoNuevo), "nada de `hidden sm:inline` en el rediseño");
  assert.ok(!/\b(sm|md|lg|xl):hidden\b/.test(todoNuevo), "nada de `md:hidden` en el rediseño");
});

test("sin acordeones ni desplegables nuevos: lo que hoy está a la vista sigue a la vista", () => {
  assert.ok(!/<details|Collapsible|Accordion|DropdownMenu|Popover/.test(todoNuevo), "el rediseño no mete nada detrás de un clic");
});

test("las opciones del formulario son las del contrato, no una lista escrita a mano", () => {
  const lista = leer("components/dashboard/soporte-rediseno/lista-tickets.tsx");
  assert.match(lista, /SUPPORT_CATEGORIES\.map/, "las categorías salen del contrato");
  assert.match(lista, /SUPPORT_PRIORITIES\.map/, "las prioridades salen del contrato");
  // Ni una categoría ni una prioridad escritas como literal en el rediseño.
  for (const v of [...SUPPORT_CATEGORIES, ...SUPPORT_PRIORITIES]) {
    assert.ok(!new RegExp(`["']${v}["']`).test(lista), `«${v}» está escrito a mano en la lista rediseñada`);
  }
});

test("dice lo mismo que la pantalla de siempre: mismos textos, mismos botones", () => {
  const lista = leer("components/dashboard/soporte-rediseno/lista-tickets.tsx");
  const ticket = leer("components/dashboard/soporte-rediseno/ticket.tsx");
  const viejoLista = leer(VIEJO_LISTA);
  const viejoTicket = leer(VIEJO_TICKET);
  const textosLista = [
    "Soporte Técnico",
    "¿Necesitas ayuda? Levanta un ticket y te respondemos por aquí y por correo.",
    "Nuevo ticket",
    "Aún no tienes tickets",
    "Crear mi primer ticket",
    "Respuesta nueva",
    "Resumen breve de tu problema o duda",
    "Adjuntar archivos",
    "Crear ticket",
    "Cancelar",
  ];
  for (const t of textosLista) {
    assert.ok(viejoLista.includes(t), `la lista de siempre ya no dice «${t}»: actualiza este candado`);
    assert.ok(lista.includes(t), `la lista rediseñada perdió «${t}»`);
  }
  const textosTicket = [
    "Cerrar ticket",
    "Cerrar y calificar",
    "¿Resolvimos tu problema?",
    "Sin calificación",
    "Este ticket está cerrado.",
    "Crear ticket nuevo",
    "Aún no hay mensajes en este ticket.",
    "Escribe tu mensaje…",
    "Enter para enviar · Shift+Enter para salto de línea",
    "Ticket no encontrado",
    "No se pudo cargar el ticket",
    "Reintentar",
    "Marcamos tu ticket como resuelto. Si todo quedó bien, ciérralo y califica la atención.",
  ];
  for (const t of textosTicket) {
    assert.ok(viejoTicket.includes(t), `el hilo de siempre ya no dice «${t}»: actualiza este candado`);
    assert.ok(ticket.includes(t), `el hilo rediseñado perdió «${t}»`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Los formateadores dicen lo mismo que los de la pantalla de siempre
// ═══════════════════════════════════════════════════════════════════════════
test("los tonos de estado y prioridad son los del mapa de siempre", () => {
  // La pantalla de siempre habla en inglés (BadgeNew); el rediseño, en español.
  const equivalente: Record<string, string> = {
    info: "info", brand: "marca", warning: "alerta", success: "exito", neutral: "neutro", danger: "peligro",
  };
  const viejo = leer(VIEJO_LISTA);
  const mapaViejo = (nombre: string) => {
    const bloque = viejo.slice(viejo.indexOf(`const ${nombre}`), viejo.indexOf("};", viejo.indexOf(`const ${nombre}`)));
    const m: Record<string, string> = {};
    for (const x of bloque.matchAll(/([A-Z_]+):\s*"([a-z]+)"/g)) m[x[1]] = equivalente[x[2]];
    return m;
  };
  assert.deepEqual(TONO_ESTADO, mapaViejo("STATUS_TONES"));
  assert.deepEqual(TONO_PRIORIDAD, mapaViejo("PRIORITY_TONES"));
  for (const e of SUPPORT_STATUSES) assert.ok(e in TONO_ESTADO, `sin tono para el estado ${e}`);
  for (const p of SUPPORT_PRIORITIES) assert.ok(p in TONO_PRIORIDAD, `sin tono para la prioridad ${p}`);
});

test("fechas y tamaños: mismos casos vacíos y mismas unidades que hoy", () => {
  assert.equal(fechaCorta("no es fecha"), "—");
  assert.equal(fechaLarga("no es fecha"), "");
  assert.equal(horaMensaje("no es fecha"), "");
  assert.match(fechaLarga("2026-09-16T12:00:00.000Z"), /2026/);
  // Un mensaje de otro año lleva el año; uno de este año, no.
  const ahora = new Date("2026-09-16T12:00:00.000Z");
  assert.match(horaMensaje("2025-01-05T12:00:00.000Z", ahora), /2025/);
  assert.doesNotMatch(horaMensaje("2026-03-05T12:00:00.000Z", ahora), /2026/);
  assert.equal(bytesLista(12), "12 B");
  assert.equal(bytesLista(2048), "2 KB");
  assert.equal(bytesLista(1.5 * 1024 * 1024), "1.5 MB");
  assert.equal(bytesHilo(0), "");
  assert.equal(bytesHilo(12), "1 KB");
  assert.equal(bytesHilo(2048), "2 KB");
  assert.equal(bytesHilo(1.5 * 1024 * 1024), "1.5 MB");
});
