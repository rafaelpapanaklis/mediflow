/**
 * LA FICHA COMPLETA DEL PACIENTE (Ola B · ws2-t3).
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-ficha-completa.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ CUBRE, Y POR QUÉ CADA COSA.
 *
 * El encargo de Rafael era «al abrir el perfil del paciente faltan muchos
 * datos y funciones reales que los dentistas necesitan». Lo que se añadió
 * son 22 columnas capturables, un PDF, una paginación y tres acciones. Lo
 * que se prueba aquí es lo que, si se rompe, no se ve:
 *
 *   1. EL CURP. Una regla de formato que rechaza de más es peor que una que
 *      acepta de menos: bloquea a alguien que está en el sillón.
 *   2. EL TUTOR POR EDAD. Un menor sin representante legal produce una
 *      carta de consentimiento que no vale. Pero bloquear CUALQUIER
 *      guardado de un menor sin tutor deja a recepción sin poder corregir
 *      un apellido — hay una línea fina y esto la fija.
 *   3. EL TRI-ESTADO NULL / DESCONOCIDO / NINGUNO. Es la distinción que
 *      evita el chip verde mentiroso, y se pierde en el DIFF: un campo que
 *      no cambió no puede viajar, porque viajaría como "nadie preguntó"
 *      encima de un dato bueno.
 *   4. LOS PERMISOS POR GRUPO. Tres grupos, dos llaves y cuatro roles: es
 *      donde un `||` de más abre la ficha entera a un alumno.
 *   5. LA PAGINACIÓN POR CURSOR. Que no salte filas ni las repita cuando
 *      alguien da de alta un paciente entre dos páginas — que es el bug
 *      que tendría un `skip`/`OFFSET` y la razón de que esto sea un cursor.
 *   6. EL CSV. El escape, y la neutralización de la celda que empieza por
 *      `=`, que Excel ejecutaría como fórmula.
 *
 * 🔴 CÓMO SE PRUEBA LO QUE NO TIENE BASE DE DATOS. No hay base de pruebas
 * en este repo, así que las funciones que hablan con Prisma no se pueden
 * EJECUTAR: lo que se hace —el patrón que ya usan edu-permissions.test.ts y
 * edu-pacientes-edicion.test.ts— es leer el FUENTE y fijar la
 * correspondencia entre las dos puntas. No sustituye a una prueba de
 * integración; es el candado que sí se puede poner hoy.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDU_PATIENT_CLINICAL_FIELDS,
  EDU_PATIENT_CONTACT_FIELDS,
  EDU_PATIENT_CSV_HEADERS,
  EDU_PATIENT_EDAD_MAYORIA,
  EDU_PATIENT_FIELD_GROUP,
  EDU_PATIENT_FORM_FIELDS,
  EDU_PATIENT_IDENTITY_FIELDS,
  EDU_PATIENT_PAGE_SIZE,
  eduCsvCell,
  eduCsvDate,
  eduCurpIsValid,
  eduCurpWarning,
  eduPatientCursorDecode,
  eduPatientCursorEncode,
  eduPatientFichaChips,
  eduPatientFieldGroupOf,
  eduPatientFormDiff,
  eduPatientFormValues,
  eduPatientTutorConflict,
  eduPatientTutorConflictOnSave,
  eduPatientsCsv,
  eduPatientsCsvFileName,
  normalizeEduCurp,
  parseEduContactPreference,
  parseEduHabitLevel,
  parseEduPregnancy,
  type EduPatientRow,
} from "../pacientes-core";
import { eduPatientSearchIndex } from "../search";
import { eduPatientEditAbilities, eduPatientEditGroups } from "../permissions";
import { EDU_CONSENT_EDAD_MAYORIA } from "../consentimientos-core";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const SERVIDOR = "src/lib/edu/pacientes.ts";
const CORE = "src/lib/edu/pacientes-core.ts";
const FORMULARIO = "src/components/edu/clinica/paciente-datos-form.tsx";
const LISTA = "src/components/edu/clinica/pacientes-screen.tsx";
const ACCIONES = "src/components/edu/expediente/paciente-acciones.tsx";
const CONSENT_SCREEN = "src/components/edu/expediente/consentimientos-screen.tsx";
const CONSENT_LIB = "src/lib/edu/consentimientos.ts";
const CONSENT_PDF = "src/lib/edu/consentimiento-pdf.tsx";
const CONSENT_PDF_ROUTE = "src/app/api/instituto/consentimientos/[id]/pdf/route.ts";
const CSV_ROUTE = "src/app/api/instituto/pacientes/exportar/route.ts";
const CITA_ROUTE = "src/app/api/instituto/pacientes/[id]/agenda/[citaId]/route.ts";
const AGENDA_LIB = "src/lib/edu/agenda.ts";
const AGENDA_TAB = "src/app/instituto/(panel)/pacientes/[id]/agenda/page.tsx";

/** Una fila cualquiera. Todo lo de la Ola B en null: es el estado de
 *  CUALQUIER paciente registrado antes, que es contra el que hay que
 *  probar. */
function paciente(over: Partial<EduPatientRow> = {}): EduPatientRow {
  return {
    id: "pac_1",
    folio: "P-0088",
    name: "María López",
    firstName: "María",
    lastName: "López",
    phone: "5544332211",
    email: "maria@example.com",
    birthDate: "1990-03-15T00:00:00.000Z",
    ageYears: 36,
    sex: "FEMALE",
    notes: null,
    status: "ACTIVE",
    origin: {
      studentId: null,
      studentName: null,
      studentMatricula: null,
      setByName: null,
      setAt: null,
    },
    antecedentes: {
      bloodType: null,
      allergies: [],
      chronicConditions: [],
      currentMedications: [],
      emergencyContactName: null,
      emergencyContactPhone: null,
      emergencyContactRelation: null,
      recordedAt: null,
      recordedByName: null,
    },
    openCases: 0,
    totalCases: 0,
    createdAt: "2026-01-10T12:00:00.000Z",
    curp: null,
    phone2: null,
    contactPreference: null,
    addressStreet: null,
    addressNeighborhood: null,
    addressCity: null,
    addressState: null,
    addressZip: null,
    guardianName: null,
    guardianRelation: null,
    guardianPhone: null,
    insuranceProvider: null,
    insurancePolicy: null,
    familyHistory: null,
    personalNonPathologicalHistory: null,
    habitsTobacco: null,
    habitsAlcohol: null,
    habitsBruxism: null,
    habitsNotes: null,
    pregnancy: null,
    isChild: false,
    privacyNoticeAcceptedAt: null,
    updatedAt: "2026-01-10T12:00:00.000Z",
    updatedByName: null,
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL CURP (NOM-024)
// ═══════════════════════════════════════════════════════════════════════

/** Un CURP real en forma: cuatro letras, AAMMDD, sexo, entidad, tres
 *  consonantes, homoclave y dígito. */
const CURP_OK = "ROGM850101MDFDMR07";

test("CURP · una clave con la forma oficial se acepta", () => {
  assert.equal(eduCurpIsValid(CURP_OK), true);
  // Y se acepta escrita como la teclea una persona: minúsculas y espacios.
  assert.equal(eduCurpIsValid(" rogm850101mdfdmr07 "), true);
  assert.equal(normalizeEduCurp(" rogm850101 mdfdmr07 "), CURP_OK);
  assert.equal(eduCurpWarning(CURP_OK), null);
});

test("CURP · lo que NO tiene la forma oficial se rechaza, y con motivo", () => {
  const malos: [string, string][] = [
    ["ROGM850101MDFDMR0", "17 caracteres: le falta el dígito verificador"],
    ["ROGM850101MDFDMR077", "19 caracteres"],
    ["RO9M850101MDFDMR07", "un dígito donde van las cuatro letras"],
    ["ROGM8501O1MDFDMR07", "una O donde va un cero en la fecha"],
    ["ROGM850101XDFDMR07", "el sexo tiene que ser H o M"],
    ["ROGM850101MDFDMR7A", "el último tiene que ser dígito"],
    ["ROGM850231MDFDMR07", "31 de febrero: no existe ese día"],
    ["ROGM851301MDFDMR07", "mes 13"],
    ["ROGM850101MZZDMR07", "ZZ no es una entidad federativa"],
  ];
  for (const [valor, porque] of malos) {
    assert.equal(eduCurpIsValid(valor), false, `debería rechazarse (${porque}): ${valor}`);
    assert.ok(eduCurpWarning(valor), `debería avisar de ${valor}`);
  }
});

test("CURP · el 29 de febrero pasa y el 30 no (la fecha se comprueba de verdad)", () => {
  assert.equal(eduCurpIsValid("ROGM000229MDFDMR07"), true);
  assert.equal(eduCurpIsValid("ROGM000230MDFDMR07"), false);
});

test("CURP · NE (nacido en el extranjero) es una entidad válida", () => {
  // Un paciente extranjero con CURP mexicano lleva NE en las posiciones
  // 12-13. Rechazarlo dejaría fuera justo a quien más papeleo trae.
  assert.equal(eduCurpIsValid("ROGM850101MNEDMR07"), true);
});

test("CURP · sin CURP no hay aviso (vacío no es lo mismo que malo)", () => {
  assert.equal(eduCurpWarning(null), null);
  assert.equal(eduCurpWarning(""), null);
  assert.equal(eduCurpWarning("   "), null);
  assert.equal(normalizeEduCurp(""), null);
  assert.equal(normalizeEduCurp(42), null);
});

test("CURP · la regla se escribe en edu y NO se importa del dental", () => {
  // El encargo lo pide con todas sus letras, y hay razón: traerla habría
  // atado la ficha del instituto a un archivo del producto dental, con su
  // `curpStatus` y su `passportNo` que aquí nadie pidió.
  const core = leer(CORE);
  assert.ok(!/from "@\/lib\/validators\/curp"/.test(core), "el CURP se importa del dental");
  assert.ok(!/lib\/patients/.test(core), "pacientes-core importa del dental");
  assert.ok(/EDU_CURP_RE/.test(core), "la expresión del CURP no vive en edu");
});

test("CURP · el servidor rebota el valor malo al guardar", () => {
  const fuente = leer(SERVIDOR);
  assert.ok(/eduCurpIsValid/.test(fuente), "updateEduPatient no valida el CURP");
  assert.ok(/EDU_CURP_HELP/.test(fuente), "el rechazo del CURP no lleva el motivo escrito");
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · EL TUTOR, OBLIGATORIO POR EDAD (H-08)
// ═══════════════════════════════════════════════════════════════════════

test("tutor · la mayoría de edad es la MISMA que la de los consentimientos", () => {
  // Dos números distintos serían una ficha que exige tutor a los 17 y un
  // servidor de cartas que lo exige a los 18, o al revés.
  assert.equal(EDU_PATIENT_EDAD_MAYORIA, EDU_CONSENT_EDAD_MAYORIA);
  assert.equal(EDU_PATIENT_EDAD_MAYORIA, 18);
});

test("tutor · un menor sin tutor produce el motivo; con tutor, no", () => {
  assert.ok(eduPatientTutorConflict({ ageYears: 9, guardianName: null }));
  assert.ok(eduPatientTutorConflict({ ageYears: 17, guardianName: "   " }));
  assert.equal(eduPatientTutorConflict({ ageYears: 9, guardianName: "Ana López" }), null);
  assert.equal(eduPatientTutorConflict({ ageYears: 18, guardianName: null }), null);
  assert.equal(eduPatientTutorConflict({ ageYears: 40, guardianName: null }), null);
});

test("tutor · SIN fecha de nacimiento no se bloquea nada", () => {
  // No se puede afirmar que alguien sea menor, y trancar la ficha de todo
  // paciente sin nacimiento —un dato que sigue siendo opcional— pararía la
  // clínica. Es la misma decisión que ya tomó el servidor de las cartas.
  assert.equal(eduPatientTutorConflict({ ageYears: null, guardianName: null }), null);
});

test("tutor · el motivo dice la EDAD y qué hacer, no «campo requerido»", () => {
  const m = eduPatientTutorConflict({ ageYears: 9, guardianName: null })!;
  assert.ok(m.includes("9 años"), "el motivo no dice la edad");
  assert.ok(/tutor|representante legal/i.test(m), "el motivo no dice qué falta");
  assert.ok(/parentesco/i.test(m), "el motivo no pide el parentesco");
});

test("tutor · un menor SIN tutor de antes no queda atrapado al corregirle el teléfono", () => {
  // 🔴 ES LA LÍNEA FINA DE TODO ESTO. En la base hay menores registrados
  // antes de que existiera la columna del tutor. Si el guardado se
  // bloqueara siempre, recepción no podría corregirles ni un apellido hasta
  // rellenar un dato que a lo mejor no tiene delante — y esa ficha se
  // quedaría congelada para siempre.
  const nino = paciente({ birthDate: "2018-05-05T00:00:00.000Z", ageYears: 8 });
  assert.equal(eduPatientTutorConflictOnSave(nino, { phone: "5511223344" }), null);
  assert.equal(eduPatientTutorConflictOnSave(nino, { lastName: "Pérez" }), null);
  assert.equal(eduPatientTutorConflictOnSave(nino, { pregnancy: null }), null);
});

test("tutor · pero SÍ muerde cuando el guardado toca el asunto", () => {
  const ahora = new Date("2026-09-07T00:00:00.000Z");
  const adulto = paciente();

  // (a) Poner un nacimiento que deja un menor sin tutor.
  assert.ok(
    eduPatientTutorConflictOnSave(adulto, { birthDate: "2018-05-05" }, ahora),
    "cambiar el nacimiento a un menor sin tutor tiene que rebotar",
  );

  // (b) …y si en el MISMO guardado se escribe el tutor, pasa.
  assert.equal(
    eduPatientTutorConflictOnSave(
      adulto,
      { birthDate: "2018-05-05", guardianName: "Ana López" },
      ahora,
    ),
    null,
  );

  // (c) Borrarle el tutor a un menor que ya lo tenía.
  const nino = paciente({
    birthDate: "2018-05-05T00:00:00.000Z",
    ageYears: 8,
    guardianName: "Ana López",
  });
  assert.ok(
    eduPatientTutorConflictOnSave(nino, { guardianName: null }, ahora),
    "borrar el tutor de un menor tiene que rebotar",
  );

  // (d) …y borrárselo a un ADULTO no molesta a nadie.
  assert.equal(eduPatientTutorConflictOnSave(adulto, { guardianName: null }, ahora), null);
});

test("tutor · el servidor aplica la MISMA función que la pantalla", () => {
  const fuente = leer(SERVIDOR);
  assert.ok(
    /eduPatientTutorConflict/.test(fuente),
    "el servidor no comprueba el tutor con el punto único",
  );
  const form = leer(FORMULARIO);
  assert.ok(
    /eduPatientTutorConflictOnSave/.test(form),
    "la pantalla no avisa antes de pulsar Guardar",
  );
});

test("tutor · la carta de consentimiento lo PRECARGA desde la ficha", () => {
  const screen = leer(CONSENT_SCREEN);
  assert.ok(
    /useState\(guardianName \?\? ""\)/.test(screen),
    "el representante legal de la carta no se siembra con el tutor de la ficha",
  );
  assert.ok(
    /useState\(guardianRelation \?\? ""\)/.test(screen),
    "el parentesco de la carta no se siembra con el de la ficha",
  );
  // Y sigue siendo EDITABLE: quien firma hoy puede no ser el tutor habitual.
  assert.ok(
    /setSignerName\(e\.target\.value\)/.test(screen),
    "el representante legal dejó de poder cambiarse en la carta",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL TRI-ESTADO NULL / DESCONOCIDO / NINGUNO EN EL DIFF DEL PATCH
//
// 🔴 ES LA DISTINCIÓN QUE EVITA MENTIR EN LA FICHA:
//   · null         = nadie preguntó       → la ficha dice «sin registrar»
//   · DESCONOCIDO  = se preguntó y no se sabe
//   · NO / NINGUNO = se preguntó, y la respuesta fue que no
// Aplastar las tres en una es exactamente el chip verde mentiroso que
// `historyRecordedAt` existe para no producir con los antecedentes.
// ═══════════════════════════════════════════════════════════════════════

test("tri-estado · los tres valores son DISTINTOS y los tres se pueden guardar", () => {
  const row = paciente();
  const base = eduPatientFormValues(row);

  // (a) «Sin registrar» → «No»: viaja "NO", que es una respuesta.
  assert.deepEqual(eduPatientFormDiff(row, { ...base, pregnancy: "NO" }), { pregnancy: "NO" });

  // (b) «Sin registrar» → «No lo sabe»: viaja DESCONOCIDO, que es OTRA cosa.
  assert.deepEqual(eduPatientFormDiff(row, { ...base, pregnancy: "DESCONOCIDO" }), {
    pregnancy: "DESCONOCIDO",
  });

  // (c) Y volver a «Sin registrar» viaja como null EXPLÍCITO: la persona
  //     está diciendo "esto no se preguntó", y eso se guarda.
  const conDato = paciente({ pregnancy: "NO" });
  assert.deepEqual(
    eduPatientFormDiff(conDato, { ...eduPatientFormValues(conDato), pregnancy: "" }),
    { pregnancy: null },
  );
});

test("tri-estado · un campo que NO cambió no viaja (y por eso no se borra)", () => {
  // 🔴 EL CASO QUE IMPORTA. Con 31 campos, un PATCH completo borraría el
  // embarazo que otra persona acaba de capturar. Solo viaja el diff.
  const row = paciente({ pregnancy: "EMBARAZO", habitsTobacco: "FRECUENTE" });
  const base = eduPatientFormValues(row);
  const diff = eduPatientFormDiff(row, { ...base, phone: "5599887766" });
  assert.deepEqual(diff, { phone: "5599887766" });
  assert.equal("pregnancy" in diff, false, "el embarazo viajó sin haber cambiado");
  assert.equal("habitsTobacco" in diff, false, "el tabaco viajó sin haber cambiado");
});

test("tri-estado · NINGUNO de la preferencia de contacto NO es «sin registrar»", () => {
  // `NINGUNO` = "dijo que no quiere que le escriban", y eso se respeta.
  // `null` = nadie se lo preguntó. El desplegable tiene las dos cosas.
  const row = paciente();
  const base = eduPatientFormValues(row);
  assert.deepEqual(eduPatientFormDiff(row, { ...base, contactPreference: "NINGUNO" }), {
    contactPreference: "NINGUNO",
  });
  assert.equal(parseEduContactPreference("NINGUNO"), "NINGUNO");
  assert.equal(parseEduContactPreference(""), null);
});

test("tri-estado · los parsers rechazan lo que no reconocen (no lo convierten en null)", () => {
  // 🔴 Un parser que devolviera null para la basura estaría escribiendo
  // "nadie preguntó" encima de un dato bueno cada vez que llegara un valor
  // mal escrito. Devuelven null y el servidor lo distingue de "no vino".
  assert.equal(parseEduPregnancy("SI"), null);
  assert.equal(parseEduPregnancy("embarazo"), null, "los enums van en MAYÚSCULAS");
  assert.equal(parseEduHabitLevel("MUCHO"), null);
  assert.equal(parseEduContactPreference("SMS"), null);
  const fuente = leer(SERVIDOR);
  assert.ok(
    /Ese valor de \$\{que\} no existe/.test(fuente),
    "el servidor no rebota el valor de enum que no reconoce",
  );
});

test("tri-estado · `isChild` no tiene «sin registrar»: su columna es NOT NULL", () => {
  const row = paciente();
  const base = eduPatientFormValues(row);
  assert.equal(base.isChild, "false");
  assert.deepEqual(eduPatientFormDiff(row, { ...base, isChild: "true" }), { isChild: "true" });
  // Y vaciarlo no lo pone a null: no hay null que poner.
  assert.deepEqual(eduPatientFormDiff(paciente({ isChild: true }), {
    ...eduPatientFormValues(paciente({ isChild: true })),
    isChild: "false",
  }), { isChild: "false" });
});

test("tri-estado · la pantalla dice «Sin registrar» y no «Ninguno»", () => {
  const form = leer(FORMULARIO);
  assert.ok(
    /<option value="">Sin registrar<\/option>/.test(form),
    "la opción vacía de los enums no dice «Sin registrar»",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · LOS PERMISOS, GRUPO POR GRUPO Y ROL POR ROL
// ═══════════════════════════════════════════════════════════════════════

test("permisos · los 31 campos tienen grupo, y son solo tres", () => {
  for (const campo of EDU_PATIENT_FORM_FIELDS) {
    const g = EDU_PATIENT_FIELD_GROUP[campo];
    assert.ok(
      g === "identidad" || g === "contacto" || g === "clinico",
      `el campo ${campo} no tiene un grupo válido`,
    );
    assert.equal(eduPatientFieldGroupOf(campo), g);
  }
  // Los tres grupos juntos SON los 31 campos: ni uno suelto, ni uno doble.
  assert.equal(
    EDU_PATIENT_IDENTITY_FIELDS.length +
      EDU_PATIENT_CONTACT_FIELDS.length +
      EDU_PATIENT_CLINICAL_FIELDS.length,
    EDU_PATIENT_FORM_FIELDS.length,
  );
  // Y una clave inventada no tiene grupo (no se cuela por el body).
  assert.equal(eduPatientFieldGroupOf("institutionId"), null);
  assert.equal(eduPatientFieldGroupOf("updatedById"), null);
});

test("permisos · los CLÍNICOS son los cuatro bloques que pidió el encargo", () => {
  assert.deepEqual(
    [...EDU_PATIENT_CLINICAL_FIELDS],
    [
      "familyHistory",
      "personalNonPathologicalHistory",
      "habitsTobacco",
      "habitsAlcohol",
      "habitsBruxism",
      "habitsNotes",
      "pregnancy",
      "isChild",
    ],
  );
});

test("permisos · el TUTOR, el DOMICILIO, el SEGURO y el AVISO son de recepción", () => {
  for (const campo of [
    "guardianName",
    "guardianRelation",
    "guardianPhone",
    "addressStreet",
    "addressZip",
    "insuranceProvider",
    "insurancePolicy",
    "privacyNoticeAcceptedAt",
    "curp",
  ] as const) {
    assert.equal(
      EDU_PATIENT_FIELD_GROUP[campo],
      "identidad",
      `${campo} tendría que ir con pacientes.manage`,
    );
  }
});

test("permisos · CAJA abre identidad y contacto y clínico; no le falta ninguno", () => {
  // Caja lleva `pacientes.manage`, que abre los tres grupos: es quien
  // captura los antecedentes en el mostrador desde la ola de Casos.
  const a = eduPatientEditAbilities({ role: "CAJA", permissionsOverride: null });
  assert.equal(a.manage, true);
  assert.equal(a.contacto, true);
  assert.equal(a.clinico, true);
  assert.deepEqual(eduPatientEditGroups(a), ["identidad", "contacto", "clinico"]);
});

test("permisos · ALUMNO y DOCENTE abren contacto y clínico, NUNCA identidad", () => {
  for (const role of ["ALUMNO", "DOCENTE"] as const) {
    const a = eduPatientEditAbilities({ role, permissionsOverride: null });
    assert.equal(a.manage, false, `${role} no puede corregir la identidad`);
    assert.equal(a.contacto, true, `${role} tiene que poder corregir el contacto`);
    assert.equal(a.clinico, true, `${role} tiene que poder escribir los antecedentes`);
    assert.deepEqual(eduPatientEditGroups(a), ["contacto", "clinico"]);
  }
});

test("permisos · DIRECCION abre los tres", () => {
  const a = eduPatientEditAbilities({ role: "DIRECCION", permissionsOverride: null });
  assert.deepEqual(eduPatientEditGroups(a), ["identidad", "contacto", "clinico"]);
});

test("permisos · quien no lleva ninguna de las dos llaves no abre ni un grupo", () => {
  // El override REEMPLAZA al default: una cuenta con solo "pacientes.view"
  // ve la ficha entera y no toca ni un campo.
  const a = eduPatientEditAbilities({ role: "ALUMNO", permissionsOverride: ["pacientes.view"] });
  assert.equal(a.manage, false);
  assert.equal(a.contacto, false);
  assert.equal(a.clinico, false);
  assert.deepEqual(eduPatientEditGroups(a), []);
});

test("permisos · NINGUNA key nueva (el override sin backfill no le llega a nadie)", () => {
  // Se mira el CATÁLOGO (`"clave": "descripción"`), no el archivo entero:
  // los comentarios nombran `pacientes.contacto` justo para explicar por
  // qué NO se creó, y buscar la cadena suelta encontraría esa explicación.
  const perms = leer("src/lib/edu/permissions.ts");
  for (const inventada of [
    "pacientes.contacto",
    "pacientes.tutor",
    "pacientes.clinico",
    "ficha.write",
  ]) {
    assert.ok(
      !new RegExp(`"${inventada.replace(".", "\\.")}":`).test(perms),
      `se inventó la key ${inventada}`,
    );
  }
});

test("permisos · el formulario deshabilita CON MOTIVO, no esconde", () => {
  const form = leer(FORMULARIO);
  // Tres motivos, uno por grupo: un campo gris y mudo se lee como una
  // pantalla rota.
  assert.ok(/motivoIdentidad/.test(form));
  assert.ok(/motivoContacto/.test(form));
  assert.ok(/motivoClinico/.test(form));
  assert.ok(
    /disabled=\{!canClinico\}/.test(form),
    "los campos clínicos no miran la llave clínica",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · LA PAGINACIÓN POR CURSOR (H-06)
// ═══════════════════════════════════════════════════════════════════════

test("cursor · se codifica y se decodifica sin perder nada", () => {
  const c = eduPatientCursorEncode({ createdAt: "2026-01-10T12:00:00.000Z", id: "pac_1" });
  assert.equal(c, "2026-01-10T12:00:00.000Z|pac_1");
  const d = eduPatientCursorDecode(c)!;
  assert.equal(d.id, "pac_1");
  assert.equal(d.createdAt.toISOString(), "2026-01-10T12:00:00.000Z");
});

test("cursor · uno inventado devuelve null (y la lista arranca de la primera página)", () => {
  // Nunca puede reventar la consulta: lo que se lee de la URL lo escribe
  // cualquiera.
  for (const basura of [
    null,
    42,
    "",
    "|",
    "|pac_1",
    "no-es-fecha|pac_1",
    "2026-01-10T12:00:00.000Z|",
    "2026-01-10T12:00:00.000Z|pac 1",
    `2026-01-10T12:00:00.000Z|${"x".repeat(60)}`,
  ]) {
    assert.equal(eduPatientCursorDecode(basura), null, `debería rechazar ${String(basura)}`);
  }
});

test("cursor · un id con guion bajo o guion sí es válido (los cuid y los de prueba)", () => {
  assert.ok(eduPatientCursorDecode("2026-01-10T12:00:00.000Z|ckla-9_x"));
});

/**
 * ── LA PRUEBA QUE IMPORTA: RECORRER LA LISTA ENTERA SIN SALTOS NI REPETIDOS
 *
 * No hay base de datos, así que se simula EN MEMORIA la condición que el
 * `where` expresa en Prisma —"estrictamente después de esta fila, en el
 * orden (createdAt desc, id desc)"— y se recorre el conjunto entero. Si la
 * condición y el `orderBy` se separaran (o faltara el desempate por `id`),
 * este recorrido saltaría o repetiría filas.
 */
function despuesDe(
  fila: { createdAt: string; id: string },
  cursor: { createdAt: Date; id: string },
): boolean {
  const t = new Date(fila.createdAt).getTime();
  const c = cursor.createdAt.getTime();
  if (t !== c) return t < c;
  return fila.id < cursor.id;
}

function ordenar<T extends { createdAt: string; id: string }>(filas: T[]): T[] {
  return [...filas].sort((a, b) => {
    const d = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return d !== 0 ? d : (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  });
}

function recorrer(
  filas: { createdAt: string; id: string }[],
  take: number,
): { paginas: string[][]; vistos: string[] } {
  const paginas: string[][] = [];
  const vistos: string[] = [];
  let cursor: { createdAt: Date; id: string } | null = null;
  for (let vuelta = 0; vuelta < 50; vuelta++) {
    const candidatas = ordenar(filas.filter((f) => (cursor ? despuesDe(f, cursor) : true)));
    const pagina = candidatas.slice(0, take);
    if (pagina.length === 0) break;
    paginas.push(pagina.map((f) => f.id));
    vistos.push(...pagina.map((f) => f.id));
    const hayMas = candidatas.length > take;
    if (!hayMas) break;
    const ultima = pagina[pagina.length - 1];
    cursor = eduPatientCursorDecode(eduPatientCursorEncode(ultima));
  }
  return { paginas, vistos };
}

test("cursor · recorre las 137 filas en páginas, sin saltos y sin repetidos", () => {
  const filas = Array.from({ length: 137 }, (_, i) => ({
    id: `pac_${String(i).padStart(3, "0")}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  }));
  const { vistos } = recorrer(filas, 20);
  assert.equal(vistos.length, 137, "se saltaron o se repitieron filas");
  assert.equal(new Set(vistos).size, 137, "hay filas repetidas entre páginas");
  assert.deepEqual(vistos, ordenar(filas).map((f) => f.id), "el orden no es estable");
});

test("cursor · con createdAt REPETIDO (una importación) tampoco salta ni repite", () => {
  // 🔴 ES EL CASO QUE OBLIGA AL DESEMPATE POR `id`. `createdAt` no es único:
  // una importación mete cincuenta filas con el mismo instante. Sin el
  // segundo criterio, Postgres las ordena de forma arbitraria entre dos
  // consultas y el cursor se salta una — en silencio.
  const mismo = new Date(Date.UTC(2026, 0, 1, 8, 0, 0)).toISOString();
  const filas = Array.from({ length: 50 }, (_, i) => ({
    id: `imp_${String(i).padStart(3, "0")}`,
    createdAt: mismo,
  }));
  const { vistos } = recorrer(filas, 7);
  assert.equal(vistos.length, 50);
  assert.equal(new Set(vistos).size, 50, "el desempate por id no está haciendo su trabajo");
});

test("cursor · un ALTA entre dos páginas no repite ni esconde a nadie", () => {
  // Con `skip`/`OFFSET` esto es el bug: la fila nueva empuja a otra hacia
  // abajo y esa otra sale dos veces (o se salta). Con cursor, lo que ya
  // pasó no vuelve — el paciente nuevo aparece arriba, en la página 1, que
  // ya se sirvió: se ve al recargar, que es lo correcto.
  const filas = Array.from({ length: 30 }, (_, i) => ({
    id: `pac_${String(i).padStart(3, "0")}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  }));
  const primera = ordenar(filas).slice(0, 10);
  const cursor = eduPatientCursorDecode(
    eduPatientCursorEncode(primera[primera.length - 1]),
  )!;

  // Alguien registra un paciente MIENTRAS recepción mira la página 1.
  filas.push({ id: "pac_nuevo", createdAt: new Date(Date.UTC(2026, 0, 1, 9, 0, 0)).toISOString() });

  const segunda = ordenar(filas.filter((f) => despuesDe(f, cursor))).slice(0, 10);
  const ids = [...primera.map((f) => f.id), ...segunda.map((f) => f.id)];
  assert.equal(new Set(ids).size, ids.length, "una fila salió dos veces");
  assert.equal(segunda.includes("pac_nuevo" as never), false, "el alta nueva se coló hacia atrás");
});

test("cursor · la página son 50 y el servidor acota lo que se le pida", () => {
  assert.equal(EDU_PATIENT_PAGE_SIZE, 50);
  const fuente = leer(SERVIDOR);
  assert.ok(
    /Math\.min\(Math\.floor\(pedido\), EDU_CLINICA_MAX_ROWS\)/.test(fuente),
    "un `take` de la query string podría pedir la tabla entera",
  );
  assert.ok(
    /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/.test(fuente),
    "el orden de la lista no lleva desempate por id",
  );
});

test("cursor · el tope de 300 sin salida desapareció de la lista", () => {
  const lista = leer(LISTA);
  // La frase INTERPOLADA, no la que el comentario cita para explicar qué
  // había antes: `se muestran los primeros ${maxRows}`.
  assert.ok(
    !/se muestran los primeros \$\{/.test(lista),
    "la lista sigue diciendo «se muestran los primeros N» sin ofrecer siguiente",
  );
  assert.ok(/Ver más pacientes/.test(lista), "no hay «Ver más»");
});

test("cursor · el desplegable de agendar busca por texto en el SERVIDOR", () => {
  const fuente = leer(SERVIDOR);
  const i = fuente.indexOf("export async function listEduPatientOptions");
  assert.ok(i > 0, "no existe listEduPatientOptions");
  const cuerpo = fuente.slice(i, i + 2200);
  assert.ok(/eduPatientSearchAnd\(q\)/.test(cuerpo), "el desplegable no filtra en Postgres");
  assert.ok(/options: \{ q\?: unknown/.test(cuerpo), "el desplegable no acepta texto");
});

// ═══════════════════════════════════════════════════════════════════════
// 6 · EL BUSCADOR APRENDE CURP Y SEGUNDO TELÉFONO
// ═══════════════════════════════════════════════════════════════════════

test("searchIndex · el CURP y el segundo teléfono entran al índice", () => {
  const indice = eduPatientSearchIndex({
    folio: "P-0088",
    curp: CURP_OK,
    firstName: "María",
    lastName: "López",
    phone: "5544332211",
    phone2: "+52 55 9988 7766",
    email: "maria@example.com",
  });
  assert.ok(indice.includes(CURP_OK.toLowerCase()), "el CURP no entró al índice");
  assert.ok(indice.includes("5599887766"), "el segundo teléfono no entró al índice");
  // Y el CURP va ANTES del correo, para que el recorte a 400 no se lo lleve.
  assert.ok(
    indice.indexOf("rogm850101") < indice.indexOf("maria@example.com"),
    "el CURP va después del correo y podría caer en el recorte",
  );
});

test("searchIndex · el servidor lo reescribe cuando cambia el CURP o el teléfono 2", () => {
  const fuente = leer(SERVIDOR);
  const i = fuente.indexOf("const tocaIndice");
  assert.ok(i > 0);
  const linea = fuente.slice(i, i + 220);
  for (const col of ["folio", "curp", "firstName", "lastName", "phone", "phone2", "email"]) {
    assert.ok(linea.includes(`"${col}"`), `el índice no se rehace al cambiar ${col}`);
  }
});

test("searchIndex · sin backfill, y está dicho en el código", () => {
  // Los pacientes viejos se reindexan al editarlos. Es una consecuencia
  // real y tiene que estar escrita donde alguien la vaya a leer.
  const search = leer("src/lib/edu/search.ts");
  assert.ok(/backfill/i.test(search), "search.ts no advierte de que no hay backfill");
});

// ═══════════════════════════════════════════════════════════════════════
// 7 · EL RASTRO DE QUIÉN CORRIGIÓ (H-12b)
// ═══════════════════════════════════════════════════════════════════════

test("updatedById · se escribe en las TRES escrituras del paciente", () => {
  // Si solo estuviera en `updateEduPatient`, un guardado de antecedentes
  // movería `updatedAt` (Prisma, @updatedAt) y dejaría `updatedById`
  // apuntando al de la corrección anterior: la ficha diría "lo corrigió
  // Fulano" con la fecha de lo que hizo Mengana.
  const fuente = leer(SERVIDOR);
  assert.equal(
    (fuente.match(/updatedById\s*[:=]\s*ctx\.eduUserId/g) ?? []).length,
    3,
    "updatedById no se escribe en las tres escrituras (ficha, antecedentes y origen)",
  );
});

test("updatedById · NO es un campo del formulario (un rastro que el cliente manda no es un rastro)", () => {
  assert.equal((EDU_PATIENT_FORM_FIELDS as readonly string[]).includes("updatedById"), false);
});

test("updatedById · la pestaña Datos pinta «Última corrección»", () => {
  const form = leer(FORMULARIO);
  assert.ok(/Última corrección/.test(form), "no se pinta quién corrigió la ficha");
  assert.ok(/row\.updatedByName/.test(form), "no se pinta QUIÉN");
  // El CUÁNDO llega ya formateado del servidor con la zona del instituto
  // (`updatedAt` es un instante, no una fecha de calendario): ver la prueba
  // «rastro ·» más abajo.
  assert.ok(/rastroLabel/.test(form), "no se pinta CUÁNDO");
  const pagina = leer("src/app/instituto/(panel)/pacientes/[id]/datos/page.tsx");
  assert.ok(/p\.updatedAt/.test(pagina), "el sello no sale de la fila del paciente");
});

// ═══════════════════════════════════════════════════════════════════════
// 8 · EL CSV
// ═══════════════════════════════════════════════════════════════════════

test("CSV · una celda con coma, comillas o salto de línea no parte la fila", () => {
  assert.equal(eduCsvCell("Pérez, María"), '"Pérez, María"');
  assert.equal(eduCsvCell('dijo "hola"'), '"dijo ""hola"""');
  assert.equal(eduCsvCell("dos\nrenglones"), '"dos renglones"');
  assert.equal(eduCsvCell(null), '""');
  assert.equal(eduCsvCell(0), '"0"');
});

test("CSV · la celda que empieza por = + - @ se neutraliza (Excel la ejecutaría)", () => {
  // 🔴 No es teoría: una nota de recepción que empiece por "=" es una
  // fórmula en cuanto alguien abre el archivo en el equipo de recepción.
  for (const veneno of ["=1+1", "+SUM(A1)", "-2+3", "@SUM(A1)"]) {
    assert.equal(eduCsvCell(veneno), `"'${veneno}"`, `no se neutralizó ${veneno}`);
  }
  // Y un texto normal no se ensucia con el apóstrofo.
  assert.equal(eduCsvCell("Consulta"), '"Consulta"');
});

test("CSV · las fechas salen AAAA-MM-DD (una hoja de cálculo las ordena)", () => {
  assert.equal(eduCsvDate("1990-03-15T00:00:00.000Z"), "1990-03-15");
  assert.equal(eduCsvDate(null), "");
  assert.equal(eduCsvDate("no es fecha"), "");
});

test("CSV · la cabecera y cada fila tienen el MISMO número de columnas", () => {
  const csv = eduPatientsCsv([paciente({ curp: CURP_OK, guardianName: 'Ana "La" López' })]);
  const [cabecera, fila] = csv.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(cabecera.split('","').length, EDU_PATIENT_CSV_HEADERS.length);
  assert.equal(fila.split('","').length, EDU_PATIENT_CSV_HEADERS.length);
});

test("CSV · lleva BOM (sin él, Excel en Windows abre «Pérez» como «PÃ©rez»)", () => {
  assert.ok(eduPatientsCsv([paciente()]).startsWith("﻿"));
});

test("CSV · NO exporta la historia clínica", () => {
  // Un CSV se manda por correo y se queda abierto en un escritorio. Lo que
  // sale es el padrón administrativo, no los antecedentes.
  const csv = eduPatientsCsv([
    paciente({ pregnancy: "EMBARAZO", familyHistory: "Diabetes materna", habitsTobacco: "FRECUENTE" }),
  ]);
  assert.ok(!csv.includes("EMBARAZO"));
  assert.ok(!csv.includes("Diabetes materna"));
  assert.ok(!csv.includes("FRECUENTE"));
  const cabecera = (EDU_PATIENT_CSV_HEADERS as readonly string[]).join("|");
  for (const prohibida of ["Embarazo", "Heredofamiliares", "Tabaco", "Alergias"]) {
    assert.ok(!cabecera.includes(prohibida), `el CSV exporta ${prohibida}`);
  }
});

test("CSV · el nombre del archivo lleva la fecha", () => {
  assert.equal(
    eduPatientsCsvFileName(new Date("2026-09-07T10:00:00.000Z")),
    "pacientes-2026-09-07.csv",
  );
});

test("CSV · el endpoint rehace la MISMA consulta que la lista", () => {
  const ruta = leer(CSV_ROUTE);
  assert.ok(/parseEduPatientFilters/.test(ruta), "el CSV no aplica los mismos filtros");
  assert.ok(/listEduPatientsForCsv/.test(ruta));
  assert.ok(/pacientes\.view/.test(ruta), "el CSV no exige el permiso de ver pacientes");
  // Y avisa cuando se corta.
  assert.ok(/X-Edu-Truncado/.test(ruta));
  const fuente = leer(SERVIDOR);
  const i = fuente.indexOf("export async function listEduPatientsForCsv");
  assert.ok(/patientsWhere\(ctx, filters, now\)/.test(fuente.slice(i, i + 900)),
    "el CSV arma su propio where en vez de reusar el de la lista");
});

// ═══════════════════════════════════════════════════════════════════════
// 9 · EL PDF DE LA CARTA (H-12)
// ═══════════════════════════════════════════════════════════════════════

test("PDF · usa el MISMO motor que la receta y no consulta la base", () => {
  const pdf = leer(CONSENT_PDF);
  assert.ok(/@react-pdf\/renderer/.test(pdf), "no usa el motor de la receta");
  assert.ok(/renderToBuffer/.test(pdf));
  assert.ok(!/from "@\/lib\/prisma"/.test(pdf), "el documento consulta la base");
  assert.ok(!/prisma\./.test(pdf), "el documento consulta la base");
});

test("PDF · lleva el texto firmado, la fecha, los firmantes y las CINCO firmas", () => {
  const lib = leer(CONSENT_LIB);
  const i = lib.indexOf("export async function getEduConsentPdfData");
  assert.ok(i > 0, "no existe getEduConsentPdfData");
  const cuerpo = lib.slice(i);
  for (const slot of [
    "c.signatureUrl",
    "c.witness1SignatureUrl",
    "c.witness2SignatureUrl",
    "c.studentSignatureUrl",
    "c.supervisorSignatureUrl",
  ]) {
    assert.ok(cuerpo.includes(slot), `el PDF no trae ${slot}`);
  }
  const pdf = leer(CONSENT_PDF);
  assert.ok(/data\.content/.test(pdf), "el PDF no pinta el texto firmado");
  assert.ok(/data\.signedLabel/.test(pdf), "el PDF no pinta la fecha de firma");
  assert.ok(/data\.signerName/.test(pdf), "el PDF no dice quién otorgó el consentimiento");
  assert.ok(/<Image/.test(pdf), "el PDF no incrusta las imágenes de firma");
});

test("PDF · la huella se RECALCULA y el pie dice si cuadró", () => {
  const lib = leer(CONSENT_LIB);
  const cuerpo = lib.slice(lib.indexOf("export async function getEduConsentPdfData"));
  assert.ok(
    /eduConsentHash\(c\.procedure, c\.content\) === c\.contentHash/.test(cuerpo),
    "la integridad se lee de una columna en vez de recalcularse",
  );
  const pdf = leer(CONSENT_PDF);
  assert.ok(/INTEGRIDAD ALTERADA/.test(pdf), "un PDF alterado no se desmiente a sí mismo");
  assert.ok(/Integridad verificada/.test(pdf));
  assert.ok(/pieIntegridad/.test(pdf), "no hay pie de integridad");
});

test("PDF · el GATE: sin firma del paciente no hay papel", () => {
  const lib = leer(CONSENT_LIB);
  const cuerpo = lib.slice(lib.indexOf("export async function getEduConsentPdfData"));
  assert.ok(/if \(!c\.signedAt\) \{/.test(cuerpo), "el PDF sale de una carta sin firmar");
  assert.ok(/409/.test(cuerpo), "el gate no contesta 409 con el porqué");
  // La revocada que SÍ se firmó sale, marcada: el papel ya salió una vez y
  // la constancia de que se retiró es la mitad de revocar.
  assert.ok(/CONSENTIMIENTO REVOCADO/.test(leer(CONSENT_PDF)));
});

test("PDF · el alcance es el del PACIENTE (recepción entrega la carta)", () => {
  const lib = leer(CONSENT_LIB);
  const cuerpo = lib.slice(lib.indexOf("export async function getEduConsentPdfData"));
  assert.ok(
    /eduVisibility\(ctx, "patients"\)/.test(cuerpo),
    "el PDF usa un alcance distinto al de la pestaña",
  );
  assert.ok(
    /patient: eduPatientScopeWhere/.test(cuerpo),
    "la carta no se cruza con el alcance del paciente dentro del where",
  );
});

test("PDF · la ruta exige la MISMA llave que abre la pestaña, y ninguna nueva", () => {
  const ruta = leer(CONSENT_PDF_ROUTE);
  assert.ok(/eduApiGuard\("consentimientos\.view"\)/.test(ruta));
  assert.ok(/application\/pdf/.test(ruta));
  assert.ok(/no-store/.test(ruta), "el PDF de un paciente no puede cachearse en un proxy");
});

test("PDF · la pantalla ofrece el botón junto al texto firmado", () => {
  const screen = leer(CONSENT_SCREEN);
  assert.ok(
    /\/api\/instituto\/consentimientos\/\$\{c\.id\}\/pdf/.test(screen),
    "no hay botón de PDF en la fila de la carta",
  );
  assert.ok(
    !/el PDF con las\s+firmas incrustadas todavía no existe/.test(screen),
    "la pantalla sigue diciendo que el PDF no existe",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 10 · LAS ACCIONES DESDE LA FICHA
// ═══════════════════════════════════════════════════════════════════════

test("cancelar cita · la regla de estado NO se duplica", () => {
  const ruta = leer(CITA_ROUTE);
  assert.ok(
    /setEduAppointmentStatus/.test(ruta),
    "la ruta reimplementa el cambio de estado en vez de llamar a agenda.ts",
  );
  assert.ok(
    !/eduAppointmentCanTransition/.test(ruta),
    "la ruta copió la tabla de transiciones",
  );
  // Y la cita tiene que ser DE ESTE PACIENTE: el id de la URL no es adorno.
  assert.ok(
    /cita\.patientId !== params\.id/.test(ruta),
    "se puede cancelar la cita de otro paciente desde esta ficha",
  );
});

test("cancelar cita · exige agenda.manage y guarda el motivo", () => {
  const ruta = leer(CITA_ROUTE);
  assert.ok(/agenda\.manage/.test(ruta), "cancelar no pide agenda.manage");
  assert.ok(/reason: body\.reason/.test(ruta), "el motivo no llega a la capa de datos");

  const agenda = leer(AGENDA_LIB);
  assert.ok(/options\.reason/.test(agenda), "setEduAppointmentStatus ignora el motivo");
  // El motivo NO pisa las notas que ya había.
  assert.ok(
    /current\.notes \? `\$\{current\.notes\} \$\{marca\}` : marca/.test(agenda),
    "el motivo pisa las notas de la cita en vez de añadirse",
  );
  // Y el recorte conserva el motivo recién escrito, no lo tira.
  assert.ok(
    /junto\.slice\(junto\.length - 999\)/.test(agenda),
    "el recorte a 1000 tira el motivo recién escrito en vez del texto viejo",
  );

  // La pantalla lo exige aunque el servidor lo acepte vacío (la agenda
  // general lleva años cancelando sin motivo y romperla no era el encargo).
  const acciones = leer(ACCIONES);
  assert.ok(/disabled=\{busy \|\| !reason\.trim\(\)\}/.test(acciones));
  const tab = leer(AGENDA_TAB);
  assert.ok(/EduCitaCancelar/.test(tab), "la pestaña Agenda no ofrece cancelar");
});

test("cobrar · llama al endpoint de caja y no reimplementa el recibo", () => {
  const acciones = leer(ACCIONES);
  assert.ok(/\/api\/instituto\/caja\/cobros/.test(acciones), "el cobro no pega a la caja");
  assert.ok(!/eduChargeTotals|nextEduChargeFolio|EduPayment\b/.test(acciones),
    "el modal reimplementa lógica de recibos");
  // Idempotencia: una por modal, no una por envío.
  assert.ok(/idempotencyKey/.test(acciones), "el cobro puede duplicarse con un doble clic");
  assert.ok(
    /const \[idempotencyKey\] = useState\(/.test(acciones),
    "la clave de idempotencia se regenera en cada envío y deja de servir",
  );
});

test("imprimir · el botón lleva al RESUMEN y no imprime la pestaña abierta", () => {
  const acciones = leer(ACCIONES);
  assert.ok(/window\.print\(\)/.test(acciones));
  assert.ok(/\?imprimir=1/.test(acciones), "imprimiría la pestaña en la que estés");
  // Y no IMPORTA useSearchParams: obligaría a un <Suspense> en un layout de
  // servidor que no lo tiene, y el build fallaría por un parámetro que solo
  // se usa una vez. (Se mira el import, no la palabra suelta: el comentario
  // del componente la nombra para explicar por qué no se usa.)
  const imports = acciones.slice(0, acciones.indexOf("/**"));
  assert.ok(!/useSearchParams/.test(imports), "el componente importa useSearchParams");

  const css = leer("src/app/instituto/edu-theme.css");
  assert.ok(/\.edu-acciones-ficha,/.test(css), "la hoja impresa no apaga los botones");
  assert.ok(/\.edu-tabsbar,/.test(css), "la hoja impresa no apaga las pestañas");
});

test("la fila de la lista lleva el chip del teléfono que no sirve para WhatsApp", () => {
  const lista = leer(LISTA);
  assert.ok(/eduPhoneWaWarning\(p\.phone\)/.test(lista), "el chip no está en la fila");
  assert.ok(/edu-tablewrap/.test(lista), "la lista perdió el envoltorio de scroll");
});

// ═══════════════════════════════════════════════════════════════════════
// 11 · LOS CHIPS DE LA CABECERA, LISTOS PARA MONTAR
// ═══════════════════════════════════════════════════════════════════════

test("chips · un menor CON tutor sale en azul y con el nombre", () => {
  const chips = eduPatientFichaChips({
    ageYears: 9,
    guardianName: "Ana López",
    guardianRelation: "Madre",
    pregnancy: null,
    isChild: true,
  });
  assert.equal(chips.length, 1);
  assert.equal(chips[0].kind, "menor");
  assert.equal(chips[0].tone, "info");
  assert.ok(chips[0].text.includes("Ana López"));
});

test("chips · un menor SIN tutor sale en ámbar (es una tarea pendiente)", () => {
  const chips = eduPatientFichaChips({
    ageYears: 9,
    guardianName: null,
    guardianRelation: null,
    pregnancy: null,
    isChild: false,
  });
  assert.equal(chips[0].tone, "warn");
  assert.ok(/sin tutor/i.test(chips[0].text));
});

test("chips · `pregnancy` null NO pinta nada (nadie preguntó ≠ no está embarazada)", () => {
  const chips = eduPatientFichaChips({
    ageYears: 30,
    guardianName: null,
    guardianRelation: null,
    pregnancy: null,
    isChild: false,
  });
  assert.deepEqual(chips, []);
});

test("chips · DESCONOCIDO pinta su propio chip ámbar, distinto de «No»", () => {
  const desconocido = eduPatientFichaChips({
    ageYears: 30,
    guardianName: null,
    guardianRelation: null,
    pregnancy: "DESCONOCIDO",
    isChild: false,
  });
  assert.equal(desconocido.length, 1);
  assert.equal(desconocido[0].tone, "warn");

  const no = eduPatientFichaChips({
    ageYears: 30,
    guardianName: null,
    guardianRelation: null,
    pregnancy: "NO",
    isChild: false,
  });
  assert.deepEqual(no, [], "«No» no tiene por qué ocupar sitio en la cabecera");
});

test("chips · embarazo y lactancia avisan antes de una radiografía", () => {
  for (const p of ["EMBARAZO", "LACTANCIA"] as const) {
    const chips = eduPatientFichaChips({
      ageYears: 30,
      guardianName: null,
      guardianRelation: null,
      pregnancy: p,
      isChild: false,
    });
    assert.equal(chips[0].kind, "embarazo");
    assert.equal(chips[0].tone, "warn");
    assert.ok(chips[0].detail);
  }
});

test("chips · NO amplían EduAlertChipKind (rompería el layout de otra casilla)", () => {
  // El layout de la ficha declara `Record<EduAlertChipKind, LucideIcon>`:
  // añadir un valor a esa unión deja el Record incompleto y tumba la build
  // de un archivo que esta casilla no puede tocar.
  const core = leer(CORE);
  const i = core.indexOf("export type EduAlertChipKind");
  const union = core.slice(i, core.indexOf(";", i));
  assert.ok(!union.includes("menor"), "se amplió EduAlertChipKind: rompe el layout");
  assert.ok(!union.includes("embarazo"), "se amplió EduAlertChipKind: rompe el layout");
});

// ═══════════════════════════════════════════════════════════════════════
// 12 · NO REVERTIR LO QUE OTRA PERSONA ACABA DE GUARDAR
//
// 🔴 EL BUG QUE ESTO FIJA, y por qué la Ola B lo convierte en grave. El
// formulario conserva lo tecleado cuando llega una fila nueva del servidor
// (bien: nadie quiere que le borren a media frase lo que está escribiendo).
// Pero si el DIFF se calculara contra esa fila NUEVA, un campo que la otra
// persona acaba de rellenar se leería como «antes tenía valor, ahora está
// vacío» y viajaría como `null`. Con nueve campos lo peor que se revertía
// era un teléfono; entre los 31 están el EMBARAZO, el TUTOR, el CURP y el
// domicilio — datos que no se reconstruyen de memoria.
//
// La regla: la base del diff y lo tecleado se mueven JUNTOS o no se mueven.
// ═══════════════════════════════════════════════════════════════════════

test("no-revertir · el diff contra la fila SEMBRADA no toca lo que cambió otro", () => {
  // La fila con la que se sembró el formulario: sin embarazo y sin tutor.
  const sembrada = paciente();
  const values = { ...eduPatientFormValues(sembrada), phone2: "5599887766" };

  // Mientras tanto, otra persona captura el embarazo y el tutor.
  // (No hace falta usar esa fila para nada: el diff se calcula contra la
  // SEMBRADA, y por eso esos dos campos ni aparecen.)
  const diff = eduPatientFormDiff(sembrada, values);
  assert.deepEqual(diff, { phone2: "5599887766" });
  assert.equal("pregnancy" in diff, false);
  assert.equal("guardianName" in diff, false);
});

test("no-revertir · contra la fila VIVA sí se revertiría (por eso NO se hace así)", () => {
  // Esta prueba fija el bug al revés: demuestra que calcular el diff contra
  // la fila fresca produce EXACTAMENTE el borrado silencioso. Si algún día
  // alguien "simplifica" el hook volviendo a `row`, esta prueba explica en
  // una línea qué se rompe.
  const viva = paciente({ pregnancy: "EMBARAZO", guardianName: "Ana López" });
  const valoresViejos = { ...eduPatientFormValues(paciente()), phone2: "5599887766" };
  const diffMalo = eduPatientFormDiff(viva, valoresViejos);
  assert.equal(diffMalo.pregnancy, null);
  assert.equal(diffMalo.guardianName, null);
});

test("no-revertir · el hook calcula el diff contra `base`, y `base` viaja con `values`", () => {
  const form = leer(FORMULARIO);
  assert.ok(
    /eduPatientFormDiff\(base, values\)/.test(form),
    "el diff se calcula contra la fila viva y revierte lo que guardó otra persona",
  );
  // Las dos mitades se mueven juntas: en la resiembra automática…
  assert.ok(
    /if \(!sucio\) \{\s*setValues\(eduPatientFormValues\(row\)\);\s*setBase\(row\);/.test(form),
    "la base no se mueve con los valores cuando baja una fila nueva",
  );
  // …y en la explícita, después de guardar.
  //
  // 🔴 N-16 · `resembrar` RECIBE LA FILA. Sembraba siempre con la `row` de
  // las props —la de ANTES de guardar—, así que bajo el «Listo» verde
  // seguían los valores viejos hasta que aterrizaba el `router.refresh()`.
  // Las dos mitades (valores y base) siguen moviéndose JUNTAS, que es lo
  // que esta prueba fija; lo que cambia es de dónde sale la semilla.
  assert.ok(
    /resembrar: \(fila\?: EduPatientRow\) => \{[\s\S]{0,400}?const semilla = fila \?\? row;\s*setValues\(eduPatientFormValues\(semilla\)\);\s*setBase\(semilla\);/.test(
      form,
    ),
    "resembrar() no siembra con la fila que el servidor acaba de devolver",
  );
});

test("PDF · una carta REVOCADA SIN FIRMAR no produce documento", () => {
  // 🔴 `revokeEduConsent` acepta a propósito revocar una carta que nunca se
  // firmó («el paciente dijo que no» es una constancia, y así se anula una
  // carta emitida por error). Con el gate puesto en «tiene revokedAt», esa
  // carta habría salido como un PDF titulado CONSENTIMIENTO INFORMADO con
  // el texto íntegro de algo que nadie autorizó.
  const lib = leer(CONSENT_LIB);
  const cuerpo = lib.slice(lib.indexOf("export async function getEduConsentPdfData"));
  assert.ok(/if \(!c\.signedAt\) \{/.test(cuerpo), "el gate no exige la firma del paciente");
  assert.ok(
    !/if \(!c\.signedAt && !c\.revokedAt\)/.test(cuerpo),
    "«revocada» sigue valiendo como llave alternativa a «firmada»",
  );
  assert.ok(
    /se revocó antes de que el paciente llegara a firmarla/.test(cuerpo),
    "el 409 de la revocada-sin-firmar no explica qué pasó",
  );
});

test("aviso de privacidad · «Lo acepta hoy» usa la fecha LOCAL, no UTC", () => {
  // A las 19:00 en Ciudad de México (UTC−6), `toISOString()` da MAÑANA: el
  // aviso quedaría fechado un día después de que el paciente lo firmó, y el
  // check del servidor («no en el futuro») tampoco lo atraparía.
  const form = leer(FORMULARIO);
  assert.ok(/function eduHoyLocal\(\)/.test(form), "no existe el helper de la fecha local");
  assert.ok(
    !/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(form),
    "«Lo acepta hoy» sigue escribiendo la fecha en UTC",
  );
});

test("rastro · el «cuándo» se formatea en el SERVIDOR con la zona del instituto", () => {
  // `updatedAt` es un INSTANTE: con `formatEduDate` (fecha de calendario en
  // UTC) dos correcciones de la misma tarde son indistinguibles y una de
  // las 19:30 en México sale con la fecha del día siguiente.
  const form = leer(FORMULARIO);
  assert.ok(/rastroLabel/.test(form), "el rastro no recibe el sello ya formateado");
  assert.ok(
    !/formatEduDate\(row\.updatedAt\)/.test(form),
    "el instante se pinta con el formateador de fechas de calendario",
  );
  const pagina = leer("src/app/instituto/(panel)/pacientes/[id]/datos/page.tsx");
  assert.ok(/eduSafeTimeZone\(ctx\.institution\.timezone\)/.test(pagina));
  assert.ok(/eduFormatTime\(/.test(pagina), "el rastro no lleva la HORA");
});

test("vaciar · un texto de solo espacios se lee como «vacíalo», no como error", () => {
  const fuente = leer(SERVIDOR);
  assert.ok(
    /typeof v === "string" && v\.trim\(\) === ""/.test(fuente),
    "«   » rebota con «no es un texto válido» en vez de vaciar el campo",
  );
});
