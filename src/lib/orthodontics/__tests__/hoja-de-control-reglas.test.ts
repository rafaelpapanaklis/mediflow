// ws1-t10 — reglas de la hoja de control (hallazgos #2, #11 y #17 de la revisión final de ws1-t9).
// Correr: npx tsx --test src/lib/orthodontics/__tests__/hoja-de-control-reglas.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { hojaFirmadaDeHoy, huecosDeLaNota, mensajeDeHuecos, proximaFechaDeControl } from "../hoja-de-control-reglas";

test("huecos: cuántos y dónde", () => {
  const nota = { s: "Refiere ____ y ____", o: "", a: "Bien", p: "Cementado ____" };
  assert.deepEqual(huecosDeLaNota(nota), {
    total: 3,
    porCampo: [{ campo: "s", etiqueta: "Subjetivo", huecos: 2 }, { campo: "p", etiqueta: "Plan", huecos: 1 }],
  });
  assert.equal(mensajeDeHuecos(nota), "Quedan 3 huecos (____): 2 en Subjetivo y 1 en Plan. Llénalos para poder firmar.");
});

test("huecos: uno solo, y ninguno", () => {
  assert.equal(mensajeDeHuecos({ s: "", o: "", a: "", p: "Arco ____" }), "Queda 1 hueco (____): 1 en Plan. Llénalos para poder firmar.");
  assert.equal(mensajeDeHuecos({ s: "a", o: "b", a: "c", p: "d" }), null);
  assert.equal(mensajeDeHuecos({ s: "", o: "", a: "", p: "" }), null);
});

test("huecos en tres partes: «x en A, y en B y z en C»", () => {
  assert.equal(
    mensajeDeHuecos({ s: "____", o: "____", a: "", p: "____ ____" }),
    "Quedan 4 huecos (____): 1 en Subjetivo, 1 en Objetivo y 2 en Plan. Llénalos para poder firmar.",
  );
});

test("hojaFirmadaDeHoy: solo una FIRMADA y de hoy", () => {
  const ahora = new Date(2026, 8, 28, 15, 0);
  const hoja = (id: string, status: string, y: number, m: number, d: number) => ({ id, status, visitDate: new Date(y, m, d, 9, 0).toISOString() });
  assert.equal(hojaFirmadaDeHoy([hoja("a", "SIGNED", 2026, 8, 27), hoja("b", "DRAFT", 2026, 8, 28)], ahora), null);
  assert.equal(hojaFirmadaDeHoy([hoja("a", "SIGNED", 2026, 8, 27), hoja("c", "SIGNED", 2026, 8, 28)], ahora)?.id, "c");
  assert.equal(hojaFirmadaDeHoy([], ahora), null);
});

test("próximo control: el día es visita + N semanas", () => {
  const desde = new Date(2026, 8, 28, 11, 0).toISOString();
  const r = new Date(proximaFechaDeControl({ desde, semanas: 4 }));
  assert.equal(r.getDate(), new Date(2026, 9, 26).getDate());
  assert.equal(r.getMonth(), 9);
});

test("próximo control: una visita de las 10:26 p. m. propone las 10:00 a. m., no las 10:26 p. m.", () => {
  const desde = new Date(2026, 8, 28, 22, 26).toISOString();
  const r = new Date(proximaFechaDeControl({ desde, semanas: 4 }));
  assert.equal(r.getHours(), 10);
  assert.equal(r.getMinutes(), 0);
});

test("próximo control: madrugada también cae a las 10:00; en horario se conserva a la media hora", () => {
  assert.equal(new Date(proximaFechaDeControl({ desde: new Date(2026, 8, 28, 3, 10).toISOString(), semanas: 2 })).getHours(), 10);
  const t = new Date(proximaFechaDeControl({ desde: new Date(2026, 8, 28, 16, 47).toISOString(), semanas: 2 }));
  assert.equal(t.getHours(), 16);
  assert.equal(t.getMinutes(), 30);
});

test("próximo control: la hora de una CITA se respeta tal cual", () => {
  const desde = new Date(2026, 8, 28, 21, 15).toISOString();
  const r = new Date(proximaFechaDeControl({ desde, semanas: 6, horaDeCita: true }));
  assert.equal(r.getHours(), 21);
  assert.equal(r.getMinutes(), 15);
});

// ── Cableado (lo que se ve en pantalla) ───────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { join } from "node:path";
const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("#2: el cajón bloquea «Firmar control» con huecos y el servidor lo vuelve a exigir", () => {
  const d = leer("components/specialties/orthodontics/redesign/drawers/DrawerTreatmentCard.tsx");
  assert.match(d, /const canSign = puedeFirmarNota\(state\.soap, state\.notaPrecargada\) && !avisoDeHuecos;/);
  assert.match(d, /\{avisoDeHuecos\}/);
  const s = leer("app/actions/orthodontics/signTreatmentCard.ts");
  assert.match(s, /const avisoDeHuecos = mensajeDeHuecos\(soap\);\s*if \(avisoDeHuecos\) return fail\(avisoDeHuecos\);/);
});

test("#11: tras firmar sin fecha se ofrece agendar; la fecha usa la hora de la cita o del horario; el aviso dice «Control firmado»", () => {
  const d = leer("components/specialties/orthodontics/redesign/drawers/DrawerTreatmentCard.tsx");
  assert.match(d, /<AgendarControlBoton patientId=\{props\.paciente\.id\}/);
  assert.match(d, /proximaFechaDeControl\(\{ desde: fromIso, semanas: weeks, horaDeCita \}\)/);
  assert.match(d, /Boolean\(props\.appointmentId\)/);
  const tab = leer("components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx");
  assert.match(tab, /toast\.success\("Control firmado"\)/);
  assert.doesNotMatch(tab, /appointmentSigned/);
});

test("#9: «Registrar control» muestra que carga y no admite doble clic; #10: plantillas con Reintentar", () => {
  const c = leer("components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
  assert.match(c, /if \(abriendoControlRef\.current\) return;/);
  assert.match(c, /controlCargando=\{abriendoControl\}/);
  assert.match(leer("components/specialties/orthodontics/redesign/PatientHeaderG16.tsx"), /"Abriendo la hoja…"/);
  const p = leer("components/clinical-shared/EvolutionTemplatePicker.tsx");
  assert.match(p, /Reintentar/);
  assert.match(p, /setIntento\(\(n\) => n \+ 1\)/);
});

test("#17: con el control de hoy firmado se dice y se ve, no se ofrece registrarlo otra vez; y los dos caminos usan el mismo criterio", () => {
  const c = leer("components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
  assert.match(c, /El control de hoy ya está firmado/);
  assert.match(c, /setDrawer\(\{ kind: "tcard", cardId: hojaDeHoyFirmada\.id \}\)/);
  assert.match(c, /controlFirmadoHoy=\{Boolean\(hojaDeHoyFirmada\)\}/);
  assert.match(leer("components/specialties/orthodontics/redesign/PatientHeaderG16.tsx"), /Ver el control de hoy \(firmado\)/);
  assert.match(c, /const casoActivo = Boolean\(t\.treatmentPlanId\) && t\.status !== "no-iniciado";/);
  assert.match(c, /t\.status !== "no-iniciado" \? abrirRegistrarControl : undefined/);
});
