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
  eduRecordCanWithdraw,
} from "../expediente-core";
import { EDU_RECORD_STATUSES } from "../types";

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
  assert.equal(tabla.filas[0].deletedById, null, "revivir dejó puesto a quien la quitó");
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
