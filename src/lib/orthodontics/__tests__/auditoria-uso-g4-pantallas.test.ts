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

test("tercera ronda · C-65: «Completar consulta» cierra con la nota YA firmada y usa el texto que manda el editor", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /clinicalNoteId: \(notaFirmada && notaFirmada !== clinicalNoteId \? notaFirmada : clinicalNoteId\) \?\? undefined/);
  assert.match(ficha, /await handleEndConsult\(d\);/);
  assert.ok(!leer("src/lib/clinical/note-validation.ts").includes("NOM-004 §6, campos mínimos"));
});

test("tercera ronda · C-71 y N-30: refresco tras agendar el control; el alta rechazada no cierra el cajón", () => {
  assert.match(leer("src/components/specialties/orthodontics/AgendarProximoControlButton.tsx"), /router\.refresh\(\);/);
  assert.match(leer("src/components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx"), /if \(ok !== false\) closeDrawer\(\);/);
  assert.match(leer("src/components/specialties/orthodontics/redesign/OrtodonciaSinCaso.tsx"), /if \(abierto === false\) return;/);
});

test("tercera ronda · N-31: la pestaña pide sus lecturas en UN viaje (precarga) y cada sección la reutiliza", () => {
  assert.match(leer("src/components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx"), /iniciarPrecarga\(\{/);
  for (const [archivo, nombre] of [
    ["src/components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx", "cargarPanelDeCobro"],
    ["src/components/specialties/orthodontics/redesign/drawers/HojaExtras.tsx", "historialDeLigas"],
    ["src/components/specialties/orthodontics/alineadores/AlineadoresPanel.tsx", "getAlignerCase"],
    ["src/components/specialties/orthodontics/cobranza/ExtrasPorCobrar.tsx", "listarExtrasPorCobrar"],
  ]) {
    assert.ok(leer(archivo).includes(`conPrecarga("${nombre}"`), `${archivo} no usa la precarga`);
  }
});

test("ronda final · F-3: la tarjeta y la sección de Alertas dicen «Pago vencido»", () => {
  const a = leer("src/components/specialties/orthodontics/modulo/vista-alertas.tsx");
  assert.ok(!a.includes('etiqueta: "Mensualidad vencida"'));
  assert.match(a, /etiqueta: "Pago vencido"/);
});

test("ronda final · F-4: en el celular Fotos, Documentos, Diagnóstico y Aparatología se abren con «Ver»", () => {
  const c = leer("src/components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
  for (const id of ["photos", "docs", "diagnosis", "plan"]) assert.match(c, new RegExp(`id="${id}"`));
  assert.match(c, /plegada=\{esCelular\}/);
});

test("ronda final · N-31: la precarga lee la sesión una vez, el consentimiento ligero y el saldo primero", () => {
  assert.match(leer("src/app/actions/orthodontics/_helpers.ts"), /memoDePeticion\("auth", getAuthContext\)/);
  const p = leer("src/app/actions/orthodontics/precargarPestana.ts");
  assert.match(p, /conMemoDePeticion\(/);
  assert.ok(!p.includes("getCaseIntakeOptions({ patientId })"), "la precarga sigue leyendo todas las opciones del alta");
  assert.match(leer("src/components/specialties/orthodontics/redesign/precarga.ts"), /parte: "cobro"/);
});
