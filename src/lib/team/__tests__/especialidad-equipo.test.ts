/**
 * Equipo: la especialidad guardada nunca sale como «Sin especialidad» ni se pierde (ws1-t1, 3-oct-2026).
 *
 * Run: npm run test:equipo-especialidad
 *
 * El registro guarda la categoría como especialidad del dueño («dental»); la importación y «Mi perfil», texto
 * libre. El selector solo conocía su lista y pintaba «Sin especialidad». Con el código viejo `formDeMiembro`
 * dejaba «dental» tal cual (fuera de la lista) y el selector no tenía opción para lo desconocido.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formDeMiembro, parcheDeCambios } from "@/lib/team/parche-miembro";
import {
  ESPECIALIDADES_EQUIPO,
  especialidadParaElSelector,
  esDeLaLista,
  opcionFueraDeLista,
} from "@/lib/team/especialidad-equipo";

test("los valores viejos se leen como su opción de la lista", () => {
  const casos: Array<[string, string]> = [
    // Los valores reales de la base el 3-oct-2026 (además de los de la lista): dental ×3, odontologia-general ×7,
    // ortodoncia ×4, Odontología ×1.
    ["dental", "Odontología General"],
    ["odontologia-general", "Odontología General"],
    ["ortodoncia", "Ortodoncia"],
    ["Odontología", "Odontología General"],
    ["DENTAL", "Odontología General"],
    ["Dentista", "Odontología General"],
    ["odontologia general", "Odontología General"],
    ["Odontología General", "Odontología General"],
    ["orthodontics", "Ortodoncia"],
    ["Ortodoncista", "Ortodoncia"],
    ["endodoncia", "Endodoncia"],
    ["pediatric_dentistry", "Odontopediatría"],
    ["implantologia", "Implantología"],
    ["oral-surgery", "Cirugía Maxilofacial"],
    ["estética", "Estética Dental"],
    ["other", "Otra"],
  ];
  for (const [guardada, esperada] of casos) {
    assert.equal(especialidadParaElSelector(guardada), esperada, guardada);
    assert.ok(esDeLaLista(especialidadParaElSelector(guardada)));
  }
});

test("lo que no se reconoce se respeta tal cual y el selector lo ofrece como opción", () => {
  assert.equal(especialidadParaElSelector("  Rehabilitación con zirconia "), "Rehabilitación con zirconia");
  assert.equal(opcionFueraDeLista("Rehabilitación con zirconia"), "Rehabilitación con zirconia");
  assert.equal(opcionFueraDeLista("Ortodoncia"), null);
  assert.equal(opcionFueraDeLista(""), null);
  assert.equal(especialidadParaElSelector(null), "");
  assert.equal(especialidadParaElSelector(undefined), "");
});

test("Editar arranca con la opción de la lista y, si nadie la toca, el guardado NO manda la especialidad", () => {
  const m = { firstName: "Daisy", lastName: "Prueba", email: "d@example.com", role: "SUPER_ADMIN", specialty: "dental" };
  const inicial = formDeMiembro(m);
  assert.equal(inicial.specialty, "Odontología General");
  // Cambia solo el teléfono: la especialidad no viaja (la base sigue con «dental», nada se pisa).
  assert.deepEqual(parcheDeCambios(inicial, { ...inicial, phone: "5550001111" }), { phone: "5550001111" });
  // Elige otra: viaja la nueva.
  assert.deepEqual(parcheDeCambios(inicial, { ...inicial, specialty: "Ortodoncia" }), { specialty: "Ortodoncia" });
  // Desconocida: se conserva tal cual y tampoco viaja si nadie la toca.
  const raro = formDeMiembro({ ...m, specialty: "Rehabilitación oral avanzada" });
  assert.equal(raro.specialty, "Rehabilitación oral avanzada");
  assert.deepEqual(parcheDeCambios(raro, { ...raro, phone: "1" }), { phone: "1" });
});

test("el selector de Equipo usa los mismos ids y pinta la opción fuera de lista", () => {
  const src = readFileSync(join(process.cwd(), "src/app/dashboard/team/team-client.tsx"), "utf8");
  const ids = [...src.matchAll(/\{ id: "([^"]+)",\s+nameKey: "settings\.team\.spec/g)].map((x) => x[1]);
  assert.deepEqual(ids, [...ESPECIALIDADES_EQUIPO]);
  assert.match(src, /opcionFueraDeLista\(form\.specialty\) && <option value=\{form\.specialty\}>/);
  assert.match(src, /nombreDeEspecialidad\(m\.specialty\)/);
});
