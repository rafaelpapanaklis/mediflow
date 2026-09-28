/**
 * Presupuestos de ortodoncia → caso de ortodoncia — ws1-t5.
 *
 * Run: npx tsx --test src/lib/quotes/__tests__/ortodoncia.test.ts
 *
 * Revisión de lógica de uso (fila 14 del mapa): aceptar un presupuesto de
 * brackets creaba un plan GENERAL, no un caso de ortodoncia.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AVISO_SIN_PERMISO_DE_ORTODONCIA,
  casoDesdePresupuesto,
  esPresupuestoDeOrtodoncia,
} from "../ortodoncia";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

// ═══ ¿Es de ortodoncia? ═════════════════════════════════════════════════
test("lo es si algún concepto nombra el tratamiento, con o sin acentos", () => {
  for (const name of [
    "Ortodoncia con brackets metálicos", "ORTODONCIA", "Tratamiento de alineadores", "Invisalign completo",
    "Brackets estéticos", "Tratamiento ortodóntico", "Ortodoncia (brackets autoligado)",
  ]) {
    assert.equal(esPresupuestoDeOrtodoncia({ title: "Presupuesto", items: [{ name }] }), true, name);
  }
  // Con otros conceptos dentales alrededor, sigue siéndolo.
  assert.equal(
    esPresupuestoDeOrtodoncia({ title: "Presupuesto", items: [{ name: "Limpieza" }, { name: "Ortodoncia con brackets" }] }),
    true,
  );
});

test("el título decide solo cuando ningún concepto habla de ortodoncia", () => {
  assert.equal(
    esPresupuestoDeOrtodoncia({ title: "Ortodoncia completa", items: [{ name: "Fase 1" }, { name: "Fase 2" }] }),
    true,
  );
  assert.equal(
    esPresupuestoDeOrtodoncia({ title: "Ortodoncia", items: [{ name: "Valoración de ortodoncia" }] }),
    false,
  );
});

test("un extra suelto no abre un caso: valoración, control, retenedor, reposición…", () => {
  for (const name of [
    "Valoración de ortodoncia", "Control de ortodoncia", "Reposición de bracket", "Retenedor superior",
    "Estudio de registros de ortodoncia", "Urgencia de ortodoncia fuera de control",
    "Retiro de aparatología", "Alineadores de refinamiento", "Microimplante (TAD)",
  ]) {
    assert.equal(esPresupuestoDeOrtodoncia({ title: "Presupuesto", items: [{ name }] }), false, name);
  }
});

test("un presupuesto dental no lo es, aunque alguna palabra se parezca", () => {
  for (const name of ["Limpieza", "Resina", "Endodoncia", "Corona", "Ortopantomografía", "Control", "Extracción"]) {
    assert.equal(esPresupuestoDeOrtodoncia({ title: "Presupuesto", items: [{ name }] }), false, name);
  }
  assert.equal(esPresupuestoDeOrtodoncia({ title: null, items: [] }), false);
});

// ═══ Qué ofrece ═════════════════════════════════════════════════════════
const base = {
  quoteId: "q1",
  patientId: "p1",
  status: "ACCEPTED",
  treatmentPlanId: null,
  esDeOrtodoncia: true,
  moduloActivo: true,
  tienePermiso: true,
  casosDelPaciente: [] as string[],
};

test("paciente sin caso: «Abrir caso de ortodoncia», con el alta abierta y el presupuesto en la dirección", () => {
  assert.deepEqual(casoDesdePresupuesto(base), {
    accion: "abrir-caso",
    etiqueta: "Abrir caso de ortodoncia",
    href: "/dashboard/patients/p1?tab=ortodoncia&abrirCaso=1&presupuesto=q1",
  });
});

test("un caso terminado o abandonado no impide abrir otro", () => {
  for (const estado of ["COMPLETED", "DROPPED_OUT"]) {
    assert.equal(casoDesdePresupuesto({ ...base, casosDelPaciente: [estado] })?.accion, "abrir-caso");
  }
});

test("paciente con un caso en curso: «Ver su caso de ortodoncia», sin abrir el alta", () => {
  for (const estado of ["PLANNED", "IN_PROGRESS", "ON_HOLD", "RETENTION"]) {
    assert.deepEqual(casoDesdePresupuesto({ ...base, casosDelPaciente: ["COMPLETED", estado] }), {
      accion: "ver-caso",
      etiqueta: "Ver su caso de ortodoncia",
      href: "/dashboard/patients/p1?tab=ortodoncia",
    });
  }
});

test("sin módulo, o si el presupuesto no es de ortodoncia, el botón de siempre", () => {
  assert.equal(casoDesdePresupuesto({ ...base, moduloActivo: false }), null);
  assert.equal(casoDesdePresupuesto({ ...base, esDeOrtodoncia: false }), null);
});

test("solo el presupuesto ACEPTADO, y solo si no generó ya un plan", () => {
  for (const status of ["DRAFT", "PRESENTED", "REJECTED", "EXPIRED"]) {
    assert.equal(casoDesdePresupuesto({ ...base, status }), null, status);
  }
  assert.equal(casoDesdePresupuesto({ ...base, treatmentPlanId: "plan-viejo" }), null);
});

test("quien no tiene el permiso del módulo no crea el plan general: se le dice quién abre el caso", () => {
  const caso = casoDesdePresupuesto({ ...base, tienePermiso: false });
  assert.equal(caso?.accion, "sin-permiso");
  assert.equal(caso?.href, null);
  assert.equal(caso?.aviso, AVISO_SIN_PERMISO_DE_ORTODONCIA);
});

// ═══ Cableado ═══════════════════════════════════════════════════════════
test("la lectura va acotada a la clínica y usa el módulo REAL", () => {
  const lib = leer("lib/quotes/ortodoncia.server.ts");
  assert.match(lib, /hasActiveOrthodonticsModule\(quien\.clinicId\)/);
  assert.match(lib, /quien\.clinicCategory !== "DENTAL"/);
  assert.match(lib, /"specialties\.orthodontics"/);
  const consultas = lib.match(/prisma\.\w+\.findMany\(\{[\s\S]*?\}\)/g) ?? [];
  assert.equal(consultas.length, 1);
  for (const c of consultas) assert.match(c, /clinicId: quien\.clinicId/);
  assert.ok(!/\.(create|update|upsert|delete)\w*\(/.test(lib), "la lectura escribe en la base");
});

test("la ruta de «Crear plan» ofrece el caso ANTES de crear el plan general", () => {
  const ruta = leer("app/api/quotes/[id]/treatment-plan/route.ts");
  const ofrece = ruta.indexOf("casosDesdePresupuestos(ctx, [quote])");
  const crea = ruta.indexOf("prisma.treatmentPlan.create");
  assert.ok(ofrece > 0 && crea > 0 && ofrece < crea);
  assert.match(ruta, /status: 409/);
  // La lista manda el dato y las dos pantallas lo usan.
  assert.match(leer("app/api/quotes/route.ts"), /casosDesdePresupuestos\(ctx, quotes\)/);
  for (const pantalla of ["components/dashboard/presupuesto-nuevo/lista.tsx", "components/quotes/quotes-tab.tsx"]) {
    const texto = leer(pantalla);
    assert.match(texto, /quote\.casoOrtodoncia\?\.etiqueta \?\? t\("quotes\.card\.createPlan"\)/, pantalla);
    assert.match(texto, /if \(quote\.casoOrtodoncia\?\.href\)/, pantalla);
  }
});
