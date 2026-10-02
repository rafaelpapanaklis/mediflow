// ws1-t8 (ticket 3 de BEVADENT, mejoras 3b y 9b): la cita de ortodoncia abre la hoja de control ligada a ella, y
// el panel de la cita abre la atención COMPLETA (no solo el cajón rápido). Ver ../consulta-de-cita-orto.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  abrirHojaAlLlegar,
  enlaceAtencionCompleta,
  PARAM_ABRIR_HOJA,
  seAtiendeConLaHoja,
  TAB_ORTODONCIA,
} from "../consulta-de-cita-orto";
import { TIPO_CITA_CONTROL_ORTO } from "../agenda-constants";

const ZONA = "America/Mexico_City";
// 2-oct-2026 12:00 en CDMX.
const AHORA = new Date("2026-10-02T18:00:00Z");
const HOY = "2026-10-02T16:00:00Z";
const AYER = "2026-10-01T16:00:00Z";
const HOY_TARDE = "2026-10-03T00:00:00Z"; // 2-oct 18:00 CDMX: sigue siendo hoy aunque en UTC ya sea el 3

const base = { moduloOrtodoncia: true, casoActivo: true, ahora: AHORA, zona: ZONA };

test("3b: «Control de ortodoncia» en consulta se atiende con la hoja (antes caía en Dental general)", () => {
  assert.equal(seAtiendeConLaHoja({ ...base, cita: { type: TIPO_CITA_CONTROL_ORTO, status: "IN_PROGRESS", startsAt: HOY } }), true);
  // P0294: la cita era del día siguiente y ya se había pasado a consulta.
  assert.equal(seAtiendeConLaHoja({ ...base, cita: { type: TIPO_CITA_CONTROL_ORTO, status: "IN_PROGRESS", startsAt: "2026-10-04T00:00:00Z" } }), true);
  assert.equal(seAtiendeConLaHoja({ ...base, cita: { type: TIPO_CITA_CONTROL_ORTO, status: "SCHEDULED", startsAt: HOY_TARDE } }), true);
});

test("3b: las demás citas de ortodoncia con hoja (urgencia, colocación, retiro, retención) también", () => {
  for (const type of ["Urgencia de ortodoncia", "Colocación de aparatología", "Retiro de aparatología", "Control de retención"]) {
    assert.equal(seAtiendeConLaHoja({ ...base, cita: { type, status: "IN_PROGRESS", startsAt: HOY } }), true, type);
  }
});

test("3b: una cita que no es de ortodoncia sigue en «Nueva consulta»", () => {
  for (const type of ["Limpieza", "Valoración", "control de ortodoncia", null, undefined]) {
    assert.equal(seAtiendeConLaHoja({ ...base, cita: { type, status: "IN_PROGRESS", startsAt: HOY } }), false, String(type));
  }
});

test("3b: sin módulo, en solo lectura o sin caso en marcha, lo de siempre", () => {
  const cita = { type: TIPO_CITA_CONTROL_ORTO, status: "IN_PROGRESS", startsAt: HOY };
  assert.equal(seAtiendeConLaHoja({ ...base, cita, moduloOrtodoncia: false }), false);
  assert.equal(seAtiendeConLaHoja({ ...base, cita, casoActivo: false }), false);
  assert.equal(seAtiendeConLaHoja({ ...base, cita: null }), false);
});

test("una cita anulada nunca; una atendida solo si es de hoy (si no, se crearía un control nuevo de hoy)", () => {
  for (const status of ["CANCELLED", "NO_SHOW"]) {
    assert.equal(seAtiendeConLaHoja({ ...base, cita: { type: TIPO_CITA_CONTROL_ORTO, status, startsAt: HOY } }), false, status);
  }
  for (const status of ["COMPLETED", "CHECKED_OUT"]) {
    assert.equal(seAtiendeConLaHoja({ ...base, cita: { type: TIPO_CITA_CONTROL_ORTO, status, startsAt: HOY } }), true, `${status} hoy`);
    assert.equal(seAtiendeConLaHoja({ ...base, cita: { type: TIPO_CITA_CONTROL_ORTO, status, startsAt: AYER } }), false, `${status} ayer`);
  }
});

test("9b: el enlace de «Abrir atención completa» lleva a Ortodoncia con la cita y la hoja", () => {
  const url = enlaceAtencionCompleta("pac 1", "cita_9");
  assert.ok(url.startsWith("/dashboard/patients/pac%201?"));
  const qs = new URLSearchParams(url.split("?")[1]);
  assert.equal(qs.get("tab"), TAB_ORTODONCIA);
  assert.equal(qs.get("appointment"), "cita_9");
  assert.equal(qs.get(PARAM_ABRIR_HOJA), "1");
});

test("9b: `?hoja=1` solo abre la hoja dentro de Ortodoncia y con una cita que se atiende con ella", () => {
  assert.equal(abrirHojaAlLlegar({ tabDeLaDireccion: "ortodoncia", hoja: "1", seAtiendeConLaHoja: true }), true);
  assert.equal(abrirHojaAlLlegar({ tabDeLaDireccion: "ortodoncia", hoja: "1", seAtiendeConLaHoja: false }), false);
  assert.equal(abrirHojaAlLlegar({ tabDeLaDireccion: "resumen", hoja: "1", seAtiendeConLaHoja: true }), false);
  assert.equal(abrirHojaAlLlegar({ tabDeLaDireccion: "ortodoncia", hoja: null, seAtiendeConLaHoja: true }), false);
});

// Cableado: la regla de arriba no sirve de nada si la ficha y el panel de la cita no la usan.
const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("3b: la ficha elige la pestaña por la CITA y abre la hoja al activarse la consulta", () => {
  const ficha = leer("app/dashboard/patients/[id]/patient-detail-client.tsx");
  // Al llegar con ?appointment= de una cita de ortodoncia, Ortodoncia (si se puede ver); si no, lo de la clínica.
  assert.match(ficha, /citaDeLaDireccionConHoja \? consultLandingPermitido\(TAB_ORTODONCIA\) : null\) \?\?\s*consultLandingPermitido\(consultLandingTab\(clinicCategory\)\)/);
  // La consulta en curso de ortodoncia abre la hoja (ligada a citaEnCursoId) en vez de «Nueva consulta».
  assert.match(ficha, /const consultaConHoja = atiendeConLaHoja\(activeAppointment\)/);
  assert.match(ficha, /if \(consultaConHoja && consultLandingPermitido\(TAB_ORTODONCIA\)\) \{\s*setTab\(TAB_ORTODONCIA\);\s*setAbrirControlOrto\(true\);/);
  assert.match(ficha, /citaEnCursoId=\{activeAppointment\?\.id \?\? null\}/);
  // Una sola nota por visita: el SOAP suelto no se apila sobre la hoja.
  assert.match(ficha, /tab === CONSULT_FORM_TAB \|\| \(tab === TAB_ORTODONCIA && consultaConHoja\) \? "none"/);
});

test("9b: «Abrir atención completa» llega con ?hoja=1, abre la hoja y la quita de la dirección", () => {
  const ficha = leer("app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /useState\(\(\) =>\s*abrirHojaAlLlegar\(\{ tabDeLaDireccion: tabFromUrl, hoja: searchParams\.get\(PARAM_ABRIR_HOJA\)/);
  assert.match(ficha, /onControlAbierto=\{alAbrirControlOrto\}/);
  assert.match(ficha, /params\.delete\(PARAM_ABRIR_HOJA\)/);
});

test("9b: el panel de la cita ofrece la atención completa con el mismo permiso que el cajón", () => {
  const ranura = leer("components/specialties/orthodontics/agenda/RanuraCita.tsx");
  assert.match(ranura, /state\.canOpenClinicalCard \? \(\s*<>\s*<BotonHojaControl/);
  assert.match(ranura, /router\.push\(enlaceAtencionCompleta\(dto\.patient\.id, dto\.id\)\)/);
  assert.match(ranura, /textosFirma\.atencionCompleta\b/);
});

test("9b: los textos existen en español e inglés", async () => {
  const { textosFirmaControl } = await import("@/components/specialties/orthodontics/redesign/textos-firma-control");
  assert.equal(textosFirmaControl("es").atencionCompleta, "Abrir atención completa");
  assert.equal(textosFirmaControl("en").atencionCompleta, "Open full visit");
  assert.ok(textosFirmaControl("en").atencionCompletaAyuda.length > 20);
});

// ws1-t8 · revisión de mejoras (ws1-t10, bloqueante 1): «Abrir atención completa» dejaba el botón en «Abriendo la
// hoja…» y la hoja no abría. El efecto de `abrirControlAlEntrar` lanzaba la server action del contexto y enseguida
// `onControlAbierto` quitaba `hoja=1` con replaceState; Next 14.2 lo convierte en una acción RESTORE de su router,
// que DESCARTA la acción pendiente (su promesa no se resuelve) y tira las que esperaban detrás.
test("9b (bloqueante de la revisión): `hoja=1` se quita al LLEGAR, en un efecto de layout, no al abrir la hoja", () => {
  const ficha = leer("app/dashboard/patients/[id]/patient-detail-client.tsx");
  const i = ficha.indexOf("const alAbrirControlOrto =");
  const alAbrir = ficha.slice(i, ficha.indexOf(";", i) + 1);
  assert.equal(alAbrir, "const alAbrirControlOrto = () => setAbrirControlOrto(false);", "abrir la hoja ya no toca la dirección");
  assert.match(
    ficha,
    /const hojaEnLaDireccion = searchParams\.get\(PARAM_ABRIR_HOJA\);\s*(?:\/\/[^\n]*\n\s*)*useLayoutEffect\(\(\) => \{\s*if \(!hojaEnLaDireccion\) return;[\s\S]{0,300}?window\.history\.replaceState\(null, "", [\s\S]{0,80}?\}, \[hojaEnLaDireccion\]\);/,
  );
  // Un solo replaceState de `hoja` en la ficha: el del efecto de layout.
  assert.equal((ficha.match(/params\.delete\(PARAM_ABRIR_HOJA\)/g) ?? []).length, 1);
});

test("9b (bloqueante de la revisión): si el contexto de la hoja tarda, el botón se suelta y la hoja NO abre sin su cita", () => {
  const cliente = leer("components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
  assert.match(cliente, /const TOPE_CONTEXTO_HOJA_MS = 30_000;/);
  const i = cliente.indexOf("const pedido = getTreatmentCardContextForPatient(");
  assert.ok(i > 0, "el contexto se pide una sola vez y se espera con tope");
  const cuerpo = cliente.slice(i, cliente.indexOf("} finally {", i));
  assert.match(cuerpo, /await Promise\.race\(\[\s*pedido,/);
  // Con el tope: aviso, y la hoja abre cuando llegue la respuesta (con su contexto), nunca con los defaults.
  assert.match(cuerpo, /if \(res === SIN_RESPUESTA\) \{\s*toast\(textosConsulta\.laHojaTardaEnAbrir[^;]*;\s*void pedido\.then\(abrirCon\);\s*return;\s*\}/);
  // Y el `finally` sigue apagando «Abriendo la hoja…».
  assert.match(cliente, /\} finally \{\s*abriendoControlRef\.current = false;\s*setAbriendoControl\(false\);/);
});
