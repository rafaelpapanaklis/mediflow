// MENSAJES — la bandeja de WhatsApp con entrada propia (15-nov, Rafael:
// «saca "Conversaciones" al menú principal abajo de Clientes y ponlo como
// "Mensajes"»).
//
//   npx tsx --test src/lib/barber/__tests__/mensajes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getBarberT } from "@/i18n/dictionaries/barber";
import type { BarberWaThreadDTO } from "@/lib/barber/whatsapp-core";
import {
  cuandoLista,
  desarmarCuerpo,
  esAutomatico,
  etiquetaDia,
  filtrarChats,
  horaCorta,
  iniciales,
  proximaCita,
  quienAtiende,
  trozosConEnlaces,
  ventanaRestante,
  vistaPrevia,
} from "@/components/barber/mensajes/formato";
import { chatsSinLeer } from "@/components/barber/mensajes/sin-leer";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\{\s*\}/g, "");

// ── La mudanza ───────────────────────────────────────────────────────────

test("WhatsApp ya no tiene la pestaña «Conversaciones»: Conexión, Plantillas, Campañas y Bot", () => {
  const pantalla = sinComentarios(leer("src/components/barber/whatsapp/whatsapp-screen.tsx"));
  assert.doesNotMatch(pantalla, /InboxPanel/);
  assert.doesNotMatch(pantalla, /tabs\.inbox/);
  for (const llave of ["tabs.conexion", "tabs.plantillas", "tabs.campanas", "tabs.bot"]) {
    assert.match(pantalla, new RegExp(llave.replace(".", "\\.")), llave);
  }
});

test("la liga vieja de la pestaña lleva a /barber/mensajes, después del candado de pago", () => {
  const pagina = sinComentarios(leer("src/app/barber/(panel)/whatsapp/page.tsx"));
  assert.match(pagina, /redirect\("\/barber\/mensajes"\)/);
  for (const nombre of ["inbox", "conversaciones"]) assert.match(pagina, new RegExp(`"${nombre}"`));
  const cuerpo = pagina.slice(pagina.indexOf("export default async function"));
  const awaits = Array.from(cuerpo.matchAll(/await\s+([A-Za-z_$][\w$.]*)/g)).map((m) => m[1]);
  assert.deepEqual(awaits.slice(0, 3), ["getBarberContext", "requireBarberPaidAccess", "props.searchParams"]);
});

test("el bot: cada chat que atiende una persona abre su conversación en Mensajes", () => {
  const bot = leer("src/components/barber/bot/bot-screen.tsx");
  assert.match(bot, /\/barber\/mensajes\?tel=\$\{encodeURIComponent\(p\.phone\)\}/);
  for (const loc of ["es", "en"]) {
    const dict = JSON.parse(leer(`src/i18n/dictionaries/barber/bot.${loc}.json`));
    assert.ok(dict.pauses.openChat, `falta pauses.openChat en ${loc}`);
  }
});

test("/barber/mensajes tiene su página, con el candado de la bandeja", () => {
  const pagina = sinComentarios(leer("src/app/barber/(panel)/mensajes/page.tsx"));
  assert.match(pagina, /hasBarberPermission\(permUser, "whatsapp\.view"\)/);
  assert.match(pagina, /barberPlanHasFeature\(plan, "whatsappInbox"\)/);
});

// ── Piezas puras de la bandeja (formato.ts) ──────────────────────────────

const TZ = "America/Mexico_City";

test("Mensajes escribe los teléfonos con el formateador único del vertical", () => {
  const pantalla = leer("src/components/barber/mensajes/mensajes-screen.tsx");
  assert.match(pantalla, /from "@\/lib\/barber\/phone-format"/);
  assert.match(pantalla, /formatBarberPhone\(/);
  assert.doesNotMatch(pantalla, /telefonoLegible/);
  assert.doesNotMatch(leer("src/components/barber/mensajes/formato.ts"), /function telefonoLegible/);
});

test("iniciales: dos letras del nombre, null sin nombre", () => {
  assert.equal(iniciales("Juan Pérez López"), "JL");
  assert.equal(iniciales("ángel"), "Á");
  assert.equal(iniciales(null), null);
  assert.equal(iniciales("  "), null);
});

test("hora de la lista: ahora, minutos, hora de hoy, ayer, día de la semana y fecha", () => {
  const ahora = new Date("2026-11-15T20:00:00Z"); // 14:00 en CDMX, domingo
  const tx = { ahora: "Ahora", ayer: "Ayer" };
  assert.equal(cuandoLista("2026-11-15T19:59:40Z", ahora, TZ, "es", tx), "Ahora");
  assert.match(cuandoLista("2026-11-15T19:48:00Z", ahora, TZ, "es", tx), /12 min/);
  assert.equal(cuandoLista("2026-11-15T15:05:00Z", ahora, TZ, "es", tx), "9:05 a. m.");
  assert.equal(cuandoLista("2026-11-14T23:00:00Z", ahora, TZ, "es", tx), "Ayer");
  assert.match(cuandoLista("2026-11-11T18:00:00Z", ahora, TZ, "es", tx), /^mi[ée]/i);
  assert.match(cuandoLista("2026-10-02T18:00:00Z", ahora, TZ, "es", tx), /^2 oct/);
  // En la zona de la barbería: las 23:30 de CDMX del sábado ya son domingo en UTC.
  assert.equal(cuandoLista("2026-11-15T05:30:00Z", ahora, TZ, "es", tx), "Ayer");
  assert.equal(horaCorta("2026-11-15T21:05:00Z", TZ, "en"), "3:05 PM");
});

test("separador de día: Hoy, Ayer y la fecha larga con mayúscula", () => {
  const ahora = new Date("2026-11-15T20:00:00Z");
  const tx = { hoy: "Hoy", ayer: "Ayer" };
  assert.equal(etiquetaDia("2026-11-15T16:00:00Z", ahora, TZ, "es", tx), "Hoy");
  assert.equal(etiquetaDia("2026-11-14T16:00:00Z", ahora, TZ, "es", tx), "Ayer");
  assert.match(etiquetaDia("2026-11-10T16:00:00Z", ahora, TZ, "es", tx), /^Martes,? 10 de noviembre$/);
});

test("cuerpo: opciones, transcripción de voz y pie de foto, sin los avisos del servidor", () => {
  const conOpciones = desarmarCuerpo("¿Qué servicio quieres?\n🔘 Opciones: Corte · Barba · Corte y barba", null);
  assert.equal(conOpciones.texto, "¿Qué servicio quieres?");
  assert.deepEqual(conOpciones.opciones, ["Corte", "Barba", "Corte y barba"]);
  assert.ok(esAutomatico("Hola\n🔘 Opciones: Sí · No"));
  assert.ok(!esAutomatico("Hola, te esperamos"));

  const voz = desarmarCuerpo("🎤 Nota de voz: quiero cita mañana a las 5", "audio");
  assert.equal(voz.transcripcion, "quiero cita mañana a las 5");
  assert.equal(voz.texto, null);
  const vozSinTranscribir = desarmarCuerpo("🎤 Te mandaron una nota de voz", "audio");
  assert.equal(vozSinTranscribir.texto, null);
  assert.equal(vozSinTranscribir.transcripcion, null);

  assert.equal(desarmarCuerpo("📷 Te mandaron una foto — así lo quiero", "image").texto, "así lo quiero");
  assert.equal(desarmarCuerpo("📷 Te mandaron una foto", "image").texto, null);
  assert.equal(desarmarCuerpo("📄 Te mandaron el archivo lista.pdf", "document").texto, null);
  // Sin adjunto, el texto del cliente se respeta tal cual.
  assert.equal(desarmarCuerpo("📷 Te mandaron una foto", null).texto, "📷 Te mandaron una foto");

  assert.equal(vistaPrevia("¿Qué servicio?\n🔘 Opciones: Corte · Barba"), "¿Qué servicio?");
});

test("enlaces: la ubicación de Google Maps se vuelve enlace, sin la puntuación final", () => {
  const trozos = trozosConEnlaces("Aquí estoy: https://maps.google.com/?q=21.0,-89.6.");
  assert.deepEqual(trozos.map((x) => x.enlace), [false, true, false]);
  assert.equal(trozos[1].valor, "https://maps.google.com/?q=21.0,-89.6");
});

test("quién atiende: pausa → persona; bot encendido y conectado → bot; si no, nadie", () => {
  const bot = { disponible: true, encendido: true, conectado: true };
  const pausas = [{ phone: "9992602093", reason: null, pausedAt: "2026-11-15T18:00:00Z" }];
  assert.equal(quienAtiende("9992602093", bot, pausas), "persona");
  assert.equal(quienAtiende("5512345678", bot, pausas), "bot");
  assert.equal(quienAtiende("5512345678", { ...bot, encendido: false }, []), "nadie");
  assert.equal(quienAtiende("5512345678", { ...bot, disponible: false }, []), "nadie");
  assert.equal(quienAtiende("5512345678", { ...bot, conectado: false }, []), "nadie");
});

test("filtros y búsqueda: sin leer, bot, pausados; por nombre, teléfono o mensaje", () => {
  const hilo = (phone: string, extra: Partial<BarberWaThreadDTO> = {}): BarberWaThreadDTO => ({
    phone,
    clientId: null,
    clientName: null,
    lastBody: "hola",
    lastAt: "2026-11-15T18:00:00Z",
    lastDirection: "INBOUND",
    lastStatus: "DELIVERED",
    unread: 0,
    archived: false,
    windowOpen: true,
    ...extra,
  });
  const hilos = [
    hilo("9992602093", { clientName: "Juan Pérez", unread: 2 }),
    hilo("5512345678", { lastBody: "¿tienen cita el sábado?" }),
    hilo("3331112222"),
  ];
  const atiende = (p: string) => (p === "5512345678" ? ("persona" as const) : ("bot" as const));
  const tels = (xs: BarberWaThreadDTO[]) => xs.map((x) => x.phone);
  assert.deepEqual(tels(filtrarChats(hilos, "sinLeer", "", atiende)), ["9992602093"]);
  assert.deepEqual(tels(filtrarChats(hilos, "pausados", "", atiende)), ["5512345678"]);
  assert.deepEqual(tels(filtrarChats(hilos, "bot", "", atiende)), ["9992602093", "3331112222"]);
  assert.deepEqual(tels(filtrarChats(hilos, "todos", "juan", atiende)), ["9992602093"]);
  assert.deepEqual(tels(filtrarChats(hilos, "todos", "333 111", atiende)), ["3331112222"]);
  assert.deepEqual(tels(filtrarChats(hilos, "todos", "sábado", atiende)), ["5512345678"]);
  assert.equal(chatsSinLeer(hilos), 1);
});

test("próxima cita: la viva más cercana del cliente o de su teléfono", () => {
  const ahora = new Date("2026-11-15T18:00:00Z");
  const cita = (id: string, startAt: string, status: string, extra: Record<string, unknown> = {}) => ({
    id,
    clientId: null,
    clientPhone: "999 260 2093",
    startAt,
    status,
    barberName: "Beto",
    services: [{ serviceName: "Corte" }],
    ...extra,
  });
  const citas = [
    cita("pasada", "2026-11-15T15:00:00Z", "CONFIRMED"),
    cita("cancelada", "2026-11-16T15:00:00Z", "CANCELLED"),
    cita("lejana", "2026-11-20T15:00:00Z", "PENDING"),
    cita("buena", "2026-11-17T15:00:00Z", "CONFIRMED"),
    cita("ajena", "2026-11-16T12:00:00Z", "CONFIRMED", { clientPhone: "5512345678" }),
  ];
  assert.equal(proximaCita(citas, "529992602093", null, ahora)?.id, "buena");
  assert.equal(proximaCita(citas, "1111111111", null, ahora), null);
});

test("ventana de 24 h: cuenta desde el último mensaje DEL CLIENTE", () => {
  const ahora = new Date("2026-11-15T18:00:00Z");
  const msgs = [
    { direction: "INBOUND", createdAt: "2026-11-14T20:00:00Z" },
    { direction: "OUTBOUND", createdAt: "2026-11-15T17:00:00Z" },
  ];
  assert.equal(ventanaRestante(msgs, ahora), 2 * 60 * 60 * 1000);
  assert.equal(ventanaRestante([{ direction: "INBOUND", createdAt: "2026-11-13T10:00:00Z" }], ahora), 0);
  assert.equal(ventanaRestante([], ahora), 0);
});

// ── Textos y estilos ─────────────────────────────────────────────────────

test("cada t(\"…\") de la pantalla existe en es y en", () => {
  const fuente = leer("src/components/barber/mensajes/mensajes-screen.tsx");
  const llaves = new Set(Array.from(fuente.matchAll(/\bt\("([a-zA-Z.]+)"/g)).map((m) => m[1]));
  // Las que se arman: estados, filtros y vacíos por filtro.
  for (const st of ["PENDING", "SENT", "DELIVERED", "READ", "FAILED"]) llaves.add(`status.${st}`);
  for (const f of ["todos", "sinLeer", "bot", "pausados", "archivados"]) llaves.add(`filters.${f}`);
  for (const f of ["SinLeer", "Bot", "Pausados", "Archivados"]) llaves.add(`list.empty${f}`);
  assert.ok(llaves.size > 40, `solo ${llaves.size} llaves: ¿cambió la forma de llamar a t()?`);
  for (const locale of ["es", "en"]) {
    const t = getBarberT(locale);
    const faltan = Array.from(llaves).filter((k) => t(`barber.mensajes.${k}`).startsWith("barber.mensajes"));
    assert.deepEqual(faltan, [], `[${locale}] faltan llaves`);
  }
});

test("estilos: solo tokens (ni un hex), letra nunca mayor que la del panel", () => {
  const css = leer("src/components/barber/mensajes/mensajes.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "hay un hex suelto");
  const tamanos = Array.from(css.matchAll(/font-size:\s*([\d.]+)px/g)).map((m) => Number(m[1]));
  assert.ok(tamanos.length > 10);
  assert.ok(Math.max(...tamanos) <= 14, `letra de ${Math.max(...tamanos)} px: la mayor del panel en tarjetas es 14`);
  // El título usa la misma escala que las demás pantallas.
  assert.match(css, /font-size: clamp\(19px, 2\.2vw, 23px\)/);
});

// ── El contador del menú es ligero (revisión ronda 16) ───────────────────

test("contador del menú: pide solo el CONTEO, cada ≥ 2 min y se apaga con la pestaña escondida", () => {
  const hook = sinComentarios(leer("src/components/barber/mensajes/sin-leer.ts"));
  assert.match(hook, /"\/api\/barber\/whatsapp\/unread"/);
  assert.doesNotMatch(hook, /whatsapp\/threads/, "el menú ya no baja la lista de hilos");
  const cada = /MENSAJES_SIN_LEER_CADA_MS = ([\d_]+)/.exec(hook);
  assert.ok(cada && Number(cada[1].replace(/_/g, "")) >= 120_000, "intervalo de al menos 2 min");
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /clearInterval/, "con la pestaña escondida el reloj se apaga, no solo se salta");

  const menu = sinComentarios(leer("src/components/barber/barber-sidebar.tsx"));
  assert.match(menu, /sondear: conMensajes && !enMensajes && \(escritorio \|\| mobileOpen\)/);
});

test("/api/barber/whatsapp/unread: el MISMO candado que /threads y un solo número", () => {
  const ruta = sinComentarios(leer("src/app/api/barber/whatsapp/unread/route.ts"));
  assert.match(ruta, /permission: "whatsapp\.view"/);
  assert.match(ruta, /feature: WA_INBOX_FEATURE/);
  assert.match(ruta, /COUNT\(\*\)/);
  assert.match(ruta, /LIMIT 2000/, "las mismas filas que mira la lista");
  assert.match(ruta, /NextResponse\.json\(\{ chats:/);
});
