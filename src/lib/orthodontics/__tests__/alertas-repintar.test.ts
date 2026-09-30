/**
 * Alertas se repinta sin recargar tras «Deshacer» / «Posponer» (ws1-t12, revisión final, punto 10).
 *
 * Run: npm run test:orto-alertas-repintar
 *
 * «Deshacer» quitaba la fila de «pospuestas» pero el caso no volvía a su sección hasta recargar (la pantalla
 * dependía de `router.refresh()`). Ahora `VistaAlertas` guarda las alertas en su estado y, tras posponer o
 * deshacer, las pide de nuevo con `cargarAlertasDeOrtodoncia` (la MISMA lectura que la página) y se repinta.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const llamadas: Array<{ clinicId: string; zona: string; viewer: Record<string, unknown> }> = [];
let auth: { ok: true; data: { ctx: Record<string, unknown> } } | { ok: false; error: string } = {
  ok: true,
  data: { ctx: { clinicId: "cli_1", userId: "usr_1", role: "ADMIN" } },
};
let cargaFalla = false;
const ALERTAS = { missingNextControl: [{ patientId: "p1" }], pospuestas: 0 };

mock.module("@/lib/prisma", { namedExports: { prisma: { clinic: { findUnique: async () => ({ timezone: "America/Cancun" }) } } } });
mock.module("@/lib/orthodontics/alerts-data", {
  namedExports: {
    loadOrthoAlerts: async (clinicId: string, zona: string, viewer: Record<string, unknown>) => {
      llamadas.push({ clinicId, zona, viewer });
      if (cargaFalla) throw new Error("base caída");
      return ALERTAS;
    },
  },
});
mock.module("../../../app/actions/orthodontics/_helpers", { namedExports: { getOrthoActionContext: async () => auth } });

const cargar = async () => (await import("../../../app/actions/orthodontics/modulo/cargarAlertas")).cargarAlertasDeOrtodoncia();

test("la acción lee las alertas con la clínica y el usuario de la SESIÓN (no del cliente)", async () => {
  llamadas.length = 0;
  const r = await cargar();
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.data, ALERTAS);
  assert.deepEqual(llamadas[0], { clinicId: "cli_1", zona: "America/Cancun", viewer: { userId: "usr_1", role: "ADMIN", clinicId: "cli_1" } });
});

test("sin permiso o sin módulo no lee nada; sin clínica en la sesión tampoco (clinicId: undefined no filtra)", async () => {
  llamadas.length = 0;
  auth = { ok: false, error: "Sin permisos: medicalRecord.view" };
  assert.equal((await cargar()).ok, false);
  auth = { ok: true, data: { ctx: { clinicId: "", userId: "usr_1", role: "ADMIN" } } };
  assert.equal((await cargar()).ok, false);
  assert.equal(llamadas.length, 0);
  auth = { ok: true, data: { ctx: { clinicId: "cli_1", userId: "usr_1", role: "ADMIN" } } };
});

test("si la base falla, responde error (la vista cae a router.refresh) y no lanza", async () => {
  cargaFalla = true;
  const original = console.error;
  console.error = () => undefined;
  try {
    const r = await cargar();
    assert.equal(r.ok, false);
  } finally {
    console.error = original;
    cargaFalla = false;
  }
});

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const M = "src/components/specialties/orthodontics/modulo/";

test("la vista guarda las alertas en su estado y da a sus botones la función que las pide de nuevo", () => {
  const v = sinComentarios(leer(M + "vista-alertas.tsx"));
  assert.match(v, /^"use client";/m);
  assert.match(v, /const \[alerts, setAlerts\] = useState<OrthoAlertsData>\(alertsDelServidor\)/);
  assert.match(v, /const r = await cargarAlertasDeOrtodoncia\(\);\s*if \(isFailure\(r\)\) router\.refresh\(\);\s*else setAlerts\(r\.data\);/);
  assert.match(v, /<RefrescarAlertasContext\.Provider value=\{refrescar\}>/);
  // No se vuelve a pisar el estado con lo que traiga un refresh viejo.
  assert.doesNotMatch(v, /useEffect/);
});

test("«Posponer» y «Deshacer» repintan con esa función, no con router.refresh()", () => {
  for (const f of ["posponer-alerta.tsx", "lista-de-pospuestas.tsx"]) {
    const c = sinComentarios(leer(M + f));
    assert.match(c, /useRefrescarAlertas\(\)/, f);
    assert.match(c, /await refrescar\(\)/, f);
    assert.doesNotMatch(c, /router\.refresh\(\)/, f);
  }
});

test("la acción de leer es «use server», solo exporta funciones async y no recibe nada del cliente", () => {
  const a = leer("src/app/actions/orthodontics/modulo/cargarAlertas.ts");
  assert.match(a, /^"use server";/);
  const exportados: string[] = sinComentarios(a).match(/^export .*/gm) ?? [];
  assert.ok(exportados.every((l) => l.startsWith("export async function")), exportados.join("\n"));
  assert.match(a, /cargarAlertasDeOrtodoncia\(\): Promise/);
});
