/**
 * DaleControl INSTITUCIONAL — LOS ESTUDIOS DEJAN RASTRO (ws2-t2, H-14).
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-estudios-rastro.test.ts
 *
 * Todo sin base de datos: funciones puras, unos `where` y lecturas del
 * fuente para lo que no se puede comprobar de otra forma sin levantar
 * Postgres. Es el mismo reparto que edu-fotos.test.ts, y por la misma
 * razón: un `where` correcto que nadie llama es exactamente igual de
 * inseguro que uno equivocado.
 *
 * Lo que fija:
 *  1. 🔴 la BAJA SUAVE: `deletedAt IS NULL` en TODAS las lecturas, nunca
 *     un `prisma.eduStudy.delete`, motivo obligatorio y binario conservado;
 *  2. la RECLASIFICACIÓN válida e inválida (una imagen sí, un .zip no);
 *  3. el ORDEN por fecha de TOMA con caída a la de subida;
 *  4. las MARCAS sobre la imagen: lo que no encaja se descarta y nunca
 *     revienta;
 *  5. el viaje día ↔ instante sin que la fecha se corra un día;
 *  6. que `abortEduStudyUpload` deja de acabarse en sí mismo y manda a
 *     «Retirar».
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EduStudyKind as PrismaStudyKind } from "@prisma/client";
import {
  EDU_STUDY_ABORT_YA_REGISTRADO,
  EDU_STUDY_MARK_LABEL_MAX,
  EDU_STUDY_MAX_MARKS,
  EDU_STUDY_MOTIVO_MAX,
  EDU_STUDY_ORDEN_NOTA,
  eduDiaISOaInstante,
  eduInstanteADiaInput,
  eduOrdenarEstudios,
  eduParseStudyMarks,
  eduParseTakenAt,
  eduReclasificacionesPosibles,
  eduResolveStudyKind,
  eduSerializeStudyMarks,
  eduStudyOrdenISO,
  eduValidarReclasificacion,
} from "../estudios-core";
import { eduAlmacenamientoWhere, eduAlmacenamientoFotosWhere } from "../almacenamiento-core";
import { EDU_STUDY_KINDS, type EduStudyKind } from "../types";

// ─────────────────────────────────────────────────────────────────────
// 0 · Candado de TIPOS: la lista de `kind` de types.ts == el enum de
//     Prisma. En runtime esto no existe; lo verifica `tsc --noEmit`, y
//     por lo tanto `next build`.
// ─────────────────────────────────────────────────────────────────────
type Exacto<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _kind: Exacto<EduStudyKind, PrismaStudyKind> = true;
void _kind;

const RAIZ = join(__dirname, "..", "..", "..", "..");

function crudo(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8");
}

/** El código SIN comentarios: un comentario que EXPLICA por qué algo no
 *  se hace no puede hacer fallar la prueba que mira el fuente. */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

const SERVIDOR = ["src", "lib", "edu", "estudios.ts"];
const RUTA_DETALLE = ["src", "app", "api", "instituto", "estudios", "[id]", "route.ts"];

// ═════════════════════════════════════════════════════════════════════
// 1 · LA BAJA SUAVE
// ═════════════════════════════════════════════════════════════════════

test("🔴 NADA se borra: no existe un solo `eduStudy.delete` en el vertical", () => {
  const src = sinComentarios(crudo(...SERVIDOR));
  assert.equal(
    /prisma\.eduStudy\.delete\b/.test(src),
    false,
    "apareció un borrado duro de estudios",
  );
  assert.equal(/prisma\.eduStudy\.deleteMany\b/.test(src), false);
});

test("🔴 TODAS las lecturas de estudios filtran `deletedAt: null`", () => {
  const src = sinComentarios(crudo(...SERVIDOR));

  // La galería del paciente.
  assert.match(
    src,
    /where: \{ institutionId, patientId: paciente\.id, deletedAt: null \}/,
    "listEduPatientStudies no esconde los retirados",
  );
  // El estudio suelto que abre el visor: aquí SÍ salen los retirados,
  // con su deletedAt, porque quien llama tiene que poder contestar "ya
  // estaba retirado" y no "no existe" — pero lo devuelve para decidir.
  assert.match(src, /deletedAt: true/, "getEduStudyForViewer no trae el deletedAt");

  // Y el Resumen de la ficha, que consulta por su cuenta.
  const resumen = sinComentarios(crudo("src", "lib", "edu", "resumen.ts"));
  assert.match(resumen, /patientId: id,\s*deletedAt: null,/);
});

test("🔴 la CUOTA deja de contar lo retirado, en las dos tablas hermanas", () => {
  // Es una sola decisión de producto (baja suave + binario conservado) y
  // tiene que valer igual para un estudio y para una foto: si una
  // descontara y la otra no, la misma acción liberaría espacio o no según
  // el archivo y nadie sabría explicar por qué.
  assert.deepEqual(eduAlmacenamientoWhere("inst_1"), {
    institutionId: "inst_1",
    deletedAt: null,
  });
  assert.deepEqual(eduAlmacenamientoFotosWhere("inst_1"), {
    institutionId: "inst_1",
    deletedAt: null,
  });
});

test("🔴 un institutionId vacío revienta en vez de sumar el consumo del vecino", () => {
  // En Prisma `where: { institutionId: undefined }` NO devuelve cero
  // filas: BORRA el filtro y devuelve las de TODAS las escuelas.
  assert.throws(() => eduAlmacenamientoWhere(""));
  assert.throws(() => eduAlmacenamientoWhere(undefined as unknown as string));
});

test("retirar EXIGE motivo, escribe los tres campos juntos y NO toca el bucket", () => {
  const src = crudo(...SERVIDOR);
  const cuerpo = src.slice(src.indexOf("export async function softDeleteEduStudy"));
  assert.match(cuerpo, /Escribe por qué se retira el estudio/);
  assert.match(cuerpo, /deletedAt: now, deletedById: ctx\.eduUserId, deleteReason: reason/);
  // El binario se conserva: ni un `eduStorageRemove` dentro de la baja.
  assert.equal(
    /eduStorageRemove/.test(cuerpo),
    false,
    "la baja suave está borrando el objeto del bucket",
  );
  assert.equal(EDU_STUDY_MOTIVO_MAX, 500);
});

test("retirar dos veces contesta «ya estaba retirado», no «no existe»", () => {
  // Un 404 le haría creer a alguien que perdió el estudio.
  const src = crudo(...SERVIDOR);
  const cuerpo = src.slice(src.indexOf("export async function softDeleteEduStudy"));
  assert.match(cuerpo, /ya estaba retirado del expediente\.", 409/);
});

test("un estudio retirado ya no se corrige ni se le escriben notas", () => {
  const src = crudo(...SERVIDOR);
  const corregir = src.slice(src.indexOf("export async function updateEduStudy"));
  assert.match(corregir, /retirado del expediente: ya no se corrige\.", 409/);
  const notas = src.slice(src.indexOf("export async function updateEduStudyNotes"));
  assert.match(notas, /retirado del expediente: ya no se edita\.", 409/);
});

test("🔴 `abort` ya no se acaba en sí mismo: manda a «Retirar»", () => {
  // El 409 decía «Ese archivo ya está registrado» y ahí se acababa la
  // conversación: el alumno que acababa de subir la panorámica al paciente
  // equivocado no tenía a dónde ir.
  assert.match(EDU_STUDY_ABORT_YA_REGISTRADO, /Retirar/);
  assert.match(EDU_STUDY_ABORT_YA_REGISTRADO, /no se destruye/);
  const src = crudo(...SERVIDOR);
  const abort = src.slice(src.indexOf("export async function abortEduStudyUpload"));
  assert.match(abort, /EDU_STUDY_ABORT_YA_REGISTRADO/);
  // Y NO filtra los retirados al buscar la fila: si lo hiciera, "cancelar
  // una subida" sería la forma de borrar el binario que «Retirar» existe
  // para conservar.
  assert.match(abort, /where: \{ institutionId, storagePath: path \}/);
});

test("las dos puertas nuevas piden `estudios.upload` y no una key inventada", () => {
  const ruta = crudo(...RUTA_DETALLE);
  const veces = ruta.match(/eduApiGuard\("estudios\.upload"\)/g) ?? [];
  assert.equal(veces.length, 2, "PATCH y DELETE tienen que pedir el permiso de escritura");
  assert.equal(/["']estudios\.(retirar|delete)/.test(ruta), false, "se coló una key nueva");
  assert.match(ruta, /export const dynamic = "force-dynamic"/);
});

// ═════════════════════════════════════════════════════════════════════
// 2 · RECLASIFICAR — solo entre los compatibles con la extensión
// ═════════════════════════════════════════════════════════════════════

test("una IMAGEN va y viene entre radiografía y foto clínica", () => {
  // Es la corrección que de verdad hace falta: el servidor asume
  // RADIOGRAFIA para TODA imagen, y por eso el Resumen rotulaba
  // «Radiografía» una foto de la sonrisa.
  assert.equal(eduValidarReclasificacion("jpg", "FOTO"), null);
  assert.equal(eduValidarReclasificacion("png", "RADIOGRAFIA"), null);
  assert.equal(eduValidarReclasificacion("webp", "FOTO"), null);
  assert.deepEqual(eduReclasificacionesPosibles("jpg").sort(), ["FOTO", "RADIOGRAFIA"]);
});

test("🔴 un .zip de 600 MB NUNCA se convierte en «Foto»", () => {
  // Es lo que haría que la galería intentara pintarlo con un <img>.
  const error = eduValidarReclasificacion("zip", "FOTO");
  assert.ok(error, "aceptó reclasificar un .zip como foto");
  assert.match(error!, /\.zip/);
  assert.deepEqual(eduReclasificacionesPosibles("zip"), ["TOMOGRAFIA"]);
  assert.deepEqual(eduReclasificacionesPosibles("stl"), ["MODELO_3D"]);
  assert.deepEqual(eduReclasificacionesPosibles("pdf"), ["PDF"]);
});

test("un `kind` que no existe se rechaza con palabras, no con un 500", () => {
  assert.match(eduValidarReclasificacion("jpg", "RESONANCIA")!, /no existe/);
  assert.match(eduValidarReclasificacion("jpg", 7)!, /no existe/);
  assert.match(eduValidarReclasificacion("jpg", null)!, /no existe/);
});

test("la regla de reclasificar es LA MISMA que la de registrar, no una copia", () => {
  // Si un día divergen, la pantalla ofrecería lo que el servidor rebota.
  for (const ext of ["jpg", "png", "webp", "zip", "dcm", "pdf", "stl", "ply", "obj", "raro"]) {
    for (const k of EDU_STUDY_KINDS) {
      const permitido = eduValidarReclasificacion(ext, k) === null;
      assert.equal(permitido, eduResolveStudyKind(ext, k) === k, `${ext} → ${k}`);
      assert.equal(permitido, eduReclasificacionesPosibles(ext).includes(k), `${ext} → ${k}`);
    }
  }
});

// ═════════════════════════════════════════════════════════════════════
// 3 · EL ORDEN: por fecha de TOMA, con caída a la de subida
// ═════════════════════════════════════════════════════════════════════

const SUBIDA = "2026-09-01T10:00:00.000Z";

function est(id: string, takenAt: string | null, createdAt = SUBIDA) {
  return { id, takenAt, createdAt };
}

test("manda la fecha de TOMA cuando existe; si no, la de subida", () => {
  assert.deepEqual(eduStudyOrdenISO(est("a", "2025-01-01T12:00:00.000Z")), {
    iso: "2025-01-01T12:00:00.000Z",
    porToma: true,
  });
  assert.deepEqual(eduStudyOrdenISO(est("b", null)), { iso: SUBIDA, porToma: false });
  // Una fecha de toma corrupta no puede desaparecer el estudio del orden.
  assert.deepEqual(eduStudyOrdenISO(est("c", "no-es-fecha")), { iso: SUBIDA, porToma: false });
});

test("🔴 una placa de hace un año subida hoy NO se ordena como de hoy", () => {
  // Es la razón entera de que exista la columna: sin `takenAt`, el
  // expediente contaba una historia falsa.
  const orden = eduOrdenarEstudios([
    est("vieja-subida-hoy", "2025-01-10T12:00:00.000Z"),
    est("nueva-sin-toma", null),
  ]);
  assert.deepEqual(
    orden.map((r) => r.id),
    ["nueva-sin-toma", "vieja-subida-hoy"],
  );
});

test("el orden es de la más reciente a la más antigua, y ESTABLE con empates", () => {
  const misma = "2026-05-05T12:00:00.000Z";
  const a = eduOrdenarEstudios([est("z", misma), est("a", misma), est("x", "2026-06-06T12:00:00.000Z")]);
  const b = eduOrdenarEstudios([est("a", misma), est("z", misma), est("x", "2026-06-06T12:00:00.000Z")]);
  assert.deepEqual(a.map((r) => r.id), b.map((r) => r.id));
  assert.deepEqual(a.map((r) => r.id), ["x", "a", "z"]);
});

test("ordenar una lista vacía o basura no revienta", () => {
  assert.deepEqual(eduOrdenarEstudios([]), []);
  assert.deepEqual(eduOrdenarEstudios(null as never), []);
});

test("la pantalla DICE por qué está ordenada así", () => {
  // Un orden que no se explica se lee como un orden roto.
  assert.match(EDU_STUDY_ORDEN_NOTA, /fecha de toma/i);
  assert.match(EDU_STUDY_ORDEN_NOTA, /subida/i);
  const screen = crudo("src", "components", "edu", "expediente", "estudios-screen.tsx");
  assert.match(screen, /EDU_STUDY_ORDEN_NOTA/);
});

test("una fecha de toma en el FUTURO se rechaza; vacía BORRA; ausente no toca", () => {
  const ahora = new Date("2026-09-07T12:00:00.000Z");
  assert.equal(eduParseTakenAt(undefined, ahora), undefined);
  assert.equal(eduParseTakenAt("", ahora), null);
  assert.equal(eduParseTakenAt(null, ahora), null);
  assert.equal(eduParseTakenAt("2036-01-01", ahora), false);
  assert.equal(eduParseTakenAt("no-es-fecha", ahora), false);
  const ayer = eduParseTakenAt("2026-09-06T12:00:00.000Z", ahora);
  assert.ok(ayer instanceof Date);
  // Un día de margen para no pelearse con la zona horaria del navegador.
  assert.ok(eduParseTakenAt("2026-09-08T00:00:00.000Z", ahora) instanceof Date);
});

test("🔴 el día no se corre: se manda a MEDIODÍA UTC y vuelve igual", () => {
  // Con `T00:00:00Z`, leído en la zona del instituto (México, UTC-6), el
  // instante cae en el día ANTERIOR y la placa fechada el 12 sale el 11.
  assert.equal(eduDiaISOaInstante("2026-03-12"), "2026-03-12T12:00:00.000Z");
  assert.equal(eduInstanteADiaInput("2026-03-12T12:00:00.000Z"), "2026-03-12");
  assert.equal(eduInstanteADiaInput(eduDiaISOaInstante("2026-12-31")), "2026-12-31");
  // Lo que no es un día se ignora en vez de inventarse una fecha.
  assert.equal(eduDiaISOaInstante("12/03/2026"), "");
  assert.equal(eduDiaISOaInstante(""), "");
  assert.equal(eduInstanteADiaInput(null), "");
  assert.equal(eduInstanteADiaInput("basura"), "");
});

test("la fecha de toma se captura AL SUBIR, no solo después", () => {
  const src = sinComentarios(crudo(...SERVIDOR));
  const confirm = src.slice(src.indexOf("export async function confirmEduStudyUpload"));
  assert.match(confirm, /eduParseTakenAt\(input\.takenAt, now\)/);
  assert.match(confirm, /takenAt: taken \?\? null/);
  // Y el cliente la manda.
  const cliente = crudo("src", "components", "edu", "expediente", "edu-upload-client.ts");
  assert.match(cliente, /takenAt: takenAt \|\| undefined/);
});

// ═════════════════════════════════════════════════════════════════════
// 4 · LAS MARCAS SOBRE LA IMAGEN
// ═════════════════════════════════════════════════════════════════════

test("🔴 el JSON de la columna nunca revienta el visor: lo que no encaja se descarta", () => {
  // `annotations` es Json: puede traer una versión vieja, algo escrito a
  // mano o un objeto en vez de un arreglo. Un visor que se cae por una
  // marca mal escrita deja al paciente sin su radiografía por una etiqueta.
  assert.deepEqual(eduParseStudyMarks(null), []);
  assert.deepEqual(eduParseStudyMarks("[]"), []);
  assert.deepEqual(eduParseStudyMarks({ x: 0.5 }), []);
  assert.deepEqual(eduParseStudyMarks([null, 3, "x"]), []);
  assert.deepEqual(eduParseStudyMarks([{ x: 0.5, y: 0.5 }]), [], "una marca sin etiqueta no vale");
  assert.deepEqual(eduParseStudyMarks([{ x: "no", y: 0.5, label: "a" }]), []);
});

test("las coordenadas son RELATIVAS y se pinzan al marco", () => {
  // Un arrastre que se sale un píxel es un gesto normal, no un dato
  // corrupto: se pinza en vez de rechazar.
  assert.deepEqual(eduParseStudyMarks([{ x: 1.4, y: -0.2, label: "36" }]), [
    { x: 1, y: 0, label: "36" },
  ]);
});

test("la etiqueta se recorta y hay un techo de marcas", () => {
  const larga = "x".repeat(200);
  assert.equal(eduParseStudyMarks([{ x: 0.5, y: 0.5, label: larga }])[0].label.length, EDU_STUDY_MARK_LABEL_MAX);
  const muchas = Array.from({ length: EDU_STUDY_MAX_MARKS + 10 }, (_, i) => ({
    x: 0.5,
    y: 0.5,
    label: `m${i}`,
  }));
  assert.equal(eduParseStudyMarks(muchas).length, EDU_STUDY_MAX_MARKS);
});

test("sin marcas se guarda null y no `[]`: dos formas de «vacío» es una de más", () => {
  assert.equal(eduSerializeStudyMarks([]), null);
  assert.equal(eduSerializeStudyMarks("basura"), null);
  assert.deepEqual(eduSerializeStudyMarks([{ x: 0.2, y: 0.3, label: " 36 " }]), [
    { x: 0.2, y: 0.3, label: "36" },
  ]);
});

test("las marcas se REEMPLAZAN enteras, que es lo único que deja borrar una", () => {
  const src = sinComentarios(crudo(...SERVIDOR));
  const upd = src.slice(src.indexOf("export async function updateEduStudy"));
  assert.match(upd, /eduSerializeStudyMarks\(patch\.annotations\)/);
  // Y sin `estudios.upload` el visor no ofrece ni un botón que dé 403.
  const anot = crudo("src", "components", "edu", "estudios", "anotaciones.tsx");
  assert.match(anot, /canUpload \? \(/);
});

// ═════════════════════════════════════════════════════════════════════
// 5 · 🔴 RENOMBRAR NO PUEDE CAMBIAR LO QUE EL ARCHIVO ES
// ═════════════════════════════════════════════════════════════════════

test("la EXTENSIÓN viaja desde el PATH, no desde el nombre que se corrige", () => {
  // Es el efecto secundario del renombrado, y es el que muerde: hasta hoy
  // la pantalla deducía el visor y el icono de `name` y daba igual, porque
  // `name` era el nombre con el que se subió. Desde que se puede corregir,
  // «tomografía de Ana» —sin extensión— dejaría a un .zip sin visor CBCT.
  const servidor = sinComentarios(crudo(...SERVIDOR));
  assert.match(servidor, /ext: eduExtOfName\(s\.storagePath\)/);

  const visor = crudo("src", "components", "edu", "expediente", "estudio-viewer.tsx");
  assert.match(visor, /eduVisorPorExtension\(estudio\.ext\)/);
  assert.equal(
    /eduVisorPorExtension\(estudio\.name\)/.test(visor),
    false,
    "el visor sigue eligiéndose por el nombre",
  );

  const screen = crudo("src", "components", "edu", "expediente", "estudios-screen.tsx");
  assert.match(screen, /iconoDeArchivo\(e\.ext\)/);

  const editar = crudo("src", "components", "edu", "estudios", "estudio-editar.tsx");
  assert.match(editar, /eduReclasificacionesPosibles\(estudio\.ext\)/);
});

test("el nombre NO se puede dejar vacío: es por lo que se encuentra después", () => {
  const src = crudo(...SERVIDOR);
  const upd = src.slice(src.indexOf("export async function updateEduStudy"));
  assert.match(upd, /El nombre no puede quedar vacío/);
});
