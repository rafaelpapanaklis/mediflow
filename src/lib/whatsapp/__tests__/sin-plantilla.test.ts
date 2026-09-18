/**
 * H-7 · Cumpleaños, reactivación y seguimientos fuera de la ventana de 24 h:
 * el bloqueo deja un motivo VERDADERO, en español, que el panel sabe traducir.
 *
 * Run: npx tsx --test src/lib/whatsapp/__tests__/sin-plantilla.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decideSendMode } from "../send-mode";
import { describeReminderError } from "../reminder-error";
import { REMINDER_REASON_KEY } from "../reason-i18n";
import { FRAGMENTOS_SIN_PLANTILLA, MOTIVO_SIN_PLANTILLA_PARA_TIPO, motivoDeBloqueo } from "../sin-plantilla";
import { whereSinPlantilla, DIAS_RESUMEN_SIN_PLANTILLA } from "../recent-reminders";

const SRC = join(__dirname, "..", "..", "..");
const plantillaAprobada = { reminder: { name: "dc_recordatorio_cita", lang: "es_MX", status: "APPROVED" } } as any;

/** Lo que el worker acaba guardando en errorMsg para un recordatorio bloqueado. */
function motivoGuardado(templates: any, params: string[] | null): string {
  const d = decideSendMode({ kind: "reminder", windowOpen: false, templates, params });
  assert.equal(d.mode, "blocked", "fuera de ventana y sin datos de plantilla NO se envía");
  return motivoDeBloqueo({ reason: (d as any).reason, cuelgaDeCita: params !== null });
}

test("un cumpleaños fuera de ventana SIGUE sin enviarse (no se manda «a ver si pasa»)", () => {
  for (const templates of [plantillaAprobada, {}]) {
    const d = decideSendMode({ kind: "reminder", windowOpen: false, templates, params: null });
    assert.equal(d.mode, "blocked");
  }
});

test("clínica CON plantilla: el motivo ya no es «espera 5 datos y se prepararon 0»", () => {
  const motivo = motivoGuardado(plantillaAprobada, null);
  assert.equal(motivo, MOTIVO_SIN_PLANTILLA_PARA_TIPO);
  assert.equal(describeReminderError(motivo), "noTemplateForKind");
});

test("clínica SIN plantilla: no se le manda a «configurar la plantilla» de un tipo que no existe", () => {
  const motivo = motivoGuardado({}, null);
  assert.equal(describeReminderError(motivo), "noTemplateForKind");
});

test("un recordatorio DE CITA conserva su motivo de siempre", () => {
  const motivo = motivoGuardado({}, ["Ana", "Clínica", "lunes", "10:00", "Dra. Ruiz"]);
  assert.equal(describeReminderError(motivo), "templateNotConfigured");
});

test("un bloqueo que no es de ventana pasa tal cual", () => {
  assert.equal(motivoDeBloqueo({ reason: "otra cosa", cuelgaDeCita: false }), "otra cosa");
});

test("las filas guardadas ANTES del arreglo también se traducen", () => {
  const viejo =
    "Fuera de la ventana de 24 h: la plantilla espera 5 datos y se prepararon 0. " +
    "No se envió para no gastar un intento rechazado.";
  assert.equal(describeReminderError(viejo), "noTemplateForKind");
  // …pero un desajuste real de datos (con cita) NO se confunde con esto.
  assert.equal(describeReminderError(viejo.replace("prepararon 0", "prepararon 4")), null);
});

test("el motivo tiene traducción en español y en inglés", () => {
  const clave = REMINDER_REASON_KEY.noTemplateForKind.split(".").pop()!;
  for (const lang of ["es", "en"]) {
    const dic = JSON.parse(readFileSync(join(SRC, "i18n", "dictionaries", `${lang}.json`), "utf8"));
    const wa = dic.inbox.whatsapp;
    assert.ok(wa[clave], `${lang}: falta ${clave}`);
    assert.ok(wa.noTemplateSummaryTitle && /\{count\}/.test(wa.noTemplateSummaryBody), `${lang}: falta el resumen`);
  }
});

test("el resumen cuenta SOLO lo de la clínica, fallido, de los últimos 30 días, por este motivo", () => {
  const ahora = new Date("2026-09-17T12:00:00Z");
  const w = whereSinPlantilla("clinica-1", ahora);
  assert.equal(w.clinicId, "clinica-1");
  assert.equal(w.status, "FAILED");
  assert.equal(ahora.getTime() - w.createdAt.gte.getTime(), DIAS_RESUMEN_SIN_PLANTILLA * 86_400_000);
  assert.deepEqual(w.OR.map((o) => o.errorMsg.contains), [...FRAGMENTOS_SIN_PLANTILLA]);
  // El texto nuevo y el viejo caen los dos en el filtro.
  assert.ok(FRAGMENTOS_SIN_PLANTILLA.some((f) => MOTIVO_SIN_PLANTILLA_PARA_TIPO.includes(f)));
});

test("cableado: el worker traduce el bloqueo y las dos pantallas pintan el resumen", () => {
  const worker = readFileSync(join(SRC, "lib", "whatsapp", "queue-worker.ts"), "utf8");
  assert.match(worker, /e instanceof WhatsAppBlockedError\s*\?\s*motivoDeBloqueo\(/);
  for (const rel of ["app/dashboard/whatsapp/whatsapp-client.tsx", "components/dashboard/whatsapp-rediseno/conexion.tsx"]) {
    const texto = readFileSync(join(SRC, rel), "utf8");
    assert.match(texto, /sinPlantilla30d > 0 &&/, `${rel} no pinta el resumen`);
    assert.match(texto, /noTemplateSummaryBody/, rel);
  }
});
