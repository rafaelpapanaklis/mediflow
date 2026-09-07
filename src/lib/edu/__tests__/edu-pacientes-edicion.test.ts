/**
 * QUE LA FICHA DEL PACIENTE SE PUEDA CORREGIR — y que no se pueda guardar
 * basura al hacerlo.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-pacientes-edicion.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE ESTE ARCHIVO. La sección (f) de la auditoría WS2-T8 dice
 * exactamente dónde estaba ciega la suite, y son cinco huecos:
 *
 *   1. «Ninguna prueba toca `updateEduPatient`. No hay una sola que diga
 *      qué campos acepta ni cuáles le manda la UI. H-01 —el bug que Rafael
 *      vio— es invisible para esta suite y lo seguirá siendo.»
 *   2. «Ninguna prueba mira un componente de pantalla del paciente.»
 *   3. «Nada prueba el ciclo de vida del paciente: duplicados, estado
 *      manual contra estado derivado, qué pasa al egresar el alumno.»
 *   4. «Nada cruza las validaciones entre módulos. `normalizeEduPhone` y
 *      `eduWaPhone` están probadas por separado y nadie comprueba que lo
 *      que una acepta la otra lo pueda entregar.»
 *   5. Y el patrón que las junta: «hay pruebas verdes que documentan
 *      capacidades que la UI no usa» — una función viva que ningún cliente
 *      llama es una prueba que pasa sobre código muerto.
 *
 * 🔴 CÓMO SE PRUEBA LO QUE NO TIENE BASE DE DATOS. No hay base de pruebas
 * en este repo, así que `updateEduPatient` no se puede EJECUTAR aquí: lo
 * que se hace —y es el patrón que edu-permissions.test.ts ya usa para el
 * catálogo de permisos— es leer el FUENTE y comprobar la correspondencia
 * entre las dos puntas. No es un sustituto de una prueba de integración; es
 * el candado que sí se puede poner hoy, y caza exactamente el bug que
 * ocurrió: un campo que el servidor acepta y ninguna pantalla manda.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDU_PATIENT_CONTACT_FIELDS,
  EDU_PATIENT_FORM_FIELDS,
  EDU_PATIENT_STATUSES_SIN_CASOS_ABIERTOS,
  eduPatientFieldIsContact,
  eduPatientFormDiff,
  eduPatientFormHasChanges,
  eduPatientFormValues,
  eduPatientStatusConflict,
  eduPhoneWaWarning,
  normalizeEduPhone,
  normalizeEduWaPhone,
  type EduPatientFormField,
  type EduPatientRow,
} from "../pacientes-core";
import { eduWaPhone } from "../whatsapp-core";
import { eduPatientEditAbilities } from "../permissions";
import { eduCaseScopeWhere, eduPatientScopeWhere, eduStudentScopeWhere } from "../visibility";
import { EDU_PATIENT_STATUSES } from "../types";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const SERVIDOR = "src/lib/edu/pacientes.ts";
const FORMULARIO = "src/components/edu/clinica/paciente-datos-form.tsx";
const MODAL = "src/components/edu/clinica/pacientes-screen.tsx";
const PESTANA = "src/app/instituto/(panel)/pacientes/[id]/datos/page.tsx";
const ENDPOINT = "src/app/api/instituto/pacientes/[id]/route.ts";

/** Una fila de paciente cualquiera, para los diffs. */
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
    notes: "Llega en silla de ruedas.",
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

    // ── Ola B · los 22 campos de la ficha completa ────────────────────
    // TODOS a null / false a propósito: es el estado de CUALQUIER paciente
    // registrado antes de la Ola B, que es contra el que hay que probar.
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
// 1 · H-01 · QUÉ CAMPOS ACEPTA EL SERVIDOR, Y QUE LA UI LOS MANDE TODOS
// ═══════════════════════════════════════════════════════════════════════

test("los 31 campos de la ficha son los que son (si crece la lista, se entera esta prueba)", () => {
  // Nueve de la ola de la edición + 22 de la Ola B. Si esta lista crece hay
  // que revisar tres cosas: que el servidor los acepte, que las dos
  // pantallas los manden, y que cada uno tenga su GRUPO de permiso.
  assert.deepEqual(
    [...EDU_PATIENT_FORM_FIELDS],
    [
      "folio",
      "firstName",
      "lastName",
      "sex",
      "birthDate",
      "curp",
      "phone",
      "phone2",
      "email",
      "contactPreference",
      "addressStreet",
      "addressNeighborhood",
      "addressCity",
      "addressState",
      "addressZip",
      "guardianName",
      "guardianRelation",
      "guardianPhone",
      "insuranceProvider",
      "insurancePolicy",
      "familyHistory",
      "personalNonPathologicalHistory",
      "habitsTobacco",
      "habitsAlcohol",
      "habitsBruxism",
      "habitsNotes",
      "pregnancy",
      "isChild",
      "status",
      "notes",
      "privacyNoticeAcceptedAt",
    ],
    "cambió la lista de campos de la ficha: revisa que el servidor los acepte, que las dos pantallas los manden y que cada uno tenga grupo de permiso",
  );
});

test("🔴 H-01 · `updateEduPatient` acepta los NUEVE, uno por uno", () => {
  // Es EL bug que Rafael vio: el servidor sabía editar nombre, apellidos,
  // folio y sexo desde la Ola 2 y ninguna pantalla se los mandaba nunca.
  // Aquí se fija la punta del servidor: cada campo tiene su rama
  // `input.X !== undefined` dentro de la función.
  const fuente = leer(SERVIDOR);
  const cuerpo = fuente.slice(fuente.indexOf("export async function updateEduPatient("));
  assert.ok(cuerpo.length > 0, "no se encontró updateEduPatient");

  // 🔴 N-16 · Los 22 campos de la Ola B ya NO tienen su rama escrita dentro
  // de `updateEduPatient`: viven en `parseEduPatientOlaB`, y la corrección
  // y el ALTA llaman a esa misma función. Antes el alta los declaraba en su
  // input y los tiraba en silencio. Así que la rama se busca en la función
  // que corresponda, y además se exige que las DOS escrituras pasen por el
  // parser — que es lo que impide que vuelvan a separarse.
  const parser = fuente.slice(
    fuente.indexOf("export function parseEduPatientOlaB("),
    fuente.indexOf("export async function createEduPatient("),
  );
  assert.ok(parser.length > 0, "no se encontró parseEduPatientOlaB");
  assert.ok(
    /Object\.assign\(data, parseEduPatientOlaB\(input, now\)\)/.test(cuerpo),
    "updateEduPatient dejó de pasar por el parser compartido",
  );
  const alta = fuente.slice(fuente.indexOf("export async function createEduPatient("));
  assert.ok(
    /parseEduPatientOlaB\(input, now\)/.test(alta),
    "createEduPatient volvió a tirar los campos de la Ola B en silencio",
  );

  const sinRama = EDU_PATIENT_FORM_FIELDS.filter(
    (campo) =>
      !cuerpo.includes(`input.${campo} !== undefined`) &&
      !parser.includes(`input.${campo} !== undefined`),
  );
  assert.deepEqual(
    sinRama,
    [],
    `updateEduPatient no lee estos campos: ${sinRama.join(", ")} — la pantalla los mandaría al vacío`,
  );
});

test("🔴 H-01 · el formulario ÚNICO pinta los nueve, y es el mismo en los dos sitios", () => {
  // La otra punta. `eduPatientFormValues` es lo que el componente usa como
  // estado, así que si un campo no está ahí, la pantalla no lo puede
  // mandar por más ramas que tenga el servidor.
  const valores = eduPatientFormValues(paciente());
  assert.deepEqual(
    Object.keys(valores).sort(),
    [...EDU_PATIENT_FORM_FIELDS].sort(),
    "el estado del formulario no cubre los nueve campos",
  );

  // Y que el componente sea de verdad UNO, montado en DOS. Es la decisión
  // escrita en datos/page.tsx que la ola respeta: dos formularios para la
  // misma ficha es cómo uno de los dos se queda sin el campo nuevo.
  const componente = "@/components/edu/clinica/paciente-datos-form";
  assert.ok(leer(MODAL).includes(componente), "el modal de la lista no monta el formulario único");
  assert.ok(leer(PESTANA).includes(componente), "la pestaña Datos no monta el formulario único");
});

test("🔴 H-03 · la pestaña Datos ya no manda a la lista a buscar el paciente a mano", () => {
  const pestana = leer(PESTANA);
  assert.ok(
    !pestana.includes("Editar en la lista de pacientes"),
    "sigue el botón que abandonaba a recepción en la lista completa, sin folio y sin ?q=",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · H-10 · CAMPO AUSENTE NO SE ESCRIBE
// ═══════════════════════════════════════════════════════════════════════

test("🔴 H-10 · solo viaja lo que cambió, y nada más", () => {
  const row = paciente();
  const valores = eduPatientFormValues(row);

  assert.deepEqual(eduPatientFormDiff(row, valores), {}, "sin tocar nada, no hay nada que mandar");
  assert.equal(eduPatientFormHasChanges({}), false);

  const diff = eduPatientFormDiff(row, { ...valores, email: "maria.lopez@example.com" });
  assert.deepEqual(diff, { email: "maria.lopez@example.com" });
  // 🔴 Lo que importa NO es que `email` esté: es que `status` NO esté. Ése
  // era el bug: el PATCH mandaba los cinco campos siempre, así que corregir
  // el correo a las 9:25 reescribía el estado que la lista pintó a las 9:00
  // y resucitaba a un paciente que un caso cerrado ya había dado de alta.
  assert.equal("status" in diff, false, "el estado viaja sin que nadie lo haya tocado");
  assert.equal("phone" in diff, false);
  assert.equal("notes" in diff, false);
});

test("🔴 H-10 · vaciar un campo anulable manda null; los obligatorios no se anulan", () => {
  const row = paciente();
  const valores = eduPatientFormValues(row);

  assert.deepEqual(eduPatientFormDiff(row, { ...valores, phone: "" }), { phone: null });
  assert.deepEqual(eduPatientFormDiff(row, { ...valores, email: "" }), { email: null });
  assert.deepEqual(eduPatientFormDiff(row, { ...valores, birthDate: "" }), { birthDate: null });
  assert.deepEqual(eduPatientFormDiff(row, { ...valores, notes: "" }), { notes: null });

  // El folio vacío NO se manda como null: es obligatorio y el servidor lo
  // rechaza con su motivo. Mandar "" es lo que hace que ese motivo salga.
  assert.deepEqual(eduPatientFormDiff(row, { ...valores, folio: "" }), { folio: "" });
});

test("H-10 · los espacios de más no son un cambio (nadie quiere un PATCH por un espacio)", () => {
  const row = paciente();
  const valores = eduPatientFormValues(row);
  assert.deepEqual(eduPatientFormDiff(row, { ...valores, firstName: "  María  " }), {});
});

test("H-10 · el diff se calcula contra la fila FRESCA: el modal no monta el formulario antes", () => {
  // El arreglo de H-10 tiene dos mitades y ésta es la que un diff no puede
  // probar solo: el formulario nace de `data.row` (lo que el servidor acaba
  // de decir) y no de la fila que pintó la lista hace veinte minutos.
  const modal = leer(MODAL);
  assert.ok(
    modal.includes("useEduPacienteDatosForm(row)"),
    "el formulario del modal no se siembra con la fila que llegó del servidor",
  );
  // El cuerpo no se MONTA hasta que la fila llegó: mientras `data` es null,
  // `FichaCuerpo` no existe, así que su `useState` no puede sembrarse con la
  // fila vieja de la lista.
  assert.ok(
    /cargando \|\| !data \?/.test(modal),
    "el modal monta el formulario antes de tener la fila fresca",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · H-02 · LAS DOS LLAVES, Y QUÉ ABRE CADA UNA
// ═══════════════════════════════════════════════════════════════════════

test("🔴 H-02 · el ALUMNO y el DOCENTE corrigen el CONTACTO; la identidad sigue siendo de recepción", () => {
  for (const role of ["ALUMNO", "DOCENTE"] as const) {
    const a = eduPatientEditAbilities({ role });
    assert.equal(a.contacto, true, `${role} debería poder corregir el teléfono del paciente`);
    assert.equal(a.manage, false, `${role} no captura la identidad del paciente`);
  }
});

test("🔴 H-02 · CAJA y DIRECCIÓN siguen abriendo la ficha entera", () => {
  for (const role of ["CAJA", "DIRECCION"] as const) {
    const a = eduPatientEditAbilities({ role });
    assert.equal(a.manage, true, `${role} perdió pacientes.manage`);
    assert.equal(a.contacto, true);
  }
});

test("🔴 H-02 · quien no lleva ninguna de las dos llaves no corrige nada", () => {
  // El override REEMPLAZA al default: una cuenta con solo "pacientes.view"
  // tildado ve la ficha y no la toca.
  const a = eduPatientEditAbilities({ role: "ALUMNO", permissionsOverride: ["pacientes.view"] });
  assert.equal(a.manage, false);
  assert.equal(a.contacto, false);
});

test("🔴 H-02 · el CONTACTO son los dos teléfonos, el correo y la preferencia", () => {
  // La Ola B añadió `phone2` y `contactPreference` al MISMO grupo, y es la
  // misma decisión: el alumno tiene al paciente en el sillón y le dictan un
  // número de recado. Lo que NO entró es todo lo demás.
  assert.deepEqual(
    [...EDU_PATIENT_CONTACT_FIELDS],
    ["phone", "phone2", "email", "contactPreference"],
  );
  // El nacimiento NO es contacto y no es un olvido: decide la edad que sale
  // impresa en una carta de consentimiento. El CURP y el TUTOR tampoco: son
  // identidad y papeleo, y los captura recepción.
  for (const campo of [
    "folio",
    "firstName",
    "lastName",
    "sex",
    "birthDate",
    "curp",
    "guardianName",
    "addressZip",
    "pregnancy",
    "status",
    "notes",
  ]) {
    assert.equal(eduPatientFieldIsContact(campo), false, `${campo} no puede ser "contacto"`);
  }
});

test("🔴 H-02 · el servidor RECHAZA con su motivo un campo de más, no lo ignora", () => {
  // Ignorarlo en silencio dejaría a un alumno creyendo que corrigió el
  // apellido. La rama vive en `updateEduPatient`, no solo en el endpoint.
  const fuente = leer(SERVIDOR);
  assert.ok(
    /motivoGrupoCerrado/.test(fuente),
    "updateEduPatient no rechaza con un motivo escrito el campo que no le toca a quien manda",
  );
  assert.ok(
    /eduPatientFieldGroupOf/.test(fuente),
    "el recorte de campos no usa el punto único de pacientes-core",
  );
  assert.ok(
    /options\.groups/.test(fuente),
    "updateEduPatient no lee los GRUPOS que puede tocar quien manda",
  );

  // Y el endpoint tiene que pasar el reparto: si llamara sin opciones, o
  // con una lista fija, abriría los 31 campos a quien solo lleva la segunda
  // llave. Es exactamente el bug que este check evita.
  const endpoint = leer(ENDPOINT);
  assert.ok(endpoint.includes("eduPatientEditAbilities"), "el endpoint no resuelve las dos llaves");
  assert.ok(
    /groups: grupos/.test(endpoint),
    "el endpoint no le dice a updateEduPatient qué GRUPOS puede tocar quien manda",
  );
  assert.ok(
    /eduPatientEditGroups/.test(endpoint),
    "el endpoint traduce las llaves a grupos por su cuenta en vez de usar el punto único",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · H-09 · EL TELÉFONO, CRUZADO CON EL DE WHATSAPP
//     («nadie comprueba que lo que una acepta la otra lo pueda entregar»)
// ═══════════════════════════════════════════════════════════════════════

const TELEFONOS_QUE_LA_GENTE_TECLEA = [
  "5544332211",
  "55 4433 2211",
  "(55) 4433-2211",
  "+52 55 4433 2211",
  "+521 55 4433 2211",
  "52 55 4433 2211",
  "55-4433-2211",
  "  5544332211  ",
];

test("🔴 H-09 · TODO lo que el saneo del PACIENTE acepta, WhatsApp lo puede entregar", () => {
  // El cruce que faltaba. Antes el teléfono del paciente se guardaba con la
  // regla ancha: "55" entraba y `eduWaPhone` devolvía null para él, así que
  // el paciente quedaba con un teléfono en la ficha y sin un solo
  // recordatorio, sin que nadie lo dijera.
  for (const crudo of TELEFONOS_QUE_LA_GENTE_TECLEA) {
    const guardado = normalizeEduWaPhone(crudo);
    assert.ok(guardado, `"${crudo}" debería poder guardarse`);
    assert.ok(
      eduWaPhone(guardado),
      `se guardó "${guardado}" y WhatsApp no lo puede entregar: el saneo acepta lo que el envío rechaza`,
    );
  }
});

test("🔴 H-09 · lo que WhatsApp no puede entregar, tampoco se guarda en el paciente", () => {
  for (const crudo of ["55", "5", "554433221", "55443322110", "abc", "  "]) {
    assert.equal(normalizeEduWaPhone(crudo), null, `"${crudo}" no debería guardarse`);
  }
});

test("🔴 H-09 · y la regla estrecha NO se lleva por delante los otros dos teléfonos", () => {
  // `normalizeEduPhone` la comparten el CONTACTO DE EMERGENCIA y el teléfono
  // de una cuenta del equipo. A esos se les LLAMA: un número extranjero o
  // con extensión sigue sirviendo. Estrecharlos habría bloqueado el guardado
  // ENTERO de los antecedentes —el bloque de las alergias— de cualquier
  // paciente viejo con un contacto de emergencia de otra forma.
  assert.equal(normalizeEduPhone("+1 415 555 1234"), "+14155551234");
  assert.equal(normalizeEduPhone("55 4433 2211 ext 12"), "554433221112");
  assert.equal(normalizeEduPhone("sin teléfono"), null);
  // Y el del paciente sí es estrecho: son dos reglas, a propósito.
  assert.equal(normalizeEduWaPhone("+1 415 555 1234"), null);
});

test("🔴 H-09 · el teléfono del PACIENTE usa la regla estrecha, y solo él", () => {
  const fuente = leer(SERVIDOR);
  assert.ok(
    fuente.includes("normalizeEduWaPhone(input.phone)"),
    "el teléfono del paciente dejó de pasar por la regla de WhatsApp",
  );
  assert.ok(
    !/normalizeEduPhone\(input\.phone\)/.test(fuente),
    "quedó la regla ancha sobre el teléfono del paciente",
  );
});

test("H-09 · el aviso solo sale para lo que YA está guardado y no sirve", () => {
  // Es para las filas VIEJAS: desde esta ola el saneo cierra la puerta,
  // pero en la base ya hay pacientes con "55" de antes.
  assert.ok(eduPhoneWaWarning("55"), "un teléfono viejo de dos dígitos tiene que avisar");
  assert.equal(eduPhoneWaWarning("5544332211"), null, "un teléfono bueno no avisa de nada");
  // Sin teléfono NO es lo mismo que un teléfono malo: no hay nada que
  // corregir, y pintar un aviso ámbar sobre un campo vacío es ruido.
  assert.equal(eduPhoneWaWarning(null), null);
  assert.equal(eduPhoneWaWarning(""), null);
  assert.equal(eduPhoneWaWarning("   "), null);
});

test("H-09 · la regla del teléfono se IMPORTA de whatsapp-core, no se copia", () => {
  const core = leer("src/lib/edu/pacientes-core.ts");
  assert.ok(
    /import \{ eduWaPhone \} from "@\/lib\/edu\/whatsapp-core"/.test(core),
    "pacientes-core dejó de reusar eduWaPhone: dos reglas del teléfono es cómo vuelve H-09",
  );
});

test("H-09 · la fecha del formulario tampoco se reimplementa", () => {
  // `eduDateInputValue` (padron-core) ya resolvía el "AAAA-MM-DD" en UTC, y
  // era lo que el modal de la lista usaba antes de esta ola. Una segunda
  // copia de la misma regla es cómo una de las dos se olvida del UTC y un
  // nacimiento del 1 de enero sale "31 de diciembre".
  const core = leer("src/lib/edu/pacientes-core.ts");
  assert.ok(core.includes("eduDateInputValue"), "se reimplementó el formateo de la fecha");
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · H-28 · EL ESTADO CONTRA LOS CASOS
// ═══════════════════════════════════════════════════════════════════════

test("🔴 H-28 · no se puede dar de alta a un paciente con casos abiertos", () => {
  for (const status of EDU_PATIENT_STATUSES_SIN_CASOS_ABIERTOS) {
    const motivo = eduPatientStatusConflict(status, 3);
    assert.ok(motivo, `${status} con 3 casos abiertos tendría que rebotar`);
    assert.ok(/3 casos abiertos/.test(motivo), `el motivo no dice cuántos casos: ${motivo}`);
  }
});

test("H-28 · el motivo está escrito para una persona, en singular y en plural", () => {
  const uno = eduPatientStatusConflict("DISCHARGED", 1) ?? "";
  assert.ok(/1 caso abierto\b/.test(uno), `no concuerda en singular: ${uno}`);
  assert.ok(!/1 casos/.test(uno));
  assert.ok(/Dado de alta|alta/i.test(uno), "el motivo no nombra el estado que se intentó poner");
  // 🔴 Y NO le manda a caja a cerrar un caso, que es lo único que caja no
  // puede hacer: no lleva ninguna key de casos y su alcance es "none".
  assert.ok(!/[Cc]iérralos|[Cc]iérralo|traspásalos tú/.test(uno), `manda a caja a cerrar casos: ${uno}`);
  assert.ok(/docente/i.test(uno), `el motivo no dice de quién depende: ${uno}`);
});

test("H-28 · sin casos abiertos, los cuatro estados se pueden poner", () => {
  for (const status of EDU_PATIENT_STATUSES) {
    assert.equal(eduPatientStatusConflict(status, 0), null, `${status} rebotó sin casos abiertos`);
  }
});

test("H-28 · con casos abiertos, ACTIVE y NEW siguen siendo válidos", () => {
  // El bloqueo es sobre "este paciente ya no está en tratamiento", no sobre
  // cualquier cambio de estado.
  assert.equal(eduPatientStatusConflict("ACTIVE", 4), null);
  assert.equal(eduPatientStatusConflict("NEW", 4), null);
});

test("🔴 H-28 · la pantalla y el servidor dicen el MISMO no", () => {
  // Dos textos distintos para el mismo rechazo es cómo alguien acaba
  // creyendo que son dos problemas. El servidor llama a la misma función.
  const fuente = leer(SERVIDOR);
  assert.ok(
    fuente.includes("eduPatientStatusConflict"),
    "updateEduPatient no revalida el estado contra los casos: entre pintar y pulsar cabe un caso nuevo",
  );
  assert.ok(
    leer(FORMULARIO).includes("eduPatientStatusConflict"),
    "el formulario no avisa antes de pulsar Guardar",
  );
});

test("H-28 · el choque solo se comprueba si el estado ESTÁ cambiando", () => {
  // Un paciente que quedó DISCHARGED con casos abiertos por un dato viejo
  // no puede quedar atrapado sin poder corregirse el teléfono.
  const row = paciente({ status: "DISCHARGED", openCases: 2 });
  const valores = eduPatientFormValues(row);
  const diff = eduPatientFormDiff(row, { ...valores, phone: "5599887766" });
  assert.equal("status" in diff, false, "el estado no se está tocando y no debería viajar");
});

// ═══════════════════════════════════════════════════════════════════════
// 6 · H-07 · EL ALCANCE DEL EGRESADO
// ═══════════════════════════════════════════════════════════════════════

const INST = "inst_1";
const AHORA = new Date("2026-09-06T12:00:00.000Z");

/** Saca todos los valores de una clave, a cualquier profundidad. */
function valoresDe(obj: unknown, clave: string): unknown[] {
  const out: unknown[] = [];
  const ver = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(ver);
    if (!n || typeof n !== "object") return;
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (k === clave) out.push(v);
      ver(v);
    }
  };
  ver(obj);
  return out;
}

test("🔴 H-07 · el recorte del ALUMNO mira su estado académico", () => {
  const where = eduPatientScopeWhere({
    institutionId: INST,
    scope: { kind: "own", studentUserId: "u_egresado" },
    now: AHORA,
  });

  // Sin esto, marcar GRADUATED en el padrón no le quitaba UNA sola fila: el
  // egresado seguía abriendo la ficha, el expediente, el odontograma y las
  // radiografías de sus pacientes hasta que alguien de dirección se
  // acordara de ir a otra pantalla a desactivarle la cuenta a mano.
  const estados = valoresDe(where, "status");
  const fuera = estados.filter(
    (v) => v && typeof v === "object" && "notIn" in (v as Record<string, unknown>),
  );
  assert.ok(fuera.length > 0, "el recorte del alumno no mira EduStudent.status");
  for (const v of fuera) {
    assert.deepEqual(
      (v as { notIn: string[] }).notIn,
      ["GRADUATED", "WITHDRAWN"],
      "cambió qué estados cierran el acceso: los dos son los TERMINALES",
    );
  }
});

test("🔴 H-07 · ON_LEAVE NO cierra: la baja temporal vuelve y retoma sus casos", () => {
  const where = eduPatientScopeWhere({
    institutionId: INST,
    scope: { kind: "own", studentUserId: "u_alumno" },
    now: AHORA,
  });
  const crudo = JSON.stringify(where);
  assert.ok(!crudo.includes("ON_LEAVE"), "una baja temporal no puede perder a sus pacientes");
});

test("🔴 H-07 · el egresado CONSERVA sus casos, su evaluación y su agenda", () => {
  // Lo que se cierra es el PACIENTE, y con él todo lo que cuelga de él. Su
  // historia académica NO se cierra, y hay decisiones escritas que lo dicen:
  // la lista de casos conserva a propósito los que entregó, y su evaluación
  // es UNA fila —la suya—. Aplicar H-07 en `eduStudentScopeFilter`, que es
  // donde cabría, se los habría llevado por delante a los tres.
  const own = { kind: "own", studentUserId: "u_egresado" } as const;

  const casos = JSON.stringify(eduCaseScopeWhere({ institutionId: INST, scope: own, now: AHORA }));
  assert.ok(!casos.includes("GRADUATED"), "el egresado perdió su propia lista de casos");

  const suFicha = JSON.stringify(
    eduStudentScopeWhere({ institutionId: INST, scope: own, now: AHORA }),
  );
  assert.ok(!suFicha.includes("GRADUATED"), "el egresado perdió su bitácora y su evaluación");
});

test("🔴 H-07 · el vacío del egresado tampoco miente (la lección de H-29)", () => {
  // Su alcance sigue siendo "own" y nunca "none", así que ninguna rama de
  // `EDU_VISIBILITY_NONE_DETAIL` lo atrapa: sin esto leería «Todavía no hay
  // pacientes», que es exactamente la clase de texto que esta ola arregló
  // para el docente.
  const pantalla = leer(MODAL);
  assert.ok(
    pantalla.includes("Tu inscripción ya no está activa"),
    "el egresado cae en el vacío genérico que miente sobre el estado del sistema",
  );
  assert.ok(
    leer("src/app/instituto/(panel)/pacientes/page.tsx").includes(
      'inscripcionInactiva={scope.kind === "own" && alumnos.length === 0}',
    ),
    "la página no detecta al estudiante cuya inscripción dejó de estar activa",
  );
});

test("H-07 · el recorte del DOCENTE no lo toca (responde por lo que firmó)", () => {
  const where = eduPatientScopeWhere({
    institutionId: INST,
    scope: { kind: "supervised", supervisorUserId: "doc_1" },
    now: AHORA,
  });
  assert.ok(
    !JSON.stringify(where).includes("GRADUATED"),
    "un docente no puede perder el acceso a las notas de un alumno el día que egresa",
  );
});

test("H-07 · DIRECCIÓN y CAJA no pierden nada: su where sigue siendo el tenant", () => {
  const where = eduPatientScopeWhere({ institutionId: INST, scope: { kind: "all" }, now: AHORA });
  assert.deepEqual(where, { institutionId: INST });
});

test("🔴 H-07 · el padrón AVISA de que la cuenta sigue viva, y no la apaga solo", () => {
  // Dar de baja una cuenta es quitarle a alguien el acceso a su propio
  // historial: no puede ser un efecto secundario de mover un desplegable.
  const padron = leer("src/components/edu/padron/padron-screen.tsx");
  assert.ok(
    padron.includes("Su cuenta seguirá activa"),
    "el padrón no avisa al marcar el egreso",
  );
  assert.ok(
    padron.includes("/instituto/equipo"),
    "el aviso no ofrece el camino para desactivar la cuenta",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 7 · H-05 · EL AVISO DE DUPLICADO
// ═══════════════════════════════════════════════════════════════════════

test("🔴 H-05 · el alta avisa del duplicado y deja seguir A PROPÓSITO", () => {
  const fuente = leer(SERVIDOR);
  assert.ok(fuente.includes("buscarDuplicados"), "createEduPatient no busca duplicados");
  assert.ok(
    fuente.includes("options.allowDuplicate"),
    "no hay forma de registrar a sabiendas: dos hermanos comparten el teléfono de su madre",
  );
  // La comprobación va pegada a la escritura, no en la pantalla: entre
  // "consulto" y "creo" caben los cinco segundos en los que la otra
  // recepcionista lo registra.
  const alta = fuente.slice(fuente.indexOf("export async function createEduPatient("));
  assert.ok(
    alta.indexOf("buscarDuplicados") < alta.indexOf("prisma.eduPatient.create"),
    "el aviso tiene que ir ANTES de escribir",
  );
});

test("H-05 · el aviso dice A QUIÉN se parece, con folio (o no sirve para decidir)", () => {
  const fuente = leer(SERVIDOR);
  assert.ok(
    /Ya existe \$\{quienes\}|Ya existe/.test(fuente),
    "el mensaje del duplicado no nombra al paciente que ya existe",
  );
  assert.ok(fuente.includes("d.folio"), "el mensaje no lleva el folio");
});

test("H-05 · esto NO fusiona ni borra nada", () => {
  // La ola avisa; fusionar son ocho tablas y una decisión de producto, y un
  // paciente no se borra nunca (NOM-004).
  const fuente = leer(SERVIDOR);
  assert.ok(!/prisma\.eduPatient\.delete/.test(fuente), "apareció un borrado de pacientes");
  assert.ok(!/prisma\.eduPatient\.deleteMany/.test(fuente));
});

// ═══════════════════════════════════════════════════════════════════════
// 8 · H-11 · LA ESCRITURA PASA POR EL PUNTO ÚNICO DE ALCANCE
// ═══════════════════════════════════════════════════════════════════════

test("🔴 H-11 · `updateEduPatient` busca al paciente DENTRO del alcance", () => {
  // Era la única escritura de pacientes que se saltaba el punto único. No
  // explotaba porque el endpoint pedía pacientes.manage (caja y dirección,
  // alcance completo), pero desde esta ola entran el alumno y el docente —
  // y su alcance sí recorta.
  const fuente = leer(SERVIDOR);
  const cuerpo = fuente.slice(
    fuente.indexOf("export async function updateEduPatient("),
    fuente.indexOf("export async function setEduPatientOrigin("),
  );
  assert.ok(cuerpo.length > 0, "no se encontró updateEduPatient");
  assert.ok(
    cuerpo.includes("eduPatientScopeWhere"),
    "updateEduPatient arma su propio where en vez de usar el punto único",
  );
  assert.ok(
    !/where: \{ id, institutionId \}/.test(cuerpo),
    "quedó el where a secas que ignoraba el alcance",
  );
});

test("H-11 · sin alcance no se consulta: un scope vacío contesta 404 antes de tocar la base", () => {
  const fuente = leer(SERVIDOR);
  const cuerpo = fuente.slice(fuente.indexOf("export async function updateEduPatient("));
  assert.ok(cuerpo.includes("eduScopeIsEmpty(scope)"), "falta el corte por alcance vacío");
});

// ═══════════════════════════════════════════════════════════════════════
// 9 · H-25 · EL ENLACE QUE LLEVABA A UN 404
// ═══════════════════════════════════════════════════════════════════════

test("🔴 H-25 · el paciente de un caso TRANSFERRED no es enlace en una vista recortada", () => {
  const casos = leer("src/components/edu/casos/casos-screen.tsx");
  assert.ok(
    /recortado && c\.status === "TRANSFERRED"/.test(casos),
    "el nombre del paciente de un caso traspasado sigue siendo un enlace a un 404",
  );
  assert.ok(
    /ya no está en tu alcance/.test(casos),
    "no se dice por qué el nombre dejó de ser enlace",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 10 · H-27 y H-29 · LO QUE LA PANTALLA ENSEÑA Y LO QUE DICE CUANDO NO HAY
// ═══════════════════════════════════════════════════════════════════════

test("🔴 H-27 · los datos fiscales se VEN en la ficha, y se editan donde se editan", () => {
  const pestana = leer(PESTANA);
  assert.ok(pestana.includes("getEduPatientTaxProfile"), "la pestaña Datos no lee el RFC");
  assert.ok(pestana.includes("/instituto/facturacion"), "no hay enlace a donde se corrigen");
  // NO se duplica el formulario fiscal: un RFC capturado en dos sitios es
  // un CFDI rechazado por el SAT.
  assert.ok(
    !pestana.includes("saveEduPatientTaxProfile"),
    "se duplicó el formulario fiscal en la ficha",
  );
});

test("🔴 H-29 · un docente sin alumnos no lee que la clínica no tiene pacientes", () => {
  const pantalla = leer(MODAL);
  assert.ok(
    pantalla.includes("No tienes alumnos asignados todavía"),
    "el vacío del docente sigue diciendo «Todavía no hay pacientes», que es falso",
  );
  assert.ok(
    pantalla.includes("sinAlumnosAsignados"),
    "no se distingue el vacío del docente del vacío de la clínica",
  );
  // El dato tiene que venir del SERVIDOR: el alcance de un docente es
  // "supervised" y nunca "none", así que la pantalla no lo puede deducir.
  assert.ok(
    leer("src/app/instituto/(panel)/pacientes/page.tsx").includes(
      'scope.kind === "supervised" && alumnos.length === 0',
    ),
    "la página no calcula si el docente tiene alumnos asignados",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 11 · EL MOTIVO ESCRITO — la regla de pantalla del vertical
// ═══════════════════════════════════════════════════════════════════════

test("un campo que no se puede tocar se pinta deshabilitado CON su motivo", () => {
  // Es el patrón de paciente-whatsapp.tsx, y la ola lo respeta: un campo
  // gris y mudo se lee como una pantalla rota.
  const form = leer(FORMULARIO);
  assert.ok(form.includes("disabled={!canManage}"), "los campos de identidad no se deshabilitan");
  assert.ok(form.includes("disabled={!canContacto}"), "los de contacto no se deshabilitan");
  assert.ok(
    form.includes("edu-fichaform__motivo"),
    "no hay motivo escrito debajo de lo que está bloqueado",
  );
});

test("el bloque de CSS nuevo lleva el prefijo de la ola y no pisa nada", () => {
  const css = leer("src/app/instituto/edu-theme.css");
  for (const clase of [
    ".edu-fichaform__motivo",
    ".edu-fichaform__motivo--alto",
    ".edu-fichaform__chip",
  ]) {
    assert.ok(css.includes(clase), `falta la regla ${clase}`);
  }
});

test("los campos del formulario no repiten id entre los dos montajes", () => {
  // Dos <label for> con el mismo id en la misma página hacen que el clic en
  // uno enfoque el otro. Por eso el componente recibe `idPrefix`.
  const form = leer(FORMULARIO);
  // Desde la Ola B el prefijo se aplica con el ayudante `id("…")` en vez de
  // interpolarlo en cada campo: 31 campos con la plantilla escrita a mano
  // son 31 sitios donde olvidarse del prefijo.
  const usados = [
    ...form.matchAll(/id=\{`\$\{idPrefix\}-([a-z0-9-]+)`\}/g),
    // Solo el ATRIBUTO id, no el `htmlFor` que le apunta: los dos usan el
    // mismo ayudante y contarlos juntos daría cada campo dos veces.
    ...form.matchAll(/\bid=\{id\("([a-z0-9-]+)"\)\}/g),
  ].map((m) => m[1]);
  assert.ok(usados.length >= 25, `se esperaban al menos 25 campos con prefijo, hay ${usados.length}`);
  assert.equal(new Set(usados).size, usados.length, `hay ids repetidos: ${usados.join(", ")}`);

  const prefijos = [
    ...leer(MODAL).matchAll(/idPrefix="([^"]+)"/g),
    ...leer(PESTANA).matchAll(/idPrefix="([^"]+)"/g),
  ].map((m) => m[1]);
  assert.equal(prefijos.length, 2, "el formulario tiene que estar montado en exactamente dos sitios");
  assert.equal(new Set(prefijos).size, 2, `los dos montajes usan el mismo prefijo: ${prefijos}`);
});

test("cada campo tiene etiqueta en español (la UI nunca pinta el nombre de la columna)", () => {
  const form = leer(FORMULARIO);
  // Se leen las etiquetas DE VERDAD del fuente, no se busca la palabra
  // suelta: "Estado" aparece en veinte comentarios y encontrarla ahí no
  // prueba que exista el rótulo. Desde la Ola B hay dos formas: el <label>
  // escrito a mano (los <select> que no caben en el ayudante) y la prop
  // `label="…"` de los ayudantes Texto/Area/Enumo.
  const rotulos = [
    ...[...form.matchAll(/<label[^>]*>\s*([^<{]+?)\s*<\/label>/g)].map((m) => m[1]),
    ...[...form.matchAll(/\blabel="([^"]+)"/g)].map((m) => m[1]),
  ];
  for (const e of [
    "Nombre",
    "Apellidos",
    "Folio",
    "Sexo",
    "Nacimiento",
    "Estado",
    "Teléfono",
    "Correo",
    "Notas de recepción",
    // Ola B: los que la ficha no tenía.
    "CURP",
    "Segundo teléfono",
    "Nombre del tutor",
    "Parentesco",
    "Código postal",
    "Heredofamiliares",
    "Personales no patológicos",
    "Tabaco",
    "Embarazo o lactancia",
    "Dentición",
  ]) {
    assert.ok(rotulos.includes(e), `falta la etiqueta «${e}» — hay: ${rotulos.join(", ")}`);
  }
  // Y ninguna etiqueta es el nombre de la columna de Prisma.
  for (const campo of EDU_PATIENT_FORM_FIELDS as readonly EduPatientFormField[]) {
    assert.ok(!rotulos.includes(campo), `el campo ${campo} se pinta con el nombre de su columna`);
  }
});
