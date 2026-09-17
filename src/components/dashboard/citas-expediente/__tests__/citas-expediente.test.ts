/**
 * CANDADOS DE «CITAS EDITABLES DESDE EL EXPEDIENTE» (ws1-t3).
 *
 * Run: npx tsx --test src/components/dashboard/citas-expediente/__tests__/citas-expediente.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno/__tests__/
 * hoy-rediseno.test.ts`: lo que se vigila es CABLEADO — que el expediente abra
 * LA MISMA ventana de la agenda y no una copia con sus propias reglas, que no
 * invente tokens ni letra de máquina, y que con la bandera apagada el camino
 * de siempre no se entere de nada.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "citas-expediente");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

const VENTANA = leer("components/dashboard/citas-expediente/ventana-cita.tsx");
const MODAL = leer("components/dashboard/agenda/agenda-edit-appointment-modal.tsx");
const FICHA = leer("app/dashboard/patients/[id]/patient-detail-client.tsx");
const PAGINA = leer("app/dashboard/patients/[id]/page.tsx");
const TABLA = leer("components/dashboard/expediente-rediseno/citas.tsx");

/** El código sin comentarios: los candados miran lo que se ejecuta. */
const sinComentarios = (texto: string) =>
  texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina
// ═══════════════════════════════════════════════════════════════════════════
// La palabra prohibida se arma en trozos para que un grep sobre la carpeta no
// se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en la carpeta", () => {
  for (const a of archivosNuevos) {
    assert.ok(!LETRA_DE_MAQUINA.test(a.texto), `${a.nombre} usa letra de máquina; las cifras van con tabular-nums`);
  }
  const css = archivosNuevos.find((a) => a.nombre === "citas-expediente.module.css")!.texto;
  assert.match(css, /font-variant-numeric:\s*tabular-nums/, "las cifras se alinean con tabular-nums");
});

// ═══════════════════════════════════════════════════════════════════════════
// Los colores se LEEN: ni un token propio, ni un color escrito a mano
// ═══════════════════════════════════════════════════════════════════════════
test("la hoja no declara variables CSS ni escribe colores a mano", () => {
  const css = archivosNuevos.find((a) => a.nombre === "citas-expediente.module.css")!.texto;
  const declaraciones = css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  for (const a of archivosNuevos) {
    const crudos = sinComentarios(a.texto).match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/gi) ?? [];
    assert.deepEqual(crudos, [], `${a.nombre} escribe colores a mano: ${crudos.join(", ")}`);
  }
  assert.match(css, /var\(--m2-/, "lee los tokens del menú");
  assert.match(css, /var\(--ag-/, "dentro de la ventana lee los tokens de la agenda nueva");
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 UNA sola lógica: la ventana del expediente ES la de la agenda
// ═══════════════════════════════════════════════════════════════════════════
// Ya pasó con el bot: copió las reglas de agendar y se dejó siete validaciones.
// Aquí no se copia nada: se monta el componente de la agenda con su ropa, y
// guardar es SU `rescheduleAppointment` contra el mismo PATCH, donde el
// servidor valida solapes, horario de la clínica y vacaciones del doctor.
test("el expediente monta la ventana de la agenda, con su misma ropa", () => {
  assert.match(VENTANA, /import \{ AgendaEditAppointmentModal \} from "@\/components\/dashboard\/agenda\/agenda-edit-appointment-modal"/);
  assert.match(VENTANA, /import \{ ROPA_EDITAR_CITA \} from "@\/components\/dashboard\/agenda-nueva\/ropa"/);
  assert.match(VENTANA, /<AgendaEditAppointmentModal[\s\S]*ropa=\{ROPA_EDITAR_CITA\}[\s\S]*prestado=\{prestado\}/);
});

test("la carpeta no guarda la cita por su cuenta ni valida nada", () => {
  const codigo = archivosNuevos.filter((a) => /\.tsx?$/.test(a.nombre)).map((a) => sinComentarios(a.texto)).join("\n");
  // Mover/editar la cita: solo el modal lo hace. Aquí ni se nombra.
  assert.ok(!/rescheduleAppointment/.test(codigo), "guardar fecha/hora/doctor es cosa del modal de la agenda");
  // El único endpoint que se toca a mano es el de estado, como hace el panel
  // de la agenda para cancelar con motivo.
  const rutas = codigo.match(/\/api\/[a-z0-9\-\/\$\{\}\.]+/gi) ?? [];
  assert.deepEqual([...new Set(rutas)], ["/api/appointments/${cita.id}/status"], `endpoints inesperados: ${rutas.join(", ")}`);
  // Ni solapes, ni horarios, ni vacaciones calculados en el cliente.
  for (const prohibido of [/overlap/i, /solap/i, /clinic-hours/, /vacacion/i, /time-?off/i, /canTransition/]) {
    assert.ok(!prohibido.test(codigo), `la carpeta menciona ${prohibido}: las reglas viven en el servidor y en el modal`);
  }
});

test("los estados que se ofrecen salen de la máquina de estados real, con el rol", () => {
  assert.match(VENTANA, /import \{ possibleTransitions \} from "@\/lib\/agenda\/transitions"/);
  assert.match(VENTANA, /possibleTransitions\([\s\S]*?role:[\s\S]*?now:[\s\S]*?appointmentStart:/, "sin `role` el filtro es solo estructural y el servidor devuelve 403");
  assert.match(VENTANA, /import \{ patchAppointmentStatus \} from "@\/lib\/agenda\/mutations"/);
  assert.match(VENTANA, /ESTADO_LEGACY_PENDIENTE/, "una fila PENDING no ofrece cambios: el servidor la rechaza con 409");
});

test("el modal sigue guardando con su único camino y solo presta de dónde lee", () => {
  const codigo = sinComentarios(MODAL);
  assert.equal((codigo.match(/rescheduleAppointment\(/g) ?? []).length, 1, "un solo guardado, con o sin `prestado`");
  // Dentro de la agenda nadie pasa `prestado`: el contexto manda, como siempre.
  assert.match(codigo, /const state = prestado \?\? agenda!\.state;/);
  assert.match(codigo, /if \(!agenda && !prestado\) throw new Error\("useAgenda must be used inside <AgendaProvider>"\)/);
  for (const uso of [
    "components/dashboard/agenda/agenda-detail-panel.tsx",
    "components/dashboard/agenda-nueva/panel-cita.tsx",
  ]) {
    const t = sinComentarios(leer(uso));
    const desde = t.indexOf("<AgendaEditAppointmentModal");
    const montaje = t.slice(desde, t.indexOf("/>", desde));
    assert.ok(!/prestado|extra=|pieExtra/.test(montaje), `${uso} no debe usar los huecos del expediente`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Eliminar es destructivo: confirma, dice QUÉ, y no promete un borrado
// ═══════════════════════════════════════════════════════════════════════════
test("eliminar pide confirmación y dice qué cita y qué le pasa", () => {
  const eliminar = VENTANA.slice(VENTANA.indexOf("async function eliminar"), VENTANA.indexOf("const e = estado("));
  const confirma = eliminar.indexOf("confirmarConMotivo(");
  const llama = eliminar.indexOf("fetch(");
  assert.ok(confirma > -1 && llama > confirma, "primero se confirma, después se llama al servidor");
  assert.match(eliminar, /if \(!r\.confirmed\) return;/);
  assert.match(eliminar, /variant: "danger"/);
  for (const dato of ["pacienteNombre", "formatDate(cita.date)", "cita.startTime", "doctor"]) {
    assert.ok(eliminar.includes(dato), `la confirmación no dice ${dato}`);
  }
  assert.match(eliminar, /recordatorios pendientes/, "dice qué más se anula");
  assert.match(eliminar, /«Cancelada»/, "la API cancela, no borra: la confirmación lo dice");
  // Y solo se ofrece a quien la API se lo va a aceptar.
  assert.match(VENTANA, /agenda\.permisos\.canCancel && transiciones\.includes\("CANCELLED"\)/);
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 Con la bandera apagada, nada de esto existe
// ═══════════════════════════════════════════════════════════════════════════
test("la página solo carga y pasa lo de la agenda con la bandera encendida", () => {
  assert.match(PAGINA, /const agendaCitas = rediseno\s*\?[\s\S]*?: null;/);
  assert.match(PAGINA, /\{\.\.\.\(agendaCitas \? \{ agendaCitas \} : \{\}\)\}/, "sin bandera ni siquiera viaja la prop");
  // Los mismos permisos y los mismos cargadores que /dashboard/agenda.
  const agenda = leer("app/dashboard/agenda/page.tsx");
  for (const pieza of ['hasPermission(permsUser, "agenda.edit")', 'hasPermission(permsUser, "agenda.delete")']) {
    assert.ok(PAGINA.includes(pieza), `falta ${pieza}`);
  }
  for (const cargador of ["fetchActiveDoctors", "fetchResources"]) {
    assert.ok(agenda.includes(cargador), `la agenda ya no usa ${cargador}: actualiza este candado`);
    assert.ok(PAGINA.includes(cargador), `el expediente no carga con ${cargador}`);
  }
});

test("la ficha solo monta la ventana en la rama del rediseño; la tabla de siempre no se toca", () => {
  assert.match(FICHA, /\{rediseno && agendaCitas && \(\s*<VentanaCita/);
  assert.match(FICHA, /onAbrir=\{agendaCitas \? \(a\) => setCitaAbiertaId\(a\.id\) : undefined\}/);
  // La tabla de siempre (`!rediseno`) no conoce ni la ventana ni el clic.
  const desde = FICHA.indexOf('{tab === "agenda" && !rediseno && (');
  assert.ok(desde > -1);
  const vieja = FICHA.slice(desde, FICHA.indexOf("</table>", desde));
  assert.ok(!/VentanaCita|onAbrir|citaAbiertaId/.test(vieja), "la tabla de siempre no abre nada");
});

// ═══════════════════════════════════════════════════════════════════════════
// Las leyes de Rafael: «Cancelar» sigue a un clic, y se llega con el teclado
// ═══════════════════════════════════════════════════════════════════════════
test("la fila abre la cita sin tragarse el «Cancelar» de siempre", () => {
  assert.match(TABLA, /onClick=\{abrir \? \(\) => abrir\(a\) : undefined\}/);
  assert.match(TABLA, /ev\.stopPropagation\(\);\s*onCancelar\(a\);/, "«Cancelar» no debe abrir además la ventana");
  assert.match(TABLA, /<button[\s\S]*?className=\{v\.abrir\}/, "la fecha es un botón: se abre también con el teclado");
});

test("se abren las mismas citas que la agenda deja editar: vivas y con permiso", () => {
  // La regla de la agenda, para que este candado avise si cambia allí.
  const panel = leer("components/dashboard/agenda-nueva/panel-cita.tsx");
  assert.match(panel, /\{!terminal && permissions\.canEdit && \(\s*<button[^>]*onClick=\{\(\) => setEditando\(true\)\}/);
  assert.match(VENTANA, /return permisos\.canEdit && status !== "CANCELLED" && status !== "NO_SHOW";/);
  assert.match(FICHA, /abrible=\{agendaCitas \? \(a\) => citaAbrible\(a\.status, agendaCitas\.permisos\) : undefined\}/);
});
