/**
 * OLA C·2 · WS2-T3 — AGENDA Y ACADEMIA: bloqueos, requisitos por cohorte,
 * categorías con llave, cupo de IA, rotación programada e instituto
 * editable.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-ola-c2.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ SE PRUEBA EJECUTANDO Y QUÉ SE PRUEBA LEYENDO FUENTE
 *
 * Lo PURO se ejecuta de verdad: la regla del NULL de un bloqueo, el recorte
 * de una banda a un día, el rango que teclea una persona, la resolución de
 * la versión de un requisito por cohorte, el emparejado de categorías y el
 * costo de la caché de IA. Son funciones sin prisma y sin `new Date()`
 * escondido, así que aquí se llaman.
 *
 * Lo que es una ESCRITURA (agendar consultando el bloqueo, versionar,
 * desactivar un criterio en vez de borrarlo) abre una transacción de Prisma
 * en su primera línea y no se puede ejercitar sin una base. De eso se fija
 * la FORMA leyendo el fuente, que es el mismo camino que ya usan
 * `edu-ola-c-carreras.test.ts` y `edu-theme.test.ts`. Una prueba de lectura
 * de fuente no demuestra que el código funcione: demuestra que la forma que
 * lo hace correcto sigue ahí, y ésa es la que se pierde en el refactor de
 * dentro de tres olas.
 * ═══════════════════════════════════════════════════════════════════════
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EDU_BLOCK_MAX_DIAS,
  eduBlockAlcanzaSillon,
  eduBlockMensaje,
  eduBlockParseRangoLocal,
  eduBlockQueImpide,
  eduBloqueoAlcance,
  eduBloqueoBandasDelDia,
  eduBloqueoRangoLabel,
  type EduBloqueoVista,
} from "@/lib/edu/agenda-bloqueos-core";
import {
  eduRequisitoEfectivo,
  eduRequisitoVersionVigente,
  type EduRequirementVersionLike,
} from "@/lib/edu/requisitos-version-core";
import {
  eduCategoriaKeyDesdeNombre,
  eduCategoriaSugerirEmparejado,
} from "@/lib/edu/categorias-core";
import { eduIaCosto, eduIaCostoDetallado, type EduIaPrecio } from "@/lib/edu/ia-core";
import { eduCaseCountsFor, type EduCountableCase, type EduRequirementSpec } from "@/lib/edu/evaluacion-core";
import { eduInstitucionParsePatch } from "@/lib/edu/institucion-core";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const crudo = (ruta: string): string => readFileSync(join(RAIZ, ...ruta.split("/")), "utf8");

// ═══════════════════════════════════════════════════════════════════════
// 1 · H-19 · LOS BLOQUEOS DE AGENDA
// ═══════════════════════════════════════════════════════════════════════

const TZ = "America/Tijuana";

function bloqueo(over: Partial<EduBloqueoVista> = {}): EduBloqueoVista {
  return {
    id: "b1",
    kind: "PUENTE",
    reason: "Fiestas patrias",
    campusId: null,
    chairId: null,
    // El 15 de septiembre entero, en la hora de Tijuana (UTC-7).
    startsAt: "2026-09-15T07:00:00.000Z",
    endsAt: "2026-09-16T07:00:00.000Z",
    createdByName: "Ana Pérez",
    ...over,
  };
}

test("🔴 H-19 · la regla del NULL: sin sede alcanza a todos, con sede a los suyos, con sillón solo a ése", () => {
  const norte = { id: "ch1", campusId: "sedeN" };
  const sur = { id: "ch2", campusId: "sedeS" };

  const instituto = { campusId: null, chairId: null };
  assert.equal(eduBlockAlcanzaSillon(instituto, norte), true);
  assert.equal(eduBlockAlcanzaSillon(instituto, sur), true);

  const deSede = { campusId: "sedeN", chairId: null };
  assert.equal(eduBlockAlcanzaSillon(deSede, norte), true);
  assert.equal(eduBlockAlcanzaSillon(deSede, sur), false);

  const deSillon = { campusId: "sedeN", chairId: "ch1" };
  assert.equal(eduBlockAlcanzaSillon(deSillon, norte), true);
  assert.equal(eduBlockAlcanzaSillon(deSillon, sur), false);
  assert.equal(eduBlockAlcanzaSillon(deSillon, { id: "ch9", campusId: "sedeN" }), false);
});

test("🔴 H-19 · el solape es SEMIABIERTO: una cita que empieza cuando el bloqueo acaba, cabe", () => {
  const bloques = [
    {
      campusId: null,
      chairId: null,
      startsAt: new Date("2026-09-15T16:00:00Z"),
      endsAt: new Date("2026-09-15T21:00:00Z"),
      kind: "MANTENIMIENTO" as const,
      reason: "Se repara el compresor",
    },
  ];
  const chair = { id: "ch1", campusId: "sedeN" };

  // Empieza justo cuando el bloqueo termina: NO choca.
  assert.equal(
    eduBlockQueImpide(bloques, {
      startsAt: new Date("2026-09-15T21:00:00Z"),
      endsAt: new Date("2026-09-15T22:00:00Z"),
      chair,
    }),
    null,
  );
  // Termina justo cuando el bloqueo empieza: tampoco.
  assert.equal(
    eduBlockQueImpide(bloques, {
      startsAt: new Date("2026-09-15T15:00:00Z"),
      endsAt: new Date("2026-09-15T16:00:00Z"),
      chair,
    }),
    null,
  );
  // Se pisan por un minuto: choca, y devuelve EL BLOQUEO (no un booleano).
  const choca = eduBlockQueImpide(bloques, {
    startsAt: new Date("2026-09-15T20:59:00Z"),
    endsAt: new Date("2026-09-15T21:59:00Z"),
    chair,
  });
  assert.ok(choca);
  // El mensaje lleva el MOTIVO: quien choca es recepción con el paciente
  // delante, y un "no se puede" la deja llamando por teléfono.
  assert.match(eduBlockMensaje(choca!), /Se repara el compresor/);
});

test("🔴 H-19 · la banda se recorta al día EN HORA DE PARED, no por diferencia de instantes", () => {
  // Un puente del 15 al 17 (tres días completos en Tijuana).
  const puente = bloqueo({ endsAt: "2026-09-18T07:00:00.000Z" });

  const dia15 = eduBloqueoBandasDelDia([puente], "2026-09-15", null, TZ);
  assert.equal(dia15.length, 1);
  assert.equal(dia15[0].startMinute, 0);
  assert.equal(dia15[0].endMinute, 1440);
  assert.equal(dia15[0].todoElDia, true);
  assert.equal(dia15[0].desdeAntes, false);
  assert.equal(dia15[0].hastaDespues, true);

  // El 16 está en medio: viene de antes y sigue después.
  const dia16 = eduBloqueoBandasDelDia([puente], "2026-09-16", null, TZ);
  assert.equal(dia16[0].desdeAntes, true);
  assert.equal(dia16[0].hastaDespues, true);

  // 🔴 El 17 es el ÚLTIMO día: viene de antes y NO sigue. El corte está en
  // las 00:00 del 18, así que «acaba en otro día» no puede leerse como
  // «sigue mañana» — la banda pintaría una flecha prometiendo un 18 cerrado
  // que la rejilla enseña abierto.
  const dia17 = eduBloqueoBandasDelDia([puente], "2026-09-17", null, TZ);
  assert.equal(dia17[0].desdeAntes, true);
  assert.equal(dia17[0].hastaDespues, false);

  // 🔴 El 18 NO está bloqueado: el intervalo es semiabierto y termina a las
  // 00:00 de ese día. Sin esta regla, "hasta el 17" cerraría el 18.
  assert.deepEqual(eduBloqueoBandasDelDia([puente], "2026-09-18", null, TZ), []);
  // Y el 14 tampoco.
  assert.deepEqual(eduBloqueoBandasDelDia([puente], "2026-09-14", null, TZ), []);
});

test("🔴 H-19 · una banda de MEDIO día sale con sus minutos de reloj de pared", () => {
  const manana = bloqueo({
    kind: "MANTENIMIENTO",
    reason: "Sillón 7 en servicio",
    chairId: "ch7",
    campusId: "sedeN",
    startsAt: "2026-09-15T16:00:00.000Z", // 09:00 en Tijuana
    endsAt: "2026-09-15T21:00:00.000Z", // 14:00 en Tijuana
  });
  const bandas = eduBloqueoBandasDelDia([manana], "2026-09-15", { id: "ch7", campusId: "sedeN" }, TZ);
  assert.equal(bandas.length, 1);
  assert.equal(bandas[0].startMinute, 9 * 60);
  assert.equal(bandas[0].endMinute, 14 * 60);
  assert.equal(bandas[0].todoElDia, false);
  assert.equal(bandas[0].alcance, "sillon");

  // Y NO alcanza al sillón de al lado.
  assert.deepEqual(
    eduBloqueoBandasDelDia([manana], "2026-09-15", { id: "ch8", campusId: "sedeN" }, TZ),
    [],
  );
});

test("🔴 H-19 · «hasta el 17» incluye el 17 ENTERO (el corte es la medianoche del 18)", () => {
  const { startsAt, endsAt } = eduBlockParseRangoLocal(
    { desdeDia: "2026-09-15", hastaDia: "2026-09-17" },
    TZ,
  );
  assert.equal(startsAt.toISOString(), "2026-09-15T07:00:00.000Z");
  assert.equal(endsAt.toISOString(), "2026-09-18T07:00:00.000Z");
});

test("H-19 · el rango local rebota lo ilegible, lo invertido y el dedazo de año", () => {
  assert.throws(() => eduBlockParseRangoLocal({ desdeDia: "no", hastaDia: "2026-09-17" }, TZ));
  assert.throws(() =>
    eduBlockParseRangoLocal({ desdeDia: "2026-09-17", hastaDia: "2026-09-15" }, TZ),
  );
  assert.throws(
    () => eduBlockParseRangoLocal({ desdeDia: "2026-09-15", hastaDia: "2030-09-17" }, TZ),
    new RegExp(String(EDU_BLOCK_MAX_DIAS)),
  );
});

test("H-19 · el rótulo del rango se lee como lo tecleó una persona", () => {
  const b = bloqueo({ endsAt: "2026-09-18T07:00:00.000Z" });
  const texto = eduBloqueoRangoLabel(b.startsAt, b.endsAt, TZ);
  assert.match(texto, /^Del /);
  assert.match(texto, /17/);
  // Un día suelto no dice "del X al X".
  assert.match(eduBloqueoRangoLabel(bloqueo().startsAt, bloqueo().endsAt, TZ), /todo el día/);
});

test("H-19 · el alcance se deriva de lo que esté en NULL, en un solo sitio", () => {
  assert.equal(eduBloqueoAlcance({ campusId: null, chairId: null }), "instituto");
  assert.equal(eduBloqueoAlcance({ campusId: "s1", chairId: null }), "sede");
  assert.equal(eduBloqueoAlcance({ campusId: "s1", chairId: "c1" }), "sillon");
});

test("🔴 H-19 · agendar Y reagendar consultan el bloqueo, y el 409 lleva el motivo", () => {
  const src = crudo("src/lib/edu/agenda.ts");
  // La función existe y rebota con 409 usando el mensaje del core.
  assert.match(src, /async function assertNoBloqueo\(/);
  assert.match(src, /throw new EduPadronError\(eduBlockMensaje\(impide\), 409\)/);
  // Y se llama desde las DOS escrituras. Sin la segunda, basta arrastrar
  // una cita al martes del puente para saltarse el bloqueo.
  const alta = src.slice(
    src.indexOf("export async function createEduAppointment"),
    src.indexOf("export async function updateEduAppointment"),
  );
  const mover = src.slice(
    src.indexOf("export async function updateEduAppointment"),
    src.indexOf("export async function setEduAppointmentStatus"),
  );
  assert.match(alta, /assertNoBloqueo\(/);
  assert.match(mover, /assertNoBloqueo\(/);
});

test("H-19 · un bloqueo NO cancela las citas que ya están (se dice en los tres sitios)", () => {
  assert.match(crudo("src/lib/edu/agenda-bloqueos-core.ts"), /NO CANCELA LAS CITAS/);
  assert.match(crudo("src/lib/edu/agenda-bloqueos.ts"), /NO CANCELA LAS CITAS/);
  assert.match(
    crudo("src/components/edu/agenda/bloqueos-panel.tsx"),
    /NO cancela las citas que ya están/i,
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · H-89 · EL REQUISITO POR COHORTE
// ═══════════════════════════════════════════════════════════════════════

const AHORA = new Date("2026-06-01T12:00:00Z");

function version(over: Partial<EduRequirementVersionLike> = {}): EduRequirementVersionLike {
  return {
    id: "v1",
    version: 1,
    cohortId: null,
    effectiveFrom: new Date("2026-03-01T00:00:00Z"),
    requiredCount: 12,
    semesterFrom: null,
    semesterTo: null,
    onlyCompleted: true,
    notes: null,
    ...over,
  };
}

test("🔴 H-89 · sin versiones NO cambia nada: se mide contra la fila viva", () => {
  const vivo = {
    requiredCount: 8,
    semesterFrom: null,
    semesterTo: null,
    onlyCompleted: true,
    notes: null,
  };
  const r = eduRequisitoEfectivo(vivo, [], "gen2024", AHORA);
  assert.equal(r.version, null);
  assert.equal(r.snapshot.requiredCount, 8);
});

test("🔴 H-89 · la generación con versión propia GANA sobre la regla general", () => {
  const vivo = {
    requiredCount: 8,
    semesterFrom: null,
    semesterTo: null,
    onlyCompleted: true,
    notes: null,
  };
  const versiones = [
    version({ id: "vg", version: 1, cohortId: null, requiredCount: 12 }),
    version({ id: "vc", version: 2, cohortId: "gen2024", requiredCount: 8 }),
  ];
  // La que se gradúa en junio se queda con 8.
  assert.equal(eduRequisitoEfectivo(vivo, versiones, "gen2024", AHORA).snapshot.requiredCount, 8);
  // La que entra ahora, con 12.
  assert.equal(eduRequisitoEfectivo(vivo, versiones, "gen2026", AHORA).snapshot.requiredCount, 12);
});

test("🔴 H-89 · una versión que TODAVÍA no rige no se aplica", () => {
  const futura = version({ effectiveFrom: new Date("2027-01-01T00:00:00Z"), requiredCount: 20 });
  assert.equal(eduRequisitoVersionVigente([futura], null, AHORA), null);
});

test("🔴 H-89 · dos versiones del MISMO día: gana la de número mayor, no el orden de Postgres", () => {
  const mismaFecha = new Date("2026-03-01T00:00:00Z");
  const a = version({ id: "a", version: 3, effectiveFrom: mismaFecha, requiredCount: 12 });
  const b = version({ id: "b", version: 4, effectiveFrom: mismaFecha, requiredCount: 10 });
  // El orden de entrada no puede decidir el avance de una generación.
  assert.equal(eduRequisitoVersionVigente([a, b], null, AHORA)?.id, "b");
  assert.equal(eduRequisitoVersionVigente([b, a], null, AHORA)?.id, "b");
});

test("🔴 H-89 · la evaluación mide a cada alumno con la versión de SU generación", () => {
  const src = crudo("src/lib/edu/evaluacion.ts");
  // La regla se importa, no se reescribe.
  assert.match(src, /eduRequisitoEfectivo/);
  assert.match(src, /function specEfectivo\(/);
  // Y se aplica con el cohortId del alumno en las DOS pantallas que miden
  // avance: la lista de Evaluación y la bitácora académica.
  assert.match(src, /specEfectivo\(toSpec\(r\), versionesPorRequisito\.get\(r\.id\), a\.cohortId, now\)/);
  assert.match(
    src,
    /specEfectivo\(toSpec\(r\), versionesPorRequisito\.get\(r\.id\), alumno\.cohortId, now\)/,
  );
});

test("H-89 · el requisito guarda AUTOR (la tercera cosa que el hallazgo echaba en falta)", () => {
  const src = crudo("src/lib/edu/evaluacion.ts");
  assert.match(src, /updatedByName: autorDe\(ctx\)/);
  assert.match(src, /data\.updatedByName = autorDe\(ctx\)/);
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · H-90 · LA CATEGORÍA CON LLAVE
// ═══════════════════════════════════════════════════════════════════════

function spec(over: Partial<EduRequirementSpec> = {}): EduRequirementSpec {
  return {
    id: "r1",
    name: "Endodoncias",
    programId: "prog",
    semesterFrom: null,
    semesterTo: null,
    procedureId: null,
    category: null,
    categoryId: null,
    requiredCount: 8,
    onlyCompleted: true,
    ...over,
  };
}

function caso(over: Partial<EduCountableCase> = {}): EduCountableCase {
  return {
    id: "c1",
    programId: "prog",
    status: "COMPLETED",
    procedureId: null,
    procedureCategory: null,
    procedureCategoryId: null,
    ...over,
  };
}

test("🔴 H-90 · con llave se compara POR LLAVE, y renombrar deja de mover el avance", () => {
  const req = spec({ categoryId: "cat_endo", category: null });
  // El caso apunta a la misma llave, aunque su TEXTO diga otra cosa (que es
  // exactamente lo que pasa el día que alguien renombra la categoría).
  assert.equal(
    eduCaseCountsFor(req, caso({ procedureCategoryId: "cat_endo", procedureCategory: "Endo y retratamiento" })),
    true,
  );
  // Y un caso de otra llave no cuenta, aunque el texto coincida.
  assert.equal(
    eduCaseCountsFor(req, caso({ procedureCategoryId: "cat_proto", procedureCategory: "Endodoncias" })),
    false,
  );
});

test("🔴 H-90 · con llave NO se cae al texto: un caso sin emparejar no cuenta", () => {
  const req = spec({ categoryId: "cat_endo" });
  // Si cayera al texto, el avance dependería de CUÁLES filas alguien ya
  // migró: dos alumnos con el mismo trabajo tendrían números distintos.
  assert.equal(
    eduCaseCountsFor(req, caso({ procedureCategoryId: null, procedureCategory: "Endodoncias" })),
    false,
  );
});

test("H-90 · sin llave sigue comparándose por texto, exactamente como antes de la ola", () => {
  const req = spec({ category: "Endodoncia" });
  assert.equal(eduCaseCountsFor(req, caso({ procedureCategory: "endodoncia" })), true);
  assert.equal(eduCaseCountsFor(req, caso({ procedureCategory: "Prótesis" })), false);
});

test("🔴 H-90 · la clave se deriva del nombre y NO se regenera al renombrar", () => {
  assert.equal(eduCategoriaKeyDesdeNombre("Endodoncia"), "endodoncia");
  assert.equal(eduCategoriaKeyDesdeNombre("Cirugía Bucal"), "cirugia-bucal");
  assert.equal(eduCategoriaKeyDesdeNombre("   "), "categoria");
  // Que NO se regenera lo fija el servidor: `updateEduCategoria` no escribe
  // `key` en ningún camino.
  const src = crudo("src/lib/edu/categorias.ts");
  const fn = src.slice(
    src.indexOf("export async function updateEduCategoria"),
    src.indexOf("export async function asignarEduCategoria"),
  );
  assert.ok(!/data\.key\s*=/.test(fn), "updateEduCategoria NO debe tocar la clave");
});

test("🔴 H-90 · el emparejado SUGIERE y lo que no encaja sale en la lista, no se migra", () => {
  const cats = [{ id: "c1", name: "Endodoncia", key: "endodoncia" }];
  const s = eduCategoriaSugerirEmparejado(["endodoncia ", "ENDODONCIA", "Cirugía bucal"], cats);
  assert.equal(s.find((x) => x.texto === "endodoncia ")?.categoryId, "c1");
  assert.equal(s.find((x) => x.texto === "ENDODONCIA")?.categoryId, "c1");
  // «Cirugía bucal» no se empareja con nada a la fuerza: es un juicio humano.
  assert.equal(s.find((x) => x.texto === "Cirugía bucal")?.categoryId, null);
});

test("H-90 · emparejar un requisito LIMPIA su texto libre (una fuente, no dos)", () => {
  const src = crudo("src/lib/edu/categorias.ts");
  assert.match(src, /data: \{ categoryId, category: categoryId \? null : req\.category \}/);
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · H-132 · EL ESCALÓN DE CACHÉ DE IA
// ═══════════════════════════════════════════════════════════════════════

function precio(over: Partial<EduIaPrecio> = {}): EduIaPrecio {
  return {
    feature: "ANALISIS",
    model: "claude-opus-5",
    unit: "TOKEN",
    inUsdMicrosPerMillion: 5_000_000,
    outUsdMicrosPerMillion: 25_000_000,
    cacheReadUsdMicrosPerMillion: null,
    cacheWriteUsdMicrosPerMillion: null,
    source: null,
    ...over,
  };
}

test("🔴 H-132 · sin escalón de caché el número es IDÉNTICO al de antes de la ola", () => {
  const p = precio();
  // 1M de entrada + 0 de salida = 5 USD = 5_000_000 micros.
  assert.equal(eduIaCosto(p, 1_000_000, 0), 5_000_000);
  // Partido en tres, sin escalón, da exactamente lo mismo.
  assert.equal(
    eduIaCostoDetallado(p, {
      inputUnits: 400_000,
      cacheReadUnits: 500_000,
      cacheWriteUnits: 100_000,
      outputUnits: 0,
    }),
    5_000_000,
  );
});

test("🔴 H-132 · con escalón, la caché leída deja de cobrarse a precio de token nuevo", () => {
  const p = precio({ cacheReadUsdMicrosPerMillion: 500_000 }); // una décima parte
  const conEscalon = eduIaCostoDetallado(p, {
    inputUnits: 100_000,
    cacheReadUnits: 900_000,
    outputUnits: 0,
  });
  // 100k × 5 USD/M + 900k × 0,5 USD/M = 0,5 + 0,45 = 0,95 USD.
  assert.equal(conEscalon, 950_000);
  // Sin el escalón se le cobraban 5 USD/M a los 900k: 5 USD en total.
  assert.equal(eduIaCosto(p, 1_000_000, 0), 5_000_000);
  assert.ok(conEscalon! < 5_000_000, "el escalón tiene que ABARATAR, no encarecer");
});

test("H-132 · sin tarifa devuelve null (no cero: una llamada gratis es otra cosa)", () => {
  assert.equal(eduIaCostoDetallado(null, { inputUnits: 10, outputUnits: 10 }), null);
});

test("🔴 H-132 · el análisis cobra los tres tipos de token por separado", () => {
  const src = crudo("src/lib/edu/ia.ts");
  assert.match(src, /const cacheReadTokens = num\(usage\.cache_read_input_tokens\)/);
  assert.match(src, /eduIaCostoDetallado\(permiso\.precio, \{/);
  assert.match(src, /cacheReadUnits: sinMedicion \? 0 : cacheReadTokens/);
});

test("el cambio de cupo de IA escribe su HISTORIAL y su renglón de bitácora", () => {
  const src = crudo("src/lib/edu/ia-cupo.ts");
  assert.match(src, /await eduAiQuotaChange\(/);
  assert.match(src, /entity: "aiQuota"/);
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · LA ROTACIÓN DOCENTE PROGRAMADA
// ═══════════════════════════════════════════════════════════════════════

test("🔴 la rotación programada exige fecha FUTURA y no cierra al titular de hoy", () => {
  const src = crudo("src/lib/edu/docente.ts");
  const fn = src.slice(
    src.indexOf("export async function programarEduRotacion"),
    src.indexOf("export async function cancelarEduRotacionProgramada"),
  );
  // Fecha futura obligatoria: una "programada" para ayer es otra cosa.
  assert.match(fn, /startsAt\.getTime\(\) <= now\.getTime\(\)/);
  // 🔴 Y NO cierra al titular: cerrarlo hoy dejaría al alumno sin docente
  // los días de en medio. Se comprueba que NO haya un updateMany que ponga
  // endsAt dentro de esta función.
  assert.ok(
    !/endsAt: now/.test(fn),
    "programar una rotación NO puede cerrar al titular de hoy",
  );
  // Nadie se programa a sí mismo (H-16, la tercera llave).
  assert.match(fn, /supervisor\.id === ctx\.eduUserId/);
});

test("🔴 cancelar una rotación programada NO borra la fila", () => {
  const src = crudo("src/lib/edu/docente.ts");
  const fn = src.slice(src.indexOf("export async function cancelarEduRotacionProgramada"));
  assert.ok(!/\.delete\(|deleteMany/.test(fn), "no se borra nada");
  assert.match(fn, /data: \{ endsAt: actual\.startsAt \}/);
  // Y solo lo que NO ha arrancado: lo vigente se cierra, no se cancela.
  assert.match(fn, /actual\.startsAt\.getTime\(\) <= now\.getTime\(\)/);
});

test("lo PROGRAMADO se define como lo que el predicado de vigencia descarta por la izquierda", () => {
  const src = crudo("src/lib/edu/docente.ts");
  assert.match(src, /startsAt: \{ gt: now \}/);
});

// ═══════════════════════════════════════════════════════════════════════
// 6 · H-150 · LOS DATOS DEL INSTITUTO
// ═══════════════════════════════════════════════════════════════════════

test("🔴 H-150 · campo ausente no se escribe; campo vacío SÍ borra", () => {
  const p = eduInstitucionParsePatch({ phone: "664 123" });
  assert.deepEqual(Object.keys(p), ["phone"]);
  assert.equal(eduInstitucionParsePatch({ rfc: "" }).rfc, null);
});

test("🔴 H-150 · una zona horaria inventada se RECHAZA (no se guarda como UTC)", () => {
  assert.throws(() => eduInstitucionParsePatch({ timezone: "America/Tijuna" }), /no es una zona/);
  assert.equal(eduInstitucionParsePatch({ timezone: "America/Tijuana" }).timezone, "America/Tijuana");
});

test("H-150 · ni el nombre ni la zona se pueden vaciar (los dos son NOT NULL)", () => {
  assert.throws(() => eduInstitucionParsePatch({ name: "" }));
  assert.throws(() => eduInstitucionParsePatch({ timezone: "" }));
});

test("H-150 · la pantalla existe, exige permiso y NO acepta un id de instituto", () => {
  const page = crudo("src/app/instituto/(panel)/direccion/instituto/page.tsx");
  assert.match(page, /hasEduPermission\(permUser, "inicio\.view"\)/);
  assert.match(page, /hasEduPermission\(permUser, "sedes\.manage"\)/);
  // El instituto sale de la SESIÓN: la función no recibe ningún id.
  assert.match(page, /getEduInstitucion\(ctx\)/);
});

// ═══════════════════════════════════════════════════════════════════════
// 7 · H-93 y H-95 · RÚBRICAS
// ═══════════════════════════════════════════════════════════════════════

test("🔴 H-93 · un criterio que sobra se DESACTIVA, no se borra", () => {
  const src = crudo("src/lib/edu/rubricas.ts");
  const fn = src.slice(
    src.indexOf("export async function updateEduRubric"),
    src.indexOf("// 2 · LAS CALIFICACIONES"),
  );
  assert.ok(
    !/eduRubricCriterion\.deleteMany/.test(fn),
    "los criterios ya no se borran: se desactivan (H-93)",
  );
  assert.match(fn, /data: \{ isActive: false \}/);
  // Y volver a añadirlo lo revive con su MISMO id, así que el historial de
  // calificaciones vuelve a enlazar solo.
  assert.match(fn, /isActive: true,/);
});

test("H-93 · calificar solo ofrece los criterios ACTIVOS", () => {
  const src = crudo("src/lib/edu/rubricas.ts");
  const fn = src.slice(src.indexOf("export async function createEduGrade"));
  assert.match(fn, /where: \{ isActive: true \}/);
});

test("🔴 H-95 · el código respeta los índices únicos PARCIALES del SQL de la ola", () => {
  const src = crudo("src/lib/edu/rubricas.ts");
  // Los dos nombres del sql/edu-ola-c.sql §12.9, traducidos al mismo
  // mensaje que ya da la comprobación en transacción.
  assert.match(src, /una_correccion/);
  assert.match(src, /una_raiz/);
  assert.match(src, /e\?\.code !== "P2002"/);
  // Y el .sql los declara, para que el nombre no se separe del código.
  const sql = crudo("sql/edu-ola-c.sql");
  assert.match(sql, /edu_case_grades_una_raiz_idx/);
  assert.match(sql, /edu_case_grades_una_correccion_idx/);
});

// ═══════════════════════════════════════════════════════════════════════
// 8 · LA BITÁCORA
// ═══════════════════════════════════════════════════════════════════════

test("🔴 las escrituras de esta ola llaman al ESCRITOR ÚNICO de la bitácora", () => {
  for (const [ruta, entidad] of [
    ["src/lib/edu/agenda.ts", 'entity: "appointment"'],
    ["src/lib/edu/rubricas.ts", 'entity: "case"'],
    ["src/lib/edu/evaluacion.ts", 'entity: "student"'],
    ["src/lib/edu/docente.ts", 'entity: "student"'],
    ["src/lib/edu/ia-cupo.ts", 'entity: "aiQuota"'],
  ] as const) {
    const src = crudo(ruta);
    assert.match(src, /eduAudit\(/, `${ruta} no llama a eduAudit`);
    assert.ok(src.includes(entidad), `${ruta} no registra ${entidad}`);
  }
});

test("las tres escrituras de la agenda registran, y con el paciente para poder buscarlas", () => {
  const src = crudo("src/lib/edu/agenda.ts");
  const veces = src.match(/entity: "appointment"/g) ?? [];
  assert.equal(veces.length, 3, "alta, reagendar y cambio de estado");
  assert.match(src, /patientId: partes\.patientId/);
  assert.match(src, /patientId: current\.patientId/);
});

// ═══════════════════════════════════════════════════════════════════════
// 9 · LAS LISTAS NUEVAS RESPETAN LAS 10 REGLAS RESPONSIVE
// ═══════════════════════════════════════════════════════════════════════

test("🔴 las cinco listas nuevas van en `.edu-tablewrap` y tienen su umbral en un @container", () => {
  const css = crudo("src/app/instituto/edu-theme.css");
  for (const clase of [
    "edu-table--bloqueos",
    "edu-table--reqversiones",
    "edu-table--categorias",
    "edu-table--rotaciones",
    "edu-table--iacupo",
  ]) {
    assert.ok(css.includes(`.${clase}`), `falta el bloque de .${clase}`);
    // Cada una declara sus pistas y aparece dentro de una consulta de
    // CONTENEDOR (regla 2: nunca @media para el contenido).
    assert.match(
      css,
      new RegExp(`@container edu-tabla \\(min-width: \\d+px\\) \\{[\\s\\S]*?\\.${clase}`),
      `.${clase} no está dentro de un @container edu-tabla`,
    );
  }
  // Y ningún umbral nuevo se coló como @media.
  assert.ok(
    !/@media[^{]*\{\s*\.edu-table--(bloqueos|reqversiones|categorias|rotaciones|iacupo)/.test(css),
  );
});

test("cada pantalla nueva envuelve su lista en .edu-tablewrap", () => {
  for (const ruta of [
    "src/components/edu/agenda/bloqueos-panel.tsx",
    "src/components/edu/evaluacion/categorias-screen.tsx",
    "src/components/edu/ia/ia-screen.tsx",
    "src/app/instituto/(panel)/docentes/rotacion-programada.tsx",
    "src/components/edu/evaluacion/requisitos-screen.tsx",
  ]) {
    assert.match(crudo(ruta), /edu-tablewrap/, `${ruta} sin envoltorio`);
  }
});
