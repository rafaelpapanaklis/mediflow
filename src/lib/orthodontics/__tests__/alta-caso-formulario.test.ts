/**
 * Alta del caso de ortodoncia — H18 de la QA en vivo (28-sep-2026).
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/alta-caso-formulario.test.ts
 *
 * Reproduce los tres fallos:
 *  (a) tutor nuevo sin teléfono: el botón quedaba gris y nadie decía por qué;
 *  (b) «Quién lo refirió» vacío y sin forma de agregar a nadie;
 *  (c) «Costo total» con 45000 escrito en el código.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_COSTO_TOTAL,
  MIN_NOMBRE_TUTOR,
  MIN_RESUMEN,
  MIN_RETENCION,
  MIN_TELEFONO_TUTOR,
  MAX_TELEFONO_TUTOR,
  MOTIVO_TELEFONO_TUTOR,
  errorReferenteNuevo,
  errorTelefonoTutor,
  faltantesDelAlta,
  fraseDeFaltantes,
  leerCostoTotal,
  costoDelAlta,
  referenteParaGuardar,
  referenteYaRegistrado,
  telefonoTutorValido,
  pistaDelModoDelCaso,
  textosDelCosto,
  type EstadoAlta,
} from "../alta-caso-formulario";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const CAJON = leer("src/components/specialties/orthodontics/redesign/drawers/DrawerNewCase.tsx");
/** El cajón sin comentarios: un «45000» en una explicación no precarga nada. */
const CAJON_CODIGO = CAJON.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Un alta completa y correcta: de aquí se va rompiendo una cosa cada vez. */
const COMPLETA: EstadoAlta = {
  necesitaDiagnostico: true,
  enObservacion: false,
  resumen: "Clase II división 1 con apiñamiento moderado inferior y sobremordida.",
  proximaRevision: "",
  retencion: "Retenedor fijo lingual 3-3 inferior y Hawley superior.",
  costoTotal: "36000",
  modoResponsable: "none",
  tutorElegidoId: "",
  tutorNombre: "",
  tutorTelefono: "",
};

// ── (a) El teléfono del tutor ────────────────────────────────────────────

test("H18a: tutor nuevo sin teléfono → el alta dice QUÉ falta (antes: botón gris sin explicación)", () => {
  const faltan = faltantesDelAlta({ ...COMPLETA, modoResponsable: "new", tutorNombre: "Mamá Pruebas", tutorTelefono: "" });
  assert.deepEqual(faltan, [`el teléfono del responsable del pago (mínimo ${MIN_TELEFONO_TUTOR} cifras)`]);
  assert.equal(
    fraseDeFaltantes(faltan, false),
    "Para abrir el caso falta: el teléfono del responsable del pago (mínimo 7 cifras).",
  );
});

test("H18a: el campo dice que es obligatorio y POR QUÉ", () => {
  assert.match(MOTIVO_TELEFONO_TUTOR, /^Obligatorio\./);
  assert.match(MOTIVO_TELEFONO_TUTOR, /quien paga/);
  assert.match(CAJON, /<Field label="Teléfono \(obligatorio\)" hint=\{MOTIVO_TELEFONO_TUTOR\}/);
  // Y junto al botón, lo que falta.
  assert.match(CAJON, /\{fraseFaltantes\}/);
  assert.match(CAJON, /aria-describedby=\{fraseFaltantes \? idFaltantes : undefined\}/);
  assert.match(CAJON, /const todosLosFaltantes = \[\.\.\.faltantesDelPlan\.obligatorios, \.\.\.faltantesDelPlan\.correcciones\];/);
  assert.match(CAJON, /const fraseFaltantes = paso === "diagnostico"/);
  assert.match(CAJON, /const canSubmit = todosLosFaltantes\.length === 0 && !loadingOptions;/, "el botón y la explicación salen de la MISMA lista");
});

test("el teléfono se mide en cifras, no en caracteres", () => {
  assert.equal(telefonoTutorValido("5512345"), true);
  assert.equal(telefonoTutorValido("55 1234 5678"), true);
  assert.equal(telefonoTutorValido("+52 55 1234 5678"), true);
  assert.equal(telefonoTutorValido("551234"), false, "6 cifras");
  assert.equal(telefonoTutorValido("55-12-34"), false, "8 caracteres pero 6 cifras: antes pasaba el botón y fallaba al guardar");
  assert.equal(telefonoTutorValido("       "), false);
  assert.equal(telefonoTutorValido("1".repeat(MAX_TELEFONO_TUTOR + 1)), false, "no cabe en el servidor");

  assert.equal(errorTelefonoTutor(""), null, "vacío no regaña: lo dice la lista de faltantes");
  assert.equal(errorTelefonoTutor("5512"), "Lleva 4 cifras: faltan 3 para el mínimo de 7.");
  assert.equal(errorTelefonoTutor("5"), "Lleva 1 cifra: faltan 6 para el mínimo de 7.");
  assert.equal(errorTelefonoTutor("5512345678"), null);
});

test("los mínimos son los del servidor (createTreatmentPlanSchema / createDiagnosisSchema)", () => {
  const esquema = leer("src/lib/validation/orthodontics.ts");
  assert.match(esquema, new RegExp(`fullName: z\\.string\\(\\)\\.min\\(${MIN_NOMBRE_TUTOR}\\)\\.max\\(200\\)`));
  assert.match(esquema, new RegExp(`phone: z\\.string\\(\\)\\.min\\(${MIN_TELEFONO_TUTOR}\\)\\.max\\(${MAX_TELEFONO_TUTOR}\\)`));
  // ws1-t12 (decisión de Rafael): la retención ya no es obligatoria para abrir el caso; vacío = "".
  assert.match(esquema, /retentionPlanText: z\.string\(\)\.max\(2000\)\.default\(""\)/);
  assert.match(esquema, /totalCostMxn: z\.number\(\)\.positive\(\)\.max\(10_000_000\)/);
  assert.equal(MAX_COSTO_TOTAL, 10_000_000);
  assert.equal(MIN_RESUMEN, 40);
});

test("todo lo que falta, en el orden del formulario", () => {
  assert.deepEqual(faltantesDelAlta(COMPLETA), [], "completa: se puede abrir");
  assert.equal(fraseDeFaltantes([], false), null);

  const faltan = faltantesDelAlta({
    ...COMPLETA,
    resumen: "corto",
    costoTotal: "",
    retencion: "poco",
    modoResponsable: "new",
    tutorNombre: "",
    tutorTelefono: "55",
  });
  assert.deepEqual(faltan, [
    "el resumen clínico (lleva 5 de 40 caracteres)",
    "el costo del tratamiento",
    "el plan de retención (lleva 4 de 20 caracteres)",
    "el nombre del responsable del pago",
    "el teléfono del responsable del pago (mínimo 7 cifras)",
  ]);
  assert.match(fraseDeFaltantes(faltan, false)!, /^Para abrir el caso falta: .+; .+ y el teléfono del responsable del pago \(mínimo 7 cifras\)\.$/);

  // «Ya registrado» sin elegir a nadie: antes se guardaba el caso SIN responsable, en silencio.
  assert.deepEqual(faltantesDelAlta({ ...COMPLETA, modoResponsable: "existing", tutorElegidoId: "" }), [
    "elegir al responsable del pago (o marcar «El paciente»)",
  ]);
  assert.deepEqual(faltantesDelAlta({ ...COMPLETA, modoResponsable: "existing", tutorElegidoId: "g1" }), []);

  // Con diagnóstico ya hecho, el resumen no se pide.
  assert.deepEqual(faltantesDelAlta({ ...COMPLETA, necesitaDiagnostico: false, resumen: "" }), []);
});

test("paciente en observación: sin plan, solo diagnóstico y próxima revisión", () => {
  const obs = { ...COMPLETA, enObservacion: true, costoTotal: "", retencion: "", modoResponsable: "new" as const };
  assert.deepEqual(faltantesDelAlta(obs), ["la fecha de la próxima revisión"]);
  assert.deepEqual(faltantesDelAlta({ ...obs, proximaRevision: "2026-12-01" }), []);
  assert.equal(
    fraseDeFaltantes(["la fecha de la próxima revisión"], true),
    "Para guardarlo en observación falta: la fecha de la próxima revisión.",
  );
});

// ── (c) El costo total ───────────────────────────────────────────────────

test("H18c: el costo nace VACÍO — ningún precio escrito en el código", () => {
  assert.match(CAJON, /const \[totalCost, setTotalCost\] = useState\(\(\) => \(caso \? String\([^\n]*\) : ""\)\);/, "sin caso, nace vacío");
  assert.doesNotMatch(CAJON_CODIGO, /45[_,.]?000/, "el 45000 de antes ya no está");
  // Ni ese ni ningún otro importe por defecto en el estado del cajón.
  assert.doesNotMatch(CAJON_CODIGO, /useState\(\s*\d{4,}\s*\)/);
  assert.match(CAJON, /totalCostMxn: costoAGuardar,/, "se manda lo que se escribió (0 = «lo armo después»)");
});

test("H18c: sin costo no se abre el caso, y lo dice", () => {
  assert.deepEqual(faltantesDelAlta({ ...COMPLETA, costoTotal: "" }), ["el costo del tratamiento"]);
  assert.deepEqual(faltantesDelAlta({ ...COMPLETA, costoTotal: "   " }), ["el costo del tratamiento"]);
  for (const malo of ["0", "-500", "abc", "36k", "1e5", "12.345"]) {
    assert.deepEqual(faltantesDelAlta({ ...COMPLETA, costoTotal: malo }), ["un costo del tratamiento válido (mayor que cero)"], malo);
  }
});

test("el costo se lee como lo escribe una persona", () => {
  assert.equal(leerCostoTotal("36000"), 36000);
  assert.equal(leerCostoTotal("36,000"), 36000);
  assert.equal(leerCostoTotal("$36,000"), 36000);
  assert.equal(leerCostoTotal(" 36 000 "), 36000);
  assert.equal(leerCostoTotal("36000.50"), 36000.5);
  assert.equal(leerCostoTotal(""), null);
  assert.equal(leerCostoTotal("0"), null);
  assert.equal(leerCostoTotal("0.00"), null);
  assert.equal(leerCostoTotal(String(MAX_COSTO_TOTAL)), MAX_COSTO_TOTAL);
  assert.equal(leerCostoTotal(String(MAX_COSTO_TOTAL + 1)), null, "el servidor lo rechazaría");
});

test("el rótulo del costo depende de cómo cobra la clínica", () => {
  const total = textosDelCosto("PRECIO_TOTAL");
  assert.equal(total.rotulo, "Costo total (MXN)");
  assert.match(total.pista, /Plan de pago/);
  assert.doesNotMatch(total.pista, /confírmalo ahí/, "ya no se manda a Cobro por lo que se arma en el mismo alta");
  const control = textosDelCosto("PAGO_POR_CONTROL");
  assert.match(control.rotulo, /estimado/i);
  assert.match(control.pista, /cobra por control/);
  assert.match(control.pista, /no se factura un total/);

  assert.match(CAJON, /const textosCosto = textosDelCosto\(billingMode\);/);
  assert.match(CAJON, /setBillingMode\(res\.data\.billingMode\);/);
  const opciones = leer("src/app/actions/orthodontics/getCaseIntakeOptions.ts");
  // Desde a80e849f (ws1-t5) se lee junto con el doctor por defecto; sigue
  // siendo la clínica de la SESIÓN.
  assert.match(opciones, /const settings = await loadOrthoClinicSettings\(ctx\.clinicId\);/, "el modo sale de la clínica de la SESIÓN");
  assert.match(opciones, /billingMode = settings\.billingMode;/);
});

// ── (b) Quién lo refirió ────────────────────────────────────────────────

test("H18b: con la lista vacía se puede agregar un referente ahí mismo", () => {
  assert.match(CAJON, /Aún no hay referentes registrados en la clínica\. Agrega el primero aquí mismo\./);
  assert.match(CAJON, /const res = await createDoctorContact\(datos\);/, "reutiliza el directorio que ya existe");
  assert.match(CAJON, /setReferredByDoctorId\(res\.data\.id\);/, "el recién agregado queda elegido");
  // La acción que guarda saca la clínica de la sesión, nunca del formulario.
  const accion = leer("src/app/actions/clinical-shared/referrals.ts");
  assert.match(accion, /const ctx = await getAuthContext\(\);[\s\S]{0,200}clinicId: ctx\.clinicId,/);
  assert.doesNotMatch(CAJON, /clinicId/, "el cajón no manda ninguna clínica");
});

test("el referente nuevo: nombre obligatorio, lo demás opcional", () => {
  assert.equal(errorReferenteNuevo({ fullName: "", clinicName: "", phone: "" }), "Escribe el nombre de quien lo refirió.");
  assert.equal(errorReferenteNuevo({ fullName: " A ", clinicName: "", phone: "" }), "Escribe el nombre de quien lo refirió.");
  assert.equal(errorReferenteNuevo({ fullName: "Dra. Laura Méndez", clinicName: "", phone: "" }), null);
  assert.match(errorReferenteNuevo({ fullName: "x".repeat(121), clinicName: "", phone: "" })!, /demasiado largo/);
  assert.match(errorReferenteNuevo({ fullName: "Dra. Laura", clinicName: "c".repeat(121), phone: "" })!, /consultorio/);
  assert.match(errorReferenteNuevo({ fullName: "Dra. Laura", clinicName: "", phone: "5".repeat(41) })!, /teléfono/);

  assert.deepEqual(referenteParaGuardar({ fullName: "  Dra.  Laura   Méndez ", clinicName: "  ", phone: " 55 1234 5678 " }), {
    fullName: "Dra. Laura Méndez",
    clinicName: null,
    phone: "55 1234 5678",
  });
});

test("un referente que ya está en la lista no se guarda dos veces", () => {
  const lista = [
    { id: "r1", fullName: "Dra. Laura Méndez" },
    { id: "r2", fullName: "Dr. José Núñez" },
  ];
  assert.equal(referenteYaRegistrado(lista, "dra. laura mendez")?.id, "r1", "sin mayúsculas ni acentos");
  assert.equal(referenteYaRegistrado(lista, "  Dr.  José   Núñez ")?.id, "r2");
  assert.equal(referenteYaRegistrado(lista, "Dra. Laura"), null, "un nombre parecido NO es el mismo");
  assert.equal(referenteYaRegistrado(lista, ""), null);
  assert.equal(referenteYaRegistrado([], "Dra. Laura Méndez"), null);
  assert.match(CAJON, /const repetido = referenteYaRegistrado\(referringDoctors, referenteNuevo\.fullName\);/);
});

// ── Fila 32 (ws1-t4 ronda 6, decisión 2): el modo de cobro se elige al abrir el caso ──

test("el alta propone el modo de la clínica y deja elegir otro solo para este caso", () => {
  assert.match(pistaDelModoDelCaso("PRECIO_TOTAL", "PRECIO_TOTAL"), /como cobra tu clínica/);
  assert.match(pistaDelModoDelCaso("PAGO_POR_CONTROL", "PRECIO_TOTAL"), /solo para este caso/);
  for (const [a, b] of [["PRECIO_TOTAL", "PRECIO_TOTAL"], ["PAGO_POR_CONTROL", "PRECIO_TOTAL"]] as const) {
    assert.match(pistaDelModoDelCaso(a, b), /no se cambia con el caso abierto/);
  }
  assert.match(textosDelCosto("PAGO_POR_CONTROL").pista, /Este caso se cobra por control/);

  // El cajón manda el modo elegido, arrancando en el de la clínica.
  assert.match(CAJON, /setModoDeLaClinica\(res\.data\.billingMode\);/);
  assert.match(CAJON, /pistaDelModoDelCaso\(billingMode, modoDeLaClinica\)/);
  assert.match(CAJON, /\n\s+billingMode,\n/);

  // El servidor usa el del alta y, sin él, el de la clínica de la sesión.
  const accion = leer("src/app/actions/orthodontics/createTreatmentPlan.ts");
  assert.match(accion, /const billingModeDelCaso = parsed\.data\.billingMode \?\? clinicSettings\.billingMode;/);

  // Y un caso abierto no cambia de modo: la edición no lo acepta.
  const validacion = leer("src/lib/validation/orthodontics.ts");
  assert.match(validacion, /updateTreatmentPlanSchema = createTreatmentPlanSchema\.omit\(\{ billingMode: true(, planDetalle: true)? \}\)/);
});

// ── Sección H (ws1-t4 ronda 6): un solo nombre para cada cosa ──

test("el alta habla de «responsable» para el dinero y de «datos del caso», no de «tutor» ni «plan»", () => {
  assert.doesNotMatch(CAJON, />Tutor registrado</);
  assert.doesNotMatch(CAJON, /"Plan de tratamiento · "/);
  assert.match(CAJON, /titulo="Datos del caso"/);
  assert.match(CAJON, /placeholder="Nombre o teléfono del responsable"/);
  const ajustes = leer("src/components/specialties/orthodontics/redesign/drawers/DrawerCaseSettings.tsx");
  assert.doesNotMatch(ajustes, />Tutor registrado</);
  const cobro = leer("src/components/specialties/orthodontics/redesign/sections/SectionFinance.tsx");
  assert.doesNotMatch(cobro, /Saldo pendiente/);
  assert.match(cobro, /Por cobrar/);
});

// ── ws1-t10 (E): en «Pago por control» el costo es opcional ────────────────

test("costo opcional (Pago por control): vacío vale 0; escrito, tiene que valer; en Precio total sigue obligatorio", () => {
  assert.equal(costoDelAlta("", true), 0);
  assert.equal(costoDelAlta("   ", true), 0);
  assert.equal(costoDelAlta("15,000", true), 15000);
  assert.equal(costoDelAlta("abc", true), null, "si se escribe algo, no se acepta basura");
  assert.equal(costoDelAlta("0", true), null, "escrito, tampoco un cero");
  assert.equal(costoDelAlta("", false), null, "Precio total: el costo sigue haciendo falta");
  assert.equal(costoDelAlta("36000", false), 36000);

  const sinCosto = { ...COMPLETA, costoTotal: "" };
  assert.ok(faltantesDelAlta(sinCosto).some((f) => /costo/.test(f)), "Precio total: falta el costo");
  assert.deepEqual(faltantesDelAlta({ ...sinCosto, costoOpcional: true }), [], "Pago por control: se abre sin costo");
  assert.ok(faltantesDelAlta({ ...sinCosto, costoTotal: "abc", costoOpcional: true }).some((f) => /válido/.test(f)));
});

test("costo opcional en CUALQUIER modo (ws1-t12): la ventana guarda 0 si no hay costo y el servidor ya no lo exige al abrir", () => {
  const cajon = readFileSync(join(process.cwd(), "src/components/specialties/orthodontics/redesign/drawers/DrawerNewCase.tsx"), "utf8");
  assert.match(cajon, /const costoAGuardar = costoParaGuardar\(totalCost\);/);
  assert.match(cajon, /totalCostMxn: costoAGuardar,/);
  const accion = readFileSync(join(process.cwd(), "src/app/actions/orthodontics/createTreatmentPlan.ts"), "utf8");
  assert.doesNotMatch(accion, /El costo del tratamiento tiene que ser mayor que cero/, "abrir el caso solo exige técnica y doctor");
  const validacion = readFileSync(join(process.cwd(), "src/lib/validation/orthodontics.ts"), "utf8");
  assert.match(validacion, /updateTreatmentPlanSchema[\s\S]*?totalCostMxn: z\.number\(\)\.positive\(\)/, "la edición sigue exigiendo un costo mayor que cero");
});

// ── ws1-t10 (D) y (A): la vista «sin caso» avisa al instante; la clave del botón existe ──

test("la vista «sin caso» dice «Caso abierto» en cuanto el caso se abre, sin esperar la ficha", () => {
  const sinCaso = readFileSync(join(process.cwd(), "src/components/specialties/orthodontics/redesign/OrtodonciaSinCaso.tsx"), "utf8");
  assert.match(sinCaso, /const abierto = await onCreateCase\(payload\);\s*if \(abierto === true\) setCasoAbierto\(true\);/);
  const tab = readFileSync(join(process.cwd(), "src/components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx"), "utf8");
  assert.match(tab, /const crearCaso = async \(payload: DrawerNewCaseSubmit\): Promise<boolean>/);
});

test("billing.invoiceEditor.editButton existe en es y en en (salía la clave cruda en la ventana de la factura)", () => {
  for (const l of ["es", "en"]) {
    const d = JSON.parse(readFileSync(join(process.cwd(), `src/i18n/dictionaries/${l}.json`), "utf8"));
    assert.equal(typeof d.billing?.invoiceEditor?.editButton, "string", l);
  }
});
