/**
 * La guarda de los PDF del caso que se piden por dirección (ws1-t12, revisión final, #13).
 *
 * Run: npm run test:orto-guarda-pdf
 *
 * El PDF del plan respondía 400 «Sin permisos: medicalRecord.view» a recepción y a un doctor «solo dental»; el
 * expediente ya respondía 403 con un mensaje claro. Aquí se fija que los tres PDF que pasaban por la acción (plan,
 * antes/después, carta de avance) contestan lo mismo que el expediente.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let ctxActual: Record<string, unknown> | null = null;
let moduloActivo = true;

const ctxBase = { userId: "u1", clinicId: "c1", clinicCategory: "DENTAL", permissionsOverride: [] as string[] };

(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => ctxActual } });
(mock as any).module("@/lib/orthodontics/access", { namedExports: { hasActiveOrthodonticsModule: async () => moduloActivo } });

async function correr(ctx: Record<string, unknown> | null, activo = true) {
  ctxActual = ctx;
  moduloActivo = activo;
  const { guardaDelPdfDelCaso } = await import("../guarda-del-caso");
  const r = await guardaDelPdfDelCaso();
  return r ? { status: r.status, cuerpo: await r.json() } : null;
}

test("sin sesión: 401", async () => {
  const r = await correr(null);
  assert.equal(r?.status, 401);
});

test("recepción no ve lo clínico: 403 con el mismo mensaje que el expediente (no 400)", async () => {
  const r = await correr({ ...ctxBase, role: "RECEPTIONIST" });
  assert.equal(r?.status, 403);
  assert.ok(String(r?.cuerpo.error).length > 10);
});

test("un doctor sin la casilla de Ortodoncia: 403 con el aviso del módulo", async () => {
  const { MENSAJE_SIN_ACCESO_ORTODONCIA } = await import("../../acceso-doctor");
  const r = await correr({ ...ctxBase, role: "DOCTOR", permissionsOverride: ["medicalRecord.view"] });
  // El override reemplaza al rol: sin `specialties.orthodontics` no entra.
  assert.equal(r?.status, 403);
  assert.equal(r?.cuerpo.error, MENSAJE_SIN_ACCESO_ORTODONCIA);
});

test("con el módulo apagado: 403", async () => {
  const r = await correr({ ...ctxBase, role: "DOCTOR" }, false);
  assert.equal(r?.status, 403);
});

test("un doctor con acceso pasa (null: sigue a la acción)", async () => {
  const r = await correr({ ...ctxBase, role: "DOCTOR" });
  assert.equal(r, null);
});

test("lo que no existe es 404, lo demás 400", async () => {
  const { estadoDeFalloDelPdf } = await import("../guarda-del-caso");
  assert.equal(estadoDeFalloDelPdf("Plan no encontrado"), 404);
  assert.equal(estadoDeFalloDelPdf("Paciente no encontrado"), 404);
  assert.equal(estadoDeFalloDelPdf("Datos inválidos"), 400);
});

test("los tres PDF del caso que pasaban por la acción llaman a la guarda antes de cargar nada", () => {
  for (const ruta of ["treatment-plan-pdf", "comparison-pdf", "referral-progress-pdf"]) {
    const fuente = readFileSync(join(process.cwd(), "src/app/api/orthodontics/treatment-plans/[id]", ruta, "route.tsx"), "utf8");
    assert.match(fuente, /const sinPermiso = await guardaDelPdfDelCaso\(\);\s*\n\s*if \(sinPermiso\) return sinPermiso;/, ruta);
    assert.ok(fuente.indexOf("guardaDelPdfDelCaso()") < fuente.indexOf("await export"), `${ruta}: la guarda va antes de la acción`);
  }
});
