/**
 * ORTODONCIA EN EL BUSCADOR DEL TOPBAR (Ctrl+K) — ws1-t5.
 *
 * Run: npx tsx --test src/lib/command-palette/__tests__/ortodoncia-paleta.test.ts
 *
 * Revisión de lógica de uso (fila 9 del mapa): escribir «ortodoncia» decía
 * «Sin resultados» y un paciente en tratamiento solo abría su ficha.
 *
 * Dos clases de prueba, como en buscador-paleta.test.ts: lógica pura sobre
 * ortodoncia.ts y actions.ts, y guardas sobre el CÓDIGO FUENTE de la ruta y
 * de la paleta (cableado que no se puede montar sin navegador ni base).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DESTINOS_ORTODONCIA,
  SIN_ACCESO_ORTODONCIA,
  accesoOrtodonciaParaPaleta,
  destinosOrtodoncia,
  hrefCasoOrtodoncia,
  leerAccesoOrtodoncia,
  ofreceAbrirCaso,
} from "../ortodoncia";
import { buildOrthodonticsActions, buildOpenOrthoCaseAction, buildGlobalActions } from "../actions";
import { fuzzyScore } from "../fuzzy";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const TODO = { activo: true, configuracion: true };
const SIN_CONFIG = { activo: true, configuracion: false };

/** Lo mismo que hace la paleta para filtrar las acciones con lo que se escribió. */
function buscar(q: string, acceso = TODO): string[] {
  return buildOrthodonticsActions(acceso)
    .filter((it) => fuzzyScore(q, [it.label, ...(it.keywords ?? [])].join(" ")) > 0)
    .map((it) => it.id);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · Quién ve ortodoncia en el buscador
// ═══════════════════════════════════════════════════════════════════════════
test("sin módulo, sin permiso o en una sede no dental no hay NADA de ortodoncia", () => {
  const base = { esDental: true, moduloActivo: true, tienePermisoModulo: true, puedeVerConfiguracion: true };
  assert.deepEqual(accesoOrtodonciaParaPaleta(base), TODO);
  for (const falta of ["esDental", "moduloActivo", "tienePermisoModulo"] as const) {
    const acceso = accesoOrtodonciaParaPaleta({ ...base, [falta]: false });
    assert.deepEqual(acceso, SIN_ACCESO_ORTODONCIA, `sin ${falta} sigue habiendo acceso`);
    assert.deepEqual(destinosOrtodoncia(acceso), []);
    assert.deepEqual(buildOrthodonticsActions(acceso), []);
    assert.deepEqual(buscar("ortodoncia", acceso), []);
  }
});

test("Configuración solo le sale a quien puede abrirla", () => {
  const acceso = accesoOrtodonciaParaPaleta({
    esDental: true, moduloActivo: true, tienePermisoModulo: true, puedeVerConfiguracion: false,
  });
  assert.deepEqual(acceso, SIN_CONFIG);
  const ids = destinosOrtodoncia(acceso).map((d) => d.id);
  assert.equal(ids.length, 5);
  assert.ok(!ids.includes("orto:configuracion"));
  assert.ok(destinosOrtodoncia(TODO).some((d) => d.id === "orto:configuracion"));
});

test("un bloque `ortodoncia` raro en la respuesta se lee como «sin acceso»", () => {
  for (const raro of [undefined, null, "si", 1, {}, { activo: "true" }, { configuracion: true }]) {
    assert.deepEqual(leerAccesoOrtodoncia(raro), SIN_ACCESO_ORTODONCIA);
  }
  assert.deepEqual(leerAccesoOrtodoncia({ activo: true }), SIN_CONFIG);
  assert.deepEqual(leerAccesoOrtodoncia({ activo: true, configuracion: true }), TODO);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Los destinos y las palabras con las que se buscan
// ═══════════════════════════════════════════════════════════════════════════
test("los seis destinos son los seis apartados del submenú del módulo", () => {
  const layout = leer("app/dashboard/orthodontics/layout.tsx");
  assert.equal(DESTINOS_ORTODONCIA.length, 6);
  for (const d of DESTINOS_ORTODONCIA) {
    assert.ok(layout.includes(`href: "${d.href}"`), `${d.href} no está en el submenú del módulo`);
    assert.match(d.label, /^Ortodoncia: /);
  }
  assert.equal(new Set(DESTINOS_ORTODONCIA.map((d) => d.id)).size, 6);
});

test("«ortodoncia» y «brackets» traen los seis apartados", () => {
  assert.equal(buscar("ortodoncia").length, 6);
  assert.equal(buscar("Ortodoncia").length, 6);
  assert.equal(buscar("brackets").length, 6);
  assert.equal(buscar("ortodoncia", SIN_CONFIG).length, 5);
});

test("«mensualidad» lleva a Cobranza y «control» a Controles", () => {
  assert.deepEqual(buscar("mensualidad"), ["orto:cobranza"]);
  assert.deepEqual(buscar("mensualidades"), ["orto:cobranza"]);
  assert.ok(buscar("control").includes("orto:controles"));
  assert.ok(buscar("registrar control").includes("orto:controles"));
  assert.ok(buscar("cobranza").includes("orto:cobranza"));
  assert.ok(buscar("alertas").includes("orto:alertas"));
});

test("las acciones de siempre no cambian y no chocan con las de ortodoncia", () => {
  const globales = buildGlobalActions().map((a) => a.id);
  const orto = buildOrthodonticsActions(TODO).map((a) => a.id);
  assert.equal(new Set([...globales, ...orto]).size, globales.length + orto.length);
  for (const a of buildOrthodonticsActions(TODO)) {
    assert.equal(a.group, "ir-a");
    assert.equal(a.shortcut, undefined, "un destino de ortodoncia no se queda con un atajo de teclado");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · El paciente con caso
// ═══════════════════════════════════════════════════════════════════════════
test("el paciente con caso ofrece abrir su caso, en la pestaña Ortodoncia de su ficha", () => {
  assert.equal(hrefCasoOrtodoncia("abc-123"), "/dashboard/patients/abc-123?tab=ortodoncia");
  const fila = buildOpenOrthoCaseAction("abc-123", "Ana Pérez");
  assert.equal(fila.group, "pacientes");
  assert.equal(fila.label, "Abrir su caso de ortodoncia — Ana Pérez");
  let destino = "";
  void fila.run({ close() {}, push: (h) => { destino = h; }, activeConsultPatientId: null });
  assert.equal(destino, "/dashboard/patients/abc-123?tab=ortodoncia");
});

test("sin acceso al módulo, un paciente con caso NO ofrece abrirlo", () => {
  assert.equal(ofreceAbrirCaso({ casoOrtodoncia: true }, TODO), true);
  assert.equal(ofreceAbrirCaso({ casoOrtodoncia: true }, SIN_ACCESO_ORTODONCIA), false);
  assert.equal(ofreceAbrirCaso({}, TODO), false);
  assert.equal(ofreceAbrirCaso({ casoOrtodoncia: "true" }, TODO), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Cableado: la ruta decide con la sesión y la paleta lo usa
// ═══════════════════════════════════════════════════════════════════════════
test("la ruta resuelve el acceso con el módulo REAL, el permiso y la clínica de la sesión", () => {
  const ruta = leer("app/api/dashboard/search/route.ts");
  assert.match(ruta, /hasActiveOrthodonticsModule\(ctx\.clinicId\)/);
  assert.match(ruta, /hasPermission\(quien, "specialties\.orthodontics"\)/);
  assert.match(ruta, /hasPermission\(quien, "settings\.view"\)/);
  assert.match(ruta, /ctx\.clinicCategory === "DENTAL"/);
  // Con la búsqueda vacía también contesta el acceso (la paleta lo pide al abrirse).
  assert.match(ruta, /invoices: \[\], ortodoncia \}/);
});

test("la ruta solo busca casos si hay acceso, y acotados a la clínica de la sesión", () => {
  const ruta = leer("app/api/dashboard/search/route.ts");
  const bloque = /if \(ortodoncia\.activo && patients\.length > 0\) \{([\s\S]*?)\n  \}/.exec(ruta)?.[1] ?? "";
  assert.ok(bloque, "no encuentro la consulta de casos detrás de `ortodoncia.activo`");
  assert.match(bloque, /clinicId: ctx\.clinicId/);
  assert.match(bloque, /patientId: \{ in: patients\.map/);
  assert.match(bloque, /deletedAt: null/);
  assert.match(bloque, /\.catch\(/, "si la consulta de casos falla, tumba toda la búsqueda");
});

test("la paleta pinta los destinos de ortodoncia y la fila del caso", () => {
  const paleta = leer("components/dashboard/command-palette.tsx");
  assert.match(paleta, /buildOrthodonticsActions\(ortoAcceso\)/);
  assert.match(paleta, /ofreceAbrirCaso\(p, ortoAcceso\)/);
  assert.match(paleta, /fetch\("\/api\/dashboard\/search\?q="/, "la paleta no pregunta el acceso al abrirse");
  assert.match(paleta, /useState<AccesoOrtodonciaPaleta>\(SIN_ACCESO_ORTODONCIA\)/, "la paleta no arranca sin acceso");
});
