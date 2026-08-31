/**
 * RECETAS — Ola 14 de DaleControl INSTITUCIONAL.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-recetas.test.ts
 *
 * Todo se comprueba SIN base de datos, como en las olas anteriores: el
 * hash es una función de un texto, la validación de renglones es pura y
 * el reparto de permisos es una lista. Lo que queda fuera (las
 * transacciones de enviar/expedir contra Postgres) está anotado como NO
 * probado en ORQUESTA.md.
 *
 * Lo que fija este archivo:
 *  1. 🔴 QUE LA RECETA VIVA DENTRO DEL GATE DE LA OLA 4: la etapa
 *     PRESCRIPTION apunta a EduPrescription, su hash usa la MISMA
 *     maquinaria (editar la receta vence la firma), y NO se puede pedir
 *     por el camino genérico (etapas "pedibles").
 *  2. 🔴 QUE EL ALUMNO PROPONGA Y NO EXPIDA: recetas.propose sin
 *     recetas.issue en su default. Si esto cambia, el alumno se receta
 *     solo — sin cédula.
 *  3. 🔴 QUE UNA PENDIENTE O RECHAZADA NO PRODUZCA PAPEL:
 *     eduRecetaPrintable solo abre EXPEDIDA y ANULADA.
 *  4. Que la RECETA nunca entre al LOTE — se expide leyéndola.
 *  5. Que un renglón sin medicamento o sin dosis no pase.
 *  6. Que las uniones de types.ts no se desincronicen de los enums de
 *     Prisma (chequeo de TIPOS, lo verifica `tsc --noEmit`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { EduPrescriptionStatus as PrismaPrescriptionStatus } from "@prisma/client";
import {
  EDU_APPROVAL_BATCH_SKIP_LABELS,
  EDU_APPROVAL_REQUESTABLE_STAGES,
  EDU_APPROVAL_STAGE_TARGET,
  EDU_APPROVAL_TARGETS,
  eduApprovalBatchSkipReason,
  eduApprovalCanonicalText,
  eduApprovalEffectiveStatus,
  eduApprovalTargetForStage,
  parseEduApprovalStage,
  parseEduApprovalTarget,
  type EduApprovalPrescriptionSnapshot,
} from "../autorizaciones-core";
import { eduApprovalHash } from "../autorizaciones-hash";
import {
  EDU_RECETA_MAX_ITEMS,
  EDU_RECETA_NONE_DETAIL,
  eduRecetaCleanCedula,
  eduRecetaEditable,
  eduRecetaParseItems,
  eduRecetaPrintable,
  eduRecetaSendable,
  eduRecetaSnapshot,
  eduRecetaVoidable,
} from "../recetas-core";
import {
  EDU_ALL_PERMISSIONS,
  EDU_PERMISSION_GROUPS,
  hasEduPermission,
  type EduPermissionKey,
} from "../permissions";
import {
  EDU_APPROVAL_STAGES,
  EDU_APPROVAL_STAGE_LABELS,
  EDU_PRESCRIPTION_STATUSES,
  EDU_PRESCRIPTION_STATUS_DESCRIPTIONS,
  EDU_PRESCRIPTION_STATUS_LABELS,
  EDU_PRESCRIPTION_TRANSITIONS,
  EDU_ROLES,
  type EduPrescriptionStatus,
  type EduRole,
} from "../types";

// ─────────────────────────────────────────────────────────────────────
// 0 · Candado de tipos: la unión de types.ts == el enum de Prisma
// ─────────────────────────────────────────────────────────────────────
type Exacto<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

const _status: Exacto<EduPrescriptionStatus, PrismaPrescriptionStatus> = true;
void _status;

// ─────────────────────────────────────────────────────────────────────
// 1 · La etapa RECETA vive DENTRO del catálogo de la Ola 4
// ─────────────────────────────────────────────────────────────────────

test("PRESCRIPTION está en el catálogo de etapas y apunta a EduPrescription", () => {
  assert.ok((EDU_APPROVAL_STAGES as string[]).includes("PRESCRIPTION"));
  assert.ok((EDU_APPROVAL_TARGETS as readonly string[]).includes("EduPrescription"));
  assert.equal(EDU_APPROVAL_STAGE_TARGET.PRESCRIPTION, "EduPrescription");
  assert.equal(eduApprovalTargetForStage("PRESCRIPTION"), "EduPrescription");
  assert.equal(parseEduApprovalStage("PRESCRIPTION"), "PRESCRIPTION");
  assert.equal(parseEduApprovalTarget("EduPrescription"), "EduPrescription");
  assert.ok(EDU_APPROVAL_STAGE_LABELS.PRESCRIPTION, "la etiqueta en español existe");
  assert.notEqual(EDU_APPROVAL_STAGE_LABELS.PRESCRIPTION, "PRESCRIPTION");
});

test("la RECETA no es una etapa PEDIBLE desde el camino genérico", () => {
  // Mandarla también la mueve (BORRADOR → PENDIENTE), así que su envío
  // vive en recetas.ts. Si alguien la agrega aquí, el desplegable del
  // caso volvería a ofrecerla y requestEduApproval la rebotaría en vivo.
  assert.ok(!EDU_APPROVAL_REQUESTABLE_STAGES.includes("PRESCRIPTION"));
  // Y las cuatro de siempre siguen completas: quitar una rompería el
  // botón "Enviar a autorización" de la ficha del caso.
  for (const s of ["PLAN", "PROCEDURE", "SESSION", "DISCHARGE"] as const) {
    assert.ok(EDU_APPROVAL_REQUESTABLE_STAGES.includes(s), `falta ${s}`);
  }
});

// ─────────────────────────────────────────────────────────────────────
// 2 · El HASH: la misma maquinaria de la Ola 4, con la receta adentro
// ─────────────────────────────────────────────────────────────────────

const ITEM = {
  drug: "Amoxicilina",
  presentation: "cápsulas 500 mg",
  dose: "1 cápsula",
  route: "oral",
  frequency: "cada 8 horas",
  duration: "por 7 días",
  quantity: "1 caja (21)",
  notes: "terminar el tratamiento completo",
};

function snap(over: Partial<EduApprovalPrescriptionSnapshot> = {}): EduApprovalPrescriptionSnapshot {
  return {
    kind: "EduPrescription",
    diagnosis: "Pulpitis irreversible en 26",
    indications: "Dieta blanda 24 h",
    items: [ITEM],
    ...over,
  };
}

test("cambiar UNA letra de un medicamento cambia el hash (editar vence la firma)", () => {
  const a = eduApprovalHash(snap());
  const b = eduApprovalHash(snap({ items: [{ ...ITEM, dose: "2 cápsulas" }] }));
  assert.notEqual(a, b);

  // Y es LA regla de la Ola 4 aplicada a recetas: lo firmado deja de
  // valer solo cuando el contenido cambia.
  const firmada = { status: "APPROVED" as const, contentHash: a };
  assert.equal(eduApprovalEffectiveStatus(firmada, a), "APPROVED");
  assert.equal(eduApprovalEffectiveStatus(firmada, b), "EXPIRED");
});

test("el ORDEN de los medicamentos es contenido: reordenar cambia el hash", () => {
  const ibuprofeno = { ...ITEM, drug: "Ibuprofeno" };
  const a = eduApprovalHash(snap({ items: [ITEM, ibuprofeno] }));
  const b = eduApprovalHash(snap({ items: [ibuprofeno, ITEM] }));
  assert.notEqual(a, b);
});

test("CRLF y NFC no vencen la firma; los espacios interiores sí cuentan", () => {
  // El mismo diagnóstico tecleado en Windows y pegado desde un teléfono.
  const a = eduApprovalHash(snap({ diagnosis: "línea uno\ndos" }));
  const b = eduApprovalHash(snap({ diagnosis: "línea uno\r\ndos" }));
  assert.equal(a, b);
  // "no extraer" y "no  extraer" no son el mismo texto.
  const c = eduApprovalHash(snap({ diagnosis: "no  extraer" }));
  const d = eduApprovalHash(snap({ diagnosis: "no extraer" }));
  assert.notEqual(c, d);
});

test("agregar o quitar un renglón cambia el hash, y el texto canónico lleva la versión", () => {
  const uno = eduApprovalHash(snap());
  const dos = eduApprovalHash(snap({ items: [ITEM, { ...ITEM, drug: "Paracetamol" }] }));
  const cero = eduApprovalHash(snap({ items: [] }));
  assert.notEqual(uno, dos);
  assert.notEqual(uno, cero);

  const texto = eduApprovalCanonicalText(snap());
  assert.ok(texto.startsWith("edu-approval/v1"), "la versión va DENTRO del texto que se resume");
  assert.ok(texto.includes("EduPrescription"), "el tipo distingue receta de nota y de cita");
});

test("una receta y una nota con textos parecidos JAMÁS producen el mismo hash", () => {
  const receta = eduApprovalHash(snap({ diagnosis: "X", indications: null, items: [] }));
  const nota = eduApprovalHash({
    kind: "EduRecord",
    subjetivo: null,
    objetivo: null,
    analisis: null,
    plan: null,
    diagnostico: "X",
  });
  assert.notEqual(receta, nota);
});

test("eduRecetaSnapshot es el ÚNICO armado: normaliza los huecos a null", () => {
  const s = eduRecetaSnapshot({
    diagnosis: null,
    indications: null,
    items: [
      {
        drug: "Ketorolaco",
        presentation: null,
        dose: "10 mg",
        route: null,
        frequency: null,
        duration: null,
        quantity: null,
        notes: null,
      },
    ],
  });
  assert.equal(s.kind, "EduPrescription");
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].presentation, null);
  // Y produce el mismo hash que el snapshot literal equivalente: si el
  // servidor y el gate armaran distinto, la firma se vencería sola.
  const literal: EduApprovalPrescriptionSnapshot = {
    kind: "EduPrescription",
    diagnosis: null,
    indications: null,
    items: [
      {
        drug: "Ketorolaco",
        presentation: null,
        dose: "10 mg",
        route: null,
        frequency: null,
        duration: null,
        quantity: null,
        notes: null,
      },
    ],
  };
  assert.equal(eduApprovalHash(s), eduApprovalHash(literal));
});

// ─────────────────────────────────────────────────────────────────────
// 3 · El LOTE: la receta nunca entra
// ─────────────────────────────────────────────────────────────────────

test("una RECETA queda fuera del lote, incluso urgente o sin cambios", () => {
  assert.equal(
    eduApprovalBatchSkipReason({
      status: "PENDING",
      isEmergency: false,
      contentChanged: false,
      stage: "PRESCRIPTION",
    }),
    "receta",
  );
  // Urgente sigue siendo receta: el motivo que se pinta es el que explica
  // la cédula, no el de la urgencia.
  assert.equal(
    eduApprovalBatchSkipReason({
      status: "PENDING",
      isEmergency: true,
      contentChanged: false,
      stage: "PRESCRIPTION",
    }),
    "receta",
  );
  assert.ok(EDU_APPROVAL_BATCH_SKIP_LABELS.receta.includes("cédula"));
  // Y las demás etapas siguen entrando como siempre (sin stage también:
  // los llamadores viejos no pasan el campo).
  assert.equal(
    eduApprovalBatchSkipReason({ status: "PENDING", isEmergency: false, contentChanged: false, stage: "PLAN" }),
    null,
  );
  assert.equal(
    eduApprovalBatchSkipReason({ status: "PENDING", isEmergency: false, contentChanged: false }),
    null,
  );
});

// ─────────────────────────────────────────────────────────────────────
// 4 · Estados: qué se puede hacer con cada uno
// ─────────────────────────────────────────────────────────────────────

test("🔴 el papel SOLO sale EXPEDIDA o ANULADA — ése es el gate", () => {
  assert.equal(eduRecetaPrintable("EXPEDIDA"), true);
  assert.equal(eduRecetaPrintable("ANULADA"), true);
  assert.equal(eduRecetaPrintable("BORRADOR"), false);
  assert.equal(eduRecetaPrintable("PENDIENTE"), false);
  assert.equal(eduRecetaPrintable("RECHAZADA"), false);
});

test("editable, mandable y anulable, por estado", () => {
  assert.equal(eduRecetaEditable("BORRADOR"), true);
  // PENDIENTE se edita a propósito: la bandeja marca "la editó después
  // de mandarla" (el hash hace ese trabajo solo) y el docente firma lo
  // que lee.
  assert.equal(eduRecetaEditable("PENDIENTE"), true);
  assert.equal(eduRecetaEditable("EXPEDIDA"), false);
  assert.equal(eduRecetaEditable("RECHAZADA"), false);
  assert.equal(eduRecetaEditable("ANULADA"), false);

  assert.equal(eduRecetaSendable("BORRADOR"), true);
  assert.equal(eduRecetaSendable("PENDIENTE"), true);
  assert.equal(eduRecetaSendable("EXPEDIDA"), false);

  assert.equal(eduRecetaVoidable("EXPEDIDA"), true);
  assert.equal(eduRecetaVoidable("PENDIENTE"), false);
  assert.equal(eduRecetaVoidable("ANULADA"), false);
});

test("las transiciones son un dato y cuadran con los helpers", () => {
  assert.deepEqual(EDU_PRESCRIPTION_TRANSITIONS.BORRADOR, ["PENDIENTE"]);
  assert.deepEqual(EDU_PRESCRIPTION_TRANSITIONS.PENDIENTE, ["EXPEDIDA", "RECHAZADA", "BORRADOR"]);
  assert.deepEqual(EDU_PRESCRIPTION_TRANSITIONS.EXPEDIDA, ["ANULADA"]);
  // RECHAZADA y ANULADA no llevan a ningún lado: una rechazada se
  // propone de nuevo, una anulada se sustituye por OTRA receta.
  assert.deepEqual(EDU_PRESCRIPTION_TRANSITIONS.RECHAZADA, []);
  assert.deepEqual(EDU_PRESCRIPTION_TRANSITIONS.ANULADA, []);

  for (const s of EDU_PRESCRIPTION_STATUSES) {
    assert.ok(EDU_PRESCRIPTION_STATUS_LABELS[s], `falta la etiqueta de ${s}`);
    assert.notEqual(EDU_PRESCRIPTION_STATUS_LABELS[s], s, "la UI no pinta el enum");
    assert.ok(EDU_PRESCRIPTION_STATUS_DESCRIPTIONS[s], `falta la descripción de ${s}`);
  }
});

// ─────────────────────────────────────────────────────────────────────
// 5 · Los renglones: validación pura
// ─────────────────────────────────────────────────────────────────────

test("un renglón sin medicamento o sin dosis no pasa", () => {
  const sinDroga = eduRecetaParseItems([{ dose: "1 tableta" }]);
  assert.equal(sinDroga.ok, false);

  const sinDosis = eduRecetaParseItems([{ drug: "Amoxicilina" }]);
  assert.equal(sinDosis.ok, false);
  if (!sinDosis.ok) assert.ok(sinDosis.error.includes("Amoxicilina"));

  const vacio = eduRecetaParseItems([]);
  assert.equal(vacio.ok, false);
  const noArray = eduRecetaParseItems("amoxi");
  assert.equal(noArray.ok, false);
});

test("los renglones válidos se recortan a sus topes y conservan el orden", () => {
  const out = eduRecetaParseItems([
    { drug: "  Amoxicilina  ", dose: "1 cápsula", presentation: "", route: "oral" },
    { drug: "Ibuprofeno", dose: "400 mg", notes: "x".repeat(9000) },
  ]);
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.items.length, 2);
    assert.equal(out.items[0].drug, "Amoxicilina");
    assert.equal(out.items[0].presentation, null, "cadena vacía = null, no ''");
    assert.equal(out.items[1].notes?.length, 500, "el tope del schema, no el del navegador");
    // El orden es el del formulario, tal cual: es el que entra al hash.
    assert.equal(out.items[1].drug, "Ibuprofeno");
  }
});

test("más renglones que el tope no pasan", () => {
  const muchos = Array.from({ length: EDU_RECETA_MAX_ITEMS + 1 }, (_, i) => ({
    drug: `Med ${i}`,
    dose: "1",
  }));
  const out = eduRecetaParseItems(muchos);
  assert.equal(out.ok, false);
});

test("la cédula: plausible sí, casilla rellenada no", () => {
  assert.equal(eduRecetaCleanCedula("1234567"), "1234567");
  assert.equal(eduRecetaCleanCedula("  12345678  "), "12345678");
  assert.equal(eduRecetaCleanCedula("AECD-891011"), "AECD-891011");
  assert.equal(eduRecetaCleanCedula("123"), null, "muy corta");
  assert.equal(eduRecetaCleanCedula("x".repeat(40)), null, "muy larga");
  assert.equal(eduRecetaCleanCedula("¡¡¡!!!"), null, "sin dígitos ni letras");
  assert.equal(eduRecetaCleanCedula(42), null);
  assert.equal(eduRecetaCleanCedula(undefined), null);
});

// ─────────────────────────────────────────────────────────────────────
// 6 · Permisos: el alumno propone y NO expide
// ─────────────────────────────────────────────────────────────────────

const RECETA_KEYS: EduPermissionKey[] = [
  "recetas.view",
  "recetas.propose",
  "recetas.issue",
  "recetas.void",
];

function conRol(role: EduRole) {
  return { role, permissionsOverride: [] as string[] };
}

test("las cuatro keys existen en el catálogo y viven en EXACTAMENTE un grupo", () => {
  for (const k of RECETA_KEYS) {
    assert.ok(k in EDU_ALL_PERMISSIONS, `falta ${k} en el catálogo`);
    const grupos = EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes(k));
    assert.equal(grupos.length, 1, `${k} debe estar en un solo grupo (está en ${grupos.length})`);
  }
});

test("🔴 el reparto ES la ola: ALUMNO propone y no expide; CAJA nada", () => {
  // ALUMNO: ve y propone. NI issue NI void — no tiene cédula.
  assert.equal(hasEduPermission(conRol("ALUMNO"), "recetas.view"), true);
  assert.equal(hasEduPermission(conRol("ALUMNO"), "recetas.propose"), true);
  assert.equal(hasEduPermission(conRol("ALUMNO"), "recetas.issue"), false);
  assert.equal(hasEduPermission(conRol("ALUMNO"), "recetas.void"), false);

  // DOCENTE y DIRECCION: todo.
  for (const rol of ["DOCENTE", "DIRECCION"] as EduRole[]) {
    for (const k of RECETA_KEYS) {
      assert.equal(hasEduPermission(conRol(rol), k), true, `${rol} debe llevar ${k}`);
    }
  }

  // CAJA: ninguna. Una receta es un documento clínico, no un cobro.
  for (const k of RECETA_KEYS) {
    assert.equal(hasEduPermission(conRol("CAJA"), k), false, `CAJA no debe llevar ${k}`);
  }
});

test("el texto de 'no te toca nada' existe y dice por qué caja no ve", () => {
  assert.ok(EDU_RECETA_NONE_DETAIL.includes("documento clínico"));
  assert.ok(EDU_ROLES.length === 4, "si aparece un quinto rol, revisar el reparto de recetas");
});
