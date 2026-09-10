/**
 * LA BASE DE LA OLA C — WS2-T4.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-ola-c-base.test.ts
 *       (y entra sola en `npm run test:edu`, que descubre la carpeta)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ VIGILA ESTE ARCHIVO
 *
 * Esta casilla no arregla hallazgos: pone la BASE (el SQL, el esquema y
 * los cores) para que la Ola C·2 solo tenga que pintar pantallas. Así que
 * lo que hay que fijar aquí son las DECISIONES, no los píxeles:
 *
 *   1. ARCO      — qué campos se sustituyen al anonimizar y cuáles NO, y
 *                  que anonimizar sea irreversible y exija baja previa.
 *   2. Fusión    — que sean OCHO tablas, que el odontograma se resuelva
 *                  fila a fila y que los cuestionarios se renumeren sin
 *                  chocar contra su índice único.
 *   3. Bitácora  — que un update que no cambió nada NO escriba renglón,
 *                  que las lecturas SÍ, y que el cursor no salte filas.
 *   4. Cuestionario — que el merge a la ficha sea ADITIVO (un campo
 *                  ausente NO se escribe) y que las banderas de riesgo
 *                  salgan del servidor.
 *   5. Plan      — que el avance se CUENTE y que 13 de 12 no dé 108 %.
 *   6. Presupuesto — que VENCIDO se derive, que el descuento no deje una
 *                  línea en negativo y que un aceptado no se des-acepte.
 *   7. Receta ARCHIVADA — que RECHAZADA tenga salida y que esa salida NO
 *                  abra la puerta del PDF.
 *   8. Odontograma — que MARCA, QUITA y REVIVE se distingan (N-3).
 *   9. Bloqueos  — el solape semiabierto y la regla del NULL.
 *  10. Y las lecturas del FUENTE: que ni arco.ts ni fusion.ts contengan un
 *      solo `delete`, y que el SQL sea aditivo de arriba abajo.
 *
 * Las secciones 1-9 son puras (se ejecutan sin base de datos). La 10 lee
 * los archivos, que es la única forma de comprobar sin Postgres que una
 * regla está PUESTA — el mismo truco que ya usan edu-caja.test.ts y
 * edu-rastro.test.ts.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  EduAgendaBlockKind as PrismaBlockKind,
  EduOdontogramEventAction as PrismaOdontoAction,
  EduPrescriptionStatus as PrismaPrescriptionStatus,
  EduQuoteStatus as PrismaQuoteStatus,
  EduTreatmentPlanStatus as PrismaPlanStatus,
} from "@prisma/client";

import {
  EDU_ARCO_CONSERVADO,
  EDU_ARCO_FOLIO_PREFIX,
  EDU_ARCO_PII_FIELDS,
  EDU_ARCO_PII_FIELD_NAMES,
  EDU_ARCO_REDACTED,
  EDU_ARCO_RETENTION_YEARS,
  eduArcoAnonymizeData,
  eduArcoMotivoParaNoAnonimizar,
  eduArcoParseReason,
  eduArcoRetentionCumplida,
  eduArcoRetentionUntil,
} from "../arco-core";
import {
  EDU_FUSION_NO_MOVIDAS,
  EDU_FUSION_TABLAS,
  eduFusionCuestionariosPlan,
  eduFusionMotivoParaNoFusionar,
  eduFusionOdontogramaPlan,
  eduFusionParseReason,
} from "../fusion-core";
import {
  EDU_AUDIT_ACTIONS,
  EDU_AUDIT_ACTION_LABELS,
  EDU_AUDIT_CAMPOS_IGNORADOS,
  EDU_AUDIT_ENTITIES,
  EDU_AUDIT_ENTITY_LABELS,
  EDU_AUDIT_MAX_CAMPOS,
  eduAuditCampos,
  eduAuditCursorDecode,
  eduAuditCursorEncode,
  eduAuditDiff,
  eduAuditIsAction,
  eduAuditIsEntity,
  eduAuditParseTake,
} from "../auditoria-core";
import {
  EDU_CUESTIONARIO_HISTORIAL,
  EDU_RISK_FLAGS_CRITICAS,
  eduCuestionarioEsSi,
  eduCuestionarioMergeData,
  eduCuestionarioParseAnswers,
  eduCuestionarioParseLista,
  eduCuestionarioRiskFlags,
  eduCuestionarioTieneTexto,
} from "../cuestionario-core";
import {
  EDU_PLAN_STATUSES,
  EDU_PLAN_STATUS_LABELS,
  EDU_PLAN_TRANSITIONS,
  eduPlanAtrasado,
  eduPlanKpis,
  eduPlanParseEntero,
  eduPlanProximaFecha,
  eduPlanPuedeTransicionar,
  type EduTreatmentPlanStatus,
} from "../plan-tratamiento-core";
import {
  EDU_QUOTE_STATUSES,
  EDU_QUOTE_STATUS_LABELS,
  EDU_QUOTE_TRANSITIONS,
  eduQuoteEstadoVisible,
  eduQuoteLineTotal,
  eduQuoteMotivoParaNoAceptar,
  eduQuoteParseItems,
  eduQuoteParsePct,
  eduQuoteParseToothFdi,
  eduQuoteTextoCanonico,
  eduQuoteTotales,
  eduQuoteVencido,
  type EduQuoteStatus,
} from "../presupuestos-core";
import {
  EDU_BLOCK_KINDS,
  EDU_BLOCK_KIND_LABELS,
  EDU_BLOCK_MAX_DIAS,
  eduBlockAlcanzaSillon,
  eduBlockParseRango,
  eduBlockParseReason,
  eduBlockQueImpide,
  eduRangosSePisan,
  type EduAgendaBlockKind,
} from "../agenda-bloqueos-core";
import {
  EDU_ODONTO_EVENT_ACTIONS,
  EDU_ODONTO_EVENT_LABELS,
  eduOdontoEventAccionAlMarcar,
  eduOdontoEventFiltrarHallazgo,
  eduOdontoEventPieza,
  eduOdontoEventUltimaBaja,
  type EduOdontogramEventAction,
} from "../odontograma-eventos-core";
import { eduCorteDesglose, eduCorteDesgloseLeer } from "../caja-cierre-core";
import {
  eduCategoriaKeyDesdeNombre,
  eduCategoriaParseKey,
  eduCategoriaSinPareja,
  eduCategoriaSugerirEmparejado,
} from "../categorias-core";
import {
  eduRequisitoCambioDuele,
  eduRequisitoEfectivo,
  eduRequisitoVersionVigente,
} from "../requisitos-version-core";
import { eduInstitucionParsePatch, EDU_INSTITUCION_NO_EDITABLE } from "../institucion-core";
import {
  EDU_PRESCRIPTION_STATUSES,
  EDU_PRESCRIPTION_STATUS_LABELS,
  EDU_PRESCRIPTION_TRANSITIONS,
  type EduPrescriptionStatus,
} from "../types";
import { eduRecetaArchivable, eduRecetaPrintable, eduRecetaVoidable } from "../recetas-core";

// ─────────────────────────────────────────────────────────────────────
// El candado de TIPOS contra Prisma: si el enum de la base y la unión de
// strings se separan, esto no compila (lo verifica `tsc --noEmit`, que es
// el gate de tipos del repo). Es el mismo truco de edu-recetas.test.ts.
// ─────────────────────────────────────────────────────────────────────
type Exacto<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _plan: Exacto<EduTreatmentPlanStatus, PrismaPlanStatus> = true;
const _quote: Exacto<EduQuoteStatus, PrismaQuoteStatus> = true;
const _block: Exacto<EduAgendaBlockKind, PrismaBlockKind> = true;
const _odonto: Exacto<EduOdontogramEventAction, PrismaOdontoAction> = true;
const _receta: Exacto<EduPrescriptionStatus, PrismaPrescriptionStatus> = true;
void _plan;
void _quote;
void _block;
void _odonto;
void _receta;

const RAIZ = join(__dirname, "..", "..", "..", "..");
const fuente = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
/** Quita comentarios: no vale absolver a un archivo por lo que dice su prosa. */
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ═══════════════════════════════════════════════════════════════════════
// 1 · ARCO
// ═══════════════════════════════════════════════════════════════════════

test("ARCO · se sustituye TODO el PII y NO se toca nada clínico", () => {
  // Los que identifican o contactan a una persona: los 19 + searchIndex.
  for (const c of [
    "firstName",
    "lastName",
    "phone",
    "phone2",
    "email",
    "curp",
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
    "emergencyContactName",
    "emergencyContactPhone",
    "emergencyContactRelation",
    "notes",
    "searchIndex",
  ]) {
    assert.ok(c in EDU_ARCO_PII_FIELDS, `${c} tiene que estar en la lista de PII`);
  }

  // 🔴 Y LO CLÍNICO NO. La NOM-004 obliga a conservar el expediente cinco
  // años; borrar la fecha de nacimiento o las alergias lo dejaría inútil.
  for (const c of [
    "birthDate",
    "sex",
    "isChild",
    "allergies",
    "chronicConditions",
    "currentMedications",
    "bloodType",
    "pregnancy",
    "familyHistory",
    "status",
    "institutionId",
  ]) {
    assert.ok(!(c in EDU_ARCO_PII_FIELDS), `${c} es clínico o estructural: NO se sustituye`);
  }

  // El índice de búsqueda se vacía, no se rellena con el marcador: buscar
  // el apellido de la persona no puede seguir encontrando su ficha.
  assert.equal(EDU_ARCO_PII_FIELDS.searchIndex, "");
  assert.equal(EDU_ARCO_PII_FIELDS.firstName, EDU_ARCO_REDACTED);
  assert.notEqual(EDU_ARCO_REDACTED, "", "el marcador no puede ser la cadena vacía");
});

test("ARCO · el folio se PREFIJA una sola vez y nunca se pierde", () => {
  const now = new Date("2026-09-07T12:00:00Z");
  const d1 = eduArcoAnonymizeData({ folio: "P-0042" }, "u1", now);
  assert.equal(d1.folio, "ARCO-P-0042", "el folio original tiene que seguir legible");
  assert.equal(d1.anonymizedAt, now);
  assert.equal(d1.anonymizedById, "u1");

  // Idempotente: correrlo dos veces no produce ARCO-ARCO-.
  const d2 = eduArcoAnonymizeData({ folio: String(d1.folio) }, "u1", now);
  assert.equal(d2.folio, "ARCO-P-0042");
  assert.ok(String(d2.folio).startsWith(EDU_ARCO_FOLIO_PREFIX));
});

test("ARCO · anonimizar exige baja previa, no se repite y no toca a un fusionado", () => {
  assert.match(
    eduArcoMotivoParaNoAnonimizar({ deletedAt: null }) ?? "",
    /dar de baja/i,
    "sin baja previa no se anonimiza: la baja se deshace y esto no",
  );
  assert.match(
    eduArcoMotivoParaNoAnonimizar({ deletedAt: new Date(), anonymizedAt: new Date() }) ?? "",
    /irreversible/i,
  );
  assert.match(
    eduArcoMotivoParaNoAnonimizar({ deletedAt: new Date(), mergedIntoId: "otro" }) ?? "",
    /fusion/i,
  );
  assert.equal(eduArcoMotivoParaNoAnonimizar({ deletedAt: new Date() }), null);
});

test("ARCO · la retención son CINCO AÑOS desde el último acto, no desde el alta", () => {
  assert.equal(EDU_ARCO_RETENTION_YEARS, 5);
  const acto = new Date("2025-03-10T00:00:00Z");
  assert.equal(eduArcoRetentionUntil(acto).toISOString(), "2030-03-10T00:00:00.000Z");
  assert.equal(eduArcoRetentionCumplida(acto, new Date("2030-03-09T00:00:00Z")), false);
  assert.equal(eduArcoRetentionCumplida(acto, new Date("2030-03-10T00:00:00Z")), true);

  // Bisiesto: contar en años y no en "5 * 365 días" es lo que impide que
  // la retención termine uno o dos días antes de tiempo.
  const feb = new Date("2024-02-29T00:00:00Z");
  const hasta = eduArcoRetentionUntil(feb);
  assert.ok(hasta.getTime() - feb.getTime() >= 5 * 365 * 24 * 60 * 60 * 1000);
});

test("ARCO · el motivo de la baja es OBLIGATORIO", () => {
  assert.throws(() => eduArcoParseReason(""), /Escribe por qué/);
  assert.throws(() => eduArcoParseReason("  "), /Escribe por qué/);
  assert.throws(() => eduArcoParseReason("ab"));
  assert.equal(eduArcoParseReason("  Solicitud ARCO del 12/03  "), "Solicitud ARCO del 12/03");
  assert.equal(eduArcoParseReason("x".repeat(900)).length, 500);
});

test("ARCO · la pantalla de confirmación puede decir qué se conserva", () => {
  // Existe para que la confirmación no mienta: quien firma un acto
  // irreversible ve la lista exacta, no un resumen escrito a mano.
  assert.ok(EDU_ARCO_PII_FIELD_NAMES.length >= 20);
  for (const k of Object.keys(EDU_ARCO_CONSERVADO)) {
    assert.ok(!(k in EDU_ARCO_PII_FIELDS), `${k} no puede estar en las dos listas`);
    assert.ok(EDU_ARCO_CONSERVADO[k].length > 20, `el porqué de ${k} tiene que explicarse`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · LA FUSIÓN
// ═══════════════════════════════════════════════════════════════════════

test("fusión · son OCHO tablas, y están las ocho", () => {
  assert.equal(EDU_FUSION_TABLAS.length, 8);
  const modelos = EDU_FUSION_TABLAS.map((t) => t.model);
  assert.deepEqual(modelos, [
    "eduAppointment",
    "eduCase",
    "eduRecord",
    "eduStudy",
    "eduClinicalPhoto",
    "eduConsent",
    "eduPrescription",
    "eduCharge",
  ]);
  // Y las tres que NO se mueven con updateMany llevan escrito su porqué.
  assert.equal(Object.keys(EDU_FUSION_NO_MOVIDAS).length, 3);
  for (const k of Object.keys(EDU_FUSION_NO_MOVIDAS)) {
    assert.ok(EDU_FUSION_NO_MOVIDAS[k].length > 30);
  }
});

test("fusión · no se fusiona entre institutos, ni consigo misma, ni lo ya fusionado", () => {
  const a = { id: "a", folio: "P-1", institutionId: "i1" };
  const b = { id: "b", folio: "P-2", institutionId: "i2" };
  assert.match(eduFusionMotivoParaNoFusionar(a, b) ?? "", /mismo instituto/i);
  assert.match(eduFusionMotivoParaNoFusionar(a, { ...a }) ?? "", /misma ficha/i);
  assert.match(
    eduFusionMotivoParaNoFusionar(a, { ...b, institutionId: "i1", mergedIntoId: "z" }) ?? "",
    /ya se fusionó/i,
  );
  assert.match(
    eduFusionMotivoParaNoFusionar({ ...a, anonymizedAt: new Date() }, { ...b, institutionId: "i1" }) ?? "",
    /anonimizada/i,
  );
  assert.equal(eduFusionMotivoParaNoFusionar(a, { ...b, institutionId: "i1" }), null);
});

test("fusión · el odontograma se resuelve fila a fila y NADA se borra", () => {
  const perdedor = [
    { id: "e1", tooth: 16, surface: "O", condition: "caries" },
    { id: "e2", tooth: 21, surface: "", condition: "fractura" },
    // Repetido DENTRO del perdedor: el segundo también choca.
    { id: "e3", tooth: 21, surface: "", condition: "fractura" },
  ];
  const ganador = [{ tooth: 16, surface: "O", condition: "caries" }];
  const plan = eduFusionOdontogramaPlan(perdedor, ganador);

  assert.deepEqual(plan.mover, ["e2"], "solo se mueve lo que no choca");
  assert.deepEqual(plan.sePierdenPorChoque.sort(), ["e1", "e3"]);
  // 🔴 "sePierdenPorChoque" NO significa que se borren: significa que se
  // QUEDAN en la ficha del perdedor, con su autor y su fecha.
  assert.equal(
    plan.mover.length + plan.sePierdenPorChoque.length,
    perdedor.length,
    "ninguna fila puede desaparecer del plan",
  );
});

test("fusión · los cuestionarios se renumeran de MAYOR a MENOR", () => {
  const plan = eduFusionCuestionariosPlan(
    [
      { id: "q2", recordedAt: new Date("2026-02-01") },
      { id: "q1", recordedAt: new Date("2026-01-01") },
    ],
    3,
  );
  // Se pegan DESPUÉS de las del ganador, en orden de captura…
  assert.deepEqual(
    [...plan].sort((a, b) => a.version - b.version),
    [
      { id: "q1", version: 4 },
      { id: "q2", version: 5 },
    ],
  );
  // …y se devuelven de mayor a menor: al revés, la primera escritura
  // chocaría contra el índice único (patientId, version).
  assert.deepEqual(
    plan.map((p) => p.version),
    [5, 4],
  );
});

test("fusión · el motivo es obligatorio", () => {
  assert.throws(() => eduFusionParseReason(""), /misma persona/i);
  assert.equal(
    eduFusionParseReason("  Mismo teléfono y misma fecha de nacimiento  "),
    "Mismo teléfono y misma fecha de nacimiento",
  );
  assert.equal(eduFusionParseReason("x".repeat(900)).length, 500);
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · LA BITÁCORA
// ═══════════════════════════════════════════════════════════════════════

test("bitácora · un update que NO cambió nada no escribe renglón", () => {
  const antes = { phone: "5511", email: "a@b.c" };
  const igual = eduAuditDiff(antes, { phone: "5511", email: "a@b.c" });
  assert.equal(igual.cambios, 0, "sin cambios no hay acto que registrar");
  assert.equal(igual.before, null);
  assert.equal(igual.after, null);

  const cambio = eduAuditDiff(antes, { phone: "5522", email: "a@b.c" });
  assert.equal(cambio.cambios, 1, "SOLO los campos que cambiaron");
  assert.deepEqual(cambio.before, { phone: "5511" });
  assert.deepEqual(cambio.after, { phone: "5522" });
});

test("bitácora · el PII de servicio y el ruido nunca entran al diff", () => {
  const d = eduAuditDiff(
    { searchIndex: "juan perez 5511", updatedAt: new Date("2026-01-01"), phone: "1" },
    { searchIndex: "juan perez 5522", updatedAt: new Date("2026-02-01"), phone: "2" },
  );
  // searchIndex lleva nombre y teléfono: copiarlo a la bitácora sería
  // moverlo a una tabla de la que la anonimización no lo puede sacar.
  assert.ok(!("searchIndex" in (d.before ?? {})));
  assert.ok(!("updatedAt" in (d.before ?? {})));
  assert.deepEqual(d.after, { phone: "2" });
  assert.ok(EDU_AUDIT_CAMPOS_IGNORADOS.has("searchIndex"));
});

test("bitácora · un alta y una baja se guardan como foto, no como diff", () => {
  const alta = eduAuditDiff(null, { folio: "P-1", firstName: "Ana" });
  assert.equal(alta.before, null);
  assert.deepEqual(alta.after, { folio: "P-1", firstName: "Ana" });
  assert.equal(alta.cambios, 1);

  const baja = eduAuditDiff({ folio: "P-1" }, null);
  assert.deepEqual(baja.before, { folio: "P-1" });
  assert.equal(baja.after, null);
});

test("bitácora · el diff se recorta y las fechas y arrays se normalizan", () => {
  const antes: Record<string, unknown> = {};
  const despues: Record<string, unknown> = {};
  for (let i = 0; i < 60; i++) {
    antes[`c${i}`] = "a";
    despues[`c${i}`] = "b";
  }
  const d = eduAuditDiff(antes, despues);
  assert.equal(d.cambios, EDU_AUDIT_MAX_CAMPOS, "un renglón de bitácora no es un volcado");

  // Dos Date del mismo instante no son ===; sin normalizar, cada guardado
  // registraría un "cambio" de fecha que no ocurrió.
  const fechas = eduAuditDiff(
    { f: new Date("2026-01-01T00:00:00Z") },
    { f: new Date("2026-01-01T00:00:00Z") },
  );
  assert.equal(fechas.cambios, 0);

  // ["a","b"] y ["b","a"] son el mismo conjunto de alergias.
  const listas = eduAuditDiff({ a: ["penicilina", "latex"] }, { a: ["latex", "penicilina"] });
  assert.equal(listas.cambios, 0);
});

test("bitácora · el catálogo está cerrado y rotulado", () => {
  assert.equal(eduAuditIsAction("view"), true, "la LECTURA es la que pide la NOM-024");
  assert.equal(eduAuditIsAction("VIEW"), false, "el catálogo distingue mayúsculas a propósito");
  assert.equal(eduAuditIsAction("inventada"), false);
  assert.equal(eduAuditIsEntity("patient"), true);
  assert.equal(eduAuditIsEntity("paciente"), false);
  for (const a of EDU_AUDIT_ACTIONS) {
    assert.ok(EDU_AUDIT_ACTION_LABELS[a], `falta la etiqueta de ${a}`);
    assert.notEqual(EDU_AUDIT_ACTION_LABELS[a], a, "la UI no pinta el valor crudo");
  }
  for (const e of EDU_AUDIT_ENTITIES) {
    assert.ok(EDU_AUDIT_ENTITY_LABELS[e], `falta la etiqueta de ${e}`);
  }
});

test("bitácora · el cursor lleva el PAR completo y no salta filas", () => {
  const fila = { createdAt: new Date("2026-09-07T10:00:00.123Z"), id: "abc123" };
  const c = eduAuditCursorEncode(fila);
  const vuelta = eduAuditCursorDecode(c);
  assert.equal(vuelta?.id, "abc123");
  assert.equal(vuelta?.createdAt.toISOString(), fila.createdAt.toISOString());

  // Un cursor inventado devuelve null (primera página), nunca revienta.
  assert.equal(eduAuditCursorDecode("basura"), null);
  assert.equal(eduAuditCursorDecode("2026-01-01|con espacio"), null);
  assert.equal(eduAuditCursorDecode(null), null);
  assert.equal(eduAuditCursorDecode("no-es-fecha|abc"), null);

  assert.equal(eduAuditParseTake("999"), 200, "el tope de página se respeta");
  assert.equal(eduAuditParseTake("0"), 50);
  assert.equal(eduAuditParseTake(undefined), 50);
});

test("bitácora · el diff se aplana a la tabla de tres columnas", () => {
  const campos = eduAuditCampos({ phone: "1" }, { phone: "2", email: "x" });
  assert.deepEqual(campos.sort((a, b) => a.campo.localeCompare(b.campo)), [
    { campo: "email", antes: null, despues: "x" },
    { campo: "phone", antes: "1", despues: "2" },
  ]);
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · EL CUESTIONARIO
// ═══════════════════════════════════════════════════════════════════════

test("cuestionario · el merge a la ficha es ADITIVO: lo ausente NO se escribe", () => {
  const now = new Date("2026-09-07T12:00:00Z");
  const actual = { allergies: ["penicilina"], chronicConditions: ["diabetes"] };

  // Un cuestionario que SOLO pregunta por el embarazo…
  const solo = eduCuestionarioMergeData({ embarazo: "EMBARAZO" }, actual, "u1", now);
  assert.equal(solo.pregnancy, "EMBARAZO");
  // …no puede dejar a un cardiópata sin sus padecimientos crónicos.
  assert.ok(!("chronicConditions" in solo), "un campo ausente NO se escribe");
  assert.ok(!("allergies" in solo), "un campo ausente NO se escribe");

  // Y las listas se UNEN, no se pisan.
  const conAlergias = eduCuestionarioMergeData({ alergias: ["latex"] }, actual, "u1", now);
  assert.deepEqual(conAlergias.allergies, ["penicilina", "latex"]);

  // Siempre quedan quién y cuándo, juntos: es lo que distingue "no
  // refiere" de "nadie preguntó".
  assert.equal(conAlergias.historyRecordedAt, now);
  assert.equal(conAlergias.historyRecordedById, "u1");
});

test("cuestionario · las banderas de riesgo salen del servidor y van ordenadas", () => {
  const flags = eduCuestionarioRiskFlags(
    {
      anticoagulantes: "sí",
      diabetes: true,
      alergiaFarmacos: "lidocaína",
      tabaco: "FRECUENTE",
    },
    { isChild: true },
  );
  assert.ok(flags.includes("ANTICOAGULANTE"));
  assert.ok(flags.includes("ALERGIA_FARMACO"));
  assert.ok(flags.includes("ALERGIA"), "una alergia a fármaco es también una alergia");
  assert.ok(flags.includes("DIABETES"));
  assert.ok(flags.includes("TABAQUISMO"));
  assert.ok(flags.includes("MENOR"));

  // 🔴 LAS CRÍTICAS PRIMERO: el orden ES la lectura. Un alumno de pie lee
  // la primera línea y a veces solo esa.
  const primeras = flags.slice(0, 2);
  for (const f of primeras) {
    assert.ok(EDU_RISK_FLAGS_CRITICAS.includes(f), `${f} debería ir después de las críticas`);
  }
  assert.equal(new Set(flags).size, flags.length, "sin repetidas");
});

test("cuestionario · el embarazo enciende bandera aunque venga de la ficha", () => {
  assert.ok(eduCuestionarioRiskFlags({}, { pregnancy: "LACTANCIA" }).includes("EMBARAZO"));
  assert.ok(eduCuestionarioRiskFlags({ embarazo: "EMBARAZO" }).includes("EMBARAZO"));
  assert.ok(!eduCuestionarioRiskFlags({}, { pregnancy: "NO" }).includes("EMBARAZO"));
});

test("cuestionario · «no», «ninguna» y un guion NO cuentan como respuesta", () => {
  assert.equal(eduCuestionarioTieneTexto("Ninguna"), false);
  assert.equal(eduCuestionarioTieneTexto("no"), false);
  assert.equal(eduCuestionarioTieneTexto("-"), false);
  assert.equal(eduCuestionarioTieneTexto("penicilina"), true);
  assert.equal(eduCuestionarioEsSi("SÍ"), true, "con acento también");
  assert.equal(eduCuestionarioEsSi("Si"), true);
  assert.equal(eduCuestionarioEsSi("no"), false);
  assert.deepEqual(eduCuestionarioParseLista("latex, Latex ,  penicilina"), ["latex", "penicilina"]);
});

test("cuestionario · una versión vacía no se guarda, y el historial es de 20", () => {
  assert.throws(() => eduCuestionarioParseAnswers({}), /ni una respuesta/);
  assert.throws(() => eduCuestionarioParseAnswers(null), /vacío/);
  assert.throws(() => eduCuestionarioParseAnswers([1, 2]), /vacío|forma/);
  assert.deepEqual(eduCuestionarioParseAnswers({ a: 1 }), { a: 1 });
  assert.equal(EDU_CUESTIONARIO_HISTORIAL, 20);
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · EL PLAN DE TRATAMIENTO
// ═══════════════════════════════════════════════════════════════════════

test("plan · el avance se CUENTA, y 13 de 12 no da 108 %", () => {
  const hechas = (n: number, total: number) =>
    Array.from({ length: total }, (_, i) => ({
      sessionNumber: i + 1,
      completedAt: i < n ? new Date(`2026-0${(i % 9) + 1}-01T00:00:00Z`) : null,
    }));

  const k = eduPlanKpis(hechas(3, 12), 12);
  assert.equal(k.hechas, 3);
  assert.equal(k.total, 12);
  assert.equal(k.avance, 25);
  assert.equal(k.siguienteNumero, 4);

  // 🔴 El plan que se ALARGA: 13 sesiones reales sobre un estimado de 12.
  // Con el estimado a secas saldría 108 %, un número que nadie le puede
  // explicar a un paciente.
  const largo = eduPlanKpis(hechas(13, 13), 12);
  assert.equal(largo.avance, 100);
  assert.equal(largo.total, 13);
  assert.equal(largo.siguienteNumero, null, "sin nada pendiente no hay siguiente");
});

test("plan · la siguiente sesión salta las que se hicieron fuera de orden", () => {
  const s = [
    { sessionNumber: 1, completedAt: new Date("2026-01-01") },
    { sessionNumber: 2, completedAt: null },
    { sessionNumber: 3, completedAt: new Date("2026-02-01") },
  ];
  const k = eduPlanKpis(s, 3);
  assert.equal(k.hechas, 2);
  assert.equal(k.siguienteNumero, 2, "el paciente se saltó una cita: la 2 sigue pendiente");
  assert.equal(k.ultimaHechaAt?.toISOString(), new Date("2026-02-01").toISOString());
});

test("plan · la próxima fecha sale de la última hecha, y desaparece al terminar", () => {
  const inicio = new Date("2026-01-01T00:00:00Z");
  const k = eduPlanKpis(
    [
      { sessionNumber: 1, completedAt: new Date("2026-03-01T00:00:00Z") },
      { sessionNumber: 2, completedAt: null },
    ],
    2,
  );
  const prox = eduPlanProximaFecha(k, inicio, 30);
  assert.equal(prox?.toISOString(), "2026-03-31T00:00:00.000Z");

  // Sin ninguna hecha, se cuenta desde el arranque del plan.
  const k0 = eduPlanKpis([{ sessionNumber: 1, completedAt: null }], 1);
  assert.equal(eduPlanProximaFecha(k0, inicio, 10)?.toISOString(), "2026-01-11T00:00:00.000Z");

  // Y terminado, null: un plan sin siguiente sesión no tiene siguiente
  // fecha, y dejarla puesta lo haría salir como atrasado para siempre.
  const kFin = eduPlanKpis([{ sessionNumber: 1, completedAt: new Date("2026-02-01") }], 1);
  assert.equal(eduPlanProximaFecha(kFin, inicio, 30), null);
});

test("plan · solo un ACTIVO puede estar atrasado", () => {
  const ayer = new Date("2026-09-06T00:00:00Z");
  const hoy = new Date("2026-09-07T00:00:00Z");
  assert.equal(eduPlanAtrasado("ACTIVO", ayer, hoy), true);
  assert.equal(eduPlanAtrasado("PAUSADO", ayer, hoy), false, "una pausa es a propósito");
  assert.equal(eduPlanAtrasado("COMPLETADO", ayer, hoy), false);
  assert.equal(eduPlanAtrasado("ACTIVO", null, hoy), false);
});

test("plan · un plan cerrado NO se reabre, y las transiciones son un dato", () => {
  assert.deepEqual(EDU_PLAN_TRANSITIONS.COMPLETADO, []);
  assert.deepEqual(EDU_PLAN_TRANSITIONS.ABANDONADO, []);
  assert.equal(eduPlanPuedeTransicionar("COMPLETADO", "ACTIVO"), false);
  assert.equal(eduPlanPuedeTransicionar("ACTIVO", "PAUSADO"), true);
  assert.equal(eduPlanPuedeTransicionar("PAUSADO", "ACTIVO"), true);
  for (const s of EDU_PLAN_STATUSES) {
    assert.ok(EDU_PLAN_STATUS_LABELS[s], `falta la etiqueta de ${s}`);
    assert.notEqual(EDU_PLAN_STATUS_LABELS[s], s, "la UI no pinta el enum");
  }
});

test("plan · un entero fuera de rango se rebota con un mensaje para una persona", () => {
  assert.equal(eduPlanParseEntero(undefined, "x", 1, 10, 3), 3);
  assert.equal(eduPlanParseEntero("5", "x", 1, 10, 3), 5);
  assert.throws(() => eduPlanParseEntero(0, "Las sesiones", 1, 100, 1), /entre 1 y 100/);
  assert.throws(() => eduPlanParseEntero(2_000_000_000, "Las sesiones", 1, 100, 1));
  assert.throws(() => eduPlanParseEntero("dos", "Las sesiones", 1, 100, 1));
});

// ═══════════════════════════════════════════════════════════════════════
// 6 · LOS PRESUPUESTOS
// ═══════════════════════════════════════════════════════════════════════

test("presupuesto · VENCIDO se DERIVA y no se guarda", () => {
  assert.ok(
    !(EDU_QUOTE_STATUSES as string[]).includes("VENCIDO"),
    "un estado que hay que escribir con un cron se queda mal el día que el cron no corre",
  );
  const ayer = new Date("2026-09-06T00:00:00Z");
  const hoy = new Date("2026-09-07T00:00:00Z");

  assert.equal(eduQuoteVencido({ status: "PRESENTADO", validUntil: ayer }, hoy), true);
  assert.equal(eduQuoteEstadoVisible({ status: "PRESENTADO", validUntil: ayer }, hoy), "VENCIDO");
  // Solo un PRESENTADO vence: un borrador no lo ha visto nadie y un
  // aceptado ocurrió dentro de la vigencia.
  assert.equal(eduQuoteVencido({ status: "BORRADOR", validUntil: ayer }, hoy), false);
  assert.equal(eduQuoteVencido({ status: "ACEPTADO", validUntil: ayer }, hoy), false);
  assert.equal(eduQuoteVencido({ status: "PRESENTADO", validUntil: null }, hoy), false);
});

test("presupuesto · un descuento de más NO deja la línea en negativo", () => {
  assert.equal(eduQuoteLineTotal({ quantity: 2, unitPriceCents: 50_000, discountCents: 0 }), 100_000);
  assert.equal(
    eduQuoteLineTotal({ quantity: 1, unitPriceCents: 10_000, discountCents: 99_999 }),
    0,
    "un descuento mayor que el importe no es un regalo con vuelto",
  );
  assert.equal(eduQuoteLineTotal({ quantity: 0, unitPriceCents: 10_000, discountCents: 0 }), 0);
});

test("presupuesto · el porcentaje manda sobre los centavos y el total cierra exacto", () => {
  const items = [
    { quantity: 1, unitPriceCents: 100_000, discountCents: 0 },
    { quantity: 3, unitPriceCents: 33_333, discountCents: 0 },
  ];
  const conPct = eduQuoteTotales(items, 10, 999_999);
  assert.equal(conPct.subtotalCents, 199_999);
  assert.equal(conPct.discountCents, 20_000, "10 % de 199 999, redondeado");
  assert.equal(
    conPct.subtotalCents - conPct.discountCents,
    conPct.totalCents,
    "la resta tiene que cerrar al centavo",
  );

  const sinPct = eduQuoteTotales(items, null, 5_000);
  assert.equal(sinPct.discountCents, 5_000);
  // Y el descuento global tampoco puede pasarse del subtotal.
  assert.equal(eduQuoteTotales(items, null, 9_999_999).totalCents, 0);
});

test("presupuesto · un aceptado no se des-acepta y un rechazado no se borra", () => {
  assert.deepEqual(EDU_QUOTE_TRANSITIONS.ACEPTADO, []);
  assert.deepEqual(EDU_QUOTE_TRANSITIONS.CANCELADO, []);
  assert.ok(EDU_QUOTE_TRANSITIONS.PRESENTADO.includes("BORRADOR"), "se puede volver a editar");
  for (const s of EDU_QUOTE_STATUSES) {
    assert.ok(EDU_QUOTE_STATUS_LABELS[s], `falta la etiqueta de ${s}`);
  }
});

test("presupuesto · la puerta pública explica POR QUÉ no se puede aceptar", () => {
  const hoy = new Date("2026-09-07T00:00:00Z");
  const ayer = new Date("2026-09-06T00:00:00Z");
  assert.match(
    eduQuoteMotivoParaNoAceptar({ status: "PRESENTADO", validUntil: ayer }, hoy) ?? "",
    /venció/i,
  );
  assert.match(eduQuoteMotivoParaNoAceptar({ status: "ACEPTADO", validUntil: null }, hoy) ?? "", /ya lo aceptaste/i);
  assert.match(eduQuoteMotivoParaNoAceptar({ status: "BORRADOR", validUntil: null }, hoy) ?? "", /todavía no está listo/i);
  assert.equal(eduQuoteMotivoParaNoAceptar({ status: "PRESENTADO", validUntil: null }, hoy), null);
});

test("presupuesto · las partidas se validan y el orden lo pone el servidor", () => {
  const items = eduQuoteParseItems([
    { name: "Endodoncia", unitPriceCents: 120_000, toothFdi: "16, 16 ,26" },
    { name: "Resina", unitPriceCents: 80_000, quantity: 2, discountCents: 10_000, phase: 2 },
  ]);
  assert.equal(items[0].sortOrder, 0);
  assert.equal(items[1].sortOrder, 1, "el orden ES contenido: lo pone el servidor");
  assert.equal(items[0].toothFdi, "16,26", "sin repetidos");
  assert.equal(items[1].lineTotalCents, 150_000);

  assert.throws(() => eduQuoteParseItems([]), /al menos una partida/);
  assert.throws(() => eduQuoteParseItems([{ unitPriceCents: 1 }]), /no tiene nombre/);
  assert.throws(() => eduQuoteParseItems([{ name: "x", unitPriceCents: -1 }]), /centavos/);
  // Un diente que no existe no puede salir impreso en un papel que el
  // paciente se lleva.
  assert.throws(() => eduQuoteParseToothFdi("99"), /FDI/);
  assert.equal(eduQuoteParseToothFdi("11 55"), "11,55", "permanentes y temporales");
  assert.throws(() => eduQuoteParsePct(101), /entre 0 y 100/);
  assert.equal(eduQuoteParsePct(null), null);
});

test("presupuesto · el texto canónico va VERSIONADO y lleva los importes", () => {
  const t = eduQuoteTextoCanonico({
    folio: "P-0001",
    title: "Rehabilitación",
    totalCents: 150_000,
    items: [{ name: "Resina", quantity: 2, lineTotalCents: 150_000 }],
    validUntil: null,
  });
  assert.ok(t.startsWith("v1|"), "sin versión, el hash deja de verificar al primer cambio de copy");
  assert.ok(t.includes("total=150000"), "el hash existe para contestar «¿aceptó ESTE total?»");
  assert.ok(t.includes("P-0001"));
});

// ═══════════════════════════════════════════════════════════════════════
// 7 · LA RECETA ARCHIVADA (H-24)
// ═══════════════════════════════════════════════════════════════════════

test("receta · RECHAZADA ya tiene salida, y esa salida NO imprime", () => {
  assert.deepEqual(
    EDU_PRESCRIPTION_TRANSITIONS.RECHAZADA,
    ["ARCHIVADA"],
    "H-24: una rechazada se quedaba en la lista del alumno para siempre",
  );
  assert.deepEqual(EDU_PRESCRIPTION_TRANSITIONS.ARCHIVADA, [], "archivar es terminal");

  // 🔴 LA LÍNEA QUE NO SE PUEDE CRUZAR. La casilla anterior se negó a
  // abrir RECHAZADA → ANULADA porque una ANULADA se IMPRIME. ARCHIVADA no.
  assert.equal(eduRecetaPrintable("ARCHIVADA"), false);
  assert.equal(eduRecetaPrintable("RECHAZADA"), false);
  assert.equal(eduRecetaPrintable("ANULADA"), true);
  assert.ok(!EDU_PRESCRIPTION_TRANSITIONS.RECHAZADA.includes("ANULADA"));

  // Y archivar es de lo RECHAZADO; anular es de lo EXPEDIDO.
  assert.equal(eduRecetaArchivable("RECHAZADA"), true);
  assert.equal(eduRecetaArchivable("EXPEDIDA"), false);
  assert.equal(eduRecetaArchivable("BORRADOR"), false);
  assert.equal(eduRecetaVoidable("RECHAZADA"), false);
  assert.equal(eduRecetaVoidable("EXPEDIDA"), true);

  for (const s of EDU_PRESCRIPTION_STATUSES) {
    assert.ok(EDU_PRESCRIPTION_STATUS_LABELS[s], `falta la etiqueta de ${s}`);
  }
  assert.ok(EDU_PRESCRIPTION_STATUSES.includes("ARCHIVADA"));
});

// ═══════════════════════════════════════════════════════════════════════
// 8 · EL LIBRO DEL ODONTOGRAMA (N-3)
// ═══════════════════════════════════════════════════════════════════════

test("odontograma · MARCA, QUITA y REVIVE se distinguen — esto ES N-3", () => {
  // La fila no existía: primera vez.
  assert.equal(eduOdontoEventAccionAlMarcar(null), "MARCA");
  // Estaba dada de baja y se vuelve a marcar: el `update` del upsert pisa
  // `deletedById`, pero el libro se queda con las dos caras.
  assert.equal(eduOdontoEventAccionAlMarcar({ deletedAt: new Date("2026-01-01") }), "REVIVE");
  // Estaba viva: solo se tocó la nota.
  assert.equal(eduOdontoEventAccionAlMarcar({ deletedAt: null }), "EDITA");

  for (const a of EDU_ODONTO_EVENT_ACTIONS) {
    assert.ok(EDU_ODONTO_EVENT_LABELS[a], `falta la etiqueta de ${a}`);
  }
});

test("odontograma · el rastro de quién lo quitó SOBREVIVE a que lo remarquen", () => {
  // El escenario exacto de H-17 y de N-3, como filas del libro.
  const eventos = [
    { action: "MARCA", actorName: "Ortodoncia", createdAt: "2026-01-01T10:00:00Z", tooth: 16, surface: "O", condition: "caries" },
    { action: "QUITA", actorName: "Endodoncia", createdAt: "2026-01-02T10:00:00Z", tooth: 16, surface: "O", condition: "caries" },
    { action: "REVIVE", actorName: "Ortodoncia", createdAt: "2026-01-03T10:00:00Z", tooth: 16, surface: "O", condition: "caries" },
    { action: "MARCA", actorName: "Prótesis", createdAt: "2026-01-04T10:00:00Z", tooth: 21, surface: "", condition: "fractura" },
  ];

  const delHallazgo = eduOdontoEventFiltrarHallazgo(eventos, {
    tooth: 16,
    surface: "O",
    condition: "caries",
  });
  assert.equal(delHallazgo.length, 3, "el otro diente no se cuela");

  const baja = eduOdontoEventUltimaBaja(delHallazgo);
  assert.equal(
    baja?.actorName,
    "Endodoncia",
    "ÉSTA es la pregunta que H-17 existía para contestar y que N-3 dejaba sin respuesta",
  );

  // Un hallazgo que nadie quitó no tiene última baja.
  assert.equal(
    eduOdontoEventUltimaBaja(
      eduOdontoEventFiltrarHallazgo(eventos, { tooth: 21, surface: "", condition: "fractura" }),
    ),
    null,
  );

  assert.equal(eduOdontoEventPieza(16, "O"), "16-O");
  assert.equal(eduOdontoEventPieza(21, ""), "21", "cara vacía = el diente entero");
});

// ═══════════════════════════════════════════════════════════════════════
// 9 · LOS BLOQUEOS DE AGENDA (H-19)
// ═══════════════════════════════════════════════════════════════════════

test("bloqueos · el solape es SEMIABIERTO: pegar dos rangos no los pisa", () => {
  const r = (a: string, b: string) => ({ startsAt: new Date(a), endsAt: new Date(b) });
  assert.equal(
    eduRangosSePisan(r("2026-09-07T08:00Z", "2026-09-07T14:00Z"), r("2026-09-07T14:00Z", "2026-09-07T18:00Z")),
    false,
    "cerrar la mañana no puede bloquear el primer hueco de la tarde",
  );
  assert.equal(
    eduRangosSePisan(r("2026-09-07T08:00Z", "2026-09-07T14:00Z"), r("2026-09-07T13:59Z", "2026-09-07T18:00Z")),
    true,
  );
});

test("bloqueos · la regla del NULL decide el alcance", () => {
  const sillon = { id: "c1", campusId: "norte" };
  // Sin sede y sin sillón: el instituto entero.
  assert.equal(eduBlockAlcanzaSillon({ campusId: null, chairId: null }, sillon), true);
  // Con sede: solo la suya.
  assert.equal(eduBlockAlcanzaSillon({ campusId: "norte", chairId: null }, sillon), true);
  assert.equal(eduBlockAlcanzaSillon({ campusId: "sur", chairId: null }, sillon), false);
  // Con sillón: solo ése, aunque la sede coincida.
  assert.equal(eduBlockAlcanzaSillon({ campusId: "norte", chairId: "c2" }, sillon), false);
  assert.equal(eduBlockAlcanzaSillon({ campusId: "norte", chairId: "c1" }, sillon), true);
});

test("bloqueos · quien choca lee POR QUÉ, no un booleano", () => {
  const bloques = [
    {
      campusId: "norte",
      chairId: null,
      startsAt: new Date("2026-09-15T00:00Z"),
      endsAt: new Date("2026-09-18T00:00Z"),
      kind: "PUENTE" as const,
      reason: "Fiestas patrias",
    },
  ];
  const choca = eduBlockQueImpide(bloques, {
    startsAt: new Date("2026-09-16T10:00Z"),
    endsAt: new Date("2026-09-16T11:00Z"),
    chair: { id: "c1", campusId: "norte" },
  });
  assert.equal(choca?.reason, "Fiestas patrias");

  // El sillón del OTRO campus no está bloqueado.
  assert.equal(
    eduBlockQueImpide(bloques, {
      startsAt: new Date("2026-09-16T10:00Z"),
      endsAt: new Date("2026-09-16T11:00Z"),
      chair: { id: "c9", campusId: "sur" },
    }),
    null,
  );
});

test("bloqueos · el motivo es obligatorio y el rango se defiende del dedazo de año", () => {
  assert.throws(() => eduBlockParseReason(""), /motivo/i);
  assert.throws(
    () => eduBlockParseRango("2026-09-07T08:00Z", "2026-09-07T08:00Z"),
    /posterior/,
    "un rango de duración cero no bloquea nada y la pantalla diría que sí",
  );
  assert.throws(() => eduBlockParseRango("no-es-fecha", "2026-09-07T08:00Z"), /no se entienden/);
  assert.throws(
    () => eduBlockParseRango("2026-09-07T08:00Z", "2028-09-07T08:00Z"),
    new RegExp(String(EDU_BLOCK_MAX_DIAS)),
    "un dedazo de año dejaría la escuela cerrada para siempre",
  );
  const ok = eduBlockParseRango("2026-09-15T00:00Z", "2026-09-18T00:00Z");
  assert.equal(ok.endsAt.getTime() - ok.startsAt.getTime(), 3 * 24 * 60 * 60 * 1000);

  for (const k of EDU_BLOCK_KINDS) {
    assert.ok(EDU_BLOCK_KIND_LABELS[k], `falta la etiqueta de ${k}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 10 · LAS PIEZAS PEQUEÑAS: CORTE, CATEGORÍAS, REQUISITOS, INSTITUTO
// ═══════════════════════════════════════════════════════════════════════

test("corte · el desglose por método se congela, y un turno viejo se distingue", () => {
  const d = eduCorteDesglose([
    { method: "CASH", amountCents: 50_000, isRefund: false },
    { method: "CASH", amountCents: 10_000, isRefund: true },
    { method: "CARD_CREDIT", amountCents: 120_000, isRefund: false },
  ]);
  const cash = d.renglones.find((r) => r.method === "CASH")!;
  assert.equal(cash.chargedCents, 50_000);
  assert.equal(cash.refundedCents, 10_000);
  assert.equal(cash.netCents, 40_000);
  assert.equal(cash.count, 2);
  assert.equal(d.netoTotalCents, 160_000);
  // Solo los métodos CON movimiento: un corte con siete ceros no lo lee nadie.
  assert.equal(d.renglones.length, 2);
  // Y el orden es el del catálogo, para poder compararlo con el de ayer.
  assert.equal(d.renglones[0].method, "CASH");

  // 🔴 NULL no es un error: es un turno cerrado ANTES de esta ola, y son
  // todos los que ya están en la base.
  assert.equal(eduCorteDesgloseLeer(null), null);
  assert.equal(eduCorteDesgloseLeer({ renglones: [] }), null);
  const vuelta = eduCorteDesgloseLeer(JSON.parse(JSON.stringify(d)));
  assert.equal(vuelta?.netoTotalCents, 160_000);
});

test("categorías · la clave se deriva del nombre y NO cambia al renombrar", () => {
  assert.equal(eduCategoriaKeyDesdeNombre("Endodoncia"), "endodoncia");
  assert.equal(eduCategoriaKeyDesdeNombre("Prótesis fija"), "protesis-fija");
  assert.equal(eduCategoriaKeyDesdeNombre("  Cirugía / Bucal  "), "cirugia-bucal");
  assert.equal(eduCategoriaParseKey(undefined, "Endodoncia"), "endodoncia");
  assert.throws(() => eduCategoriaParseKey("Con Mayúsculas", "x"), /minúsculas/);

  // El emparejado SUGIERE y no decide: lo que no encuentra pareja sale en
  // una lista para que una persona lo mire.
  const cats = [{ id: "c1", name: "Endodoncia", key: "endodoncia" }];
  const s = eduCategoriaSugerirEmparejado(["ENDODONCIA", "endodoncia", "Cirugía"], cats);
  assert.equal(s.find((x) => x.texto === "ENDODONCIA")?.categoryId, "c1");
  assert.equal(s.find((x) => x.texto === "Cirugía")?.categoryId, null);
  assert.deepEqual(eduCategoriaSinPareja(s), ["Cirugía"]);
});

test("requisitos · gana la versión de la cohorte, luego la general, luego la fila viva", () => {
  const v = (
    id: string,
    version: number,
    cohortId: string | null,
    requiredCount: number,
    iso: string,
  ) => ({
    id,
    version,
    cohortId,
    requiredCount,
    semesterFrom: null,
    semesterTo: null,
    onlyCompleted: true,
    notes: null,
    effectiveFrom: new Date(iso),
  });

  const versiones = [
    v("a", 1, null, 8, "2026-01-01T00:00:00Z"),
    v("b", 2, null, 12, "2026-03-01T00:00:00Z"),
    v("c", 3, "gen-2023", 8, "2026-03-01T00:00:00Z"),
  ];
  const hoy = new Date("2026-09-07T00:00:00Z");

  // La generación que se gradúa en junio se sigue midiendo con 8 — que es
  // exactamente lo que H-89 pedía.
  assert.equal(eduRequisitoVersionVigente(versiones, "gen-2023", hoy)?.requiredCount, 8);
  // Y la que no tiene versión propia, con la general vigente: 12.
  assert.equal(eduRequisitoVersionVigente(versiones, "gen-2026", hoy)?.requiredCount, 12);
  // Una versión con vigencia FUTURA todavía no cuenta.
  assert.equal(
    eduRequisitoVersionVigente([v("z", 4, null, 20, "2027-01-01T00:00:00Z")], null, hoy),
    null,
  );

  // Sin versiones, manda la fila viva: una escuela que nunca versionó
  // nada funciona igual que antes de esta ola.
  const vivo = { requiredCount: 5, semesterFrom: null, semesterTo: null, onlyCompleted: true, notes: null };
  const efectivo = eduRequisitoEfectivo(vivo, [], "gen-2026", hoy);
  assert.equal(efectivo.snapshot.requiredCount, 5);
  assert.equal(efectivo.version, null);

  // El desempate por `version` cuando dos comparten fecha de vigencia.
  const mismoDia = [v("p", 1, null, 8, "2026-03-01T00:00:00Z"), v("q", 2, null, 10, "2026-03-01T00:00:00Z")];
  assert.equal(eduRequisitoVersionVigente(mismoDia, null, hoy)?.requiredCount, 10);
});

test("requisitos · se avisa cuando el cambio le quita avance a todo el mundo", () => {
  const base = { requiredCount: 8, semesterFrom: null, semesterTo: null, onlyCompleted: false, notes: null };
  assert.equal(eduRequisitoCambioDuele(base, { ...base, requiredCount: 12 }), true, "H-89 en una línea");
  assert.equal(eduRequisitoCambioDuele(base, { ...base, requiredCount: 4 }), false, "bajarlo no duele");
  assert.equal(
    eduRequisitoCambioDuele(base, { ...base, onlyCompleted: true }),
    true,
    "pasar a «solo completados» también quita avance de golpe",
  );
});

test("instituto · se corrige lo editable, y el contrato NO", () => {
  const p = eduInstitucionParsePatch({ city: "Tijuana", timezone: "America/Tijuana" });
  assert.equal(p.city, "Tijuana");
  assert.equal(p.timezone, "America/Tijuana");

  // Campo ausente no se escribe; campo en blanco sí borra.
  assert.ok(!("phone" in p), "un PATCH parcial no puede vaciar el RFC de la escuela");
  assert.equal(eduInstitucionParsePatch({ rfc: "" }).rfc, null);
  assert.equal(eduInstitucionParsePatch({ rfc: "xaxx010101000" }).rfc, "XAXX010101000");

  // La zona horaria se valida contra Intl: un dedazo movería la agenda de
  // toda la escuela sin decir nada.
  assert.throws(() => eduInstitucionParsePatch({ timezone: "America/Tijuna" }), /zona horaria/);
  assert.throws(() => eduInstitucionParsePatch({ name: "" }), /nombre/);
  assert.throws(() => eduInstitucionParsePatch({}), /ningún campo/);

  // Y lo que NO se toca desde el panel lleva su porqué escrito.
  for (const k of ["slug", "storageQuotaBytes", "contractEndsAt"]) {
    assert.ok(EDU_INSTITUCION_NO_EDITABLE[k], `${k} tiene que explicar por qué no se edita`);
    assert.ok(!(k in eduInstitucionParsePatch({ city: "x", [k]: "pirata" })));
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 11 · LO QUE SOLO SE PUEDE COMPROBAR LEYENDO EL FUENTE
// ═══════════════════════════════════════════════════════════════════════

test("ARCO y fusión NO borran una sola fila", () => {
  for (const rel of ["src/lib/edu/arco.ts", "src/lib/edu/fusion.ts"]) {
    const code = sinComentarios(fuente(rel));
    assert.ok(!/\.delete\s*\(/.test(code), `${rel} no puede llamar a .delete()`);
    assert.ok(!/\.deleteMany\s*\(/.test(code), `${rel} no puede llamar a .deleteMany()`);
  }
});

test("las escrituras con estado usan updateMany y miran el count", () => {
  // La regla de la casa desde la Ola A. Un 200 que no escribió nada es la
  // peor respuesta posible, porque la persona se va convencida.
  for (const rel of [
    "src/lib/edu/arco.ts",
    "src/lib/edu/fusion.ts",
    "src/lib/edu/plan-tratamiento.ts",
    "src/lib/edu/presupuestos.ts",
    "src/lib/edu/agenda-bloqueos.ts",
    "src/lib/edu/recetas-archivo.ts",
    "src/lib/edu/institucion.ts",
    "src/lib/edu/categorias.ts",
  ]) {
    const code = sinComentarios(fuente(rel));
    assert.ok(code.includes("updateMany"), `${rel} escribe con updateMany`);
    assert.ok(/count === 0/.test(code), `${rel} tiene que mirar el count`);
  }
});

test("toda consulta de los módulos nuevos filtra por institutionId", () => {
  // `institutionId: undefined` en Prisma no devuelve cero filas: BORRA el
  // filtro y una escuela lee lo de otra.
  for (const rel of [
    "src/lib/edu/arco.ts",
    "src/lib/edu/fusion.ts",
    "src/lib/edu/auditoria.ts",
    "src/lib/edu/cuestionario.ts",
    "src/lib/edu/plan-tratamiento.ts",
    "src/lib/edu/presupuestos.ts",
    "src/lib/edu/agenda-bloqueos.ts",
    "src/lib/edu/categorias.ts",
    "src/lib/edu/requisitos-version.ts",
    "src/lib/edu/odontograma-eventos.ts",
  ]) {
    const code = sinComentarios(fuente(rel));
    assert.ok(code.includes("institutionId"), `${rel} tiene que filtrar por institutionId`);
    assert.ok(
      !/institutionId:\s*undefined/.test(code),
      `${rel}: institutionId undefined BORRA el filtro`,
    );
  }
});

test("cero imports del dental en los módulos nuevos", () => {
  // Producto SEPARADO: si Dental cambia, instituto no cambia.
  const prohibidos = [
    "@/lib/clinical-shared",
    "@/app/actions",
    "@/components/dashboard",
    "@/lib/patient",
  ];
  for (const rel of [
    "src/lib/edu/arco.ts",
    "src/lib/edu/arco-core.ts",
    "src/lib/edu/fusion.ts",
    "src/lib/edu/fusion-core.ts",
    "src/lib/edu/auditoria.ts",
    "src/lib/edu/auditoria-core.ts",
    "src/lib/edu/cuestionario.ts",
    "src/lib/edu/cuestionario-core.ts",
    "src/lib/edu/plan-tratamiento.ts",
    "src/lib/edu/plan-tratamiento-core.ts",
    "src/lib/edu/presupuestos.ts",
    "src/lib/edu/presupuestos-core.ts",
    "src/lib/edu/agenda-bloqueos.ts",
    "src/lib/edu/agenda-bloqueos-core.ts",
    "src/lib/edu/institucion.ts",
    "src/lib/edu/institucion-core.ts",
    "src/lib/edu/odontograma-eventos.ts",
    "src/lib/edu/categorias.ts",
    "src/lib/edu/requisitos-version.ts",
    "src/lib/edu/caja-cierre-core.ts",
    "src/lib/edu/recetas-archivo.ts",
    "src/lib/edu/ia-cupo-historial.ts",
  ]) {
    const code = fuente(rel);
    for (const p of prohibidos) {
      assert.ok(!code.includes(`from "${p}`), `${rel} importa del dental: ${p}`);
    }
  }
});

test("los cores son PUROS: ni prisma, ni server-only, ni un new Date() escondido", () => {
  for (const rel of [
    "src/lib/edu/arco-core.ts",
    "src/lib/edu/fusion-core.ts",
    "src/lib/edu/auditoria-core.ts",
    "src/lib/edu/cuestionario-core.ts",
    "src/lib/edu/plan-tratamiento-core.ts",
    "src/lib/edu/presupuestos-core.ts",
    "src/lib/edu/agenda-bloqueos-core.ts",
    "src/lib/edu/odontograma-eventos-core.ts",
    "src/lib/edu/caja-cierre-core.ts",
    "src/lib/edu/categorias-core.ts",
    "src/lib/edu/requisitos-version-core.ts",
  ]) {
    const code = sinComentarios(fuente(rel));
    assert.ok(!code.includes("@/lib/prisma"), `${rel} no puede importar prisma`);
    assert.ok(!code.includes("server-only"), `${rel} tiene que ser client-safe`);
    assert.ok(
      !/new Date\(\s*\)/.test(code),
      `${rel}: el "now" se pasa siempre, para poder probarlo`,
    );
  }
});

test("la bitácora tiene UN SOLO escritor y no tumba la operación", () => {
  const code = fuente("src/lib/edu/auditoria.ts");
  const sinCom = sinComentarios(code);
  // El create de la bitácora vive SOLO aquí.
  assert.equal(
    (sinCom.match(/eduAuditLog\.create/g) ?? []).length,
    1,
    "doce sitios escribiendo la bitácora es cómo se llega a que el decimotercero no la escriba",
  );
  // Y va envuelto: si falla, se grita y se sigue.
  assert.ok(sinCom.includes("catch"), "eduAudit nunca lanza");
  assert.ok(sinCom.includes("console.error"));

  // Nadie más llama a eduAuditLog.create directamente.
  for (const rel of ["src/lib/edu/arco.ts", "src/lib/edu/fusion.ts", "src/lib/edu/presupuestos.ts"]) {
    assert.ok(
      !sinComentarios(fuente(rel)).includes("eduAuditLog"),
      `${rel} tiene que pasar por eduAudit(), no escribir la tabla`,
    );
  }
});

test("el SQL de la ola es ADITIVO e IDEMPOTENTE de arriba abajo", () => {
  const sql = fuente("sql/edu-ola-c.sql");
  // Todo lo ejecutable es idempotente.
  const ejecutables = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  assert.ok(!/^\s*DROP /im.test(ejecutables), "no hay ni un DROP fuera de comentario");
  assert.ok(!/ALTER TABLE[^\n]*DROP COLUMN/i.test(ejecutables), "no se borra ninguna columna");
  assert.ok(!/\bRENAME\b/i.test(ejecutables), "no se renombra nada");
  assert.ok(!/^\s*DELETE FROM/im.test(ejecutables), "no se borra ni una fila");
  assert.ok(!/\bTRUNCATE\b/i.test(ejecutables));

  // Y cada creación lleva su guardia.
  const creates = ejecutables.match(/CREATE TABLE[^\n]*/g) ?? [];
  assert.ok(creates.length >= 11, "las once tablas de la ola");
  for (const c of creates) assert.ok(c.includes("IF NOT EXISTS"), c);
  for (const c of ejecutables.match(/CREATE (UNIQUE )?INDEX[^\n]*/g) ?? []) {
    assert.ok(c.includes("IF NOT EXISTS"), c);
  }
  for (const c of ejecutables.match(/ADD COLUMN[^\n]*/g) ?? []) {
    assert.ok(c.includes("IF NOT EXISTS"), c);
  }
  // Los enums y las FK, en su bloque DO … EXCEPTION.
  const tipos = (ejecutables.match(/CREATE TYPE/g) ?? []).length;
  const constraints = (ejecutables.match(/ADD CONSTRAINT/g) ?? []).length;
  const bloques = (ejecutables.match(/EXCEPTION\s*\n\s*WHEN duplicate_object/g) ?? []).length;
  assert.equal(bloques, tipos + constraints, "cada CREATE TYPE y cada FK, en su bloque DO");

  // El valor nuevo del enum de recetas, con su IF NOT EXISTS.
  assert.ok(ejecutables.includes(`ADD VALUE IF NOT EXISTS 'ARCHIVADA'`));

  // 🔴 Y el bloque del índice PARCIAL del odontograma va COMENTADO: aquí
  // no se borra nada sin decisión de Rafael.
  assert.ok(sql.includes("DROP INDEX IF EXISTS"), "el bloque existe, escrito");
  for (const linea of sql.split("\n")) {
    if (linea.includes("DROP INDEX")) {
      assert.ok(linea.trimStart().startsWith("--"), `este DROP tiene que ir comentado: ${linea}`);
    }
  }
});

test("el esquema declara TODO lo nuevo como opcional o con default", () => {
  const schema = fuente("prisma/schema.prisma");
  // Las columnas que la ola le añade a tablas que YA existen: si alguna
  // fuera NOT NULL sin default, aplicar el SQL reventaría contra las filas
  // que ya están en la base.
  const nuevas = [
    ["EduPatient", "deletedAt"],
    ["EduPatient", "anonymizedAt"],
    ["EduPatient", "mergedIntoId"],
    ["EduRecord", "deleteReason"],
    ["EduPrescription", "archivedAt"],
    ["EduCashSession", "campusId"],
    ["EduCashSession", "methodBreakdown"],
    ["EduProcedure", "categoryId"],
    ["EduFeeScheduleItem", "priceSetAt"],
    ["EduRequirement", "categoryId"],
  ] as const;
  for (const [modelo, campo] of nuevas) {
    const i = schema.indexOf(`model ${modelo} {`);
    assert.notEqual(i, -1, `falta el modelo ${modelo}`);
    const cuerpo = schema.slice(i, schema.indexOf("\n}", i));
    const linea = cuerpo
      .split("\n")
      .find((l) => new RegExp(`^\\s*${campo}\\s`).test(l));
    assert.ok(linea, `falta ${modelo}.${campo}`);
    assert.ok(
      linea!.includes("?") || linea!.includes("@default"),
      `${modelo}.${campo} tiene que ser opcional o traer default: ${linea}`,
    );
  }
});
