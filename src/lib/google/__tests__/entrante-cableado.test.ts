/**
 * Google Calendar → agenda (WS1-T9): el cableado. SQL, bandera, cron, textos,
 * la ruta de alta («Convertir en cita»), la sonda de tablas y lo que se monta
 * en la agenda. Sin base: se leen los archivos y se usan dobles.
 *
 * `npm run test:google-entrante`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tablasGoogleListas, _olvidarTablasGoogle } from "../tablas.server";
import { BloqueoCambiado, ConversionYaHecha, marcarBloqueoConvertido } from "../convertir.server";
import { puedeRetirar } from "@/lib/agenda-bloqueos/consulta.server";
import { BLOQUEO_KINDS, BLOQUEO_KIND_LABELS, parseKind } from "@/lib/agenda-bloqueos/core";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (p: string) => readFileSync(join(RAIZ, p), "utf8");

/* ═══ SQL y bandera ═════════════════════════════════════════════════════ */

test("SQL: solo aditivo e idempotente (enum + dos tablas), nada de DROP/RENAME/ALTER COLUMN", () => {
  const sql = leer("sql/salamanca-google.sql");
  assert.match(sql, /ALTER TYPE "AgendaBlockKind" ADD VALUE IF NOT EXISTS 'GOOGLE'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS google_agenda_imports/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS agenda_block_google/);
  assert.match(sql, /"enabled"\s+BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS agenda_block_google_evento_unico/);
  const sinComentarios = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(sinComentarios, /\bDROP\b|\bRENAME\b|ALTER COLUMN|(?<!ON )\bDELETE\b|\bTRUNCATE\b/i);
});

test("G2: el SQL entra ENTERO en una transacción (el SQL Editor): nada USA 'GOOGLE' después de añadirlo", () => {
  const sql = leer("sql/salamanca-google.sql").replace(/--.*$/gm, "");
  const tras = sql.slice(sql.indexOf("ADD VALUE IF NOT EXISTS 'GOOGLE'") + 10);
  // Ni enum_range ni un cast al tipo ni un literal del valor nuevo usado como enum.
  assert.doesNotMatch(tras, /enum_range|::\s*"AgendaBlockKind"|kind\s*=\s*'GOOGLE'/i);
  // La comprobación lee pg_enum (texto, no el tipo).
  assert.match(tras, /FROM pg_enum/);
  // Probado aparte en Postgres (PGlite): dos veces, con y sin BEGIN; ver el reporte.
});

test("RLS: las dos tablas nuevas niegan todo a anon/authenticated (títulos y token del canal no salen por PostgREST)", () => {
  const sql = leer("sql/salamanca-google.sql");
  for (const t of ["google_agenda_imports", "agenda_block_google"]) {
    assert.match(sql, new RegExp(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`CREATE POLICY "${t}_deny_anon" ON "${t}" AS RESTRICTIVE FOR ALL TO anon, authenticated USING \\(false\\)`));
  }
});

test("G14/G16: la comprobación previa es SOLO lectura y mira calendario propio, repetido y agenda nueva", () => {
  const sql = leer("sql/salamanca-google-verificar.sql").replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
  assert.match(sql, /@group\\\.calendar\\\.google\\\.com/);
  assert.match(sql, /calendario_repetido/);
  assert.match(sql, /'menu-dos-niveles'/);
});

test("encender (N-G13): los 6 slugs, con freno (las 6, un solo dueño SUPER_ADMIN en las 6) y solo las «listo»; nada más", () => {
  const sql = leer("sql/salamanca-encender-google.sql");
  const sinComentarios = sql.replace(/--.*$/gm, "");
  const slugs = [...new Set([...sinComentarios.matchAll(/'([a-z]+(?:-[a-z]+)+|dental-bas|clan-dental)'/g)].map((m) => m[1]))]
    .filter((x) => x !== "menu-dos-niveles");
  assert.deepEqual(slugs.sort(), [
    "centro-dental", "centro-dental-guanajuato", "centro-dental-san-felipe",
    "centro-dental-villagran", "clan-dental", "dental-bas",
  ]);
  assert.match(sinComentarios, /IF encontrados <> 6 THEN/);
  assert.match(sinComentarios, /count\(DISTINCT c\.id\)/, "N-A4: las 6 con SUPER_ADMIN, no solo «un dueño»");
  assert.match(sinComentarios, /IF con_dueno <> 6 THEN/);
  assert.match(sinComentarios, /IF duenos <> 1 THEN/);
  // La misma regla de «listo» que la verificación.
  const verificar = leer("sql/salamanca-google-verificar.sql");
  for (const trozo of ["@group\\.calendar\\.google\\.com$", "f.flag = 'menu-dos-niveles' AND f.enabled = false", "o.\"googleClinicCalendarId\" = c.\"googleClinicCalendarId\""]) {
    assert.ok(verificar.includes(trozo) && sinComentarios.includes(trozo), trozo);
  }
  assert.doesNotMatch(sinComentarios, /\bDROP\b|\bDELETE\b|UPDATE clinics/i);
  // Probado aparte en PGlite (×2 en transacción, freno con slug ajeno sin dueño): ver el reporte.
});

test("schema.prisma: tablas aparte, sin relaciones nuevas en Clinic ni columnas nuevas en agenda_blocks", () => {
  const s = leer("prisma/schema.prisma");
  assert.match(s, /model GoogleAgendaImport \{[\s\S]*?@@map\("google_agenda_imports"\)/);
  assert.match(s, /model AgendaBlockGoogle \{[\s\S]*?@@map\("agenda_block_google"\)/);
  const bloque = s.slice(s.indexOf("model AgendaBlock {"), s.indexOf("@@map(\"agenda_blocks\")"));
  assert.doesNotMatch(bloque, /google/i, "agenda_blocks no gana columnas");
  assert.match(s, /enum AgendaBlockKind \{[\s\S]*?GOOGLE\n\}/);
});

test("C4: una sede nueva hereda la bandera de la sede PRINCIPAL del dueño SIEMPRE (como la agenda), no solo al copiar", () => {
  const r = leer("src/app/api/clinics/route.ts");
  assert.match(r, /const principalGoogle = origen \? \{ clinicId: origen\.clinicId \} : await sedePrincipalDe\(supabaseId\);/);
  assert.match(r, /heredarBanderaGoogle\(principalGoogle\.clinicId, clinic\.id\)/);
  // Fuera del `if (origen …)` de la copia: corre aunque no se marque «copiar configuración».
  const bloque = r.slice(r.indexOf("const principalGoogle"));
  assert.ok(r.indexOf("const principalGoogle") > r.indexOf("copia = await copiarConfiguracion"));
  assert.match(bloque.slice(0, 600), /catch \(e\)/, "nunca tumba el alta");
  assert.doesNotMatch(leer("src/lib/branches/copia-sede.server.ts"), /heredarBanderaGoogle/, "una sola herencia");
  const b = leer("src/lib/google/bandera-sede.server.ts");
  assert.match(b, /if \(!origen\?\.enabled\) return 0/);
});

test("vercel.json: el cron de respaldo cada 5 minutos", () => {
  const v = JSON.parse(leer("vercel.json"));
  const c = v.crons.find((x: { path: string }) => x.path === "/api/cron/google-calendario");
  assert.ok(c);
  assert.equal(c.schedule, "*/5 * * * *");
  assert.match(leer("src/app/api/cron/google-calendario/route.ts"), /Bearer \$\{process\.env\.CRON_SECRET\}/);
});

/* ═══ El tipo nuevo en los bloqueos ════════════════════════════════════ */

test("GOOGLE tiene etiqueta pero NO se puede elegir a mano (parseKind → OTRO)", () => {
  assert.equal(BLOQUEO_KIND_LABELS.GOOGLE, "Google Calendar");
  assert.equal(BLOQUEO_KINDS.includes("GOOGLE" as never), false);
  assert.equal(parseKind("GOOGLE"), "OTRO");
});

test("un bloqueo de Google no lo retira nadie desde DaleControl (ni la administración)", () => {
  assert.equal(puedeRetirar({ role: "SUPER_ADMIN", userId: "u" }, { doctorId: null, kind: "GOOGLE" }), false);
  assert.equal(puedeRetirar({ role: "DOCTOR", userId: "u" }, { doctorId: "u", kind: "GOOGLE" }), false);
  assert.equal(puedeRetirar({ role: "SUPER_ADMIN", userId: "u" }, { doctorId: null, kind: "OTRO" }), true);
  const svc = leer("src/lib/agenda-bloqueos/service.ts");
  assert.equal((svc.match(/kind === "GOOGLE"\) throw errorDeBloqueoGoogle\(\)/g) ?? []).length, 2, "editar y retirar");
});

test("la rejilla del staff ve el título; el lector de los motores (bot, web, Sabina) no", () => {
  const c = leer("src/lib/agenda-bloqueos/consulta.server.ts");
  assert.match(c, /reason: b\.kind === "GOOGLE" \? etiquetaRejilla\(tituloGoogle \?\? ""\) : b\.reason/);
  const lector = c.slice(c.indexOf("export async function leerBloqueosDelRango"), c.indexOf("export async function leerBloqueosDelDia"));
  assert.doesNotMatch(lector, /titulo|etiquetaRejilla/);
});

/* ═══ «Convertir en cita» ══════════════════════════════════════════════ */

test("la ruta de alta: el bloqueo convertido no cuenta, la cita nace con el evento y se marca en la MISMA transacción", () => {
  const r = leer("src/app/api/appointments/route.ts");
  assert.match(r, /prepararConversionGoogle\(\s*session\.clinic\.id,\s*body\.googleBloqueoId,/);
  // G5: la hora y el doctor los decide el bloqueo en el servidor.
  assert.match(r, /\{ startsAt, endsAt, doctorId: body\.doctorId \}/);
  assert.match(r, /google_block_changed/);
  assert.match(r, /bloqueosDelHueco\.filter\(\(b\) => b\.id !== conversionGoogle\.bloqueoId\)/);
  const tx = r.slice(r.indexOf("prisma.$transaction(async (tx)"), r.indexOf("ensureUserCanSeePatient(tx"));
  assert.match(tx, /googleCalendarEventId: conversionGoogle\.googleEventId/);
  // C1: lejos de las líneas de `overrideReason` que toca ws1-t5 (sin conflicto al integrar).
  const lineas = tx.split("\n");
  const iEvento = lineas.findIndex((l) => l.includes("googleCalendarEventId: conversionGoogle"));
  const iOverride = lineas.findIndex((l) => l.includes("overrideReason:"));
  assert.ok(iOverride - iEvento >= 5, "al menos unas líneas de distancia");
  assert.match(tx, /marcarBloqueoConvertido\(tx,/);
  // Y la sincronización de salida de siempre (que hace PATCH del evento ligado) va DESPUÉS.
  assert.ok(r.indexOf("marcarBloqueoConvertido(tx") < r.indexOf("await sincronizarCitaEnSegundoPlano(session.clinic.id, created.id)"));
  assert.match(r, /google_block_already_converted/);
});

test("marcarBloqueoConvertido: condicional; si otro ya lo convirtió, lanza (y la transacción se deshace)", async () => {
  const llamadas: any[] = [];
  const tx = (cuenta: number) => ({
    agendaBlockGoogle: { updateMany: async (a: any) => { llamadas.push(["vinculo", a]); return { count: cuenta }; } },
    agendaBlock: { updateMany: async (a: any) => { llamadas.push(["bloque", a]); return { count: 1 }; } },
  });
  const d = { clinicId: "c1", bloqueoId: "b1", appointmentId: "a1", userId: "u1", startsAt: new Date(1), endsAt: new Date(2), ahora: new Date(3) };
  await marcarBloqueoConvertido(tx(1), d);
  assert.deepEqual(llamadas[0][1].where, { blockId: "b1", clinicId: "c1", appointmentId: null });
  assert.equal(llamadas[0][1].data.appointmentId, "a1");
  assert.deepEqual(llamadas[1][1].where, { id: "b1", clinicId: "c1", kind: "GOOGLE", deletedAt: null, startsAt: new Date(1), endsAt: new Date(2) });
  assert.deepEqual(llamadas[1][1].data, { deletedAt: new Date(3), deletedById: "u1" }, "se retira, no se borra");
  await assert.rejects(() => marcarBloqueoConvertido(tx(0), d), ConversionYaHecha);
  // G8: si el evento se movió o se quitó entretanto, NO es «otro lo convirtió».
  const txMovido = {
    agendaBlockGoogle: { updateMany: async () => ({ count: 1 }) },
    agendaBlock: { updateMany: async () => ({ count: 0 }) },
  };
  await assert.rejects(() => marcarBloqueoConvertido(txMovido, d), BloqueoCambiado);
});

test("G5: «Convertir» rechaza todo el día, más de 12 h, otra hora que la del bloqueo y otro doctor (si el del bloqueo atiende)", () => {
  const c = leer("src/lib/google/convertir.server.ts");
  const f = c.slice(c.indexOf("export async function prepararConversionGoogle"), c.indexOf("export class ConversionYaHecha"));
  for (const codigo of ["google_block_all_day", "google_block_too_long", "google_block_changed", "google_block_doctor"]) {
    assert.match(f, new RegExp(`no\\(409, "${codigo}"\\)`), codigo);
  }
  assert.match(f, /if \(dueno && puedeRecibirCitas\(dueno\)\) return no\(409, "google_block_doctor"\)/);
  // La pantalla tampoco ofrece «Convertir» en esos casos.
  const comp = leer("src/components/dashboard/agenda-nueva/google-calendario.tsx");
  assert.match(comp, /const noConvertible = !!detalle && \(detalle\.diaCompleto \|\| muyLargo\)/);
});

test("G7: el aviso solo sale si la cita SIGUE ligada a ese evento", () => {
  const c = leer("src/lib/google/convertir.server.ts");
  assert.match(c, /if \(!cita \|\| cita\.googleCalendarEventId !== v\.googleEventId\) return null;/);
});

test("G4/G6: la salida reconoce las citas que vinieron de Google (vínculo con el MISMO evento) y no se traga un fallo de base", () => {
  const s = leer("src/lib/agenda/google-sync.ts");
  assert.match(s, /vinculoParaSalida\(clinicId, a, a\.googleCalendarEventId\)/);
  const c = leer("src/lib/google/convertir.server.ts");
  const f = c.slice(c.indexOf("export async function vinculoParaSalida"), c.indexOf("export async function descartarAvisoDeCitaGoogle"));
  assert.match(f, /where: \{ clinicId, appointmentId: cita\.id, googleEventId \}/);
  // Las citas normales (evento con el id propio) no consultan nada ni dependen de esta lectura.
  assert.match(f, /if \(googleEventId === idEventoDeCita\(clinicId, cita\.id\)\) return null;/);
  // La sonda no usa un «no» guardado ni se traga un fallo.
  assert.match(f, /tablasGoogleListasOLanzar\(\)/);
  // «Mover la cita» limpia el aviso resuelto.
  assert.match(f, /avisoTipo: null, avisoStartsAt: null/);
  assert.doesNotMatch(f.replace(/\/\/.*$/gm, ""), /\bcatch\b/, "sin try/catch: mejor fallar y reintentar que borrar el evento");
});

test("G1: el título solo a quien ve la agenda de ESE doctor (rejilla y panel)", () => {
  const c = leer("src/lib/agenda-bloqueos/consulta.server.ts");
  assert.match(c, /if \(b\.kind === "GOOGLE" && !puedeVerTitulo\(ctx, b\)\) tituloGoogle = null;/);
  const v = leer("src/lib/google/convertir.server.ts");
  assert.match(v, /titulo: tituloVisible \? v\.title : ""/);
});

test("G9: el bot nunca dice «Google»: «Ese horario no está disponible»", () => {
  const b = leer("src/lib/agenda/bot-booking-service.ts");
  assert.match(b, /tapaTodo\.kind === "GOOGLE" \? \{ mensajeCompleto: MENSAJE_PACIENTE_GOOGLE \} : \{ mensajeBloqueo: tapaTodo\.reason \}/);
  const core = leer("src/lib/whatsapp/bot/booking-core.ts");
  assert.ok(core.indexOf("res.mensajeCompleto") < core.indexOf("la agenda está cerrada: ${res.mensajeBloqueo}"));
});

test("G10: en Configuración el tipo se pinta «Google Calendar» (no «Otro»), y no se puede elegir en el formulario", async () => {
  const { parseTipo, TIPOS_BLOQUEO } = await import("@/components/dashboard/bloqueos/tipos");
  assert.equal(parseTipo("GOOGLE"), "GOOGLE");
  assert.equal(parseTipo("CUALQUIERA"), "OTRO");
  assert.equal((TIPOS_BLOQUEO as readonly string[]).includes("GOOGLE"), false);
});

test("G11: pasar controles de ortodoncia lee los bloqueos con el lector común (ordenado, tope 2000)", () => {
  const s = leer("src/app/actions/orthodontics/moverControlesFuturosAlDoctor.ts");
  assert.match(s, /leerBloqueosDelRango\(ctx\.clinicId, desde, hasta, \{ doctorIds: \[plan\.treatingDoctorId\] \}\)/);
  assert.doesNotMatch(s.replace(/\/\/.*$/gm, ""), /take: 500|catch\(\(\) => \[\]\)/);
});

test("G3: el cron parte de los bloqueos (no de las filas apagadas) y un fallo no tumba a las demás (lo demás se EJECUTA en segunda-vuelta-servidor)", () => {
  const s = leer("src/lib/google/entrante.server.ts");
  const g = s.slice(s.indexOf("export async function clinicasSinBanderaConBloqueos"), s.indexOf("export async function retirarBloqueosDeGoogle"));
  assert.match(g, /agendaBlock\.groupBy/, "se parte de los bloqueos, no de las filas apagadas");
  assert.match(s, /error: caida \? "conexion_caida" : f\.lastError \?\? null/);
  // Un token rechazado al LEER marca la conexión caída (como al copiar una cita).
  assert.match(s, /r\.motivo === "autorizacion" && tokenAlEmpezar/);
  assert.match(s, /if \(ahora\?\.refreshToken === tokenAlEmpezar\) \{\s*await marcarGoogleCaido\(/, "no apaga una conexión recién reconectada");
  assert.doesNotMatch(s, /leerAjustesGoogle/, "ya no depende de clinic_google_status (ws1-t12)");
  const cron = leer("src/app/api/cron/google-calendario/route.ts");
  assert.match(cron, /clinicasSinBanderaConBloqueos/);
  assert.ok((cron.match(/catch \(e\)/g) ?? []).length >= 3, "try/catch por clínica");
});

test("G3/G12: el aviso de la agenda dice la verdad según el error; con la sesión vencida deja de preguntar", () => {
  const comp = leer("src/components/dashboard/agenda-nueva/google-calendario.tsx");
  assert.match(comp, /if \(error === "autorizacion" \|\| error === "conexion_caida"\) return "agenda\.google\.reconectarCaida";/);
  assert.match(comp, /if \(res\.status === 401 \|\| res\.status === 403\) \{ window\.clearInterval\(id\); return; \}/);
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  assert.doesNotMatch(es.agenda.google.reconectarCaida, /se siguen copiando/);
});

test("G15: el error del canal queda en la fila; series en lote", () => {
  const s = leer("src/lib/google/entrante.server.ts");
  assert.match(s, /channelError: String\(\(err as any\)\?\.message \?\? err\)\.slice\(0, 200\)/);
  assert.match(s, /recurringEventId: \{ in: recurringEventIds \}/);
});

test("C2/C5: «Convertir» y «Mover la cita» usan el mismo «¿Seguro?» (lo ejecuta sobreagendar-aviso) y traducen la comida", () => {
  const comp = leer("src/components/dashboard/agenda-nueva/google-calendario.tsx");
  assert.match(comp, /\.\.\.camposSobreagendar\(sobreagendar\)/);
  assert.match(comp, /moverCitaAlEvento\(\{/);
  assert.doesNotMatch(comp, /rescheduleAppointment/, "el aviso lee el 409 entero");
  assert.match(comp, /case "lunch_overlap": return "agenda\.google\.errorComida";/);
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  assert.equal(es.agenda.google.errorComida, "Ese horario es la comida del doctor.");
  assert.match(es.agenda.google.sobreagendar.cuerpoDoctor, /^Este doctor ya tiene una cita a esa hora .*¿Seguro\?$/);
});

/* ═══ La sonda de tablas (antes del SQL) ═══════════════════════════════ */

test("sin el SQL: UNA pregunta con to_regclass, recordada; ninguna consulta a las tablas", async () => {
  _olvidarTablasGoogle();
  let preguntas = 0;
  const db = { $queryRaw: async (q: TemplateStringsArray) => { preguntas++; assert.match(q.join("?"), /to_regclass/); return [{ existe: false }]; } };
  for (let i = 0; i < 20; i++) assert.equal(await tablasGoogleListas({ db }), false);
  assert.equal(preguntas, 1);
  assert.equal(await tablasGoogleListas({ db, forzar: true }), false);
  assert.equal(preguntas, 2);
  _olvidarTablasGoogle();
  const roto = { $queryRaw: async () => { throw new Error("red"); } };
  assert.equal(await tablasGoogleListas({ db: roto }), false, "si la sonda falla, se comporta como sin SQL");
  _olvidarTablasGoogle();
});

/* ═══ La pantalla ══════════════════════════════════════════════════════ */

test("textos es/en: mismas claves; los avisos dicen exactamente lo aprobado", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json"));
  assert.deepEqual(Object.keys(es.agenda.google).sort(), Object.keys(en.agenda.google).sort());
  assert.equal(es.agenda.google.avisoMovido, "El evento de Google cambió a {hora}. ¿Mover la cita?");
  assert.equal(es.agenda.google.avisoEliminado, "El evento de Google se eliminó. ¿Cancelar la cita?");
  assert.equal(es.agenda.google.convertirTitulo, "Convertir en cita");
  assert.equal(es.settings.bloqueos.tipoGOOGLE, "Google Calendar");
  assert.equal(en.settings.bloqueos.tipoGOOGLE, "Google Calendar");
  // Todas las claves que usa el componente existen.
  const comp = leer("src/components/dashboard/agenda-nueva/google-calendario.tsx");
  const clave = (d: any, ruta: string) => ruta.split(".").reduce((o, k) => (o == null ? o : o[k]), d);
  for (const m of comp.matchAll(/"agenda\.google\.([a-zA-Z_.]+)"/g)) {
    assert.ok(typeof clave(es.agenda.google, m[1]) === "string", `falta agenda.google.${m[1]} en es.json`);
    assert.ok(typeof clave(en.agenda.google, m[1]) === "string", `falta agenda.google.${m[1]} en en.json`);
  }
  for (const a of ["no_reconocido", "varios"]) assert.ok(es.agenda.google[`alcance_${a}`] && en.agenda.google[`alcance_${a}`]);
  assert.deepEqual(Object.keys(es.agenda.google.sobreagendar).sort(), Object.keys(en.agenda.google.sobreagendar).sort());
  // Español neutro con tú: nada de voseo.
  assert.doesNotMatch(JSON.stringify(es.agenda.google), /\b(tenés|podés|querés|elegí|volvé)\b/);
});

test("la agenda monta las tres piezas con el mínimo cambio", () => {
  const raiz = leer("src/components/dashboard/agenda-nueva/agenda-nueva.tsx");
  assert.match(raiz, /<SincronizarGoogleAlAbrir \/>/);
  const rejilla = leer("src/components/dashboard/agenda-nueva/cuadricula.tsx");
  assert.match(rejilla, /banda\.google \? <AccionBloqueoGoogle banda=\{banda\} \/> : null/);
  assert.match(rejilla, /banda\.google \? sg\.franjaGoogle : ""/);
  const panel = leer("src/components/dashboard/agenda-nueva/panel-cita.tsx");
  assert.match(panel, /<AvisoGoogleCita citaId=\{dto\.id\} onCancelar=/);
  const comp = leer("src/components/dashboard/agenda-nueva/google-calendario.tsx");
  assert.equal(comp.split("\n")[0], '"use client";');
  // La conversión va por la ruta normal de alta, con el bloqueo.
  assert.match(comp, /fetch\("\/api\/appointments"/);
  assert.match(comp, /googleBloqueoId: detalle\.id/);
  // Paciente nuevo: el alta normal (con su detección de duplicados), con el título sugerido.
  assert.match(comp, /abrirPacienteNuevo\(\{\s*initialName: detalle\.titulo/);
  // La franja gris no deja pasar el clic a la columna (que agendaría encima).
  assert.match(comp, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); setAbierto\(true\); \}\}/);
});

test("el parser de la pantalla conserva el dato de Google y la banda lo lleva a la rejilla", async () => {
  const { parseBloqueo } = await import("@/components/dashboard/bloqueos/tipos");
  const { bandasDelDia } = await import("@/components/dashboard/bloqueos/fechas");
  const raw = {
    id: "b1", doctorId: null, doctorNombre: null, kind: "GOOGLE", reason: "Ocupado (Google) · Junta",
    inicio: "2026-10-21T16:00:00.000Z", fin: "2026-10-21T17:00:00.000Z", diaCompleto: false,
    holidayKey: null, creadoPor: "Google Calendar", creadoEl: "2026-10-20T00:00:00.000Z", puedoRetirarlo: false,
    google: { titulo: "Junta" },
  };
  const b = parseBloqueo(raw)!;
  assert.deepEqual(b.google, { titulo: "Junta" });
  assert.equal(parseBloqueo({ ...raw, google: undefined })!.google, null);
  const [banda] = bandasDelDia([b], "2026-10-21", "America/Mexico_City", null);
  assert.deepEqual(banda.google, { titulo: "Junta" });
  assert.equal(banda.reason, "Ocupado (Google) · Junta");
});

/* ═══ Arreglos de la revisión ══════════════════════════════════════════ */

test("apagar/desconectar retira los bloqueos Y borra el syncToken (al volver, completa); encender también lo borra", () => {
  const s = leer("src/lib/google/entrante.server.ts");
  const f = s.slice(s.indexOf("export async function retirarBloqueosDeGoogle"), s.indexOf("// EL CANAL DE AVISOS"));
  assert.match(f, /data: \{ syncToken: null \}/);
  assert.match(leer("sql/salamanca-encender-google.sql"), /"syncToken" = NULL/);
});

test("una pasada que pierde la carrera con «Convertir en cita» no reactiva el bloqueo convertido", () => {
  const s = leer("src/lib/google/entrante.server.ts");
  const f = s.slice(s.indexOf("async actualizarBloqueo("), s.indexOf("async inactivarBloqueo("));
  assert.ok(f.indexOf("agendaBlockGoogle.updateMany") < f.indexOf("agendaBlock.updateMany"), "primero el vínculo");
  assert.match(f, /appointmentId: null/);
  assert.match(f, /if \(v\.count === 0\) return;/);
});

test("DOCTOR: no convierte el bloqueo de otro doctor ni toca el aviso de una cita ajena", () => {
  assert.match(leer("src/lib/google/convertir.server.ts"), /quien\?\.role === "DOCTOR" && bloque\.doctorId !== null && bloque\.doctorId !== quien\.userId/);
  const r = leer("src/app/api/google/agenda/cita/[id]/route.ts");
  assert.match(r, /session\.user\.role === "DOCTOR" && cita\.doctorId !== session\.user\.id/);
  assert.match(r, /assertPatientVisible\(cita\.patientId/);
});
