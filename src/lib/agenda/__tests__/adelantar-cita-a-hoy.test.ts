/**
 * ws1-t8 — decisión 6 de Rafael (2-oct): el paciente de una cita FUTURA llega HOY → la cita se mueve a hoy.
 * La regla pura (adelantar-cita-a-hoy.ts), «Iniciar consulta» de la ficha (que antes no tocaba una cita de otro
 * día) y la firma de la hoja (que ya no la trata como futura). Las rutas, con sus dobles, en
 * src/app/api/appointments/__tests__/llega-hoy-cita-futura.test.ts.
 * Run: npm run test:cita-futura-llega-hoy
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { debeAdelantarseAHoy, motivoDelSobreturno, planDeAdelanto, rangoAdelantado } from "../adelanto-a-hoy-regla";
import { adelantoDeLaRespuesta, textoDelAdelanto } from "../adelanto-texto";
import { iniciarConsultaArrancaLaCita, motivoParaNoIniciar } from "@/lib/patients/proxima-cita";

const TZ = "America/Mexico_City";
// Viernes 2-oct-2026, 15:20:37 en Ciudad de México (UTC-6).
const AHORA = new Date("2026-10-02T21:20:37Z");
const MANANA_10 = new Date("2026-10-03T16:00:00Z");
const HOY_18 = new Date("2026-10-03T00:00:00Z"); // 2-oct 18:00 local
const AYER_10 = new Date("2026-10-01T16:00:00Z");

describe("cuándo se mueve", () => {
  it("una llegada (llegó, en sillón, en consulta) de una cita de un día futuro", () => {
    for (const destino of ["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"]) {
      assert.equal(debeAdelantarseAHoy({ startsAt: MANANA_10 }, destino, AHORA, TZ), true, destino);
    }
  });
  it("no: confirmar, cancelar, completar, no asistió", () => {
    for (const destino of ["CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW", "SCHEDULED"]) {
      assert.equal(debeAdelantarseAHoy({ startsAt: MANANA_10 }, destino, AHORA, TZ), false, destino);
    }
  });
  it("no: una cita de hoy (aunque sea más tarde) ni de un día pasado", () => {
    assert.equal(debeAdelantarseAHoy({ startsAt: HOY_18 }, "CHECKED_IN", AHORA, TZ), false);
    assert.equal(debeAdelantarseAHoy({ startsAt: AYER_10 }, "IN_PROGRESS", AHORA, TZ), false);
  });
  it("el día es el de la clínica, no el UTC: a las 19:00 de CDMX (01:00 UTC del día siguiente) mañana sigue siendo futuro", () => {
    const noche = new Date("2026-10-03T01:00:00Z"); // 2-oct 19:00 local
    assert.equal(debeAdelantarseAHoy({ startsAt: MANANA_10 }, "CHECKED_IN", noche, TZ), true);
  });
});

describe("a dónde se mueve", () => {
  it("empieza ahora (al minuto) y dura lo mismo", () => {
    const r = rangoAdelantado({ startsAt: MANANA_10, endsAt: new Date(MANANA_10.getTime() + 45 * 60_000) }, AHORA);
    assert.equal(r.startsAt.toISOString(), "2026-10-02T21:20:00.000Z");
    assert.equal(r.endsAt.getTime() - r.startsAt.getTime(), 45 * 60_000);
  });

  const cita = { startsAt: MANANA_10, endsAt: new Date(MANANA_10.getTime() + 30 * 60_000), resourceId: "r1", overrideReason: null };
  const otra = { id: "b", paciente: "Ana López", startsAt: new Date("2026-10-02T21:00:00Z") };

  it("agenda libre: solo cambia la hora", () => {
    const p = planDeAdelanto({ cita, ahora: AHORA, zona: TZ, userId: "u", choqueDoctor: null, choqueSillon: null });
    assert.deepEqual(Object.keys(p.datos).sort(), ["endsAt", "startsAt"]);
    assert.equal(p.sinSillon, false);
    assert.equal(p.seCruzaCon, null);
  });
  it("sillón ocupado: sin sillón", () => {
    const p = planDeAdelanto({ cita, ahora: AHORA, zona: TZ, userId: "u", choqueDoctor: null, choqueSillon: otra });
    assert.equal(p.datos.resourceId, null);
    assert.equal(p.sinSillon, true);
    assert.equal(p.datos.overrideReason, undefined);
  });
  it("doctor con otra cita: sobreturno con motivo, quién y cuándo", () => {
    const p = planDeAdelanto({ cita, ahora: AHORA, zona: TZ, userId: "u9", choqueDoctor: otra, choqueSillon: null });
    assert.equal(p.datos.overrideReason, motivoDelSobreturno(MANANA_10, TZ));
    assert.match(p.datos.overrideReason!, /3 oct 2026 10:00/);
    assert.equal(p.datos.overriddenBy, "u9");
    assert.equal(p.datos.overriddenAt, AHORA);
    assert.equal(p.seCruzaCon, otra);
  });
  it("un sobreturno que ya traía su motivo lo conserva", () => {
    const p = planDeAdelanto({ cita: { ...cita, overrideReason: "Urgencia" }, ahora: AHORA, zona: TZ, userId: "u", choqueDoctor: otra, choqueSillon: null });
    assert.equal(p.datos.overrideReason, undefined);
  });
});

describe("lo que ve el equipo", () => {
  it("dice de cuándo era, que se pasó a hoy y que el paciente no recibe aviso", () => {
    const a = adelantoDeLaRespuesta({ adelantada: { de: MANANA_10.toISOString(), a: "2026-10-02T21:20:00.000Z", sinSillon: true, seCruzaCon: { paciente: "Ana López", startsAt: "2026-10-02T21:00:00.000Z" } } });
    assert.ok(a);
    const t = textoDelAdelanto(a!, TZ);
    assert.match(t, /se pasó a hoy a las 15:20/);
    assert.match(t, /no se le manda aviso/);
    assert.match(t, /sin sillón/);
    assert.match(t, /Ana López de las 15:00/);
  });
  it("sin adelanto en la respuesta, nada", () => {
    assert.equal(adelantoDeLaRespuesta({ adelantada: null }), null);
    assert.equal(adelantoDeLaRespuesta(null), null);
  });
});

describe("«Iniciar consulta» de la ficha", () => {
  it("con una cita de un día futuro TAMBIÉN la pasa a «En consulta» (antes solo la de hoy)", () => {
    assert.equal(iniciarConsultaArrancaLaCita({ status: "SCHEDULED", startsAt: MANANA_10 }, AHORA, TZ), true);
    assert.equal(iniciarConsultaArrancaLaCita({ status: "CONFIRMED", startsAt: HOY_18 }, AHORA, TZ), true);
  });
  it("no con una ya «En consulta» ni con una de un día pasado", () => {
    assert.equal(iniciarConsultaArrancaLaCita({ status: "IN_PROGRESS", startsAt: MANANA_10 }, AHORA, TZ), false);
    assert.equal(iniciarConsultaArrancaLaCita({ status: "SCHEDULED", startsAt: AYER_10 }, AHORA, TZ), false);
  });
  it("el doctor puede iniciar su cita futura; recepción sigue sin poder", () => {
    const cita = { status: "SCHEDULED", startsAt: MANANA_10, doctorId: "d1" };
    assert.equal(motivoParaNoIniciar(cita, { id: "d1", role: "DOCTOR", puedeEditarAgenda: true }, AHORA, TZ), null);
    assert.equal(motivoParaNoIniciar(cita, { id: "r1", role: "RECEPTIONIST", puedeEditarAgenda: true }, AHORA, TZ), "sinPermiso");
  });
  it("la ficha usa la regla (manda el PATCH también con la futura) y avisa del adelanto", () => {
    const src = readFileSync(join(process.cwd(), "src/app/dashboard/patients/[id]/patient-detail-client.tsx"), "utf8");
    assert.match(src, /if \(iniciarConsultaArrancaLaCita\(cita, new Date\(\), zonaClinica\)\) \{/);
    assert.match(src, /textoDelAdelanto\(adelanto, zonaClinica\)/);
  });
});

describe("la firma de la hoja ya no trata como futura una cita con el paciente presente", () => {
  it("signTreatmentCard la trae a hoy antes de ligarla y cerrarla", () => {
    const src = readFileSync(join(process.cwd(), "src/app/actions/orthodontics/signTreatmentCard.ts"), "utf8");
    assert.match(src, /decisionCita\?\.ligar && decisionCita\.visitaHoy\) \{\s*const \{ adelantarCitaPresenteAHoy \} = await import\("@\/lib\/agenda\/adelantar-cita-a-hoy"\);\s*const inicioDeHoy = await adelantarCitaPresenteAHoy\(/);
    assert.match(src, /if \(inicioDeHoy\) citaDeControl = \{ \.\.\.citaDeControl, startsAt: inicioDeHoy \};/);
  });
  it("las pantallas de la Agenda avisan del adelanto", () => {
    for (const rel of [
      "src/components/dashboard/agenda-nueva/panel-cita.tsx",
      "src/components/dashboard/agenda/agenda-detail-panel.tsx",
      "src/app/dashboard/appointments/appointments-client.tsx",
    ]) {
      assert.match(readFileSync(join(process.cwd(), rel), "utf8"), /textoDelAdelanto\(adelanto\)/, rel);
    }
  });
});
