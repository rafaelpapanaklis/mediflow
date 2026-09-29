// ws1-t4 #81 — el bracket repuesto al firmar la hoja mueve el cupo de reposiciones incluidas.
// Correr: npm run test:orto-reposiciones
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { avisoDeReposiciones } from "../reposiciones";

const SRC = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("ningún bracket repuesto: sin aviso", () => assert.equal(avisoDeReposiciones({ repuestos: 0, incluidas: 0 }), undefined));
test("todos caben en las incluidas: se dice y no hay nada que cobrar", () => {
  const a = avisoDeReposiciones({ repuestos: 1, incluidas: 1 })!;
  assert.match(a, /dentro de las reposiciones incluidas/);
  assert.doesNotMatch(a, /hay que cobrar/);
});
test("ya no queda cupo: dice cuántos hay que cobrar", () => {
  assert.match(avisoDeReposiciones({ repuestos: 1, incluidas: 0 })!, /ya no quedan reposiciones incluidas: 1 hay que cobrarlo con «Cobrar extra»/);
  assert.match(avisoDeReposiciones({ repuestos: 3, incluidas: 1 })!, /1 dentro de las incluidas y 2 hay que cobrarlos/);
});
test("incluidas nunca exceden a los repuestos", () => {
  assert.doesNotMatch(avisoDeReposiciones({ repuestos: 1, incluidas: 5 })!, /hay que cobrar/);
});

test("firmar consume el cupo solo con brackets repuestos, una sola vez por hoja, con el consumo atómico de siempre", () => {
  const f = leer("app/actions/orthodontics/signTreatmentCard.ts");
  assert.match(f, /filter\(\(b\) => b\.reBondedDate\)\.length/);
  assert.match(f, /if \(!yaEstabaFirmada && repuestos > 0\)/);
  assert.match(f, /consumirReposicionIncluida\(plan\.id, plan\.clinicId\)/);
  assert.match(f, /let yaEstabaFirmada = false;/);
  const caso = leer("lib/orthodontics/cobro/caso-db.ts");
  assert.match(caso, /"includedReplacementsUsed" < "includedReplacementsTotal"/);
});

test("los dos sitios que firman muestran el aviso", () => {
  assert.match(leer("components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx"), /res\.data\.avisoReposiciones/);
  assert.match(leer("components/specialties/orthodontics/agenda/BotonHojaControl.tsx"), /avisoReposiciones/);
});

// Revisión (revisor, ws1-t10): la firma se reclama con un UPDATE condicional y un error no es «sin cupo».
test("dos firmas a la vez no gastan el cupo dos veces (reclamo atómico) y un error de conteo no manda a cobrar", () => {
  const f = leer("app/actions/orthodontics/signTreatmentCard.ts");
  assert.match(f, /updateMany\(\{\s*where: \{ id: existing\.id, treatmentPlanId: plan\.id, status: \{ not: "SIGNED" \} \}/);
  assert.match(f, /yaEstabaFirmada = reclamo\.count === 0/);
  assert.match(f, /if \(!r\.ok\) \{ sinContar = true; break; \}/);
});
