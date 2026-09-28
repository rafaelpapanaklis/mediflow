/**
 * Ortodoncia en la pantalla «Hoy» — ws1-t5.
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/hoy.test.ts
 *
 * Revisión de lógica de uso (fila 8 del mapa): el Hoy solo decía «N
 * mensualidades vencidas» y mandaba a Caja; el doctor no veía nada de
 * ortodoncia y el control abría la ficha general.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RUTA_COBRANZA_ORTODONCIA,
  RUTA_CONTROLES_ORTODONCIA,
  RUTA_MENSUALIDADES_EN_CAJA,
  destinoDeLaCitaEnHoy,
  destinoDeMensualidadesVencidas,
  queEnsenarEnHoy,
  resumirControlesDeHoy,
  subtituloDeMensualidadesVencidas,
  type ControlDeHoy,
} from "../hoy";
import { TIPO_CITA_CONTROL_ORTO } from "../agenda-constants";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const control = (p: Partial<ControlDeHoy>): ControlDeHoy => ({
  appointmentId: "c1",
  patientId: "p1",
  patientName: "Ana Pérez",
  startsAt: "2026-09-28T16:00:00.000Z",
  hora: "10:00",
  status: "SCHEDULED",
  hoja: null,
  ...p,
});

// ═══ A dónde lleva cada cosa ════════════════════════════════════════════
test("un control de ortodoncia abre el caso del paciente; otra cita, su ficha", () => {
  assert.equal(
    destinoDeLaCitaEnHoy({ patientId: "p1", motivo: TIPO_CITA_CONTROL_ORTO }),
    "/dashboard/patients/p1?tab=ortodoncia",
  );
  for (const motivo of ["Limpieza", "Control", "control de ortodoncia", "", null, undefined]) {
    assert.equal(destinoDeLaCitaEnHoy({ patientId: "p1", motivo }), "/dashboard/patients/p1");
  }
});

test("las mensualidades vencidas llevan a Cobranza a quien puede entrar al módulo, y a Caja a quien no", () => {
  assert.equal(destinoDeMensualidadesVencidas(true), RUTA_COBRANZA_ORTODONCIA);
  assert.equal(destinoDeMensualidadesVencidas(false), RUTA_MENSUALIDADES_EN_CAJA);
  assert.match(subtituloDeMensualidadesVencidas(true), /Cobranza/);
  assert.match(subtituloDeMensualidadesVencidas(false), /Caja/);
  // Las dos rutas existen de verdad.
  assert.match(leer("app/dashboard/orthodontics/layout.tsx"), /href: "\/dashboard\/orthodontics\/cobranza"/);
  assert.match(leer("app/dashboard/orthodontics/layout.tsx"), /href: "\/dashboard\/orthodontics\/controles"/);
});

// ═══ Quién ve qué ═══════════════════════════════════════════════════════
test("sin módulo o en una sede no dental, el Hoy no enseña nada de ortodoncia", () => {
  const todo = { esDental: true, moduloActivo: true, tienePermisoModulo: true, tienePermisoCobro: true };
  assert.deepEqual(queEnsenarEnHoy(todo), { controles: true, mensualidades: true, puedeVerModulo: true });
  for (const falta of ["esDental", "moduloActivo"] as const) {
    assert.deepEqual(
      queEnsenarEnHoy({ ...todo, [falta]: false }),
      { controles: false, mensualidades: false, puedeVerModulo: false },
    );
  }
});

test("recepción (cobra, sin permiso del módulo) ve las mensualidades y no los controles", () => {
  assert.deepEqual(
    queEnsenarEnHoy({ esDental: true, moduloActivo: true, tienePermisoModulo: false, tienePermisoCobro: true }),
    { controles: false, mensualidades: true, puedeVerModulo: false },
  );
});

test("quien no puede ver facturación no ve el dinero, aunque entre al módulo", () => {
  assert.deepEqual(
    queEnsenarEnHoy({ esDental: true, moduloActivo: true, tienePermisoModulo: true, tienePermisoCobro: false }),
    { controles: true, mensualidades: false, puedeVerModulo: true },
  );
});

// ═══ El aviso de los controles de hoy ═══════════════════════════════════
test("sin controles en pie, el aviso se calla", () => {
  assert.equal(resumirControlesDeHoy([]), null);
  assert.equal(
    resumirControlesDeHoy([control({ status: "CANCELLED" }), control({ appointmentId: "c2", status: "NO_SHOW" })]),
    null,
  );
});

test("un solo control por registrar lleva directo al caso de ese paciente", () => {
  const r = resumirControlesDeHoy([control({})])!;
  assert.equal(r.titulo, "1 control de ortodoncia hoy");
  assert.equal(r.sub, "Falta 1 por registrar · 10:00 Ana Pérez");
  assert.equal(r.href, "/dashboard/patients/p1?tab=ortodoncia");
});

test("varios por registrar: dice cuántos, cuál sigue, y lleva a Controles", () => {
  const r = resumirControlesDeHoy([
    control({ appointmentId: "c3", patientId: "p3", patientName: "Luis Gómez", startsAt: "2026-09-28T18:00:00.000Z", hora: "12:00" }),
    control({ appointmentId: "c1", hoja: "SIGNED" }),
    control({ appointmentId: "c2", patientId: "p2", patientName: "Eva Ruiz", startsAt: "2026-09-28T17:00:00.000Z", hora: "11:00", hoja: "DRAFT" }),
    control({ appointmentId: "c4", patientId: "p4", status: "CANCELLED" }),
  ])!;
  assert.equal(r.total, 3);
  assert.equal(r.registrados, 1);
  assert.equal(r.titulo, "3 controles de ortodoncia hoy");
  assert.equal(r.sub, "Faltan 2 por registrar · 11:00 Eva Ruiz");
  assert.equal(r.href, RUTA_CONTROLES_ORTODONCIA);
  assert.deepEqual(r.porRegistrar.map((c) => c.appointmentId), ["c2", "c3"]);
});

test("una hoja en borrador todavía no es un control registrado", () => {
  const r = resumirControlesDeHoy([control({ hoja: "DRAFT" })])!;
  assert.equal(r.registrados, 0);
  assert.equal(r.porRegistrar.length, 1);
});

test("con todo registrado lo dice, y lleva a Controles", () => {
  assert.equal(resumirControlesDeHoy([control({ hoja: "SIGNED" })])!.sub, "Ya está registrado");
  const r = resumirControlesDeHoy([control({ hoja: "SIGNED" }), control({ appointmentId: "c2", hoja: "SIGNED" })])!;
  assert.equal(r.sub, "Todos registrados");
  assert.equal(r.href, RUTA_CONTROLES_ORTODONCIA);
});

// ═══ Cableado ═══════════════════════════════════════════════════════════
test("la lectura decide con la sesión: clínica, módulo real, permisos y visibilidad", () => {
  const accion = leer("app/actions/orthodontics/hoy/resumenDeHoy.ts");
  assert.match(accion, /hasActiveOrthodonticsModule\(ctx\.clinicId\)/);
  assert.match(accion, /hasPermission\(quien, "specialties\.orthodontics"\)/);
  assert.match(accion, /hasPermission\(quien, "billing\.view"\)/);
  assert.match(accion, /relatedPatientVisibilityAnd\(viewer\)/);
  assert.match(accion, /ctx\.canViewAllData \? \{\} : \{ doctorId: ctx\.userId \}/, "el doctor vería los controles de todos");
  assert.match(accion, /if \(!ctx\.clinicId\) return ok\(VACIO\)/);
  // Toda consulta va acotada a la clínica de la sesión.
  const consultas = accion.match(/prisma\.\w+\.find\w+\(\{[\s\S]*?\n {4,8}\}\);?/g) ?? [];
  assert.ok(consultas.length >= 3);
  for (const c of consultas) assert.match(c, /ctx\.clinicId/, `consulta sin clínica: ${c.slice(0, 60)}`);
  // Solo lectura.
  assert.ok(!/\.(create|update|upsert|delete)\w*\(/.test(accion), "la lectura del Hoy escribe en la base");
  // El dinero sale de la misma lectura que Caja.
  assert.match(accion, /listarMensualidadesPorCobrar\(\)/);
});

test("los «Hoy» montan el aviso y el aviso usa las reglas", () => {
  const aviso = leer("components/dashboard/home/ortodoncia-en-hoy.tsx");
  assert.match(aviso, /^"use client";/);
  assert.match(aviso, /resumirControlesDeHoy\(resumen\.controles\)/);
  assert.match(aviso, /destinoDeMensualidadesVencidas\(resumen\.puedeVerModulo\)/);
  assert.ok(!aviso.includes('href="/dashboard/caja'), "el aviso sigue mandando siempre a Caja");
  assert.match(leer("components/dashboard/home/aviso-mensualidades-vencidas.tsx"), /<OrtodonciaEnHoy \/>/);
  for (const hoy of [
    "components/dashboard/hoy-rediseno/hoy-admin.tsx",
    "components/dashboard/hoy-rediseno/hoy-recepcion.tsx",
    "components/dashboard/home/home-admin.tsx",
    "components/dashboard/home/home-receptionist.tsx",
  ]) {
    assert.match(leer(hoy), /<AvisoMensualidadesVencidas \/>/, `${hoy} dejó de montar el aviso`);
  }
});
