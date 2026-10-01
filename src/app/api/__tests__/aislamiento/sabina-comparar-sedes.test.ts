/**
 * LA EXCEPCIÓN DE LAS SEDES, vista con el detector — ws1-t10.
 *
 * Run: npm run test:aislamiento-sedes
 *
 * Rafael: los reportes de comparación ENTRE SEDES del mismo dueño sí pueden ver
 * varias clínicas; nada más. Hoy ese reporte es `comparar_sedes` de Sabina
 * (src/lib/sabina/tools/comparar-sedes.ts). Aquí corre sobre la base falsa del
 * barrido (A = sede activa, C = sede hermana del MISMO dueño, B = ajena) y se
 * comprueba, con el mismo detector de fugas:
 *
 *   1 · con C del mismo dueño → compara A y C, y B no se toca ni se nombra
 *   2 · con C de OTRO dueño   → solo A: ni se lee ni se nombra
 *   3 · cualquier OTRA herramienta de Sabina (una sola clínica) con C hermana
 *       → no toca C: la excepción es solo de ese reporte
 *
 * (La batería larga de `comparar_sedes` —permisos por sede, plan vencido, tope
 * de sedes, el modelo que inventa un sede— vive en `npm run test:sabina-sedes`.)
 */
import "@/lib/sabina/tools/__tests__/preparar";
import { test } from "node:test";
import assert from "node:assert/strict";
import { BaseFalsa, ID, MARCA } from "./base-falsa";
import { correrHerramienta } from "@/lib/sabina/tools/base";
import { compararSedes } from "@/lib/sabina/tools/comparar-sedes";
import { ingresosPorPeriodo } from "@/lib/sabina/tools/ingresos-por-periodo";
import { pacientesNuevos } from "@/lib/sabina/tools/pacientes-nuevos";
import { pacientesConDeuda } from "@/lib/sabina/tools/pacientes-con-deuda";
import { agendaOcupacion } from "@/lib/sabina/tools/agenda-ocupacion";
import { ausencias } from "@/lib/sabina/tools/ausencias";
import type { SabinaCtx } from "@/lib/sabina/tipos";

function ctxDe(base: BaseFalsa): SabinaCtx {
  return {
    clinicId: ID.A,
    userId: ID.A, // la fila User de A (id «idA»)
    role: "SUPER_ADMIN",
    permissionsOverride: [],
    timezone: "America/Mexico_City",
    clinicCategory: "DENTAL",
    clinicaNombre: "Sede A",
    db: base.cliente(),
  };
}

const texto = (x: unknown) => JSON.stringify(x);

test("comparar_sedes con una sede hermana (mismo dueño): lee A y C, nunca B", async () => {
  const base = new BaseFalsa({ permitidos: ["C"], duenoDeC: "mismo" });
  const r: any = await correrHerramienta(compararSedes, ctxDe(base), {});
  assert.equal(r.ok, true, texto(r));
  assert.equal(base.fugas.length, 0, `tocó filas que no debía: ${texto(base.fugas.slice(0, 4))}`);
  assert.ok(base.consultas > 0, "el reporte no llegó a la base");
  const salida = texto(r);
  assert.ok(salida.includes(MARCA.A), "no trae la sede activa");
  assert.ok(salida.includes(MARCA.C), "no trae la sede hermana");
  assert.equal(salida.includes(MARCA.B), false, "nombra o trae datos de una clínica AJENA");
  assert.equal(r.datos.sedes.length, 2);
});

test("control: el detector SÍ ve el reporte entrar a la sede hermana cuando no se le deja", async () => {
  const base = new BaseFalsa({ permitidos: [], duenoDeC: "mismo" });
  await correrHerramienta(compararSedes, ctxDe(base), {});
  assert.ok(base.fugas.some((f) => f.dueno === "C"), "sin permiso para C, leer C tendría que marcarse");
});

test("comparar_sedes con C de OTRO dueño: solo la sede activa — C ni se lee ni se nombra", async () => {
  const base = new BaseFalsa({ permitidos: [], duenoDeC: "otro" });
  const r: any = await correrHerramienta(compararSedes, ctxDe(base), {});
  assert.equal(r.ok, true, texto(r));
  assert.equal(base.fugas.length, 0, `leyó una clínica de otro dueño: ${texto(base.fugas.slice(0, 4))}`);
  const salida = texto(r);
  assert.equal(salida.includes(MARCA.C), false, "trae datos de una clínica que NO es del mismo dueño");
  assert.equal(salida.includes(MARCA.B), false);
  assert.equal(r.datos.sedes.length, 1);
});

test("las herramientas de UNA clínica no se llevan la sede hermana: la excepción es solo del reporte de sedes", async () => {
  for (const [nombre, herramienta, params] of [
    ["ingresos_por_periodo", ingresosPorPeriodo, {}],
    ["pacientes_nuevos", pacientesNuevos, {}],
    ["pacientes_con_deuda", pacientesConDeuda, {}],
    ["agenda_ocupacion", agendaOcupacion, {}],
    ["ausencias", ausencias, {}],
  ] as const) {
    // C es del MISMO dueño y aun así está prohibida para estas herramientas.
    const base = new BaseFalsa({ permitidos: [], duenoDeC: "mismo" });
    const r: any = await correrHerramienta(herramienta as any, ctxDe(base), params);
    assert.ok(base.consultas > 0 || r.ok === false, `${nombre}: ni siquiera consultó (¿cambió la firma?): ${texto(r).slice(0, 200)}`);
    assert.equal(base.fugas.length, 0, `${nombre} tocó otra clínica: ${texto(base.fugas.slice(0, 4))}`);
    assert.equal(texto(r).includes(MARCA.C) || texto(r).includes(MARCA.B), false, `${nombre} devolvió datos de otra clínica`);
  }
});
