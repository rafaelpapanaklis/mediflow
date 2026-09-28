/**
 * La encuesta posterior a la cita no sale en cada control de ortodoncia — ws1-t5.
 *
 * Run: npx tsx --test src/lib/reminders/__tests__/seguimiento-post-cita.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  esVisitaDeRutinaDeOrtodoncia,
  motivoSinEncuesta,
  TIPO_CITA_CONTROL_RETENCION,
} from "../seguimiento-post-cita";
import { TIPO_CITA_CONTROL_ORTO } from "../../orthodontics/agenda-constants";
import { DEFAULT_ORTHO_APPOINTMENT_TYPES } from "../../orthodontics/clinic-settings-db";

test("el control mensual y el de retención son visitas de rutina", () => {
  assert.equal(esVisitaDeRutinaDeOrtodoncia(TIPO_CITA_CONTROL_ORTO), true);
  assert.equal(esVisitaDeRutinaDeOrtodoncia(TIPO_CITA_CONTROL_RETENCION), true);
  assert.equal(esVisitaDeRutinaDeOrtodoncia("  control de ORTODONCIA "), true);
  assert.equal(esVisitaDeRutinaDeOrtodoncia("Control de retencion"), true);
});

test("la valoración, la colocación, el retiro y las citas dentales sí llevan encuesta", () => {
  for (const tipo of [
    "Valoración de ortodoncia", "Colocación de aparatología", "Retiro de aparatología",
    "Urgencia de ortodoncia", "Toma de registros de ortodoncia",
    "Limpieza", "Consulta general", "Control", "", null, undefined,
  ]) {
    assert.equal(esVisitaDeRutinaDeOrtodoncia(tipo), false, `«${tipo}» se quedó sin encuesta`);
  }
});

test("los dos textos de rutina son los del catálogo de tipos de cita del módulo", () => {
  const catalogo = DEFAULT_ORTHO_APPOINTMENT_TYPES.map((t) => t.label);
  assert.ok(catalogo.includes(TIPO_CITA_CONTROL_ORTO));
  assert.ok(catalogo.includes(TIPO_CITA_CONTROL_RETENCION));
  assert.deepEqual(
    DEFAULT_ORTHO_APPOINTMENT_TYPES.filter((t) => esVisitaDeRutinaDeOrtodoncia(t.label)).map((t) => t.id),
    ["control", "control-retencion"],
  );
});

test("el motivo: lo de siempre (sin teléfono, ya preguntada) y, nuevo, el control", () => {
  const base = { tipo: "Limpieza", telefono: "5512345678", yaPreguntada: false };
  assert.equal(motivoSinEncuesta(base), null);
  assert.equal(motivoSinEncuesta({ ...base, telefono: null }), "sin-telefono");
  assert.equal(motivoSinEncuesta({ ...base, telefono: "" }), "sin-telefono");
  assert.equal(motivoSinEncuesta({ ...base, yaPreguntada: true }), "ya-preguntada");
  assert.equal(motivoSinEncuesta({ ...base, tipo: TIPO_CITA_CONTROL_ORTO }), "visita-de-rutina-ortodoncia");
  assert.equal(motivoSinEncuesta({ ...base, tipo: "Valoración de ortodoncia" }), null);
});

test("el proceso programado lee el tipo de la cita y usa la regla", () => {
  const ruta = readFileSync(
    join(__dirname, "..", "..", "..", "app/api/cron/post-appointment-followup/route.ts"),
    "utf8",
  );
  assert.match(ruta, /select: \{ id: true, type: true,/);
  assert.match(ruta, /motivoSinEncuesta\(\{\s*tipo: appt\.type,/);
  assert.match(ruta, /clinicId: clinic\.id/);
});
