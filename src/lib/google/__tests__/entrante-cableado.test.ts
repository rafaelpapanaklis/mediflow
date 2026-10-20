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
import { ConversionYaHecha, marcarBloqueoConvertido } from "../convertir.server";
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

test("encender: SOLO los 6 slugs de Salamanca, con RETURNING; nada más", () => {
  const sql = leer("sql/salamanca-encender-google.sql");
  const slugs = [...sql.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(slugs.sort(), [
    "centro-dental", "centro-dental-guanajuato", "centro-dental-san-felipe",
    "centro-dental-villagran", "clan-dental", "dental-bas",
  ]);
  assert.match(sql, /WHERE c\.slug IN \(/);
  assert.match(sql, /RETURNING/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /\bDROP\b|\bDELETE\b|UPDATE clinics/i);
});

test("schema.prisma: tablas aparte, sin relaciones nuevas en Clinic ni columnas nuevas en agenda_blocks", () => {
  const s = leer("prisma/schema.prisma");
  assert.match(s, /model GoogleAgendaImport \{[\s\S]*?@@map\("google_agenda_imports"\)/);
  assert.match(s, /model AgendaBlockGoogle \{[\s\S]*?@@map\("agenda_block_google"\)/);
  const bloque = s.slice(s.indexOf("model AgendaBlock {"), s.indexOf("@@map(\"agenda_blocks\")"));
  assert.doesNotMatch(bloque, /google/i, "agenda_blocks no gana columnas");
  assert.match(s, /enum AgendaBlockKind \{[\s\S]*?GOOGLE\n\}/);
});

test("una sede nueva hereda la bandera (copia de sede, sección «ajustes»)", () => {
  const s = leer("src/lib/branches/copia-sede.server.ts");
  assert.match(s, /heredarBanderaGoogle\(origenId, destinoId\)/);
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
  assert.match(r, /prepararConversionGoogle\(session\.clinic\.id, body\.googleBloqueoId, \{/);
  assert.match(r, /bloqueosDelHueco\.filter\(\(b\) => b\.id !== conversionGoogle\.bloqueoId\)/);
  const tx = r.slice(r.indexOf("prisma.$transaction(async (tx)"), r.indexOf("ensureUserCanSeePatient(tx"));
  assert.match(tx, /googleCalendarEventId: conversionGoogle\.googleEventId/);
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
  assert.deepEqual(llamadas[1][1].where, { id: "b1", clinicId: "c1", kind: "GOOGLE", deletedAt: null });
  assert.deepEqual(llamadas[1][1].data, { deletedAt: new Date(3), deletedById: "u1" }, "se retira, no se borra");
  await assert.rejects(() => marcarBloqueoConvertido(tx(0), d), ConversionYaHecha);
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
  for (const m of comp.matchAll(/t\("agenda\.google\.([a-zA-Z]+)"/g)) {
    assert.ok(es.agenda.google[m[1]], `falta agenda.google.${m[1]} en es.json`);
  }
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
