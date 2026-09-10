/**
 * EL RASTRO — WS2-T4 · Ola B del instituto.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-rastro.test.ts
 *       (y entra sola en `npm run test:edu`, que descubre la carpeta)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ VIGILA ESTE ARCHIVO, Y POR QUÉ NO BASTABA CON LEER EL CÓDIGO
 *
 * El odontograma era la ÚNICA pantalla del vertical que BORRABA de verdad
 * (H-17): quitar un hallazgo era un `deleteMany`, la fila desaparecía y el
 * expediente se quedaba sin poder contestar que existió. Esta ola lo
 * cambia por una baja lógica, y ahí aparece la trampa que da nombre al
 * archivo:
 *
 *   🔴 el índice único `edu_odontogram_hallazgo_key` es de CINCO columnas
 *      y NO es parcial. Hacerlo parcial (`WHERE "deletedAt" IS NULL`)
 *      exigía un DROP INDEX, y en esta ola no se borra nada. Consecuencia:
 *      una fila dada de baja SIGUE OCUPANDO su clave, así que remarcar ese
 *      hallazgo tiene que REVIVIR esa misma fila. Insertar una segunda
 *      choca contra el índice y la escritura falla en la cara de quien
 *      está marcando una boca.
 *
 * La sección 1 REPRODUCE ese ciclo —marcar, quitar, volver a marcar—
 * sobre una tabla en memoria que aplica el índice único igual que
 * Postgres, y con los MISMOS payloads que manda el servidor (los tres
 * viven en `odontograma-core.ts` justamente para poder hacer esto sin
 * base de datos). Una prueba que solo leyera el fuente no habría podido
 * decir si el ciclo deja una fila o dos.
 *
 * Las demás secciones sí leen el fuente, porque lo que vigilan es que un
 * recorte esté EN EL `where` de la consulta —y eso no se puede comprobar
 * de otra forma sin Postgres—, o que dos sitios usen la misma regla.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDU_ODONTOGRAM_NOTE_KEY,
  EDU_TOOTH_WHOLE,
  eduEntriesToRecords,
  eduOdontogramBajaData,
  eduOdontogramCreateData,
  eduOdontogramDefaultDentition,
  eduOdontogramLiveEntries,
  eduOdontogramReviveData,
  eduOdontogramSummary,
  type EduOdontogramEntryRow,
} from "../odontograma-core";
import {
  EDU_RECORD_WITHDRAW_DENIED,
  EDU_RECORD_WITHDRAWN_APPROVAL_NOTE,
  eduRecordCanWithdraw,
  eduRecordHasContent,
} from "../expediente-core";
import { EDU_RECORD_STATUSES } from "../types";
import {
  eduApprovalEffectiveStatus,
  eduCaseGateVerdict,
} from "../autorizaciones-core";

const RAIZ = join(__dirname, "..", "..", "..", "..");

function crudo(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8");
}

/** El archivo SIN comentarios: se juzga por lo que hace, no por lo que dice. */
function fuente(...tramos: string[]): string {
  return crudo(...tramos)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

/** El cuerpo de UNA función exportada, para no acusar al archivo entero. */
function cuerpoDe(src: string, nombre: string): string {
  const desde = src.indexOf(`export async function ${nombre}`);
  assert.notEqual(desde, -1, `no se encontró ${nombre}: ¿la renombraron?`);
  const siguiente = src.indexOf("\nexport ", desde + 1);
  return src.slice(desde, siguiente === -1 ? undefined : siguiente);
}

const ODONTOGRAMA = "src/lib/edu/odontograma.ts";
const ODONTOGRAMA_CORE = "src/lib/edu/odontograma-core.ts";
const EXPEDIENTE = "src/lib/edu/expediente.ts";
const PANTALLA_ODO = "src/components/edu/expediente/odontograma-screen.tsx";
const PANTALLA_EXP = "src/components/edu/expediente/expediente-screen.tsx";
const PAGINA_ODO = "src/app/instituto/(panel)/pacientes/[id]/odontograma/page.tsx";
const RUTA_NOTA = "src/app/api/instituto/expediente/[id]/route.ts";

/* ═══════════════════════════════════════════════════════════════════════
 * 1 · EJECUTADA · MARCAR → QUITAR → MARCAR = UNA SOLA FILA VIVA
 *
 * La tabla de mentira aplica el índice único de CINCO columnas igual que
 * Postgres: dos filas con la misma clave no pueden coexistir, y el
 * `upsert` cae en `update` cuando la clave ya existe — esté esa fila viva
 * o dada de baja, porque el índice no mira `deletedAt`.
 * ═══════════════════════════════════════════════════════════════════════ */

interface FilaFalsa {
  institutionId: string;
  patientId: string;
  tooth: number;
  surface: string;
  condition: string;
  notes?: string | null;
  recordedById: string;
  recordedAt: Date;
  firstRecordedAt: Date | null;
  deletedAt: Date | null;
  deletedById: string | null;
}

type Llave = Pick<
  FilaFalsa,
  "institutionId" | "patientId" | "tooth" | "surface" | "condition"
>;

/** Postgres con el índice `edu_odontogram_hallazgo_key`, en 30 líneas. */
class TablaFalsa {
  filas: FilaFalsa[] = [];

  private buscar(k: Llave): FilaFalsa | undefined {
    return this.filas.find(
      (f) =>
        f.institutionId === k.institutionId &&
        f.patientId === k.patientId &&
        f.tooth === k.tooth &&
        f.surface === k.surface &&
        f.condition === k.condition,
    );
  }

  /** El upsert del servidor, con SUS payloads. */
  upsert(k: Llave, create: Record<string, unknown>, update: Record<string, unknown>): void {
    const fila = this.buscar(k);
    if (fila) {
      // Un `create` aquí violaría el índice único: es exactamente el fallo
      // que esta prueba existe para impedir.
      Object.assign(fila, update);
      return;
    }
    this.filas.push({ ...k, ...create } as FilaFalsa);
  }

  /** `updateMany` con `deletedAt: null` en el where: solo toca lo vivo. */
  bajaSiVive(k: Llave, data: Record<string, unknown>): number {
    const fila = this.buscar(k);
    if (!fila || fila.deletedAt !== null) return 0;
    Object.assign(fila, data);
    return 1;
  }

  vivas(): FilaFalsa[] {
    return this.filas.filter((f) => f.deletedAt === null);
  }
}

const LLAVE: Llave = {
  institutionId: "inst_1",
  patientId: "pac_1",
  tooth: 16,
  surface: "O",
  condition: "caries",
};

const ALUMNO = "u_alumno";
const DOCENTE = "u_docente";
const T0 = new Date("2026-03-01T15:00:00.000Z");
const T1 = new Date("2026-05-10T17:30:00.000Z");
const T2 = new Date("2026-09-07T11:00:00.000Z");

test("🔴 marcar → quitar → marcar deja UNA sola fila, y sigue siendo la misma", () => {
  const tabla = new TablaFalsa();

  // 1 · el alumno marca la caries
  tabla.upsert(
    LLAVE,
    eduOdontogramCreateData({ userId: ALUMNO, at: T0 }),
    eduOdontogramReviveData({ userId: ALUMNO, at: T0 }),
  );
  assert.equal(tabla.filas.length, 1);
  assert.equal(tabla.vivas().length, 1);

  // 2 · alguien la quita: BAJA LÓGICA, la fila no desaparece
  const bajas = tabla.bajaSiVive(LLAVE, eduOdontogramBajaData({ userId: DOCENTE, at: T1 }));
  assert.equal(bajas, 1);
  assert.equal(tabla.filas.length, 1, "quitar BORRÓ la fila: el rastro se perdió (H-17)");
  assert.equal(tabla.vivas().length, 0, "la fila retirada sigue contando como viva");
  assert.equal(tabla.filas[0].deletedById, DOCENTE, "la baja tiene que decir QUIÉN");
  assert.deepEqual(tabla.filas[0].deletedAt, T1);

  // 3 · se vuelve a marcar: REVIVE la misma fila, no nace una segunda
  tabla.upsert(
    LLAVE,
    eduOdontogramCreateData({ userId: DOCENTE, at: T2 }),
    eduOdontogramReviveData({ userId: DOCENTE, at: T2 }),
  );
  assert.equal(
    tabla.filas.length,
    1,
    "se insertó una SEGUNDA fila con la misma clave: contra Postgres esto es un P2002, " +
      "porque el índice único de cinco columnas no es parcial y la fila dada de baja " +
      "sigue ocupando su clave",
  );
  assert.equal(tabla.vivas().length, 1, "revivir dejó la fila dada de baja");
  assert.equal(tabla.filas[0].deletedAt, null, "revivir no limpió deletedAt");
  // 🔴 N-3 · Y `deletedById` SOBREVIVE, a propósito. Ver la prueba de abajo.
  assert.equal(
    tabla.filas[0].deletedById,
    DOCENTE,
    "revivir borró a quien había pasado la goma: es la pregunta que H-17 existe para contestar",
  );
});

test("🔴 N-3 · revivir CONSERVA a quien lo había quitado (y no la fecha, que no cabe)", () => {
  // El escenario del hallazgo, entero: ortodoncia marca, endodoncia quita,
  // ortodoncia vuelve a marcar. Antes de N-3 el `update` del upsert escribía
  // `deletedById: null` "por simetría" con `deletedAt`, y en la base quedaba
  // un hallazgo vivo firmado por ortodoncia y NINGUNA huella de que
  // endodoncia lo había borrado — o sea, exactamente la pregunta que H-17
  // vino a contestar, sin respuesta en cuanto alguien restaura el hallazgo,
  // que es la reacción natural.
  const tabla = new TablaFalsa();
  tabla.upsert(
    LLAVE,
    eduOdontogramCreateData({ userId: ALUMNO, at: T0 }),
    eduOdontogramReviveData({ userId: ALUMNO, at: T0 }),
  );
  tabla.bajaSiVive(LLAVE, eduOdontogramBajaData({ userId: DOCENTE, at: T1 }));
  tabla.upsert(
    LLAVE,
    eduOdontogramCreateData({ userId: ALUMNO, at: T2 }),
    eduOdontogramReviveData({ userId: ALUMNO, at: T2 }),
  );

  const fila = tabla.filas[0];
  assert.equal(fila.deletedAt, null, "la fila tiene que quedar VIVA: es lo que se acaba de marcar");
  assert.equal(fila.deletedById, DOCENTE, "se perdió quién pasó la goma");
  assert.equal(fila.recordedById, ALUMNO, "remarcar tiene que refrescar el autor del hallazgo");

  // Y LO QUE NO CABE, fijado también: la FECHA de esa baja se pierde, porque
  // `deletedAt` es justo la columna que hay que soltar para que la fila
  // vuelva a estar viva, y no queda dónde guardarla. Se comprueba por la
  // FORMA del payload: si algún día crece o mengua, hay que volver a mirar
  // los dos rótulos de la pantalla que dicen hasta dónde llega el rastro.
  assert.deepEqual(
    Object.keys(eduOdontogramReviveData({ userId: ALUMNO, at: T2 })).sort(),
    ["deletedAt", "recordedAt", "recordedById"],
    "el payload de revivir cambió de forma: revisa los rótulos de odontograma-screen.tsx",
  );
});

test("N-3 · una fila NUEVA nace sin rastro de baja (nadie la ha quitado nunca)", () => {
  // El otro lado de la moneda: conservar `deletedById` al revivir no puede
  // significar que una fila recién creada lo herede de nada.
  const crear = eduOdontogramCreateData({ userId: ALUMNO, at: T0 });
  assert.equal(crear.deletedAt, null);
  assert.equal(crear.deletedById, null, "una fila nueva no se ha quitado nunca");

  // Y el payload de revivir NO menciona la columna: no la pisa ni con null.
  const revivir = eduOdontogramReviveData({ userId: ALUMNO, at: T2 });
  assert.equal(
    Object.prototype.hasOwnProperty.call(revivir, "deletedById"),
    false,
    "el update del upsert vuelve a tocar `deletedById`: eso borra el rastro (N-3)",
  );
  assert.equal(revivir.deletedAt, null, "revivir SÍ tiene que soltar `deletedAt`");
});

test("🔴 `firstRecordedAt` sobrevive al ciclo: es la única respuesta a «¿desde cuándo?»", () => {
  const tabla = new TablaFalsa();

  tabla.upsert(
    LLAVE,
    eduOdontogramCreateData({ userId: ALUMNO, at: T0 }),
    eduOdontogramReviveData({ userId: ALUMNO, at: T0 }),
  );
  tabla.bajaSiVive(LLAVE, eduOdontogramBajaData({ userId: DOCENTE, at: T1 }));
  tabla.upsert(
    LLAVE,
    eduOdontogramCreateData({ userId: DOCENTE, at: T2 }),
    eduOdontogramReviveData({ userId: DOCENTE, at: T2 }),
  );

  const fila = tabla.filas[0];
  assert.deepEqual(
    fila.firstRecordedAt,
    T0,
    "`firstRecordedAt` se pisó al remarcar. Es lo ÚNICO que contesta «¿desde cuándo está " +
      "marcado este diente?»: `recordedAt` se reescribe a propósito en cada remarcado, para " +
      "que el expediente diga quién lo reconfirmó.",
  );
  assert.deepEqual(fila.recordedAt, T2, "remarcar tiene que refrescar la marca de tiempo");
  assert.equal(fila.recordedById, DOCENTE, "remarcar tiene que refrescar el autor");
});

test("el payload de REVIVIR no menciona `firstRecordedAt` (y el de crear, sí)", () => {
  // El candado de la prueba de arriba, en su forma más corta: si algún día
  // alguien añade la columna al update "por simetría", esto se pone rojo
  // antes de que nadie tenga que reproducir el ciclo entero.
  const revivir = eduOdontogramReviveData({ userId: ALUMNO, at: T0 });
  assert.equal(
    Object.prototype.hasOwnProperty.call(revivir, "firstRecordedAt"),
    false,
    "revivir volvió a escribir firstRecordedAt: quitar y volver a marcar borraría la fecha " +
      "del primer marcaje clínico",
  );
  const crear = eduOdontogramCreateData({ userId: ALUMNO, at: T0 });
  assert.deepEqual(crear.firstRecordedAt, T0, "una fila nueva tiene que sellar su primera vez");
  assert.equal(crear.deletedAt, null);
});

test("quitar dos veces no reescribe la firma de quien lo quitó de verdad", () => {
  const tabla = new TablaFalsa();
  tabla.upsert(
    LLAVE,
    eduOdontogramCreateData({ userId: ALUMNO, at: T0 }),
    eduOdontogramReviveData({ userId: ALUMNO, at: T0 }),
  );
  assert.equal(tabla.bajaSiVive(LLAVE, eduOdontogramBajaData({ userId: DOCENTE, at: T1 })), 1);
  // El segundo clic (o una pestaña vieja) no encuentra nada vivo.
  assert.equal(tabla.bajaSiVive(LLAVE, eduOdontogramBajaData({ userId: ALUMNO, at: T2 })), 0);
  assert.equal(tabla.filas[0].deletedById, DOCENTE);
  assert.deepEqual(tabla.filas[0].deletedAt, T1);
});

/* ═══════════════════════════════════════════════════════════════════════
 * 2 · LO RETIRADO NO SE DIBUJA NI SE CUENTA
 * ═══════════════════════════════════════════════════════════════════════ */

function fila(
  id: string,
  tooth: number,
  surface: string,
  condition: string,
  baja: string | null,
  notes: string | null = null,
): EduOdontogramEntryRow {
  return {
    id,
    tooth,
    surface,
    condition,
    notes,
    recordedById: ALUMNO,
    recordedByName: "Alumno",
    recordedAt: "2026-03-01T15:00:00.000Z",
    recordedLabel: "dom 1 mar 09:00",
    deletedAt: baja,
    deletedById: baja ? DOCENTE : null,
    deletedByName: baja ? "Docente" : null,
    deletedLabel: baja ? "dom 10 may 11:30" : null,
    firstRecordedAt: "2026-03-01T15:00:00.000Z",
    firstRecordedLabel: "dom 1 mar 09:00",
  };
}

test("un hallazgo RETIRADO no se pinta en el dibujo", () => {
  const filas = [
    fila("a", 16, "O", "caries", null),
    fila("b", 16, "M", "caries", "2026-05-10T17:30:00.000Z"),
  ];
  const records = eduEntriesToRecords(filas);
  assert.deepEqual(records[16].surfaces.O, ["caries"]);
  assert.equal(
    records[16].surfaces.M,
    undefined,
    "el dibujo repintó un hallazgo que alguien quitó",
  );
});

test("`eduOdontogramLiveEntries` deja pasar SOLO lo vivo", () => {
  const filas = [
    fila("a", 16, "O", "caries", null),
    fila("b", 16, "M", "caries", "2026-05-10T17:30:00.000Z"),
    fila("c", 11, EDU_TOOTH_WHOLE, EDU_ODONTOGRAM_NOTE_KEY, null, "cuidado"),
  ];
  assert.deepEqual(
    eduOdontogramLiveEntries(filas).map((e) => e.id),
    ["a", "c"],
  );
});

test("el contador no cuenta lo retirado", () => {
  const filas = [
    fila("a", 16, "O", "caries", null),
    fila("b", 16, "M", "caries", "2026-05-10T17:30:00.000Z"),
    fila("c", 25, "", "crown", "2026-05-10T17:30:00.000Z"),
  ];
  const r = eduOdontogramSummary(filas);
  assert.deepEqual(
    r,
    { teeth: 1, findings: 1, notes: 0 },
    "el resumen sumó hallazgos que ya no están en esa boca",
  );
});

/* ═══════════════════════════════════════════════════════════════════════
 * 3 · EL SERVIDOR: el recorte va EN EL `where`, no en un `.filter()`
 *
 * Un recorte que vive fuera de la consulta es un recorte que el siguiente
 * `findMany` se olvida de copiar. Aquí olvidarlo significa dibujar en la
 * boca de alguien un hallazgo que se quitó, así que se comprueba en el
 * fuente: es lo único que se puede comprobar sin Postgres.
 * ═══════════════════════════════════════════════════════════════════════ */

test("🔴 el odontograma ya no BORRA en ninguna de sus tres escrituras", () => {
  const src = fuente(ODONTOGRAMA);
  assert.equal(
    (src.match(/\.deleteMany\(/g) ?? []).length,
    0,
    "volvió un deleteMany al odontograma: era la ÚNICA pantalla del vertical que borraba " +
      "de verdad (H-17), y con eso el alumno de endodoncia puede pasar la goma sobre lo que " +
      "marcó el de ortodoncia sin dejar rastro",
  );
  assert.equal((src.match(/\.delete\(/g) ?? []).length, 0);
});

test("las tres escrituras del odontograma llevan la firma de quien las hizo", () => {
  const src = fuente(ODONTOGRAMA);
  for (const fn of ["setEduOdontogramFinding", "clearEduOdontogramTooth", "setEduOdontogramNote"]) {
    const cuerpo = cuerpoDe(src, fn);
    assert.match(
      cuerpo,
      /eduOdontogramBajaData\(/,
      `${fn} da de baja sin pasar por el payload con autor`,
    );
    assert.match(
      cuerpo,
      /deletedAt: null/,
      `${fn} da de baja sin exigir que la fila estuviera viva: quitar dos veces reescribiría ` +
        "la firma de quien la quitó de verdad",
    );
  }
});

test("🔴 el dibujo se lee con `deletedAt: null` EN LA CONSULTA", () => {
  const cuerpo = cuerpoDe(fuente(ODONTOGRAMA), "listEduOdontogram");
  assert.match(
    cuerpo,
    /where: \{ institutionId, patientId: paciente\.id, deletedAt: null \}/,
    "la lectura del odontograma dejó de filtrar las bajas en el `where`",
  );
});

test("el historial SÍ trae las bajas, y avisa cuando corta (S-12)", () => {
  const src = fuente(ODONTOGRAMA);
  const cuerpo = cuerpoDe(src, "listEduOdontogramHistory");
  // Sin `deletedAt: null`: es la consulta que tiene que ver las dos caras.
  assert.equal(
    /deletedAt: null/.test(cuerpo),
    false,
    "el historial filtró las bajas: entonces no puede contestar quién quitó qué",
  );
  assert.match(cuerpo, /EDU_ODONTOGRAM_MAX_ROWS \+ 1/, "no se pide una de más para saber si cortó");
  assert.match(cuerpo, /truncated: rows\.length > EDU_ODONTOGRAM_MAX_ROWS/);
  // Y las VIVAS van primero, para que el techo nunca se lleve un hallazgo
  // que hay que dibujar.
  assert.match(
    cuerpo,
    /\{ deletedAt: \{ sort: "asc", nulls: "first" \} \}/,
    "si las retiradas pudieran ordenarse antes que las vivas, el techo dejaría el dibujo " +
      "incompleto sin que nadie lo vea",
  );
});

test("la pantalla enseña las bajas y ya no corta a 40 en silencio (S-12)", () => {
  const src = fuente(PANTALLA_ODO);
  assert.match(src, /Retirado \{e\.deletedLabel\}/, "el historial no dice qué se retiró");
  assert.match(src, /por \$\{e\.deletedByName\}/, "el historial no dice QUIÉN lo retiró");
  assert.match(
    src,
    /Ver los \{ocultas\} movimientos restantes/,
    "el historial volvió a cortar sin ofrecer el resto",
  );
  assert.match(src, /historialTruncado/, "la pantalla no recibe el aviso de que el servidor cortó");
  // El dibujo recibe lo VIVO y el historial lo TODO: dos props distintas.
  const pagina = fuente(PAGINA_ODO);
  assert.match(pagina, /entries=\{eduOdontogramLiveEntries\(historial\.rows\)\}/);
  assert.match(pagina, /historial=\{historial\.rows\}/);
});

/* ═══════════════════════════════════════════════════════════════════════
 * 4 · LA DENTICIÓN: la decide `isChild`, y se puede cambiar
 * ═══════════════════════════════════════════════════════════════════════ */

test("un paciente con dentición temporal abre en los cuadrantes 5-8", () => {
  assert.equal(eduOdontogramDefaultDentition(true), "primary");
  assert.equal(eduOdontogramDefaultDentition(false), "permanent");
});

test("`isChild` sale de la BASE por la puerta del expediente, no del cliente", () => {
  const cuerpo = cuerpoDe(fuente(EXPEDIENTE), "getEduClinicalPatient");
  assert.match(cuerpo, /isChild: true/, "la puerta del expediente dejó de traer isChild");
  const pagina = fuente(PAGINA_ODO);
  assert.match(
    pagina,
    /eduOdontogramDefaultDentition\(paciente\.isChild\)/,
    "la dentición inicial dejó de salir del paciente",
  );
});

test("la dentición sigue siendo un punto de partida, no un candado", () => {
  const src = fuente(PANTALLA_ODO);
  assert.match(
    src,
    /useState<Dentition>\(denticionInicial\)/,
    "un `useEffect` que 'corrija' la dentición pisaría el cambio manual en cada render",
  );
  assert.match(src, /onChange=\{\(e\) => setDentition\(/, "el selector dejó de poder cambiarse");
  assert.match(src, /esInfantil && \(/, "no se dice por qué abrió en temporal");
});

/* ═══════════════════════════════════════════════════════════════════════
 * 5 · EL EXPEDIENTE: retirar SOLO un borrador
 * ═══════════════════════════════════════════════════════════════════════ */

test("🔴 solo un BORRADOR se retira — y los otros dos estados, nunca", () => {
  assert.equal(eduRecordCanWithdraw("BORRADOR"), true);
  assert.equal(
    eduRecordCanWithdraw("ENVIADA"),
    false,
    "una ENVIADA está en la bandeja de un docente que puede haberla leído: se devuelve primero",
  );
  assert.equal(
    eduRecordCanWithdraw("FIRMADA"),
    false,
    "una FIRMADA no se retira NUNCA. Es la NOM-004: se corrige con una nota nueva que la " +
      "referencia, y en el expediente se leen las dos",
  );
  // Y si mañana nace un cuarto estado, nace SIN permiso de retirarse.
  for (const st of EDU_RECORD_STATUSES) {
    if (st === "BORRADOR") continue;
    assert.equal(eduRecordCanWithdraw(st), false, `${st} no debería poder retirarse`);
  }
});

test("la pantalla y el servidor usan LA MISMA regla para ofrecer «Retirar»", () => {
  // Dos copias de esta regla es como se llega a un botón que la pantalla
  // ofrece y el endpoint rechaza.
  assert.match(fuente(PANTALLA_EXP), /eduRecordCanWithdraw\(n\.status\)/);
  assert.match(cuerpoDe(fuente(EXPEDIENTE), "withdrawEduRecord"), /eduRecordCanWithdraw\(actual\.status\)/);
});

test("retirar es una BAJA LÓGICA con autor, no un borrado", () => {
  const cuerpo = cuerpoDe(fuente(EXPEDIENTE), "withdrawEduRecord");
  assert.equal(
    /delete(Many)?\(/.test(cuerpo),
    false,
    "retirar volvió a BORRAR la fila: un expediente del que se puede hacer desaparecer una " +
      "página deja de ser el registro de lo que pasó",
  );
  assert.match(cuerpo, /deletedAt: now, deletedById: ctx\.eduUserId/, "la baja no lleva firma");
  assert.match(
    cuerpo,
    /where: \{ id: actual\.id, institutionId, deletedAt: null \}/,
    "retirar dos veces reescribiría la firma de quien la retiró de verdad",
  );
  // Y la PERTENENCIA se comprueba con el alcance clínico, como todo el
  // módulo: una nota que no te toca contesta 404, igual que una que no existe.
  assert.match(cuerpo, /eduCaseScopeWhere\(\{ institutionId, scope, now \}\)/);
});

test("el endpoint de retirar pide `expediente.write` y no inventa un permiso", () => {
  const ruta = fuente(RUTA_NOTA);
  assert.match(ruta, /export async function DELETE/);
  assert.match(ruta, /withdrawEduRecord\(g\.ctx, params\.id\)/);
  const i = ruta.indexOf("export async function DELETE");
  assert.match(ruta.slice(i), /eduApiGuard\("expediente\.write"\)/);
});

test("el motivo del rechazo se le explica a una persona, no a un log", () => {
  for (const palabra of ["BORRADOR", "ENVIADA", "FIRMADA", "NOM-004"]) {
    assert.ok(
      EDU_RECORD_WITHDRAW_DENIED.includes(palabra),
      `el mensaje de rechazo no menciona ${palabra}`,
    );
  }
});

/* ═══════════════════════════════════════════════════════════════════════
 * 6 · UNA NOTA RETIRADA DEJA DE EXISTIR PARA TODO EL PANEL
 *
 * No basta con esconderla en su propia pantalla: mientras el Resumen la
 * cuente como nota o el desplegable de autorizaciones la ofrezca, retirar
 * no ha retirado nada.
 * ═══════════════════════════════════════════════════════════════════════ */

test("🔴 las cuatro lecturas del expediente filtran `deletedAt: null`", () => {
  const src = fuente(EXPEDIENTE);
  for (const fn of ["listEduPatientRecords", "updateEduRecord", "withdrawEduRecord"]) {
    assert.match(cuerpoDe(src, fn), /deletedAt: null/, `${fn} sigue trayendo notas retiradas`);
  }
  // Y la nota a la que se CORRIGE tampoco puede estar retirada.
  assert.match(cuerpoDe(src, "createEduRecord"), /deletedAt: null/);
});

test("una nota retirada no cuenta como nota en el Resumen del paciente", () => {
  const src = fuente("src/lib/edu/resumen.ts");
  assert.match(
    src,
    /where: \{ institutionId, patientId: id, deletedAt: null, case: casosWhere \}/,
    "la historia reciente del paciente seguiría pintando el borrador que alguien retiró",
  );
});

test("una nota retirada no se puede mandar a autorizar", () => {
  const src = fuente("src/lib/edu/autorizaciones.ts");
  assert.match(
    src,
    /where: \{ id: targetId, institutionId, caseId: caso\.id, deletedAt: null \}/,
    "se podría pedir la firma de un docente sobre una nota que ya no está en el expediente",
  );
  assert.match(
    src,
    /where: \{ institutionId, caseId: caso\.id, deletedAt: null \}/,
    "el desplegable ofrecería una opción que el POST después rechaza",
  );
});

/* ═══════════════════════════════════════════════════════════════════════
 * 7 · WS2-T4 (afinado) · LO QUE LA AUDITORÍA DE LA OLA A+B DEJÓ ABIERTO
 *
 * Cinco hallazgos, y el primero era el que bloqueaba el push: retirar un
 * BORRADOR dejaba viva su autorización PENDING, así que el docente firmaba
 * con su cédula una nota que ya no está en el expediente y la puerta del
 * caso la daba por cumplida.
 * ═══════════════════════════════════════════════════════════════════════ */

const AUTORIZACIONES = "src/lib/edu/autorizaciones.ts";
const PANEL_DIENTE = "src/components/edu/odontograma/DetailPanel.tsx";

test("🔴 N-1 · la bandeja no puede resolver una nota RETIRADA", () => {
  const src = fuente(AUTORIZACIONES);
  assert.match(
    src,
    /where: \{ institutionId, id: \{ in: Array\.from\(recordIds\) \}, deletedAt: null \}/,
    "`loadTargets` vuelve a traer notas retiradas: la bandeja las pinta con su resumen, " +
      "`loadTargetHashes` les calcula hash y la puerta del caso las da por firmadas",
  );
});

test("🔴 N-1 · retirar la nota CIERRA sus peticiones PENDING, en la misma transacción", () => {
  const cuerpo = cuerpoDe(fuente(EXPEDIENTE), "withdrawEduRecord");

  assert.match(cuerpo, /prisma\.\$transaction/, "las dos escrituras tienen que ir juntas");
  assert.match(cuerpo, /eduCaseApproval\.updateMany/, "no se cierra ninguna autorización");
  assert.match(cuerpo, /targetType: "EduRecord"/);
  assert.match(cuerpo, /status: "PENDING"/, "el where tiene que acotar a las que esperan firma");
  assert.match(
    cuerpo,
    /status: "CHANGES_REQUESTED"/,
    "es el mismo estado con el que el reenvío cierra la anterior: nadie la decidió",
  );
  assert.match(cuerpo, /decisionNote: EDU_RECORD_WITHDRAWN_APPROVAL_NOTE/);

  // 🔴 Y NO SE INVENTA UN DECISOR. Poner `decidedById` aquí le atribuiría a
  // alguien —al alumno que retiró— una decisión de docente que no tomó.
  assert.doesNotMatch(
    cuerpo,
    /decidedById/,
    "se le atribuyó a alguien la decisión de una petición que cerró un hecho, no una persona",
  );

  // Y NO SE BORRA NADA: ni la nota ni la petición.
  assert.doesNotMatch(cuerpo, /delete(Many)?\(/, "retirar volvió a borrar filas");
});

test("🔴 N-1 · EJECUTADA · una firma sobre una nota retirada NO abre la puerta del caso", () => {
  // Con `deletedAt: null` en `loadTargets`, la nota retirada no se
  // encuentra y su hash de hoy sale NULL. Esto comprueba lo que el resto
  // del vertical hace con ese null, que es la mitad que de verdad importa:
  // la firma deja de valer y el caso NO avanza de etapa.
  const firmada = { status: "APPROVED" as const, contentHash: "a".repeat(64), isEmergency: false };

  assert.equal(
    eduApprovalEffectiveStatus(firmada, "a".repeat(64)),
    "APPROVED",
    "con la nota viva y sin tocar, la firma tiene que seguir valiendo",
  );
  assert.equal(
    eduApprovalEffectiveStatus(firmada, null),
    "EXPIRED",
    "una firma sobre algo que ya no está en el expediente seguía contando como autorización",
  );

  // Y la puerta, con esa autorización ya vencida, no deja pasar.
  const puerta = eduCaseGateVerdict("PLAN", [
    { status: eduApprovalEffectiveStatus(firmada, null), isEmergency: false },
  ]);
  assert.equal(puerta.ok, false, "el caso avanzaba de etapa sobre una nota que nadie puede abrir");

  // La otra mitad del arreglo: retirar CIERRA la petición, así que ni
  // siquiera llega a firmarse. Una CHANGES_REQUESTED tampoco abre la puerta.
  const cerrada = eduCaseGateVerdict("PLAN", [
    { status: "CHANGES_REQUESTED", isEmergency: false },
  ]);
  assert.equal(cerrada.ok, false);
});

test("N-1 · el motivo que queda escrito en la petición lo lee una persona", () => {
  assert.ok(EDU_RECORD_WITHDRAWN_APPROVAL_NOTE.length > 30);
  assert.match(EDU_RECORD_WITHDRAWN_APPROVAL_NOTE, /retir/i, "no dice qué pasó con la nota");
  assert.match(
    EDU_RECORD_WITHDRAWN_APPROVAL_NOTE,
    /nadie/i,
    "tiene que decir que no la decidió nadie: la fila se cierra sin `decidedById`",
  );
});

test("🔴 H-23 · el SERVIDOR exige contenido al crear la nota, no solo el botón", () => {
  const cuerpo = cuerpoDe(fuente(EXPEDIENTE), "createEduRecord");
  assert.match(
    cuerpo,
    /eduRecordHasContent/,
    "un POST a mano seguía creando una nota sin una sola palabra, que después hay que RETIRAR",
  );
  assert.match(cuerpo, /EDU_RECORD_EMPTY_DENIED/);
});

test("🔴 H-23 · vaciar una nota ENVIADA rebota aunque el PATCH no traiga `status`", () => {
  const cuerpo = cuerpoDe(fuente(EXPEDIENTE), "updateEduRecord");

  // El chequeo se juzga por el estado en el que la nota VA A QUEDAR, no por
  // el que trae el PATCH: vivía dentro del `if (input.status !== undefined)`
  // y por eso un "Guardar" con los cinco campos en blanco pasaba limpio.
  assert.match(
    cuerpo,
    /if \(siguiente !== "BORRADOR"\)/,
    "el chequeo de nota vacía volvió a colgar del `status` que trae el PATCH",
  );
  assert.doesNotMatch(
    cuerpo,
    /if \(st !== "BORRADOR"\)/,
    "el chequeo sigue dentro del bloque que solo corre cuando el PATCH manda `status`",
  );
  assert.match(cuerpo, /eduRecordHasContent\(final\)/);

  // Un BORRADOR SÍ se puede quedar vacío: es un papel a medio escribir, y
  // para el que nunca debió existir está "Retirar".
  assert.equal(
    eduRecordHasContent({ subjetivo: null, objetivo: null, analisis: null, plan: null, diagnostico: null }),
    false,
  );
  assert.equal(eduRecordHasContent({ subjetivo: "   ", diagnostico: "caries" }), true);
});

test("🔴 N-4 · el dibujo se resincroniza con `entries`, y no mientras se guarda", () => {
  const src = fuente(PANTALLA_ODO);
  assert.match(
    src,
    /useEffect\(\(\) => \{[\s\S]*?setRecords\(eduEntriesToRecords\(entries\)\);[\s\S]*?\}, \[entries\]\)/,
    "«Actualizar» volvía a refrescar solo la lista: el dibujo se quedaba con lo de hace una hora",
  );
  assert.match(
    src,
    /if \(guardandoRef\.current > 0\) return;/,
    "sin el guardia, una foto del servidor tomada a media escritura borra del dibujo un " +
      "hallazgo que sí se guardó",
  );
});

test("🔴 H-22 · la goma por cara deshace SOLO lo que falló", () => {
  const src = fuente(PANTALLA_ODO);
  assert.match(
    src,
    /\(\) => restaurar\(fdi, cara, condition\)/,
    "las N peticiones de la goma volvieron a compartir el mismo deshacer: si falla la " +
      "tercera, se repintan las tres, incluidas las dos que sí se dieron de baja",
  );
  // `restaurar` reinyecta sobre el estado de ESE momento, no sobre una foto
  // vieja: si volviera a `antes`, el arreglo sería el mismo fallo con otro nombre.
  assert.match(src, /setRecords\(\(actual\) =>\s*\n?\s*clonar\(actual, fdi,/);
});

test("🔴 N-14 · en solo lectura, la rejilla de caras y la mini-paleta se apagan con motivo", () => {
  const src = fuente(PANEL_DIENTE);

  const rejilla = src.slice(src.indexOf("odo-surf-btn"), src.indexOf("DetailPalette"));
  assert.match(rejilla, /disabled=\{!canEdit\}/, "los botones de cara se pulsaban y no pasaba nada");
  assert.match(rejilla, /title=\{canEdit \? undefined : disabledReason/);

  assert.match(
    src,
    /<DetailPalette[\s\S]*?canEdit=\{canEdit\}[\s\S]*?disabledReason=\{disabledReason\}/,
    "la mini-paleta seguía ofreciendo pinceles que no se pueden usar",
  );
  const chips = src.slice(src.indexOf("odo-chip"));
  assert.match(chips, /disabled=\{!canEdit\}/);
});

test("N-3 · los rótulos del odontograma ya no prometen más de lo que hay", () => {
  // La promesa vieja era "quitar no borra, deja constancia de quién lo
  // quitó", a secas. Hoy es verdad para lo retirado Y para lo que se
  // remarcó — pero de esto último no queda la fecha, y el rótulo lo dice.
  const pantalla = crudo(PANTALLA_ODO);
  assert.ok(
    !pantalla.includes("deja constancia de quién lo quitó"),
    "el rótulo sigue prometiendo una constancia que se pierde al remarcar",
  );
  assert.match(
    pantalla,
    /se conserva quién pasó la goma, no la fecha en que lo hizo/,
    "falta decir hasta dónde llega el rastro",
  );

  // Y el índice exacto de la Ola C queda anotado donde se va a buscar.
  const servidor = crudo(ODONTOGRAMA);
  assert.match(servidor, /DROP INDEX IF EXISTS "edu_odontogram_hallazgo_key"/);
  assert.match(servidor, /WHERE "deletedAt" IS NULL/);
  // H-17, la otra mitad que no cabe: acotar la escritura al CASO pide una
  // columna que la tabla no tiene. Queda dicho, no a medias.
  assert.match(servidor, /no tiene `caseId`/);
});
