/**
 * El menú del portal del paciente enseña «Ortodoncia» SOLO a quien tiene un
 * caso abierto en una clínica con el módulo activo (ws1-t11).
 *
 * Run: npm run test:portal-menu-ortodoncia
 *
 * Dos mitades, las dos con el código real:
 *   · la DECISIÓN (`decidirOrtodonciaEnPortal`), con la base sustituida por
 *     dos funciones que cuentan cuántas veces se las llama;
 *   · el MENÚ (`PacientePortalShell`), pintado a HTML.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  decidirOrtodonciaEnPortal,
  ESTADOS_CASO_ABIERTO,
  type DepsOrtodonciaEnPortal,
  type VinculoPortal,
} from "../../../lib/patient-portal/ortodoncia-menu";
import { PacientePortalShell } from "../portal-shell";

const NORTE = "clinica-norte";
const SUR = "clinica-sur";

function doble(opts: { casosEn: string[]; moduloEn: string[] }) {
  const llamadas = { casos: 0, modulo: [] as string[], vinculosVistos: [] as VinculoPortal[] };
  const deps: DepsOrtodonciaEnPortal = {
    clinicasConCasoAbierto: async (vinculos) => {
      llamadas.casos += 1;
      llamadas.vinculosVistos = vinculos;
      return opts.casosEn;
    },
    moduloActivo: async (clinicId) => {
      llamadas.modulo.push(clinicId);
      return opts.moduloEn.includes(clinicId);
    },
  };
  return { deps, llamadas };
}

// ── La decisión ─────────────────────────────────────────────────────────────

test("caso abierto + módulo activo → se enseña", async () => {
  const { deps } = doble({ casosEn: [NORTE], moduloEn: [NORTE] });
  assert.equal(await decidirOrtodonciaEnPortal([{ patientId: "p1", clinicId: NORTE }], deps), true);
});

test("caso abierto pero módulo apagado → NO se enseña", async () => {
  const { deps, llamadas } = doble({ casosEn: [NORTE], moduloEn: [] });
  assert.equal(await decidirOrtodonciaEnPortal([{ patientId: "p1", clinicId: NORTE }], deps), false);
  assert.deepEqual(llamadas.modulo, [NORTE]);
});

test("módulo activo pero sin caso abierto → NO se enseña, y ni pregunta por el módulo", async () => {
  const { deps, llamadas } = doble({ casosEn: [], moduloEn: [NORTE] });
  assert.equal(await decidirOrtodonciaEnPortal([{ patientId: "p1", clinicId: NORTE }], deps), false);
  assert.equal(llamadas.casos, 1);
  assert.deepEqual(llamadas.modulo, []);
});

test("paciente sin expediente vinculado → NO se enseña y no toca la base", async () => {
  const { deps, llamadas } = doble({ casosEn: [NORTE], moduloEn: [NORTE] });
  assert.equal(await decidirOrtodonciaEnPortal([], deps), false);
  assert.equal(llamadas.casos, 0);
  assert.deepEqual(llamadas.modulo, []);
});

test("un vínculo sin clinicId o sin patientId no llega a la consulta", async () => {
  const { deps, llamadas } = doble({ casosEn: [], moduloEn: [] });
  await decidirOrtodonciaEnPortal(
    [
      { patientId: "p1", clinicId: "" },
      { patientId: "", clinicId: NORTE },
      { patientId: "p2", clinicId: SUR },
    ],
    deps,
  );
  assert.deepEqual(llamadas.vinculosVistos, [{ patientId: "p2", clinicId: SUR }]);
});

test("dos clínicas: el caso está en la que NO tiene módulo → NO se enseña", async () => {
  const { deps } = doble({ casosEn: [SUR], moduloEn: [NORTE] });
  const vinculos = [
    { patientId: "p1", clinicId: NORTE },
    { patientId: "p2", clinicId: SUR },
  ];
  assert.equal(await decidirOrtodonciaEnPortal(vinculos, deps), false);
});

test("una clínica ajena a la sesión nunca cuenta, aunque la base la devuelva", async () => {
  const { deps, llamadas } = doble({ casosEn: ["clinica-ajena"], moduloEn: ["clinica-ajena"] });
  assert.equal(await decidirOrtodonciaEnPortal([{ patientId: "p1", clinicId: NORTE }], deps), false);
  assert.deepEqual(llamadas.modulo, []);
});

test("la misma clínica repetida pregunta por el módulo una sola vez", async () => {
  const { deps, llamadas } = doble({ casosEn: [NORTE, NORTE], moduloEn: [] });
  await decidirOrtodonciaEnPortal([{ patientId: "p1", clinicId: NORTE }], deps);
  assert.deepEqual(llamadas.modulo, [NORTE]);
});

test("caso «abierto» = lo que el Tablero cuenta como activo; terminado y abandono quedan fuera", () => {
  assert.deepEqual([...ESTADOS_CASO_ABIERTO].sort(), ["IN_PROGRESS", "ON_HOLD", "PLANNED", "RETENTION"]);
});

// ── El menú ─────────────────────────────────────────────────────────────────

const YO = { id: "cuenta-1", name: "Sofía Hernández", email: "sofia@ejemplo.mx", phone: null };

function pintar(tieneOrtodoncia?: boolean): string {
  return renderToStaticMarkup(
    <PacientePortalShell me={YO} tieneOrtodoncia={tieneOrtodoncia}>
      <p>contenido</p>
    </PacientePortalShell>,
  );
}

function enlaces(html: string, href: string): number {
  return html.split(`href="${href}"`).length - 1;
}

test("sin caso de ortodoncia el menú queda como estaba: 7 secciones y ningún enlace a ortodoncia", () => {
  for (const html of [pintar(false), pintar(undefined)]) {
    assert.equal(enlaces(html, "/paciente/ortodoncia"), 0);
    assert.ok(!html.includes("Ortodoncia"));
    assert.ok(html.includes("repeat(7, 1fr)"));
  }
});

test("con caso de ortodoncia sale en el menú lateral Y en el de abajo", () => {
  const html = pintar(true);
  assert.equal(enlaces(html, "/paciente/ortodoncia"), 2);
  assert.ok(html.includes("repeat(8, 1fr)"));
});

test("«Ortodoncia» va después de Historial y antes de Pagos, y no desplaza a nadie más", () => {
  const html = pintar(true);
  const orden = Array.from(html.matchAll(/href="(\/paciente[^"]*)"/g)).map((m) => m[1]);
  const lateral = orden.slice(0, orden.indexOf("/paciente/perfil") + 1);
  assert.deepEqual(lateral, [
    "/paciente",
    "/paciente/citas",
    "/paciente/inbox",
    "/paciente/historial",
    "/paciente/ortodoncia",
    "/paciente/pagos",
    "/paciente/documentos",
    "/paciente/perfil",
  ]);
});
