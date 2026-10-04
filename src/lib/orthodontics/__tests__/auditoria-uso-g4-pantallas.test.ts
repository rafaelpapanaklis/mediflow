// Candados de pantalla de la ronda G4 de la auditoría de uso (ws1-t9). Son cambios de cableado que una prueba pura no
// alcanza; cada uno falla con el código viejo. La comprobación de verdad es la del navegador (ver el reporte).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const raiz = join(__dirname, "..", "..", "..", "..");
const leer = (ruta: string) => readFileSync(join(raiz, ruta), "utf8");

test("C-58: la pestaña de Ortodoncia recibe las banderas del cuestionario y la cabecera las pinta", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  const i = ficha.indexOf("<OrthodonticsPatientTab");
  assert.ok(i > 0 && ficha.indexOf("riskFlags={questionnaireRiskFlags}", i) > i, "la pestaña no recibe riskFlags");
  assert.match(leer("src/components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx"), /alertas: alertasDeCabeceraOrto\(/);
  assert.match(leer("src/components/specialties/orthodontics/redesign/PatientHeaderG16.tsx"), /p\.alertas\.riesgo\.map/);
});

test("C-104: Cobro del tratamiento ya no dice que el cobro automático «todavía no está disponible»", () => {
  assert.ok(!leer("src/components/specialties/orthodontics/redesign/sections/SectionFinance.tsx").includes("todavía no está disponible aquí.</div>"));
});

test("C-65: con la nota de la consulta ya firmada no se enseña el SOAP vacío", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /notaDeLaConsultaFirmada \? \(/);
  assert.match(ficha, /setNotaDeLaConsultaFirmada\(true\)/);
});

test("C-77 y C-78: «Consulta en curso» en la cabecera y un solo aviso al guardar", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /consultaEnCurso=\{isConsultActive && !!activeAppointment\}/);
  assert.ok(!ficha.includes('toast.success(t("patients.record.saved"))'), "sigue el segundo aviso «Expediente guardado»");
  const hero = leer("src/components/dashboard/patient-detail/hero-card.tsx");
  assert.match(hero, /data-motivo-sin-iniciar/);
  assert.match(hero, /data-consulta-en-curso/);
});

test("C-71: firmar un control recarga el cobro del caso", () => {
  const c = leer("src/components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
  assert.ok(!c.includes("onSign={props.onCardSigned}"));
  assert.match(c, /if \(r\) recargarPanelDeCobro\(\);/);
});

test("C-62: el cajón de la colocación no deja registrar sin consentimiento y el servidor tampoco", () => {
  assert.match(leer("src/components/specialties/orthodontics/redesign/drawers/DrawerColocacion.tsx"), /!datos\?\.sinConsentimiento/);
  const accion = leer("src/app/actions/orthodontics/registrarColocacion.ts");
  assert.match(accion, /if \(sinConsentimiento\) return fail\(sinConsentimiento\);/);
  assert.match(leer("src/app/actions/orthodontics/createTreatmentPlan.ts"), /status: colocado \? "IN_PROGRESS" : "PLANNED"/);
});

test("C-74: acentos del plan de tratamiento", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  const tr = es.patients.treatment;
  assert.equal(tr.everyDays, "Cada {days} días");
  assert.equal(tr.next, "Próxima: {date}");
  assert.equal(tr.descLabel, "Descripción (opcional)");
  assert.equal(tr.daysBetween, "Días entre sesiones");
  assert.equal(es.patients.commonTreatment.perioRehab, "Rehabilitación periodontal");
});

test("vuelta 2 · C-82: la hoja firmada de hoy ofrece «Registrar otro control hoy», sin cita", () => {
  const c = leer("src/components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
  assert.match(c, /onRegistrarOtroHoy=\{/);
  assert.match(c, /getTreatmentCardContextForPatient\(t\.treatmentPlanId, null, null, true\)/);
  assert.match(leer("src/lib/orthodontics/treatment-card-context.ts"), /linkedToAppt \|\| opciones\.otraHojaHoy \? null/);
  assert.match(leer("src/components/specialties/orthodontics/redesign/drawers/DrawerTreatmentCard.tsx"), /Registrar otro control hoy/);
});

test("vuelta 2 · C-83: el odontograma ya no ocupa el alto de la pantalla", () => {
  assert.ok(!/min-height:\s*100vh/.test(leer("src/components/dashboard/odontogram-v2/odontogram.css")));
});

test("vuelta 2 · C-76: la lista de presupuestos pide sus datos a la vez", () => {
  const r = leer("src/app/api/quotes/route.ts");
  assert.match(r, /const \[denied, patient, clinica, candidatos, porConcepto\] = await Promise\.all\(/);
  assert.match(r, /const \[\{ porQuote, fallo \}, cobros, aceptadas\] = await Promise\.all\(/);
});

test("vuelta 2 · C-64: plan, consentimientos, cuestionario y hoja pintan en la zona de la clínica", () => {
  assert.match(leer("src/components/dashboard/plan-tratamiento-rediseno/ventanas-plan.tsx"), /useZonaDeLaClinica\(\)/);
  assert.match(leer("src/components/dashboard/patient-detail/consents-tab.tsx"), /fmtDate\(c\.createdAt, zonaClinica\)/);
  assert.match(leer("src/components/dashboard/pacientes-rediseno/cuestionario.tsx"), /fechaLarga\(vigente\.filledAt, "es-MX", zonaClinica\)/);
  assert.match(leer("src/components/specialties/orthodontics/redesign/drawers/DrawerTreatmentCard.tsx"), /fechaCorta\([^)]*, zonaClinica\)/);
});
