// Encargo 12: (1) una sede incluida no es «Prueba» ni «En trial»; (2) el cupo de tokens de IA es POR
// DUEÑO, el saldo IA no. Run: npx tsx --test src/lib/__tests__/ia-por-dueno-y-sede-incluida.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluarSaludClinica, resumirCartera } from "@/lib/admin/salud-clinica";
import { nivelCupo, tokensVigentes } from "@/lib/admin/uso-core";

const fuente = (r: string) => readFileSync(join(__dirname, "..", "..", "..", r), "utf8");
const ahora = new Date("2026-10-07T18:00:00Z");
const sede = {
  id: "sede1", createdAt: new Date("2026-10-07T17:00:00Z"), subscriptionStatus: "active",
  trialEndsAt: new Date("2027-10-07T16:27:00Z"), nextBillingDate: new Date("2027-10-07T16:27:00Z"),
  pacientes: 0, citasPasadas: 0, citasVentana: 0, ultimaCitaAt: null, ultimoAccesoAt: null, pagosRegistrados: 0,
} as any;

test("sede nueva sin pacientes ni pagos propios: con el código viejo «Prueba»; incluida = «Pagando» + sede incluida", () => {
  const vieja = evaluarSaludClinica(sede, ahora);
  assert.equal(vieja.estadoOperativo, "prueba");
  const s = evaluarSaludClinica({ ...sede, sedeIncluida: true }, ahora);
  assert.equal(s.esPrueba, false);
  assert.equal(s.estadoOperativo, "pagando");
  assert.equal(s.sedeIncluida, true);
  assert.equal(s.cuentaParaTotales, false); // no es un cliente aparte
});

test("totales: la sede incluida no es cliente real, ni prueba, ni infla «pagando»", () => {
  const madre = evaluarSaludClinica({ ...sede, id: "madre", pacientes: 40, citasPasadas: 100, pagosRegistrados: 1 }, ahora);
  const sedes = [1, 2, 3, 4, 5].map((i) => evaluarSaludClinica({ ...sede, id: `s${i}`, sedeIncluida: true }, ahora));
  const r = resumirCartera([madre, ...sedes]);
  assert.equal(r.reales, 1);
  assert.equal(r.pruebas, 0);
  assert.equal(r.sedesIncluidas, 5);
  assert.equal(r.porEstado.pagando, 1);
  assert.equal(r.total, 6);
});

test("tokens: 3 sedes de 400k suman 1.2M contra 1M del plan = lleno; una sola de 400k no; contador de mes anterior vale 0", () => {
  const sumar = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  assert.equal(nivelCupo(sumar([400_000, 400_000, 400_000]), 1_000_000), "lleno");
  assert.equal(nivelCupo(400_000, 1_000_000), "ok");
  assert.equal(tokensVigentes(300_000, new Date("2026-08-15T00:00:00Z"), ahora), 0);
});

test("los chequeos de IA, la tarjeta de uso y /admin suman las sedes; el saldo IA sigue por clínica", () => {
  for (const f of ["src/app/api/ai/route.ts", "src/app/api/consult/ai-assist/route.ts", "src/app/api/prescriptions/check-contraindications/route.ts", "src/app/api/xrays/[id]/analyze/route.ts", "src/lib/ai-tokens.ts"]) {
    assert.match(fuente(f), /tokensDeLasOtrasSedes\(/, f);
  }
  const u = fuente("src/app/api/ai/usage/route.ts");
  assert.match(u, /clinicId: \{ in: sedesIds \}/);
  assert.match(u, /sedes: otras\.sedes/);
  const a = fuente("src/lib/admin/uso-clinica.ts");
  assert.match(a, /tokensSedes/);
  // el monedero (saldo IA) sigue leyéndose por la propia clínica
  assert.match(a, /prisma\.aiWallet\.findMany\(\{ where: en,/);
  assert.doesNotMatch(fuente("src/lib/ai-tokens-owner.ts"), /aiWallet/);
  for (const f of ["es", "en"]) assert.ok(JSON.parse(fuente(`src/i18n/dictionaries/${f}.json`)).settings.client.aiTokensUsedThisMonthAllBranches);
});

test("/admin pasa la bandera de sede incluida a las cuatro cuentas de salud", () => {
  assert.match(fuente("src/app/admin/clientes/cartera.ts"), /sedeIncluida: !!c\.sedeIncluida/);
  assert.match(fuente("src/components/admin/portada/atencion-core.ts"), /sedeIncluida: !!f\.sedeIncluida/);
  assert.match(fuente("src/app/admin/clinics/clinics-client.tsx"), /sedeIncluida: c\.sedeIncluida/);
  assert.match(fuente("src/app/admin/clinics/[id]/clinic-detail-client.tsx"), /id: clinic\.id,\s*sedeIncluida,/);
});

import { findBranchMothers, findIncludedBranchIds } from "@/lib/admin/mrr-core";
import { etiquetaSedeIncluida } from "@/lib/admin/salud-clinica";

test("la sede incluida lleva SU etiqueta «Sede incluida · paga <principal>» y la principal sigue «Pagando»", () => {
  assert.equal(etiquetaSedeIncluida("Centro Dental Salamanca"), "Sede incluida · paga Centro Dental Salamanca");
  assert.equal(etiquetaSedeIncluida(null), "Sede incluida");
  const f = (id: string, extra: object = {}) => ({ id, createdAt: new Date("2026-10-0" + (id === "M" ? 1 : 7)), subscriptionStatus: "active", monthlyPrice: null, ...extra });
  const clinicas = [f("M", { stripeSubscriptionId: "sub_1", nextBillingDate: new Date("2027-10-07") }), f("S1"), f("S2")] as any;
  const duenos = ["M", "S1", "S2"].map((clinicId) => ({ supabaseId: "d", clinicId }));
  const madres = findBranchMothers(clinicas, duenos);
  assert.deepEqual([...madres.entries()].sort(), [["S1", "M"], ["S2", "M"]]);
  assert.deepEqual([...findIncludedBranchIds(clinicas, duenos)].sort(), ["S1", "S2"]);
  // la principal no es sede incluida: su estado operativo sigue siendo «pagando»
  assert.equal(evaluarSaludClinica({ ...sede, id: "M", pacientes: 3, citasPasadas: 2, pagosRegistrados: 1 }, ahora).estadoOperativo, "pagando");
});

test("el detalle de la principal lista las sedes con enlace y el de la sede enlaza a la principal", () => {
  const c = fuente("src/app/admin/clinics/[id]/sedes-del-dueno.tsx");
  assert.match(c, /Sedes de este dueño/);
  assert.match(c, /href=\{`\/admin\/clinics\/\$\{s\.id\}`\}/);
  assert.match(c, /href=\{`\/admin\/clinics\/\$\{principal\.id\}`\}/);
  assert.match(fuente("src/app/admin/clinics/[id]/clinic-detail-client.tsx"), /<SedesDelDueno sedes=\{sedesDueno\} principal=\{principal\}/);
  assert.match(fuente("src/app/admin/clinics/clinics-client.tsx"), /etiquetaSedeIncluida\(clinic\.principalNombre\)/);
});
