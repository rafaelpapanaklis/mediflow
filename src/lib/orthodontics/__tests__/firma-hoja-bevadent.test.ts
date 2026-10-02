// ws1-t8 — firma de la hoja de control, ticket BEVADENT (2-oct-2026):
//   · punto 10: solo lo OBLIGATORIO (el Plan) bloquea; un «____» en S/O/A se firma escrito «[sin dato]».
//   · punto 12: firmar HOY la hoja de una cita de OTRO día no la pasa a «Atendida» antes de que ocurra.
//   · punto 3: una nota por visita — la hoja adopta el borrador de la consulta y la ficha cierra la consulta.
// Correr: npx tsx --test src/lib/orthodontics/__tests__/firma-hoja-bevadent.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  avisoDeHuecosOpcionales,
  fusionarNotaDeConsulta,
  fusionarTexto,
  mensajeDeHuecos,
  rellenarHuecosOpcionales,
  SIN_DATO,
} from "../hoja-de-control-reglas";
import { citaAlFirmar, diaEnZona } from "../cerrar-cita-al-firmar";
import { textosFirmaControl } from "@/components/specialties/orthodontics/redesign/textos-firma-control";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

// ── Punto 10 ─────────────────────────────────────────────────────────────────────────────

test("punto 10: un hueco en Subjetivo/Objetivo/Análisis NO bloquea la firma; en el Plan, sí", () => {
  // Lo que precarga la hoja nueva sin plantilla («Refiere ____ (…)») ya no impide firmar.
  assert.equal(mensajeDeHuecos({ s: "Refiere ____ (molestias, dolor).", o: "Ajustes: ____", a: "____", p: "Control en 4 semanas" }), null);
  assert.match(mensajeDeHuecos({ s: "", o: "", a: "", p: "Cambio a arco ____" }) ?? "", /en el Plan, que es obligatorio/);
});

test("punto 10: lo opcional vacío se marca claro antes de firmar y se firma «[sin dato]», nunca «____»", () => {
  const nota = { s: "Refiere ____ y molestia en el 24.", o: "Ajustes: ____", a: "", p: "Control en 4 semanas" };
  assert.equal(
    avisoDeHuecosOpcionales(nota),
    "2 datos opcionales sin llenar (____) en Subjetivo y Objetivo: puedes firmar así y quedará escrito «[sin dato]».",
  );
  const firmada = rellenarHuecosOpcionales(nota);
  assert.equal(firmada.s, `Refiere ${SIN_DATO} y molestia en el 24.`, "no se borra lo que el doctor sí escribió");
  assert.equal(firmada.o, `Ajustes: ${SIN_DATO}`);
  assert.equal(firmada.p, "Control en 4 semanas");
  assert.ok(![firmada.s, firmada.o, firmada.a].some((t) => t.includes("____")));
  assert.equal(avisoDeHuecosOpcionales({ s: "a", o: "", a: "", p: "b ____" }), null, "el hueco del Plan no es opcional");
});

test("punto 10: el servidor firma la versión rellenada y el cajón solo bloquea con el Plan", () => {
  const s = leer("app/actions/orthodontics/signTreatmentCard.ts");
  assert.match(s, /const soap = rellenarHuecosOpcionales\(soapTecleado\);/);
  assert.match(s, /soapS: soap\.s,/);
  assert.doesNotMatch(s, /soapS: data\.soap\.s/);
  const d = leer("components/specialties/orthodontics/redesign/drawers/DrawerTreatmentCard.tsx");
  assert.match(d, /\{avisoHuecosOpcionales\}/);
  assert.match(d, /const canSign = puedeFirmarNota\(state\.soap, state\.notaPrecargada\) && !avisoDeHuecos;/);
});

// ── Punto 12 ─────────────────────────────────────────────────────────────────────────────

const ZONA = "America/Mexico_City";
const AHORA = new Date("2026-10-02T18:00:00Z"); // 2-oct 12:00 en CDMX

test("punto 12: cita de un día futuro sin el paciente → no se liga ni se cierra; la visita es de hoy", () => {
  for (const status of ["SCHEDULED", "CONFIRMED"]) {
    assert.deepEqual(citaAlFirmar({ status, startsAt: new Date("2026-10-06T16:00:00Z") }, AHORA, ZONA), {
      ligar: false,
      visitaHoy: true,
      diaDeLaCita: "2026-10-06",
    });
  }
});

test("punto 12: cita futura que YA se está atendiendo (llegó, sillón, consulta) → se liga y cierra, visita de hoy", () => {
  for (const status of ["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"]) {
    assert.deepEqual(citaAlFirmar({ status, startsAt: new Date("2026-10-03T16:00:00Z") }, AHORA, ZONA), { ligar: true, visitaHoy: true });
  }
});

test("punto 12: cita de hoy (en la zona de la clínica) o de un día pasado → como siempre", () => {
  // 3-oct 03:00 UTC = 2-oct 21:00 en CDMX: es HOY para la clínica aunque en UTC ya sea mañana.
  assert.deepEqual(citaAlFirmar({ status: "SCHEDULED", startsAt: new Date("2026-10-03T03:00:00Z") }, AHORA, ZONA), { ligar: true, visitaHoy: false });
  assert.deepEqual(citaAlFirmar({ status: "SCHEDULED", startsAt: new Date("2026-09-30T16:00:00Z") }, AHORA, ZONA), { ligar: true, visitaHoy: false });
  assert.equal(diaEnZona(new Date("2026-10-03T03:00:00Z"), ZONA), "2026-10-02");
});

test("punto 12: la firma aplica la regla antes de cerrar la cita, para todos los roles", () => {
  const s = leer("app/actions/orthodontics/signTreatmentCard.ts");
  const iRegla = s.indexOf("citaAlFirmar(citaDeControl, new Date(), clinicaZona)");
  const iCierre = s.indexOf("planDeCierreDeCita(");
  assert.ok(iRegla > 0 && iCierre > iRegla);
  assert.match(s, /if \(citaDeOtroDiaSinTocar\) citaDeControl = null;/);
  assert.match(s, /const visitDate = decisionCita\?\.visitaHoy \? new Date\(\) : new Date\(data\.visitDate\);/);
  // Una hoja guardada antes como borrador ligada a esa cita futura se desliga al firmar.
  assert.match(s, /const appointmentIdDeLaHoja: string \| null \| undefined = citaDeOtroDiaSinTocar \? null : data\.appointmentId;/);
});

// ── Punto 3 ──────────────────────────────────────────────────────────────────────────────

test("punto 3: lo que ya estaba en el borrador de la consulta no se pierde ni se repite", () => {
  assert.equal(fusionarTexto("", "Plan de la hoja"), "Plan de la hoja");
  assert.equal(fusionarTexto(null, "Plan de la hoja"), "Plan de la hoja");
  assert.equal(fusionarTexto("Dolor en 24", ""), "Dolor en 24");
  assert.equal(fusionarTexto("Dolor en 24", "Dolor en 24. Ajuste de arco"), "Dolor en 24. Ajuste de arco");
  assert.equal(fusionarTexto("Dolor en 24", "Ajuste de arco"), "Dolor en 24\n\nAjuste de arco");
  assert.deepEqual(
    fusionarNotaDeConsulta({ subjective: "Dolor", objective: null, assessment: "", plan: null }, { s: "", o: "O", a: "A", p: "P" }),
    { s: "Dolor", o: "O", a: "A", p: "P" },
  );
});

test("punto 3: la hoja abierta dentro de una consulta se liga a ESA cita y la ficha cierra la consulta al firmar", () => {
  const ficha = leer("app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /citaEnCursoId=\{activeAppointment\?\.id \?\? null\}/);
  assert.match(ficha, /onConsultaCerradaPorLaHoja=\{cerrarConsultaPorLaHoja\}/);
  const cliente = leer("components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
  assert.match(cliente, /getTreatmentCardContextForPatient\(t\.treatmentPlanId, props\.citaEnCursoId \?\? null\)/);
  const accion = leer("app/actions/orthodontics/getTreatmentCardContextForPatient.ts");
  assert.match(accion, /status: \{ in: \["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"\] \}/);
  const tab = leer("components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx");
  assert.match(tab, /res\.data\.citaCerrada === citaEnCursoId/);
  const firma = leer("app/actions/orthodontics/signTreatmentCard.ts");
  assert.match(firma, /citaCerrada = citaDeControl\.id;/);
});

test("textos nuevos en español e inglés, con las mismas claves", () => {
  const es = textosFirmaControl("es");
  const en = textosFirmaControl("en");
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  assert.match(es.citaDeOtroDia("2026-10-06"), /6 oct/);
  assert.match(en.citaDeOtroDia("2026-10-06"), /Oct 6/);
  assert.equal(es.huecosOpcionales(1, ["s"]), "1 dato opcional sin llenar (____) en Subjetivo. Puedes firmar así: quedará escrito «[sin dato]».");
  assert.match(en.huecosOpcionales(3, ["s", "o"]), /^3 optional fields left blank \(____\) in Subjective and Objective\./);
});
