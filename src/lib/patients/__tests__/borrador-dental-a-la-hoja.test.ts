// ws1-t8 — revisión en panel.108 de ws1-t9, fallo 6: lo escrito en «Nueva consulta → Dental general» se perdía al
// cambiar el tipo a «Ortodoncia» (la hoja de control abría solo con su nota precargada). Ahora pasa a la hoja.
// Run: npx tsx --test src/lib/patients/__tests__/borrador-dental-a-la-hoja.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claveBorradorDental, notaDelBorradorDental, unirNotaDeLaConsulta } from "../borrador-dental";
import { initialState, puedeFirmarNota } from "@/components/specialties/orthodontics/redesign/drawers/treatment-card-state";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const borrador = (form: Record<string, unknown>) => JSON.stringify({ v: 1, savedAt: 1, form, vitals: {}, exploracion: {}, pronostico: "", procs: [] });

test("del borrador dental se toma la nota S/O/A/P; sin texto, nada", () => {
  assert.deepEqual(notaDelBorradorDental(borrador({ subjective: "  Dolor en 24 ", objective: "", assessment: "", plan: "Revisar" })), {
    s: "Dolor en 24", o: "", a: "", p: "Revisar",
  });
  assert.equal(notaDelBorradorDental(borrador({ subjective: " ", periodontal: { plaque: "20" } })), null);
  assert.equal(notaDelBorradorDental(null), null);
  assert.equal(notaDelBorradorDental("{roto"), null);
  assert.equal(notaDelBorradorDental(JSON.stringify({ v: 2, form: { subjective: "x" } })), null);
});

test("la clave es la misma con la que DentalForm guarda su borrador", () => {
  assert.equal(claveBorradorDental("p1"), "dc:dental-draft:p1");
  assert.match(leer("components/clinical/dental-form.tsx"), /`dc:dental-draft:\$\{patientId\}`/);
});

test("la hoja abre con lo escrito en la consulta delante de la precarga, sin repetir", () => {
  const precarga = { s: "Refiere ____ (molestias, dolor).", o: "Mes 6 de tratamiento.", a: "", p: "Control en 4 semanas." };
  assert.deepEqual(unirNotaDeLaConsulta({ s: "Dolor en 24", o: "", a: "", p: "" }, precarga), {
    s: "Dolor en 24\n\nRefiere ____ (molestias, dolor).",
    o: "Mes 6 de tratamiento.",
    a: "",
    p: "Control en 4 semanas.",
  });
  assert.deepEqual(unirNotaDeLaConsulta({ s: "Dolor", o: "", a: "", p: "" }, null), { s: "Dolor", o: "", a: "", p: "" });
});

test("en el cajón lo traído de la consulta NO cuenta como precargado: un Plan escrito por el doctor deja firmar", () => {
  const nota = { s: "", o: "", a: "", p: "Control en 4 semanas." };
  const conPlan = initialState(null, { nota, notaDeLaConsulta: { s: "Dolor en 24", o: "", a: "", p: "Cambio de arco" } });
  assert.equal(conPlan.soap.s, "Dolor en 24");
  assert.equal(conPlan.soap.p, "Cambio de arco\n\nControl en 4 semanas.");
  assert.deepEqual(conPlan.notaPrecargada, nota, "la precarga de referencia sigue siendo la del sistema");
  assert.equal(puedeFirmarNota(conPlan.soap, conPlan.notaPrecargada), true);
  // Sin Plan propio, la regla de siempre: el Plan precargado sin tocar no cuenta.
  const sinPlan = initialState(null, { nota, notaDeLaConsulta: { s: "Dolor en 24", o: "", a: "", p: "" } });
  assert.equal(puedeFirmarNota(sinPlan.soap, sinPlan.notaPrecargada), false);
});

test("«Nueva consulta → Ortodoncia» lleva la nota a la hoja y el borrador dental se borra solo al guardar o firmar", () => {
  const cliente = leer("components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
  const i = cliente.indexOf("if (!abrirControlAlEntrar) return;");
  const efecto = cliente.slice(i, cliente.indexOf("onControlAbierto?.();", i));
  assert.match(efecto, /leerNotaDelBorradorDental\(vm\.patient\.id\)/);
  assert.match(efecto, /setNotaDeLaConsulta\(nota\)/);
  assert.equal((cliente.match(/notaDeLaConsulta,\n {10}\}\}/g) ?? []).length, 2, "las dos hojas nuevas (con y sin contexto) la reciben");
  assert.equal((cliente.match(/onSign=\{conNotaDeLaConsulta\(props\.onCardSigned\)\}/g) ?? []).length, 3);
  assert.match(cliente, /if \(r\) \{\n\s+borrarBorradorDental\(vm\.patient\.id\);/);
  assert.match(leer("components/specialties/orthodontics/redesign/drawers/DrawerTreatmentCard.tsx"), /notaDeLaConsulta: d\.notaDeLaConsulta \?\? null,/);
});

test("DentalForm escribe su borrador al desmontarse (antes se perdían los últimos 700 ms tecleados)", () => {
  const f = leer("components/clinical/dental-form.tsx");
  assert.match(f, /draftPendienteRef\.current = escribir;/);
  assert.match(f, /useEffect\(\(\) => \(\) => draftPendienteRef\.current\?\.\(\), \[\]\);/);
  // Guardar la consulta borra el borrador y cancela la escritura pendiente (no lo resucita al salir).
  assert.match(f, /const clearDraft = useCallback\(\(\) => \{\n\s+draftPendienteRef\.current = null;/);
});
