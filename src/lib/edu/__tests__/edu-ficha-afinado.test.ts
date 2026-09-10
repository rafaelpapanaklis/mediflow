/**
 * ═══════════════════════════════════════════════════════════════════════
 * LOS HALLAZGOS NUEVOS DE LA AUDITORÍA WS2-T8, UNO POR UNO.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-ficha-afinado.test.ts
 *
 * Este archivo NO vuelve a probar la Ola B: eso lo hacen
 * `edu-ficha-completa.test.ts` y `edu-pacientes-edicion.test.ts`. Aquí solo
 * está lo que el informe `informe-auditoria-ola-ab.md` encontró DESPUÉS —
 * N-6, N-8, N-9, N-10, N-15, la mitad que le faltaba a H-05 y los ocho de
 * N-16 que tocan la ficha y la carta— y cada prueba lleva escrito QUÉ CASO
 * rompía, para que quien la vea fallar dentro de un año sepa qué se está
 * volviendo a romper.
 *
 * 🔴 CÓMO SE PRUEBA LO QUE NO TIENE BASE DE DATOS. No hay base de pruebas
 * en el repo, así que las funciones que tocan Prisma no se pueden EJECUTAR:
 * de ésas se fija la FORMA leyendo el fuente (el mismo patrón que
 * `edu-permissions.test.ts` y `edu-pacientes-edicion.test.ts` ya usan). Lo
 * PURO —que es donde vive casi toda la decisión— se ejecuta de verdad.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  eduAgeYears,
  eduPatientCanEditFicha,
  eduPatientFichaChips,
  eduPatientFormFieldError,
  eduPatientTutorConflict,
} from "../pacientes-core";
import {
  EDU_CONSENT_HASH_VERSION,
  eduConsentFileSlug,
  eduConsentPdfFileName,
  eduSignatureDataUrl,
} from "../consentimientos-core";
import { eduReminderCancelLabel } from "../recordatorios";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const PACIENTES = "src/lib/edu/pacientes.ts";
const CONSENT = "src/lib/edu/consentimientos.ts";
const CONSENT_CORE = "src/lib/edu/consentimientos-core.ts";
const CONSENT_PDF = "src/lib/edu/consentimiento-pdf.tsx";
const CONSENT_PANTALLA = "src/components/edu/expediente/consentimientos-screen.tsx";
const LISTA = "src/components/edu/clinica/pacientes-screen.tsx";
const FORM = "src/components/edu/clinica/paciente-datos-form.tsx";
const ACCIONES = "src/components/edu/expediente/paciente-acciones.tsx";
const RECORDATORIOS = "src/lib/edu/recordatorios.ts";
const AGENDA = "src/lib/edu/agenda.ts";
const RUTA_CITA = "src/app/api/instituto/pacientes/[id]/agenda/[citaId]/route.ts";
const RUTA_FICHA = "src/app/api/instituto/pacientes/[id]/route.ts";
const RUTA_ALTA = "src/app/api/instituto/pacientes/route.ts";
const CORE = "src/lib/edu/pacientes-core.ts";

// ═══════════════════════════════════════════════════════════════════════
// N-8 · EL ALTA APLICA LA REGLA DEL MENOR SIN TUTOR
// ═══════════════════════════════════════════════════════════════════════

test("N-8 · el ALTA usa la MISMA función que la corrección, y contesta 409", () => {
  // El caso que rompía: recepción registraba a un niño de ocho años, salía
  // un 201 limpio y la ficha quedaba sin tutor PARA SIEMPRE — corregirle
  // después el teléfono ya no dispara la regla, por diseño (H-08).
  const fuente = leer(PACIENTES);
  const alta = fuente.slice(
    fuente.indexOf("export async function createEduPatient("),
    fuente.indexOf("export type EduPatientEditFields"),
  );
  assert.ok(alta.length > 0, "no se encontró createEduPatient");
  assert.ok(
    /eduPatientTutorConflict\(\{/.test(alta),
    "el alta no aplica la regla del menor sin tutor",
  );
  assert.ok(
    /throw new EduPadronError\(choqueTutor, 409\)/.test(alta),
    "el alta no contesta 409 con el mensaje de la regla",
  );
  // Y con la MISMA función que el update: dos redacciones de la misma regla
  // es cómo una de las dos se queda atrás.
  const update = fuente.slice(fuente.indexOf("export async function updateEduPatient("));
  assert.ok(
    /eduPatientTutorConflict\(\{/.test(update),
    "la corrección dejó de usar la función compartida",
  );
});

test("N-8 · la regla: menor sin tutor bloquea, con tutor no, y SIN nacimiento no bloquea", () => {
  assert.ok(
    eduPatientTutorConflict({ ageYears: 8, guardianName: null }),
    "un menor sin tutor tiene que bloquear",
  );
  assert.equal(
    eduPatientTutorConflict({ ageYears: 8, guardianName: "Ana López" }),
    null,
    "con tutor no se bloquea nada",
  );
  assert.ok(
    eduPatientTutorConflict({ ageYears: 8, guardianName: "   " }),
    "un tutor de puros espacios no es un tutor",
  );
  // 🔴 SIN FECHA DE NACIMIENTO NO SE BLOQUEA: no se puede afirmar que
  // alguien sea menor, y trancar el alta de todo paciente sin nacimiento
  // —dato opcional— pararía la recepción.
  assert.equal(
    eduPatientTutorConflict({ ageYears: null, guardianName: null }),
    null,
    "sin nacimiento NO se puede bloquear el alta",
  );
  assert.equal(eduPatientTutorConflict({ ageYears: 18, guardianName: null }), null);
});

test("N-8 · sin nacimiento el alta ADVIERTE, y el aviso viaja con el 201", () => {
  const fuente = leer(PACIENTES);
  const alta = fuente.slice(
    fuente.indexOf("export async function createEduPatient("),
    fuente.indexOf("export type EduPatientEditFields"),
  );
  assert.ok(/const aviso =\s*\n?\s*birthDate === null/.test(alta), "el alta no arma ningún aviso");
  assert.ok(/return \{ \.\.\.created, aviso \}/.test(alta), "el aviso no vuelve con el alta");
  const ruta = leer(RUTA_ALTA);
  assert.ok(/aviso: created\.aviso/.test(ruta), "el endpoint no manda el aviso con el 201");
  const lista = leer(LISTA);
  assert.ok(
    /onDone\(res\.folio, res\.aviso \?\? null\)/.test(lista),
    "la pantalla del alta tira el aviso",
  );
});

test("N-8 · el alta CAPTURA al tutor: sin campo, el 409 sería un callejón sin salida", () => {
  const lista = leer(LISTA);
  assert.ok(/edu-p-tutor"/.test(lista), "el alta no tiene campo de tutor");
  assert.ok(/edu-p-tutor-rel"/.test(lista), "el alta no tiene campo de parentesco");
  assert.ok(/guardianName: guardianName\.trim\(\) \|\| null/.test(lista), "el tutor no viaja");
  // Y la pantalla usa la MISMA función del servidor para decirlo ANTES.
  assert.ok(
    /eduPatientTutorConflict\(\{[\s\S]{0,200}eduAgeYears\(birthDate \|\| null\)/.test(lista),
    "el alta no avisa antes de pulsar, con la función del servidor",
  );
  assert.ok(
    /disabled=\{busy \|\| !firstName\.trim\(\) \|\| !lastName\.trim\(\) \|\| conflictoTutor !== null\}/.test(
      lista,
    ),
    "se puede pulsar Registrar con un menor sin tutor",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// N-6 · EL BOTÓN «PDF» SOLO CUANDO EL SERVIDOR LO VA A SERVIR
// ═══════════════════════════════════════════════════════════════════════

test("N-6 · `imprimible` es signedAt, que es EL GATE del servidor — no `content`", () => {
  // El caso que rompía: una carta emitida por error y revocada ANTES de
  // firmarse (flujo querido y documentado) tiene `content` y no tiene
  // firma. El botón colgaba de `content`, así que recepción pulsaba «PDF»
  // con el paciente delante y se le abría el JSON del 409 en una pestaña.
  const lib = leer(CONSENT);
  assert.ok(/imprimible: firmado,/.test(lib), "toRow no manda la bandera del PDF");
  const pdf = lib.slice(lib.indexOf("export async function getEduConsentPdfData"));
  assert.ok(/if \(!c\.signedAt\) \{/.test(pdf), "el gate del servidor dejó de ser signedAt");
  const core = leer(CONSENT_CORE);
  assert.ok(/imprimible: boolean;/.test(core), "EduConsentRow no declara la bandera");
});

test("N-6 · la pantalla cuelga el PDF de `imprimible`, y el modal ya no miente", () => {
  const p = leer(CONSENT_PANTALLA);
  assert.ok(/\{c\.imprimible && \(/.test(p), "el botón PDF sigue colgando de otra cosa");
  assert.ok(
    !/\{c\.content && \(\s*<a/.test(p),
    "sigue habiendo un <a> del PDF colgado de `content`",
  );
  assert.ok(
    /title=\{row\.imprimible \? "La carta que firmó el paciente" : "La carta, sin firmar"\}/.test(p),
    "el modal sigue titulando «firmó el paciente» algo que nadie firmó",
  );
  assert.ok(
    /\{row\.imprimible \? \(/.test(p),
    "el enlace al PDF de dentro del modal no mira la bandera",
  );
});

test("N-6 · y el servidor contesta JSON con mensaje, nunca un cuerpo crudo", () => {
  // `eduApiError` traduce el EduPadronError a `{ error }` con su status.
  // Se fija aquí porque la ruta del PDF es la única del vertical que en el
  // camino feliz NO devuelve JSON, y es fácil que alguien "arregle" el 409
  // devolviendo el buffer igual.
  const ruta = leer("src/app/api/instituto/consentimientos/[id]/pdf/route.ts");
  assert.ok(
    /return eduApiError\(err, "GET \/api\/instituto\/consentimientos\/\[id\]\/pdf"\)/.test(ruta),
    "la ruta del PDF dejó de traducir el error a JSON",
  );
  const guard = leer("src/lib/edu/api-guard.ts");
  assert.ok(
    /NextResponse\.json\(\{ error: err\.message \}, \{ status: err\.status \}\)/.test(guard),
    "eduApiError dejó de mandar el mensaje escrito",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// N-9 · EL BOTÓN «EDITAR» Y EL soloLectura, LA MISMA CONDICIÓN
// ═══════════════════════════════════════════════════════════════════════

test("N-9 · `eduPatientCanEditFicha`: cualquiera de los cuatro permisos abre la ficha", () => {
  const no = { manage: false, contacto: false, clinico: false, origen: false };
  assert.equal(eduPatientCanEditFicha(no), false);
  assert.equal(eduPatientCanEditFicha({ ...no, manage: true }), true);
  // 🔴 EL CASO QUE ROMPÍA: alumno y docente (contacto + clínico, sin manage
  // ni origen) no veían NINGÚN botón «Editar» en la lista.
  assert.equal(eduPatientCanEditFicha({ ...no, contacto: true }), true);
  assert.equal(eduPatientCanEditFicha({ ...no, clinico: true }), true);
  assert.equal(eduPatientCanEditFicha({ ...no, origen: true }), true);
});

test("N-9 · la lista y el modal salen de la MISMA función, no de dos expresiones", () => {
  const lista = leer(LISTA);
  assert.equal(
    (lista.match(/eduPatientCanEditFicha\(\{/g) ?? []).length,
    2,
    "la condición del botón y la del soloLectura no son las dos la función compartida",
  );
  assert.ok(
    !/\{\(canManage \|\| canOrigin\) && \(/.test(lista),
    "el botón «Editar» sigue con la condición corta",
  );
  assert.ok(
    !/const soloLectura = !canManage && !canContacto/.test(lista),
    "el soloLectura del modal sigue con su propia expresión",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// N-10 · setEduPatientOrigin, con recorte de alcance como sus hermanas
// ═══════════════════════════════════════════════════════════════════════

test("N-10 · las TRES escrituras de la ficha buscan dentro del alcance", () => {
  const fuente = leer(PACIENTES);
  for (const fn of [
    "export async function updateEduPatient(",
    "export async function setEduPatientOrigin(",
    "export async function updateEduPatientAntecedentes(",
  ]) {
    const i = fuente.indexOf(fn);
    assert.ok(i > 0, `no se encontró ${fn}`);
    const cuerpo = fuente.slice(i, i + 3500);
    assert.ok(
      /eduPatientScopeWhere\(\{ institutionId, scope, now \}\)/.test(cuerpo),
      `${fn} escribe sin recortar por alcance`,
    );
  }
  // Y la del origen ya no busca por `{ id, institutionId }` a secas.
  const origen = fuente.slice(
    fuente.indexOf("export async function setEduPatientOrigin("),
    fuente.indexOf("export async function updateEduPatientAntecedentes("),
  );
  assert.ok(
    !/where: \{ id, institutionId \}/.test(origen),
    "setEduPatientOrigin sigue buscando sin alcance",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// N-15 · EL MODAL DE CANCELAR DICE LA VERDAD DEL RECORDATORIO
// ═══════════════════════════════════════════════════════════════════════

test("N-15 · la frase: si ya salió, lo DICE; si se paró, también; si no había, también", () => {
  // El caso real: recordatorio a 24 h, cita el jueves a las 10:00,
  // cancelación el miércoles a las 18:00. El aviso salió hace ocho horas,
  // el paciente lo tiene en el teléfono y el modal afirmaba que no sale.
  const yaSalio = eduReminderCancelLabel({ cancelados: 0, yaSalieron: 1 });
  assert.match(yaSalio, /YA le había salido/);
  assert.match(yaSalio, /avísale tú/i);

  const parado = eduReminderCancelLabel({ cancelados: 1, yaSalieron: 0 });
  assert.match(parado, /no le llega nada/);

  const nada = eduReminderCancelLabel({ cancelados: 0, yaSalieron: 0 });
  assert.match(nada, /No había ningún recordatorio/);

  // Si ya salió, eso MANDA aunque además se cancelara alguno en cola: lo
  // accionable es que hay que llamar al paciente.
  assert.match(eduReminderCancelLabel({ cancelados: 1, yaSalieron: 1 }), /YA le había salido/);
});

test("N-15 · «ya salió» es SENT y solo SENT, y el resultado sube hasta la pantalla", () => {
  const rec = leer(RECORDATORIOS);
  assert.ok(
    /filas\.filter\(\(f\) => f\.status === "SENT"\)\.length/.test(rec),
    "se cuenta como «entregado» algo que no es SENT (un CANCELLED de una vuelta anterior, por ejemplo)",
  );
  assert.ok(
    /Promise<EduReminderCancelResult>/.test(rec),
    "applyEduReminderCancel volvió a devolver un número pelado",
  );
  const agenda = leer(AGENDA);
  assert.ok(
    /return \{ id: current\.id, status, recordatorio \};/.test(agenda),
    "setEduAppointmentStatus no propaga qué pasó con el recordatorio",
  );
  const ruta = leer(RUTA_CITA);
  assert.ok(
    /recordatorioAviso: eduReminderCancelLabel\(res\.recordatorio\)/.test(ruta),
    "el endpoint de cancelar no manda la frase",
  );
});

test("N-15 · el modal ya no PROMETE que el recordatorio no sale", () => {
  const acc = leer(ACCIONES);
  assert.ok(
    !/el recordatorio automático no sale/.test(acc),
    "el modal sigue afirmando, sin condición, que el recordatorio no sale",
  );
  assert.ok(
    /si ya le salió,\s+te lo decimos al\s+terminar/.test(acc),
    "el modal no explica el caso en el que el aviso ya salió",
  );
  assert.ok(
    /setAvisoRecordatorio\(res\?\.recordatorioAviso \?\? null\)/.test(acc),
    "la pantalla tira la respuesta del servidor",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// H-05 (la mitad que faltaba) · EL DESPLEGABLE NO OFRECE INACTIVOS
// ═══════════════════════════════════════════════════════════════════════

test("H-05 · listEduPatientOptions excluye INACTIVE — y NO excluye DISCHARGED", () => {
  // INACTIVE es el estado que recepción le pone al duplicado (no se borra:
  // NOM-004; no se fusiona: no existe la función). Que siguiera saliendo en
  // el desplegable de agendar es lo que volvía a partir el expediente.
  // DISCHARGED es el final NORMAL de un caso y ese paciente vuelve.
  const fuente = leer(PACIENTES);
  const i = fuente.indexOf("export async function listEduPatientOptions");
  assert.ok(i > 0, "no existe listEduPatientOptions");
  const cuerpo = fuente.slice(i, fuente.indexOf("// ═══", i + 100));
  assert.ok(
    /where\.status = \{ not: "INACTIVE" \}/.test(cuerpo),
    "el desplegable de agendar sigue ofreciendo pacientes inactivos",
  );
  assert.ok(
    !/DISCHARGED/.test(cuerpo.replace(/\/\/.*$/gm, "")),
    "el desplegable dejó fuera a los pacientes dados de alta, que sí vuelven",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// N-16 · LOS DE LA FICHA Y LA CARTA
// ═══════════════════════════════════════════════════════════════════════

test("N-16 · `notes` lanza como los otros catorce textos, en el alta y en la corrección", () => {
  // `PATCH {notes: 123}` BORRABA las notas de recepción y contestaba 200:
  // `eduOptionalText(...) ?? null` convertía en null lo que no era texto.
  const fuente = leer(PACIENTES);
  assert.ok(
    !/eduOptionalText\(input\.notes, 1000\) \?\? null/.test(fuente),
    "`notes` sigue tragándose lo que no es texto",
  );
  assert.equal(
    (fuente.match(/texto\("notes", input\.notes, 1000\)/g) ?? []).length,
    2,
    "`notes` no pasa por `texto()` en las DOS escrituras (alta y corrección)",
  );
});

test("N-16 · createEduPatient GUARDA los campos de la Ola B en vez de tirarlos", () => {
  const fuente = leer(PACIENTES);
  const alta = fuente.slice(
    fuente.indexOf("export async function createEduPatient("),
    fuente.indexOf("export type EduPatientEditFields"),
  );
  assert.ok(/const olaB = parseEduPatientOlaB\(input, now\)/.test(alta), "el alta no los sanea");
  assert.ok(/\.\.\.olaB,/.test(alta), "el alta los sanea y no los escribe");
  // Y el índice de búsqueda los recoge desde el alta, no en la primera
  // edición: un paciente registrado con CURP se busca por su CURP.
  assert.ok(/curp: olaB\.curp \?\? null/.test(alta), "el índice del alta ignora el CURP");
  assert.ok(/phone2: olaB\.phone2 \?\? null/.test(alta), "el índice del alta ignora el 2º teléfono");
});

test("N-16 · CURP, código postal y teléfonos BLOQUEAN el guardado, nombrando el campo", () => {
  // El PATCH es ATÓMICO: un CURP de 17 caracteres tumbaba el apellido
  // corregido y el domicilio recién capturado, y el error hablaba solo del
  // CURP. La pantalla solo avisaba en ámbar y dejaba pulsar Guardar.
  const curp = eduPatientFormFieldError({ curp: "ABCD900101HDFXYZ0" });
  assert.ok(curp && /CURP/.test(curp), "un CURP corto no bloquea, o el mensaje no lo nombra");

  const cp = eduPatientFormFieldError({ addressZip: "123" });
  assert.ok(cp && /[Cc]ódigo postal/.test(cp), "un CP de tres dígitos no bloquea");

  const tel = eduPatientFormFieldError({ phone: "55" });
  assert.ok(tel && /[Tt]eléfono del paciente/.test(tel), "un teléfono de dos dígitos no bloquea");

  const tel2 = eduPatientFormFieldError({ phone2: "55" });
  assert.ok(tel2 && /[Ss]egundo teléfono/.test(tel2), "el segundo teléfono no bloquea");

  const tutor = eduPatientFormFieldError({ guardianPhone: "sin numeros" });
  assert.ok(tutor && /tutor/.test(tutor), "un teléfono de tutor sin dígitos no bloquea");

  // Lo bueno pasa…
  assert.equal(
    eduPatientFormFieldError({
      curp: "LOAM900315MDFPRR07",
      addressZip: "06700",
      phone: "5544332211",
      phone2: "5599887766",
      guardianPhone: "+52 (55) 1234 5678 ext. 9",
    }),
    null,
  );
  // …y VACIAR un campo también: `null` es «bórralo», no un valor malo.
  assert.equal(eduPatientFormFieldError({ curp: null, addressZip: null, phone: null }), null);
  // …y lo que NO viaja en el diff no atrapa a nadie: en la base hay CURP
  // escritos a mano antes de que existiera la validación, y corregirle el
  // teléfono a ese paciente no puede quedar bloqueado.
  assert.equal(eduPatientFormFieldError({ phone: "5544332211" }), null);
  assert.equal(eduPatientFormFieldError({}), null);
});

test("N-16 · el guardado bloqueado apaga el botón en los DOS montajes", () => {
  const form = leer(FORM);
  assert.ok(
    /puedeGuardar: hayCambios && !conflictoEstado && !conflictoTutor && !errorCampo/.test(form),
    "la pestaña Datos deja guardar con un campo que el servidor va a rebotar",
  );
  assert.ok(/\{form\.errorCampo && \(/.test(form), "el motivo no se pinta junto al botón");
  const lista = leer(LISTA);
  assert.ok(
    /!form\.conflictoTutor && !form\.errorCampo/.test(lista),
    "el modal de la lista deja guardar con un campo que el servidor va a rebotar",
  );
});

test("N-16 · tras guardar, el formulario se resiembra con la fila NUEVA", () => {
  // Bajo el «Listo» verde seguían los valores VIEJOS hasta que aterrizaba
  // el router.refresh(). Y el saneo del servidor no es cosmético: el
  // teléfono vuelve en diez dígitos y el folio en mayúsculas.
  const ruta = leer(RUTA_FICHA);
  assert.ok(
    /const row = await getEduPatient\(g\.ctx, updated\.id\)/.test(ruta),
    "el PATCH no devuelve la fila guardada",
  );
  assert.ok(/\{ ok: true, id: updated\.id, row \}/.test(ruta), "la fila no viaja en la respuesta");
  const form = leer(FORM);
  assert.ok(/form\.resembrar\(res\?\.row\)/.test(form), "la resiembra sigue usando la fila vieja");
});

test("N-16 · una firma que no es PNG ni JPEG no tumba el PDF: se descarta", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  assert.match(eduSignatureDataUrl(png) ?? "", /^data:image\/png;base64,/);

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  assert.match(eduSignatureDataUrl(jpeg) ?? "", /^data:image\/jpeg;base64,/);

  // 🔴 EL CASO QUE ROMPÍA: `validateSignatureDataUrl` acepta WEBP y
  // `guardarFirma` lo sube como `.png`. Al armar el PDF se le pegaba encima
  // un `data:image/png` y el renderer lanzaba: 500 genérico, y esa carta no
  // se podía imprimir nunca más.
  const webp = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([0x24, 0, 0, 0]),
    Buffer.from("WEBPVP8 "),
  ]);
  assert.equal(eduSignatureDataUrl(webp), null, "un WEBP se sigue colando como PNG");

  assert.equal(eduSignatureDataUrl(Buffer.alloc(0)), null);
  assert.equal(eduSignatureDataUrl(null), null);
});

test("N-16 · y el render del PDF va dentro de un try/catch con mensaje", () => {
  const pdf = leer(CONSENT_PDF);
  const build = pdf.slice(pdf.indexOf("export async function buildEduConsentPdf"));
  assert.ok(/try \{/.test(build), "renderToBuffer sigue sin red debajo");
  assert.ok(/throw new EduPadronError\(/.test(build), "el fallo del render sigue saliendo como 500");
  assert.ok(
    /Ver la carta firmada/.test(build),
    "el mensaje no dice por dónde SÍ se puede leer la carta",
  );
  const lib = leer(CONSENT);
  assert.ok(
    /const url = eduSignatureDataUrl\(buf\)/.test(lib),
    "el `data:` de la firma se vuelve a armar a ciegas como PNG",
  );
  assert.ok(
    !/data:image\/png;base64,\$\{buf\.toString\("base64"\)\}/.test(lib),
    "sigue habiendo un data:image/png pegado sobre bytes sin comprobar",
  );
});

test("N-16 · el folio va SANEADO en la cabecera Content-Disposition", () => {
  // Se saneaba el procedimiento y no el folio, y los dos salen por la misma
  // cabecera. Una escuela con numeración propia puede tener folios con
  // acentos, comillas o barras.
  assert.equal(eduConsentFileSlug('P/0088"ñ', 30), "p-0088-n");
  const nombre = eduConsentPdfFileName('EXP "01"/A', "Extracción dental", "abcdef0123456789");
  assert.equal(nombre, "consentimiento-exp-01-a-extraccion-dental-abcdef01.pdf");
  assert.ok(!/["/\\\r\n]/.test(nombre), "el nombre del archivo lleva caracteres de cabecera");
  // Un folio que se queda sin nada utilizable no deja el nombre partido.
  assert.equal(
    eduConsentPdfFileName("///", "///", "0123456789ab"),
    "consentimiento-paciente-carta-01234567.pdf",
  );
});

test("N-16 · el comentario obsoleto de pacientes-core está corregido", () => {
  const core = leer(CORE);
  assert.ok(
    !/NO SE MONTAN EN ESTA OLA/.test(core),
    "pacientes-core sigue diciendo que los chips no se montan; el layout los monta",
  );
  // Y el layout, en efecto, los monta.
  const layout = leer("src/app/instituto/(panel)/pacientes/[id]/layout.tsx");
  assert.ok(/eduPatientFichaChips\(\{/.test(layout), "el layout dejó de montar los chips");
});

test("N-16 · `isChild` (dentición temporal) NO pinta «menor sin tutor»", () => {
  // Un ADULTO con dentición temporal marcada llevaba en las doce pestañas
  // un chip que decía que era menor, mientras la pestaña Datos del mismo
  // paciente no decía nada y el servidor le dejaba guardar sin tutor.
  const adulto = eduPatientFichaChips({
    ageYears: 34,
    guardianName: null,
    guardianRelation: null,
    pregnancy: null,
    isChild: true,
  });
  assert.deepEqual(adulto, [], "la dentición temporal sigue decidiendo quién es menor");

  // Y la edad sigue decidiendo, con o sin `isChild`.
  for (const isChild of [true, false]) {
    const menor = eduPatientFichaChips({
      ageYears: 9,
      guardianName: null,
      guardianRelation: null,
      pregnancy: null,
      isChild,
    });
    assert.equal(menor.length, 1);
    assert.equal(menor[0].kind, "menor");
    assert.equal(menor[0].tone, "warn");
  }

  // Un paciente SIN nacimiento no es menor ni deja de serlo: no se afirma
  // nada, que es la misma decisión del servidor.
  assert.deepEqual(
    eduPatientFichaChips({
      ageYears: null,
      guardianName: null,
      guardianRelation: null,
      pregnancy: null,
      isChild: true,
    }),
    [],
  );

  // Y la edad la calcula la misma función de siempre.
  assert.equal(eduAgeYears("2018-01-01", new Date("2026-09-07T12:00:00Z")), 8);
});

// ═══════════════════════════════════════════════════════════════════════
// ⛔ EL SEPARADOR DEL PDF NO SE TOCA (y esto es el candado)
// ═══════════════════════════════════════════════════════════════════════

test("⛔ el separador U+2500 del bloque de escuela sigue INTACTO", () => {
  // 🔴 ESTO NO ES UN OLVIDO, ES UN CANDADO. El separador no existe en
  // Helvetica/WinAnsi y en el PDF sale en blanco o como basura — pero
  // CAMBIAR EL TEXTO CAMBIA EL HASH de todas las cartas nuevas, y el hash
  // es lo que permite decir «este documento sigue siendo el que se firmó».
  // Tocarlo sin subir `EDU_CONSENT_HASH_VERSION` parte las cartas viejas de
  // las nuevas en silencio. Se queda como está y se arregla en la Ola C.
  const core = leer(CONSENT_CORE);
  assert.ok(
    core.includes('"─────────────────────────────────────────────"'),
    "alguien cambió el separador del bloque de escuela: eso cambia el hash de las cartas",
  );
  assert.equal(
    EDU_CONSENT_HASH_VERSION,
    "edu-consent-v1",
    "la versión del hash cambió: si fue a propósito, actualiza esta prueba y dilo en el reporte",
  );
});
