/**
 * EL EXPEDIENTE CLÍNICO — la prueba central de la Ola 3 de DaleControl
 * INSTITUCIONAL.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-expediente.test.ts
 *
 * (No hay `npm run test:edu-expediente`: package.json es un archivo del
 * producto dental y esta ola no lo toca. Cuando el vertical se integre a
 * main, es UNA línea.)
 *
 * Todo se comprueba SIN base de datos: los módulos `-core` son puros y
 * devuelven objetos `where`, `Records` y paths, así que aquí se lee lo que
 * Prisma y Storage recibirían. Es a propósito — una prueba de integración
 * contra Postgres habría verificado lo mismo y no se habría podido correr
 * en este entorno.
 *
 * Lo que fija este archivo:
 *  1. 🔴 CAJA NO VE EL EXPEDIENTE. Tiene su propia sección, con las tres
 *     cosas (notas, odontograma, estudios) y con el error concreto que la
 *     rompería: leerlo con el alcance de "patients" en vez del de "cases".
 *  2. NOM-004 — una nota firmada no se edita, y los sellos se DERIVAN.
 *  3. El odontograma valida diente, cara y hallazgo CONTRA EL CATÁLOGO, y
 *     la key reservada de la nota no se puede mandar como hallazgo.
 *  4. El path de un estudio SIEMPRE lleva el institutionId adentro, y no se
 *     puede escapar de su carpeta.
 *  5. 2 GB no caben en un INTEGER de Postgres (por eso sizeBytes es BigInt).
 *  6. Que las uniones de types.ts no se desincronicen de los enums de
 *     Prisma (chequeo de TIPOS, lo verifica `tsc --noEmit`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  EduRecordStatus as PrismaRecordStatus,
  EduStudyKind as PrismaStudyKind,
} from "@prisma/client";
import {
  EDU_CLINICAL_NONE_DETAIL,
  EDU_RECORD_DIAGNOSIS_MAX,
  EDU_RECORD_TEXT_MAX,
  EDU_SOAP_FIELDS,
  EDU_SOAP_HINTS,
  EDU_SOAP_LABELS,
  eduClinicalScope,
  eduRecordCanTransition,
  eduRecordHasContent,
  eduRecordIsEditable,
  eduRecordStamps,
  eduRecordText,
  parseEduRecordStatus,
} from "../expediente-core";
import {
  EDU_ODONTOGRAM_NOTE_KEY,
  EDU_SURFACES,
  EDU_TOOTH_WHOLE,
  eduAllFdi,
  eduConditionLabel,
  eduConditionTarget,
  eduEntriesToRecords,
  eduIsValidFdi,
  eduOdontogramSummary,
  eduRecordsSummary,
  eduSurfaceFitsTooth,
  parseEduCondition,
  parseEduFdi,
  parseEduOdontogramTarget,
  parseEduSurface,
  type EduOdontogramEntryRow,
} from "../odontograma-core";
import {
  EDU_FILES_BUCKET,
  EDU_MAX_STUDY_BYTES,
  EDU_SIGNED_URL_TTL_SECONDS,
  EDU_STUDY_EXT,
  eduExtOfName,
  eduFormatBytes,
  eduIsStudyExt,
  eduMimeForExt,
  eduSafeStudyFileName,
  eduStudyIsImage,
  eduStudyIsPdf,
  eduStudyKindForExt,
  eduStudyPathBelongsTo,
  eduStudyPathIsSafe,
  eduStudyPathPrefix,
  eduStudyStoragePath,
} from "../estudios-core";
import {
  eduCaseScopeWhere,
  eduPatientScopeWhere,
  eduScopeIsEmpty,
  eduVisibility,
} from "../visibility";
import {
  EDU_RECORD_STATUSES,
  EDU_RECORD_STATUS_DESCRIPTIONS,
  EDU_RECORD_STATUS_LABELS,
  EDU_RECORD_TRANSITIONS,
  EDU_STUDY_KINDS,
  EDU_STUDY_KIND_DESCRIPTIONS,
  EDU_STUDY_KIND_LABELS,
  type EduRecordStatus,
  type EduRole,
  type EduStudyKind,
} from "../types";

// ─────────────────────────────────────────────────────────────────────
// 0 · Candado de tipos: las uniones de types.ts == los enums de Prisma
//     Si una ola agrega un valor al schema y no lo agrega a types.ts (o al
//     revés), `tsc --noEmit` falla aquí. En runtime esto no existe.
// ─────────────────────────────────────────────────────────────────────
type Exacto<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

const _recordStatus: Exacto<EduRecordStatus, PrismaRecordStatus> = true;
const _studyKind: Exacto<EduStudyKind, PrismaStudyKind> = true;
void _recordStatus;
void _studyKind;

const INST = "inst_1";
const OTRO_INST = "inst_2";
const AHORA = new Date("2026-08-29T18:00:00.000Z");

function actor(role: EduRole, eduUserId = "u_1") {
  return { role, eduUserId };
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · 🔴 CAJA NO VE EL EXPEDIENTE
//
// Es la regla que más fácil se rompe, así que va primero y con su propia
// sección. Se rompe de una forma muy concreta: el odontograma y los
// estudios cuelgan del PACIENTE en la base, así que "lo natural" es
// leerlos con el alcance de "patients" — y para caja ese alcance es TODO.
// ═══════════════════════════════════════════════════════════════════════

test("CAJA: el alcance del expediente es 'none' (notas, odontograma y estudios)", () => {
  const caja = actor("CAJA", "u_caja");
  const scope = eduClinicalScope(caja);

  assert.equal(scope.kind, "none", "caja no abre expediente clínico");
  assert.equal(eduScopeIsEmpty(scope), true);
});

test("CAJA: el `where` del expediente no devuelve NI UNA fila", () => {
  const caja = actor("CAJA", "u_caja");
  const scope = eduClinicalScope(caja);

  // Notas: cuelgan del caso.
  const casos = eduCaseScopeWhere({ institutionId: INST, scope, now: AHORA });
  assert.deepEqual(casos, { institutionId: INST, id: { in: [] } });

  // Odontograma y estudios: cuelgan del paciente, PERO se leen con el
  // alcance de "cases". Este es exactamente el `where` que arma
  // getEduClinicalPatient.
  const pacientes = eduPatientScopeWhere({ institutionId: INST, scope, now: AHORA });
  assert.deepEqual(pacientes, { institutionId: INST, id: { in: [] } });
});

test("🔴 EL ERROR QUE ROMPERÍA LA REGLA: leer el expediente con el alcance de 'patients'", () => {
  // Esta prueba documenta el bug y garantiza que si alguien "arregla"
  // eduClinicalScope para que use "patients" —porque el odontograma cuelga
  // del paciente, que es lo que parece natural— la suite se pone roja.
  const caja = actor("CAJA", "u_caja");

  const malo = eduVisibility(caja, "patients");
  const bueno = eduVisibility(caja, "cases");

  assert.equal(malo.kind, "all", "para caja, 'patients' es TODO (recibe, agenda y cobra)");
  assert.equal(bueno.kind, "none", "para caja, 'cases' es NADA");
  assert.notEqual(
    malo.kind,
    bueno.kind,
    "si estos dos coinciden, alguien cambió el contrato: revísalo antes de tocar la prueba",
  );

  // Con el alcance equivocado, el `where` deja de recortar: devuelve el
  // instituto ENTERO.
  const conElMalo = eduPatientScopeWhere({ institutionId: INST, scope: malo, now: AHORA });
  assert.deepEqual(conElMalo, { institutionId: INST }, "el alcance de 'patients' NO recorta");

  // Y eduClinicalScope usa el bueno. Ésta es la línea que cierra la puerta.
  assert.equal(eduClinicalScope(caja).kind, "none");
});

test("CAJA no tiene ninguno de los seis permisos del expediente (segundo candado)", async () => {
  const { hasEduPermission } = await import("../permissions");
  const keys = [
    "expediente.view",
    "expediente.write",
    "odontograma.view",
    "odontograma.edit",
    "estudios.view",
    "estudios.upload",
  ] as const;
  for (const k of keys) {
    assert.equal(
      hasEduPermission({ role: "CAJA" }, k),
      false,
      `CAJA no debería traer ${k} por defecto`,
    );
  }
  // Y aunque se lo encendieran a mano (override), el ALCANCE sigue diciendo
  // que no. Dos candados: uno solo se abre por accidente.
  assert.equal(
    hasEduPermission({ role: "CAJA", permissionsOverride: ["expediente.view"] }, "expediente.view"),
    true,
    "el override sí le enciende el permiso…",
  );
  assert.equal(
    eduClinicalScope(actor("CAJA")).kind,
    "none",
    "…y aun así el alcance no le da ni una fila",
  );
});

test("los otros tres roles SÍ abren expediente, con su recorte", () => {
  assert.equal(eduClinicalScope(actor("DIRECCION")).kind, "all");
  assert.deepEqual(eduClinicalScope(actor("DOCENTE", "u_doc")), {
    kind: "supervised",
    supervisorUserId: "u_doc",
  });
  assert.deepEqual(eduClinicalScope(actor("ALUMNO", "u_alu")), {
    kind: "own",
    studentUserId: "u_alu",
  });
});

test("un ALUMNO solo ve el expediente de SUS casos (y de sus citas)", () => {
  const scope = eduClinicalScope(actor("ALUMNO", "u_alu"));
  const where = eduPatientScopeWhere({ institutionId: INST, scope, now: AHORA });

  assert.equal(where.institutionId, INST);
  assert.ok(Array.isArray(where.OR) && where.OR.length === 2, "cuelga de casos O de citas");
  const json = JSON.stringify(where);
  assert.ok(json.includes("u_alu"), "el recorte lleva el userId del alumno");
  assert.equal(json.includes(OTRO_INST), false, "no se cuela otro instituto");
});

test("un DOCENTE con la asignación VENCIDA deja de ver ese expediente", () => {
  const scope = eduClinicalScope(actor("DOCENTE", "u_doc"));
  const where = eduCaseScopeWhere({ institutionId: INST, scope, now: AHORA });
  const json = JSON.stringify(where);

  // El predicado de vigencia lo pone eduCurrentAssignmentWhere (padron-core)
  // y aquí solo se comprueba que ESTÉ: si el recorte del expediente lo
  // olvidara, un docente que ya rotó seguiría leyendo notas clínicas de
  // alumnos que entregó.
  assert.ok(json.includes("startsAt"), "falta el límite inferior de la vigencia");
  assert.ok(json.includes("endsAt"), "falta el límite superior de la vigencia");
  assert.ok(json.includes("u_doc"));
});

test("un institutionId vacío LANZA en vez de devolver el expediente de todos", () => {
  const scope = eduClinicalScope(actor("DIRECCION"));
  // En Prisma, `where: { institutionId: undefined }` no devuelve cero filas:
  // BORRA el filtro y devuelve las de TODOS los institutos.
  assert.throws(() => eduPatientScopeWhere({ institutionId: "", scope, now: AHORA }));
  assert.throws(() => eduCaseScopeWhere({ institutionId: "", scope, now: AHORA }));
});

test("el texto que se le pinta a caja explica POR QUÉ, no solo que no puede", () => {
  assert.ok(EDU_CLINICAL_NONE_DETAIL.length > 60);
  assert.ok(/[Cc]aja/.test(EDU_CLINICAL_NONE_DETAIL), "tiene que nombrar a caja");
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · NOM-004 · LA NOTA FIRMADA NO SE EDITA
// ═══════════════════════════════════════════════════════════════════════

test("los tres estados existen, con etiqueta y explicación en español", () => {
  assert.deepEqual([...EDU_RECORD_STATUSES].sort(), ["BORRADOR", "ENVIADA", "FIRMADA"]);
  for (const s of EDU_RECORD_STATUSES) {
    assert.ok(EDU_RECORD_STATUS_LABELS[s], `falta la etiqueta de ${s}`);
    assert.notEqual(EDU_RECORD_STATUS_LABELS[s], s, `${s} se pinta con el valor del enum`);
    assert.ok(EDU_RECORD_STATUS_DESCRIPTIONS[s].length > 15, `falta la explicación de ${s}`);
  }
});

test("FIRMADA es un estado FINAL: no lleva a ningún lado", () => {
  assert.deepEqual(EDU_RECORD_TRANSITIONS.FIRMADA, []);
  for (const destino of EDU_RECORD_STATUSES) {
    assert.equal(
      eduRecordCanTransition("FIRMADA", destino),
      false,
      `una nota firmada no puede pasar a ${destino}`,
    );
  }
});

test("una nota FIRMADA no es editable; las otras dos sí", () => {
  assert.equal(eduRecordIsEditable("FIRMADA"), false);
  assert.equal(eduRecordIsEditable("BORRADOR"), true);
  assert.equal(eduRecordIsEditable("ENVIADA"), true);
});

test("las transiciones legítimas son exactamente las del contrato", () => {
  assert.equal(eduRecordCanTransition("BORRADOR", "ENVIADA"), true);
  // Escribir y cerrar en un solo acto es legítimo (lo hace la dirección).
  assert.equal(eduRecordCanTransition("BORRADOR", "FIRMADA"), true);
  assert.equal(eduRecordCanTransition("ENVIADA", "FIRMADA"), true);
  // Devolver para corregir: sin esa vuelta, la única forma de arreglar una
  // nota entregada con un dedazo sería firmarla mal y corregirla después.
  assert.equal(eduRecordCanTransition("ENVIADA", "BORRADOR"), true);
});

test("los sellos se DERIVAN del estado: no existe una firmada sin fecha de firma", () => {
  const sinEnviar = { submittedAt: null };

  const firmada = eduRecordStamps("FIRMADA", AHORA, "u_doc", sinEnviar);
  assert.deepEqual(firmada.signedAt, AHORA);
  assert.equal(firmada.signedByUserId, "u_doc");
  // Firmar sin haber entregado pone las dos marcas en el mismo instante: la
  // alternativa era una nota firmada sin fecha de entrega.
  assert.deepEqual(firmada.submittedAt, AHORA);

  const entregada = eduRecordStamps("ENVIADA", AHORA, "u_alu", sinEnviar);
  assert.deepEqual(entregada.submittedAt, AHORA);
  assert.equal(entregada.signedAt, null, "entregar no firma");
  assert.equal(entregada.signedByUserId, null);
});

test("firmar una nota YA entregada respeta la fecha de entrega original", () => {
  const entregadaEl = new Date("2026-08-27T10:00:00.000Z");
  const s = eduRecordStamps("FIRMADA", AHORA, "u_doc", { submittedAt: entregadaEl });
  assert.deepEqual(s.submittedAt, entregadaEl, "la entrega no se reescribe al firmar");
  assert.deepEqual(s.signedAt, AHORA);
});

test("devolver a BORRADOR limpia los DOS sellos", () => {
  const s = eduRecordStamps("BORRADOR", AHORA, "u_doc", {
    submittedAt: new Date("2026-08-27T10:00:00.000Z"),
  });
  // Si el sello de entrega se quedara puesto, la lista diría "entregada
  // hace tres días" de algo que el alumno está reescribiendo ahora.
  assert.equal(s.submittedAt, null);
  assert.equal(s.signedAt, null);
  assert.equal(s.signedByUserId, null);
});

test("un estado inventado no pasa el saneo", () => {
  assert.equal(parseEduRecordStatus("FIRMADO"), null);
  assert.equal(parseEduRecordStatus("borrador"), null);
  assert.equal(parseEduRecordStatus(null), null);
  assert.equal(parseEduRecordStatus(3), null);
  assert.equal(parseEduRecordStatus("FIRMADA"), "FIRMADA");
});

test("una nota VACÍA no cuenta como escrita (no se entrega ni se firma)", () => {
  assert.equal(eduRecordHasContent({}), false);
  assert.equal(eduRecordHasContent({ subjetivo: "   ", plan: "" }), false);
  assert.equal(eduRecordHasContent({ plan: "Se cita en 15 días" }), true);
  // Solo el diagnóstico también es contenido: hay notas de control que son
  // exactamente eso.
  assert.equal(eduRecordHasContent({ diagnostico: "K02.1" }), true);
});

test("el texto del SOAP: vacío BORRA, ausente NO TOCA, y se recorta al tope", () => {
  assert.equal(eduRecordText(undefined, 100), undefined, "ausente = no lo cambies");
  assert.equal(eduRecordText(null, 100), null);
  assert.equal(eduRecordText("   ", 100), null, "en blanco = borrar");
  assert.equal(eduRecordText("  hola  ", 100), "hola");
  assert.equal(eduRecordText("x".repeat(5000), EDU_RECORD_TEXT_MAX).length, EDU_RECORD_TEXT_MAX);
  assert.equal(eduRecordText(42, 100), undefined, "lo que no es texto no cambia nada");
});

test("los topes del SOAP empatan con el schema (VarChar 4000 y 500)", () => {
  // Si aquí fueran más grandes, la base rebotaría la escritura con un error
  // de Postgres en vez de un mensaje escrito para una persona.
  assert.equal(EDU_RECORD_TEXT_MAX, 4000);
  assert.equal(EDU_RECORD_DIAGNOSIS_MAX, 500);
});

test("los cuatro campos del SOAP tienen etiqueta y pista en español", () => {
  assert.deepEqual([...EDU_SOAP_FIELDS], ["subjetivo", "objetivo", "analisis", "plan"]);
  for (const f of EDU_SOAP_FIELDS) {
    assert.ok(EDU_SOAP_LABELS[f], `falta la etiqueta de ${f}`);
    assert.ok(EDU_SOAP_HINTS[f].length > 20, `falta la pista de ${f}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL ODONTOGRAMA
// ═══════════════════════════════════════════════════════════════════════

test("los dientes FDI válidos son 32 permanentes + 20 temporales", () => {
  const todos = eduAllFdi();
  assert.equal(todos.length, 52);
  for (const t of todos) assert.equal(eduIsValidFdi(t), true, `${t} debería ser válido`);
});

test("los dientes que NO existen se rechazan", () => {
  // 56 no existe: los cuadrantes temporales llegan a la pieza 5.
  for (const malo of [0, 10, 19, 20, 49, 50, 56, 58, 86, 90, 99, 11.5, -11, NaN]) {
    assert.equal(eduIsValidFdi(malo), false, `${malo} no debería ser válido`);
  }
  assert.equal(parseEduFdi("16"), 16, "acepta el número como texto (un <input> lo manda así)");
  assert.equal(parseEduFdi("dieciséis"), null);
  assert.equal(parseEduFdi(null), null);
});

test("la cara VACÍA significa 'el diente entero' y no es lo mismo que una cara inválida", () => {
  // Los dos se parecen y confundirlos escribiría en el diente completo un
  // hallazgo que la persona marcó en una cara concreta.
  assert.equal(parseEduSurface(null), EDU_TOOTH_WHOLE);
  assert.equal(parseEduSurface(undefined), EDU_TOOTH_WHOLE);
  assert.equal(parseEduSurface(""), EDU_TOOTH_WHOLE);
  assert.equal(parseEduSurface("X"), null, "esa cara no existe");
  assert.equal(parseEduSurface("o"), "O", "se normaliza a mayúscula");
  for (const s of EDU_SURFACES) assert.equal(parseEduSurface(s), s);
});

test("un molar tiene oclusal y un incisivo incisal, no al revés", () => {
  assert.equal(eduSurfaceFitsTooth(16, "O"), true, "el 16 es molar: oclusal");
  assert.equal(eduSurfaceFitsTooth(16, "I"), false, "el 16 no tiene incisal");
  assert.equal(eduSurfaceFitsTooth(11, "I"), true, "el 11 es incisivo: incisal");
  assert.equal(eduSurfaceFitsTooth(11, "O"), false);
  // Las cuatro laterales existen en todos.
  for (const c of ["M", "D", "V", "L"]) {
    assert.equal(eduSurfaceFitsTooth(16, c), true);
    assert.equal(eduSurfaceFitsTooth(11, c), true);
  }
});

test("un hallazgo que NO está en el catálogo se rechaza", () => {
  // Sin esto el odontograma acepta texto libre: la fila se guarda y al
  // pintar no hay glifo que dibujar — un hallazgo invisible que sí ocupa
  // una fila y sí sale en los conteos.
  assert.equal(parseEduCondition("lo_que_sea"), null);
  assert.equal(parseEduCondition(""), null);
  assert.equal(parseEduCondition(42), null);
  assert.equal(parseEduCondition("caries"), "caries", "sí está en el catálogo");
  assert.equal(parseEduCondition("crown"), "crown");
  assert.equal(parseEduCondition("rct"), "rct");
});

test("🔴 la key RESERVADA de la nota NO se puede mandar como hallazgo", () => {
  // Si pasara, el pincel podría crear o borrar la nota de un diente.
  assert.equal(parseEduCondition(EDU_ODONTOGRAM_NOTE_KEY), null);
  assert.equal(parseEduCondition("__nota__"), null);
  assert.equal(parseEduCondition("__lo_que_sea__"), null);
  // Y el saneo completo tampoco la deja pasar.
  const r = parseEduOdontogramTarget({ tooth: 16, condition: EDU_ODONTOGRAM_NOTE_KEY });
  assert.equal(r.ok, false);
});

test("un hallazgo de DIENTE se guarda siempre en el diente entero, aunque manden una cara", () => {
  // Si se respetara la cara, la misma corona entraría CINCO veces, una por
  // superficie, y el índice único no lo impediría.
  assert.equal(eduConditionTarget("crown"), "tooth");
  const r = parseEduOdontogramTarget({ tooth: 16, surface: "O", condition: "crown" });
  assert.equal(r.ok, true);
  assert.equal(r.value.surface, EDU_TOOTH_WHOLE);
  assert.equal(r.value.tooth, 16);
});

test("un hallazgo de CARA sin cara se rechaza con un mensaje que se entiende", () => {
  assert.equal(eduConditionTarget("caries"), "surface");
  const r = parseEduOdontogramTarget({ tooth: 16, surface: null, condition: "caries" });
  assert.equal(r.ok, false);
  assert.ok(/cara/i.test(r.error), `el mensaje debería hablar de la cara: ${r.error}`);
  assert.ok(r.error.includes("Caries"), "y nombrar el hallazgo en español");
});

test("una caries incisal en un molar se rechaza", () => {
  const r = parseEduOdontogramTarget({ tooth: 16, surface: "I", condition: "caries" });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("16"));
});

test("un sellante solo va en oclusal (surfacesOnly del catálogo)", () => {
  const bueno = parseEduOdontogramTarget({ tooth: 16, surface: "O", condition: "sealant" });
  assert.equal(bueno.ok, true);
  const malo = parseEduOdontogramTarget({ tooth: 16, surface: "V", condition: "sealant" });
  assert.equal(malo.ok, false);
});

test("una caries mesial en un molar se acepta tal cual", () => {
  const r = parseEduOdontogramTarget({ tooth: 26, surface: "M", condition: "caries" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { tooth: 26, surface: "M", condition: "caries" });
});

test("las filas planas se convierten en el mapa que pinta el dibujo", () => {
  const filas: EduOdontogramEntryRow[] = [
    fila("e1", 16, "O", "caries"),
    fila("e2", 16, "M", "caries"),
    fila("e3", 16, EDU_TOOTH_WHOLE, "crown"),
    fila("e4", 11, EDU_TOOTH_WHOLE, EDU_ODONTOGRAM_NOTE_KEY, "Duele al frío"),
  ];
  const records = eduEntriesToRecords(filas);

  assert.deepEqual(records[16].surfaces.O, ["caries"]);
  assert.deepEqual(records[16].surfaces.M, ["caries"]);
  assert.deepEqual(records[16].tooth, ["crown"]);
  // La NOTA no es un hallazgo del diente: va a `note`, no a `tooth`.
  assert.equal(records[11].note, "Duele al frío");
  assert.deepEqual(records[11].tooth, []);
});

test("una fila con un diente imposible se descarta al pintar (no revienta el dibujo)", () => {
  const records = eduEntriesToRecords([fila("e1", 99, "O", "caries"), fila("e2", 16, "O", "caries")]);
  assert.equal(records[99], undefined);
  assert.deepEqual(records[16].surfaces.O, ["caries"]);
});

test("el resumen NO cuenta las notas como hallazgos", () => {
  const r = eduOdontogramSummary([
    fila("e1", 16, "O", "caries"),
    fila("e2", 16, EDU_TOOTH_WHOLE, "crown"),
    fila("e3", 11, EDU_TOOTH_WHOLE, EDU_ODONTOGRAM_NOTE_KEY, "ojo"),
  ]);
  assert.deepEqual(r, { teeth: 2, findings: 2, notes: 1 });
});

test("el resumen sobre el MAPA da lo mismo que sobre las filas", () => {
  // La pantalla marca de forma optimista y no recarga por cada clic, así que
  // el contador se calcula sobre el mapa. Si las dos cuentas discreparan, la
  // cifra saltaría al recargar la página.
  const filas = [
    fila("e1", 16, "O", "caries"),
    fila("e2", 16, "M", "caries"),
    fila("e3", 16, EDU_TOOTH_WHOLE, "crown"),
    fila("e4", 11, EDU_TOOTH_WHOLE, EDU_ODONTOGRAM_NOTE_KEY, "Duele al frío"),
  ];
  assert.deepEqual(eduRecordsSummary(eduEntriesToRecords(filas)), eduOdontogramSummary(filas));
});

test("un diente que se marcó y se desmarcó no cuenta como diente marcado", () => {
  // El mapa conserva la clave con listas vacías tras deshacer el último
  // hallazgo; contarlo diría "1 diente, 0 hallazgos", que no significa nada.
  assert.deepEqual(eduRecordsSummary({ 16: { surfaces: {}, tooth: [] } }), {
    teeth: 0,
    findings: 0,
    notes: 0,
  });
  // Pero un diente con SOLO una nota sí cuenta: alguien escribió algo ahí.
  assert.deepEqual(eduRecordsSummary({ 16: { surfaces: {}, tooth: [], note: "ojo" } }), {
    teeth: 1,
    findings: 0,
    notes: 1,
  });
  assert.deepEqual(eduRecordsSummary({}), { teeth: 0, findings: 0, notes: 0 });
});

test("los hallazgos se nombran en español, no con su id", () => {
  assert.equal(eduConditionLabel("caries"), "Caries");
  assert.equal(eduConditionLabel("rct"), "Tratamiento de conducto");
  assert.equal(eduConditionLabel(EDU_ODONTOGRAM_NOTE_KEY), "Nota del diente");
});

function fila(
  id: string,
  tooth: number,
  surface: string,
  condition: string,
  notes: string | null = null,
): EduOdontogramEntryRow {
  return {
    id,
    tooth,
    surface,
    condition,
    notes,
    recordedById: "u_1",
    recordedByName: "Quien sea",
    recordedAt: "2026-08-29T18:00:00.000Z",
    recordedLabel: "sáb 29 ago 12:00",
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LOS ESTUDIOS: el path, el tope y el tipo
// ═══════════════════════════════════════════════════════════════════════

test("🔴 el path SIEMPRE lleva el institutionId adentro", () => {
  const path = eduStudyStoragePath(INST, "pac_1", "uuid-1", "rx.jpg");
  assert.ok(path.startsWith(`${INST}/`), `el path no empieza con el instituto: ${path}`);
  assert.equal(path, `${INST}/estudios/pac_1/uuid-1-rx.jpg`);
  // Particionar por instituto es lo que hace que un listado por prefijo
  // nunca cruce escuelas y que un borrado equivocado se quede dentro de una.
  assert.equal(eduStudyPathPrefix(INST, "pac_1"), `${INST}/estudios/pac_1/`);
});

test("un path de OTRA escuela no se puede registrar en el expediente propio", () => {
  const ajeno = eduStudyStoragePath(OTRO_INST, "pac_1", "uuid-1", "rx.jpg");
  assert.equal(eduStudyPathBelongsTo(ajeno, INST, "pac_1"), false);
  const otroPaciente = eduStudyStoragePath(INST, "pac_2", "uuid-1", "rx.jpg");
  assert.equal(eduStudyPathBelongsTo(otroPaciente, INST, "pac_1"), false);
  const propio = eduStudyStoragePath(INST, "pac_1", "uuid-1", "rx.jpg");
  assert.equal(eduStudyPathBelongsTo(propio, INST, "pac_1"), true);
});

test("no se puede salir de la carpeta con ../ aunque el prefijo coincida", () => {
  const escape = `${INST}/estudios/pac_1/../../${OTRO_INST}/estudios/pac_9/robado.jpg`;
  assert.equal(eduStudyPathIsSafe(escape), false);
  assert.equal(eduStudyPathBelongsTo(escape, INST, "pac_1"), false);
});

test("un path con caracteres raros o vacío se rechaza", () => {
  assert.equal(eduStudyPathIsSafe(""), false);
  assert.equal(eduStudyPathIsSafe("a b/c.jpg"), false, "espacios no");
  assert.equal(eduStudyPathIsSafe("a/c?x=1.jpg"), false, "query no");
  assert.equal(eduStudyPathIsSafe(null), false);
  assert.equal(eduStudyPathIsSafe("x".repeat(500)), false, "más largo que la columna");
  assert.equal(eduStudyPathIsSafe("inst/estudios/p/uuid-rx.jpg"), true);
});

test("un institutionId o un patientId vacíos NO validan el path (no se cuela un prefijo tonto)", () => {
  const path = eduStudyStoragePath(INST, "pac_1", "u", "rx.jpg");
  assert.equal(eduStudyPathBelongsTo(path, "", "pac_1"), false);
  assert.equal(eduStudyPathBelongsTo(path, INST, ""), false);
});

test("el nombre saneado SIEMPRE conserva la extensión", () => {
  // /confirm deduce el tipo leyendo la extensión DEL PATH. Un nombre que se
  // queda sin extensión al sanearse produce un path que el propio /confirm
  // rechaza — después de que la persona esperó la subida entera.
  assert.equal(eduSafeStudyFileName("Radiografía #3 (final).jpg", "jpg"), "Radiograf_a_3_final_.jpg");
  assert.equal(eduSafeStudyFileName("", "zip"), "estudio.zip");
  assert.equal(eduSafeStudyFileName("///", "zip"), "estudio.zip");
  // Un nombre entero en otro alfabeto se convierte en guiones bajos, se le
  // quitan los de delante y aun así sale con su extensión. El nombre bonito
  // no se pierde: el original se guarda en EduStudy.name y es el que se
  // enseña; esto es solo la ruta del objeto.
  assert.equal(eduSafeStudyFileName("漢字漢字.zip", "zip"), "zip.zip");
  assert.equal(eduSafeStudyFileName("漢字", "zip"), "estudio.zip");
  assert.equal(eduSafeStudyFileName("a.ZIP", "zip"), "a.ZIP", "no reescribe la caja del nombre");

  // Y el resultado siempre produce un path del que se puede volver a leer
  // la extensión correcta. Es la propiedad que de verdad importa.
  for (const nombre of ["///", "", "漢字.zip", "a.ZIP", "._-.zip", "x".repeat(200) + ".zip"]) {
    const path = eduStudyStoragePath(INST, "pac_1", "uuid", eduSafeStudyFileName(nombre, "zip"));
    assert.equal(eduExtOfName(path), "zip", `el path perdió la extensión con "${nombre}"`);
    assert.equal(eduStudyPathIsSafe(path), true, `path no seguro con "${nombre}"`);
  }
});

test("solo pasan las extensiones de la lista blanca", () => {
  for (const e of EDU_STUDY_EXT) assert.equal(eduIsStudyExt(e), true);
  for (const malo of ["exe", "js", "html", "svg", "", "php"]) {
    assert.equal(eduIsStudyExt(malo), false, `.${malo} no debería pasar`);
  }
  assert.equal(eduExtOfName("ESTUDIO.ZIP"), "zip", "se compara en minúsculas");
  assert.equal(eduExtOfName("sin_extension"), "sin_extension".toLowerCase());
});

test("el TIPO sale de la extensión, no del cliente", () => {
  // Si el `kind` viniera del navegador, un .zip de 600 MB podría
  // registrarse como "FOTO" y la galería intentaría pintarlo con un <img>.
  assert.equal(eduStudyKindForExt("zip"), "TOMOGRAFIA");
  assert.equal(eduStudyKindForExt("dcm"), "TOMOGRAFIA");
  assert.equal(eduStudyKindForExt("jpg"), "RADIOGRAFIA");
  assert.equal(eduStudyKindForExt("png"), "RADIOGRAFIA");
  assert.equal(eduStudyKindForExt("pdf"), "PDF");
  assert.equal(eduStudyKindForExt("stl"), "OTRO");
});

test("los cinco tipos tienen etiqueta y explicación en español", () => {
  assert.equal(EDU_STUDY_KINDS.length, 5);
  for (const k of EDU_STUDY_KINDS) {
    assert.ok(EDU_STUDY_KIND_LABELS[k], `falta la etiqueta de ${k}`);
    assert.notEqual(EDU_STUDY_KIND_LABELS[k], k, `${k} se pinta con el valor del enum`);
    assert.ok(EDU_STUDY_KIND_DESCRIPTIONS[k].length > 15);
  }
});

test("solo las imágenes y los PDF se pintan dentro de la página", () => {
  assert.equal(eduStudyIsImage(eduMimeForExt("jpg")), true);
  assert.equal(eduStudyIsImage(eduMimeForExt("png")), true);
  assert.equal(eduStudyIsImage(eduMimeForExt("zip")), false);
  assert.equal(eduStudyIsPdf(eduMimeForExt("pdf")), true);
  assert.equal(eduStudyIsPdf(eduMimeForExt("dcm")), false);
  // Una tomografía NO se pinta: se descarga. El visor CBCT del dental está
  // acoplado a sus tablas y no se puede reutilizar (ver estudio-viewer.tsx).
  assert.equal(eduStudyIsImage(eduMimeForExt("dcm")), false);
  assert.equal(eduStudyIsPdf(eduMimeForExt("zip")), false);
});

test("🔴 2 GB NO caben en un INTEGER de Postgres (por eso sizeBytes es BigInt)", () => {
  const MAX_INT4 = 2147483647;
  assert.equal(EDU_MAX_STUDY_BYTES, 2 * 1024 ** 3);
  assert.ok(
    EDU_MAX_STUDY_BYTES > MAX_INT4,
    "si esto deja de ser cierto, revisa el tipo de la columna antes de cambiar la prueba",
  );
  // Y sí cabe en un Number de JavaScript sin perder un byte, que es lo que
  // permite devolverlo como número en el JSON de la API.
  assert.ok(EDU_MAX_STUDY_BYTES < Number.MAX_SAFE_INTEGER);
  assert.equal(Number(BigInt(EDU_MAX_STUDY_BYTES)), EDU_MAX_STUDY_BYTES);
});

test("el tamaño se pinta legible", () => {
  assert.equal(eduFormatBytes(EDU_MAX_STUDY_BYTES), "2.0 GB");
  assert.equal(eduFormatBytes(1024 * 1024), "1.0 MB");
  assert.equal(eduFormatBytes(0), "0 B");
  assert.equal(eduFormatBytes(-1), "—");
  assert.equal(eduFormatBytes(NaN), "—");
});

test("el bucket es propio del vertical y la URL firmada caduca", () => {
  // No se reusa "patient-files": ese es del dental, y su tipo BucketName ni
  // siquiera admite este nombre.
  assert.equal(EDU_FILES_BUCKET, "edu-files");
  assert.notEqual(EDU_FILES_BUCKET, "patient-files");
  assert.ok(EDU_SIGNED_URL_TTL_SECONDS > 0 && EDU_SIGNED_URL_TTL_SECONDS <= 3600);
});
