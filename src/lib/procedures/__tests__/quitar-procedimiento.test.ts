/**
 * «Quitar» un procedimiento — ws1-t8.
 * Run: npx tsx --test src/lib/procedures/__tests__/quitar-procedimiento.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  mensajeDeQuitar,
  quitarProcedimiento,
  separarActivosYQuitados,
  type FilaAQuitar,
  type QuitarDeps,
} from "../quitar-procedimiento";
import { CODIGO_CONTROL_ORTO, ORTHO_CATALOG_CATEGORY } from "@/lib/orthodontics/catalog-procedures-constantes";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";

const fila = (p: Partial<FilaAQuitar> = {}): FilaAQuitar => ({
  id: "p1", name: "Retenedor", code: null, category: ORTHO_CATALOG_CATEGORY, isActive: true, ...p,
});

function armar(f: FilaAQuitar | null, usos: number | null | "falla") {
  const llamadas: string[] = [];
  const deps: QuitarDeps = {
    buscar: async (clinicId) => { llamadas.push(`buscar:${clinicId}`); return f; },
    contarUsos: async () => { if (usos === "falla") throw new Error("boom"); return usos; },
    eliminar: async () => { llamadas.push("eliminar"); },
    archivar: async () => { llamadas.push("archivar"); },
  };
  return { deps, llamadas };
}

test("sin uso: se elimina", async () => {
  const { deps, llamadas } = armar(fila(), 0);
  const r = await quitarProcedimiento(deps, { clinicId: "c1", id: "p1" });
  assert.deepEqual(r, { ok: true, accion: "eliminado", usos: 0 });
  assert.deepEqual(llamadas, ["buscar:c1", "eliminar"]);
});

test("con uso: se archiva, no se borra, y el aviso dice cuántos", async () => {
  const { deps, llamadas } = armar(fila(), 3);
  const r = await quitarProcedimiento(deps, { clinicId: "c1", id: "p1" });
  assert.deepEqual(r, { ok: true, accion: "archivado", usos: 3 });
  assert.ok(!llamadas.includes("eliminar"));
  assert.ok(llamadas.includes("archivar"));
  assert.match(mensajeDeQuitar("Retenedor", { accion: "archivado", usos: 3 }), /Ya se usó en 3 registros: lo quitamos de la lista, el historial lo conserva/);
});

test("si no se puede contar el uso, se archiva (nunca se pierde historial)", async () => {
  const { deps, llamadas } = armar(fila(), "falla");
  const r = await quitarProcedimiento(deps, { clinicId: "c1", id: "p1" });
  assert.equal(r.ok && r.accion, "archivado");
  assert.ok(!llamadas.includes("eliminar"));
});

test("el control no se quita (por llave ni por nombre)", async () => {
  for (const f of [fila({ code: CODIGO_CONTROL_ORTO, name: "Otro nombre" }), fila({ name: TIPO_CITA_CONTROL_ORTO })]) {
    const { deps, llamadas } = armar(f, 0);
    const r = await quitarProcedimiento(deps, { clinicId: "c1", id: "p1" });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.status, 400);
    assert.ok(!llamadas.includes("eliminar") && !llamadas.includes("archivar"));
  }
});

test("de otra clínica o inexistente: 404; sin clinicId ni se consulta", async () => {
  const a = armar(null, 0);
  const r = await quitarProcedimiento(a.deps, { clinicId: "c1", id: "x" });
  assert.equal(r.ok === false && r.status, 404);
  const b = armar(fila(), 0);
  const r2 = await quitarProcedimiento(b.deps, { clinicId: "", id: "p1" });
  assert.equal(r2.ok === false && r2.status, 404);
  assert.deepEqual(b.llamadas, []);
});

test("los inactivos quedan fuera de la lista de activos", () => {
  const { activos, quitados } = separarActivosYQuitados([
    { id: "a", isActive: true }, { id: "b", isActive: false }, { id: "c", isActive: true },
  ]);
  assert.deepEqual(activos.map((x) => x.id), ["a", "c"]);
  assert.deepEqual(quitados.map((x) => x.id), ["b"]);
});

test("reactivar: el PATCH de siempre con isActive:true (la fila vuelve a los activos)", () => {
  const { activos } = separarActivosYQuitados([{ id: "b", isActive: true }]);
  assert.equal(activos.length, 1);
  const src = readFileSync(join(process.cwd(), "src/components/specialties/orthodontics/configuracion/OrthoConfiguracionClient.tsx"), "utf8");
  assert.match(src, /Volver a activar/);
  assert.match(src, /isActive: true/);
  assert.match(src, /Ver quitados \(\$\{quitados\.length\}\)/);
  assert.doesNotMatch(src, /Inactivo — no aparece al facturar/);
});

test("el DELETE ya no hace deleteMany directo: pasa por la regla", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/procedures/[id]/route.ts"), "utf8");
  const delete_ = src.slice(src.indexOf("export async function DELETE"));
  assert.match(delete_, /quitarProcedimiento\(/);
  assert.doesNotMatch(delete_, /deleteMany/);
});
