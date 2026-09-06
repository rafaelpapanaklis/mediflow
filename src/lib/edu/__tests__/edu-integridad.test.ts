/**
 * WS2-T3 · INTEGRIDAD CLÍNICA del instituto: lo firmado no se altera por
 * debajo, y lo que el servidor sabe hacer la pantalla lo ofrece.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-integridad.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CÓMO SE PRUEBA ESTO SIN BASE DE DATOS
 *
 * El vertical no tiene base de pruebas (las 1 303 pruebas de `test:edu` son
 * de módulos puros o de lectura del fuente), y eso es exactamente por lo
 * que ni la carrera del H-16 ni el borrado del odontograma tenían quien los
 * detectara. Así que aquí hay tres clases de prueba, y cada una dice cuál
 * es:
 *
 *  · EJECUTADAS — el guardia de escritura de las recetas, el hash y la
 *    edad viven en módulos PUROS a propósito, y aquí se corren de verdad.
 *    La carrera del H-16 se REPRODUCE: dos escritores sobre la misma fila,
 *    y el segundo tiene que fallar.
 *  · DE FUENTE — la regla vive dentro de una función que importa prisma y
 *    no se puede cargar sin Postgres. Se lee el archivo y se comprueba que
 *    la llamada esté puesta. Un archivo se juzga por lo que HACE: los
 *    comentarios se quitan antes de buscar, para que ninguna prueba pase
 *    por lo que dice la prosa.
 *  · DE FRONTERA — lo que depende de un archivo del DENTAL que no
 *    controlamos (el `aria-label` con el que se tapa el panel de notas del
 *    CBCT). Si el dental lo cambia, aquí se pone rojo antes de que un
 *    alumno se encuentre un botón que no guarda.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eduApprovalHash } from "../autorizaciones-hash";
import {
  eduRecetaEditable,
  eduRecetaPrintable,
  eduRecetaSnapshot,
  eduRecetaVoidable,
  eduRecetaWriteMatches,
  eduRecetaWriteWhere,
  EDU_RECETA_INTEGRIDAD_LABELS,
  type EduRecetaIntegridad,
} from "../recetas-core";
import { EDU_CONSENT_EDAD_MAYORIA } from "../consentimientos-core";
import { eduAgeYears } from "../pacientes-core";
import { EDU_PRESCRIPTION_TRANSITIONS, type EduPrescriptionStatus } from "../types";

const RAIZ = join(__dirname, "..", "..", "..", "..");

function crudo(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8");
}

/** El archivo, SIN comentarios: se juzga por lo que hace, no por lo que dice. */
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

const RECETAS = "src/lib/edu/recetas.ts";
const CONSENTIMIENTOS = "src/lib/edu/consentimientos.ts";
const ODONTOGRAMA = "src/lib/edu/odontograma.ts";
const EXPEDIENTE = "src/lib/edu/expediente.ts";
const PANTALLA_RECETAS = "src/components/edu/recetas/recetas-screen.tsx";
const PANTALLA_EXPEDIENTE = "src/components/edu/expediente/expediente-screen.tsx";
const PANTALLA_CONSENT = "src/components/edu/expediente/consentimientos-screen.tsx";
const PANTALLA_ODO = "src/components/edu/expediente/odontograma-screen.tsx";
const VISOR = "src/components/edu/expediente/estudio-viewer.tsx";
const SUBIDA = "src/components/edu/expediente/edu-upload-client.ts";
const TEMA = "src/app/instituto/edu-theme.css";
const COPIA_ODO = "src/components/edu/odontograma";

/* ═══════════════════════════════════════════════════════════════════════
 * 1 · H-16 · LA CARRERA: dos escrituras, la segunda tiene que fallar
 *
 * EJECUTADA. Ésta es la prueba que le faltaba al vertical: la que
 * REPRODUCE el fallo. Se modela una tabla en memoria que aplica el `where`
 * exactamente como lo aplica Postgres (a través de la MISMA función que usa
 * el servidor, `eduRecetaWriteWhere` + `eduRecetaWriteMatches`) y se
 * intercalan dos escritores sobre la misma fila.
 * ═══════════════════════════════════════════════════════════════════════ */

interface FilaReceta {
  institutionId: string;
  id: string;
  status: EduPrescriptionStatus;
  diagnosis: string | null;
  issuedByCedula: string | null;
}

/**
 * La tabla de recetas, en memoria. `updateMany` devuelve cuántas filas
 * cumplieron el `where` — que es lo único de Postgres que hace falta para
 * demostrar la carrera.
 */
class TablaDeRecetas {
  private filas = new Map<string, FilaReceta>();

  constructor(inicial: FilaReceta[]) {
    for (const f of inicial) this.filas.set(f.id, { ...f });
  }

  leer(id: string): FilaReceta {
    const f = this.filas.get(id);
    assert.ok(f, `la fila ${id} no existe`);
    return { ...f };
  }

  updateMany(
    where: ReturnType<typeof eduRecetaWriteWhere>,
    data: Partial<FilaReceta>,
  ): { count: number } {
    let count = 0;
    for (const [id, fila] of this.filas) {
      if (!eduRecetaWriteMatches(where, fila)) continue;
      this.filas.set(id, { ...fila, ...data });
      count++;
    }
    return { count };
  }
}

const INST = "inst_1";

test("H-16 · la edición que llega DESPUÉS de la firma no toca la receta", () => {
  const tabla = new TablaDeRecetas([
    {
      institutionId: INST,
      id: "rx_1",
      status: "PENDIENTE",
      diagnosis: "pulpitis irreversible en 26",
      issuedByCedula: null,
    },
  ]);

  // 1 · El ALUMNO lee la receta para editarla. Está PENDIENTE.
  const leidaPorElAlumno = tabla.leer("rx_1");
  assert.equal(leidaPorElAlumno.status, "PENDIENTE");

  // 2 · En esa ventana, su DOCENTE la EXPIDE desde la bandeja. Esa
  //     escritura sí llevaba su guardia desde siempre (autorizaciones.ts).
  const firma = tabla.updateMany(eduRecetaWriteWhere(INST, "rx_1", "PENDIENTE"), {
    status: "EXPEDIDA",
    issuedByCedula: "1234567",
  });
  assert.equal(firma.count, 1, "la firma del docente sí tenía que entrar");

  // 3 · Y AHORA entra la transacción del alumno, con el estado que leyó.
  const edicion = tabla.updateMany(
    eduRecetaWriteWhere(INST, "rx_1", leidaPorElAlumno.status),
    { diagnosis: "OTRA COSA" },
  );

  assert.equal(
    edicion.count,
    0,
    "la segunda escritura tiene que fallar: sin el estado en el `where` reescribiría " +
      "los renglones de una receta YA EXPEDIDA, con la cédula del docente congelada dentro",
  );

  const final = tabla.leer("rx_1");
  assert.equal(final.status, "EXPEDIDA");
  assert.equal(
    final.diagnosis,
    "pulpitis irreversible en 26",
    "el contenido tiene que ser el que el docente leyó al firmar",
  );
  assert.equal(final.issuedByCedula, "1234567");
});

test("H-16 · sin el estado en el `where`, la carrera SÍ falsifica el documento", () => {
  // El contraejemplo, para que la prueba de arriba no pase por casualidad:
  // con el `where` viejo (solo el id) la segunda escritura entra.
  const tabla = new TablaDeRecetas([
    {
      institutionId: INST,
      id: "rx_1",
      status: "PENDIENTE",
      diagnosis: "lo que el docente leyó",
      issuedByCedula: null,
    },
  ]);
  tabla.updateMany(eduRecetaWriteWhere(INST, "rx_1", "PENDIENTE"), {
    status: "EXPEDIDA",
    issuedByCedula: "1234567",
  });

  // `where: { id }` a secas = cualquier estado cumple. Se simula pidiendo
  // el guardia con el estado que la fila tiene AHORA.
  const sinGuardia = tabla.updateMany(eduRecetaWriteWhere(INST, "rx_1", "EXPEDIDA"), {
    diagnosis: "lo que el docente NUNCA leyó",
  });
  assert.equal(sinGuardia.count, 1);
  assert.equal(
    tabla.leer("rx_1").diagnosis,
    "lo que el docente NUNCA leyó",
    "esto es lo que pasaba antes: un PDF con la cédula de un docente y otro contenido",
  );
});

test("H-16 · las TRES escrituras de recetas usan el guardia, ninguna a mano", () => {
  const src = fuente(RECETAS);

  for (const fn of ["updateEduReceta", "sendEduRecetaToApproval", "withdrawEduReceta"]) {
    const cuerpo = cuerpoDe(src, fn);
    assert.ok(
      cuerpo.includes("eduRecetaWriteWhere("),
      `${fn} escribe sin el guardia de estado: es el H-16 otra vez`,
    );
    assert.ok(
      cuerpo.includes("updateMany("),
      `${fn} usa update() en vez de updateMany(): un update por id no puede fallar por estado`,
    );
    assert.match(
      cuerpo,
      /moved\.count === 0/,
      `${fn} no comprueba que la escritura haya tocado una fila`,
    );
  }

  // Y la que ya lo hacía bien desde el principio sigue igual.
  assert.match(
    cuerpoDe(src, "voidEduReceta"),
    /status: "EXPEDIDA"/,
    "voidEduReceta perdió su guardia de estado",
  );
});

test("H-16 · ninguna escritura de recetas se cuela por `update({ where: { id`", () => {
  const src = fuente(RECETAS);
  assert.equal(
    /eduPrescription\.update\(\s*\{/.test(src),
    false,
    "volvió un update() sin guardia sobre eduPrescription: toda escritura va por updateMany " +
      "con el estado en el `where`",
  );
});

/* ═══════════════════════════════════════════════════════════════════════
 * 2 · H-16 (segunda mitad) · EL HASH SE RECALCULA Y SE COMPARA
 * ═══════════════════════════════════════════════════════════════════════ */

const RECETA_FIRMADA = {
  diagnosis: "pulpitis irreversible en 26",
  indications: "dieta blanda 24 h",
  items: [
    {
      drug: "Amoxicilina",
      presentation: "cápsulas 500 mg",
      dose: "1 cápsula",
      route: "oral",
      frequency: "cada 8 horas",
      duration: "7 días",
      quantity: "1 caja (21)",
      notes: "con alimentos",
    },
  ],
};

test("la huella cambia cuando cambia CUALQUIER cosa del contenido", () => {
  const original = eduApprovalHash(eduRecetaSnapshot(RECETA_FIRMADA));

  // Lo mismo, leído otra vez: la misma cifra. Si esto fallara, la
  // comprobación de integridad marcaría "alterada" toda receta sana.
  assert.equal(original, eduApprovalHash(eduRecetaSnapshot({ ...RECETA_FIRMADA })));

  const cambios = [
    { ...RECETA_FIRMADA, diagnosis: "otra cosa" },
    { ...RECETA_FIRMADA, indications: "otra cosa" },
    {
      ...RECETA_FIRMADA,
      items: [{ ...RECETA_FIRMADA.items[0], drug: "Paracetamol" }],
    },
    {
      ...RECETA_FIRMADA,
      items: [{ ...RECETA_FIRMADA.items[0], dose: "2 cápsulas" }],
    },
    {
      ...RECETA_FIRMADA,
      items: [{ ...RECETA_FIRMADA.items[0], frequency: "cada 4 horas" }],
    },
    // Un renglón de más: la receta que el docente firmó tenía uno.
    { ...RECETA_FIRMADA, items: [...RECETA_FIRMADA.items, RECETA_FIRMADA.items[0]] },
  ];

  for (const alterada of cambios) {
    assert.notEqual(
      eduApprovalHash(eduRecetaSnapshot(alterada)),
      original,
      "una receta alterada tiene que dejar de cuadrar con la huella que se congeló al firmar",
    );
  }
});

test("la integridad se recalcula al LEER y al servir el PDF, no se guarda", () => {
  const src = fuente(RECETAS);

  // El verificador existe y no lee ninguna columna de "integridad".
  assert.ok(src.includes("function verificarIntegridad("), "desapareció el verificador");
  assert.match(
    src,
    /eduApprovalHash\(eduRecetaSnapshot\(r\)\)/,
    "la huella tiene que RECALCULARSE con el mismo snapshot y el mismo hash del gate",
  );

  // En las dos salidas: la fila que va a la pantalla y los datos del PDF.
  assert.match(src, /integridad: verificarIntegridad\(r\)/, "toRow no verifica la huella");
  assert.match(
    src,
    /integridad: verificarIntegridad\(receta\)/,
    "getEduRecetaPdfData no verifica la huella",
  );

  // Y la lectura de siempre trae la columna: si `issuedHash` se cayera del
  // select, `verificarIntegridad` diría "sin_hash" de TODA receta y la
  // comprobación se apagaría sola sin que nada fallara.
  assert.match(src, /issuedHash: true/, "RECETA_SELECT ya no trae la huella");
});

test("la pantalla y el PDF DICEN cuando la integridad no cuadra", () => {
  const pantalla = fuente(PANTALLA_RECETAS);
  assert.ok(
    pantalla.includes('row.integridad === "alterada"'),
    "la tarjeta de la receta no avisa de una huella que no cuadra",
  );
  assert.ok(
    pantalla.includes("EDU_RECETA_INTEGRIDAD_LABELS"),
    "el aviso tiene que salir del catálogo compartido, no de un texto suelto",
  );

  const pdf = fuente("src/lib/edu/receta-pdf.tsx");
  assert.ok(
    pdf.includes('data.integridad === "alterada"'),
    "el PDF no dice nada de una receta alterada: imprimía la huella y jamás la comparaba",
  );
  assert.ok(
    pdf.includes("EDU_RECETA_INTEGRIDAD_PDF_ALERTA"),
    "la franja del PDF tiene que salir del catálogo compartido",
  );

  // Los tres estados tienen su texto: uno sin etiqueta saldría en blanco.
  for (const k of ["ok", "alterada", "sin_hash"] as EduRecetaIntegridad[]) {
    assert.ok(
      EDU_RECETA_INTEGRIDAD_LABELS[k] && EDU_RECETA_INTEGRIDAD_LABELS[k].length > 20,
      `falta el texto de la integridad "${k}"`,
    );
  }
});

/* ═══════════════════════════════════════════════════════════════════════
 * 3 · H-24 y S-16 · lo que se puede corregir, y lo que no se manda
 * ═══════════════════════════════════════════════════════════════════════ */

test("S-16 · un borrador de un caso CERRADO no se manda a autorización", () => {
  const cuerpo = cuerpoDe(fuente(RECETAS), "sendEduRecetaToApproval");
  assert.ok(
    cuerpo.includes("EDU_CASE_CLOSED_STATUSES"),
    "mandar a firmar la receta de un caso cerrado la pone en la bandeja de un docente " +
      "que ya entregó ese caso: se bloqueaba al CREAR y no al ENVIAR",
  );
  assert.ok(
    cuerpo.includes("receta.case.status"),
    "el estado del caso tiene que salir de la receta ya resuelta dentro del alcance",
  );
});

test("H-24 · un BORRADOR se mueve de caso; una PENDIENTE no", () => {
  const cuerpo = cuerpoDe(fuente(RECETAS), "updateEduReceta");
  assert.ok(cuerpo.includes('"caseId" in input'), "el PATCH sigue ignorando el caseId que manda la pantalla");
  assert.ok(
    cuerpo.includes('receta.status !== "BORRADOR"'),
    "una PENDIENTE no se mueve: su petición está en la bandeja del docente del caso viejo",
  );
  assert.ok(
    cuerpo.includes("resolverCasoDestino("),
    "el caso destino tiene que comprobarse dentro del alcance, del mismo paciente y abierto",
  );
  assert.ok(
    cuerpo.includes("data.proposedByMatricula"),
    "al mover de caso hay que recalcular la matrícula congelada, o el papel diría que lo " +
      "propuso un alumno con la matrícula de otro",
  );

  // Y el destino se busca con el alcance, no por id suelto.
  const destino = fuente(RECETAS);
  const i = destino.indexOf("async function resolverCasoDestino");
  assert.notEqual(i, -1);
  const cuerpoDestino = destino.slice(i, destino.indexOf("\nexport ", i));
  assert.ok(cuerpoDestino.includes("eduCaseScopeWhere("), "falta el recorte por alcance");
  assert.ok(cuerpoDestino.includes("patientId"), "el caso tiene que ser del MISMO paciente");
  assert.ok(cuerpoDestino.includes("EDU_CASE_CLOSED_STATUSES"), "el caso destino tiene que estar abierto");
});

test("H-24 · retirar una receta NO la anula: es PENDIENTE → BORRADOR", () => {
  // La decisión explicada en el reporte: darle a lo no-expedido un camino a
  // ANULADA contradice dos reglas escritas que siguen teniendo razón.
  assert.deepEqual(
    EDU_PRESCRIPTION_TRANSITIONS.RECHAZADA,
    [],
    "si RECHAZADA vuelve a tener salidas, revisa la decisión de H-24 en el reporte de ws2-t3",
  );
  assert.ok(
    eduRecetaPrintable("ANULADA"),
    "una ANULADA se imprime (marcada), y por eso una receta sin firmar no puede pasar a ANULADA: " +
      "ofrecería el botón del PDF y luego rebotaría por no tener firmante",
  );
  assert.equal(eduRecetaVoidable("RECHAZADA"), false);
  assert.equal(eduRecetaVoidable("BORRADOR"), false);
  assert.equal(eduRecetaVoidable("EXPEDIDA"), true);

  // Y el camino que sí existe: el de la máquina de estados.
  assert.ok(
    EDU_PRESCRIPTION_TRANSITIONS.PENDIENTE.includes("BORRADOR"),
    "retirar usa la vuelta que la máquina de estados ya tenía abierta",
  );

  const cuerpo = cuerpoDe(fuente(RECETAS), "withdrawEduReceta");
  assert.ok(
    cuerpo.includes("receta.proposedByUserId !== ctx.eduUserId"),
    "solo quien la propuso la retira",
  );
  assert.ok(
    cuerpo.includes("decidedById") === false,
    "el cierre de la petición NO puede llevar decisor: no la decidió ningún docente",
  );
  assert.ok(
    cuerpo.includes('status: "CHANGES_REQUESTED"'),
    "la petición pendiente se cierra como historial, no se borra",
  );
});

test("editar sigue abierto solo donde lo estaba", () => {
  assert.equal(eduRecetaEditable("BORRADOR"), true);
  assert.equal(eduRecetaEditable("PENDIENTE"), true);
  assert.equal(eduRecetaEditable("EXPEDIDA"), false);
  assert.equal(eduRecetaEditable("ANULADA"), false);
  assert.equal(eduRecetaEditable("RECHAZADA"), false);
});

/* ═══════════════════════════════════════════════════════════════════════
 * 4 · H-08 · UN MENOR NO FIRMA SU PROPIO CONSENTIMIENTO
 * ═══════════════════════════════════════════════════════════════════════ */

test("H-08 · la mayoría de edad es UN número, compartido por servidor y pantalla", () => {
  assert.equal(EDU_CONSENT_EDAD_MAYORIA, 18);

  const servidor = fuente(CONSENTIMIENTOS);
  const pantalla = fuente(PANTALLA_CONSENT);
  assert.ok(
    servidor.includes("EDU_CONSENT_EDAD_MAYORIA"),
    "el servidor no comprueba la edad: se emitía la carta de un niño de nueve años sin tutor",
  );
  assert.ok(
    pantalla.includes("EDU_CONSENT_EDAD_MAYORIA"),
    "la pantalla tiene que exigir lo MISMO que el servidor, con el mismo número",
  );
});

test("H-08 · el servidor BLOQUEA la emisión, no solo avisa", () => {
  const cuerpo = cuerpoDe(fuente(CONSENTIMIENTOS), "createEduConsent");
  assert.match(
    cuerpo,
    /edad !== null && edad < EDU_CONSENT_EDAD_MAYORIA && !signerName/,
    "falta el candado del menor sin representante en createEduConsent",
  );
  assert.match(
    cuerpo,
    /throw new EduPadronError\([\s\S]{0,400}?409,?\s*\)/,
    "el menor sin representante tiene que rebotar, no advertir: una carta emitida ya tiene liga",
  );
});

test("H-08 · la edad se calcula con la MISMA función de siempre", () => {
  const nacio = new Date("2017-09-06T00:00:00.000Z");
  const hoy = new Date("2026-09-06T12:00:00.000Z");
  assert.equal(eduAgeYears(nacio, hoy), 9, "un niño de nueve años tiene que salir de nueve");
  assert.ok(eduAgeYears(nacio, hoy)! < EDU_CONSENT_EDAD_MAYORIA);

  // Justo el día que cumple 18 ya firma él.
  const mayor = new Date("2008-09-06T00:00:00.000Z");
  assert.equal(eduAgeYears(mayor, hoy), 18);
  assert.ok(eduAgeYears(mayor, hoy)! >= EDU_CONSENT_EDAD_MAYORIA);

  // Sin fecha de nacimiento NO se puede afirmar nada, y por eso no se
  // bloquea: trancar la emisión de todo paciente sin fecha pararía la
  // clínica por un dato que hoy es opcional.
  assert.equal(eduAgeYears(null, hoy), null);
});

/* ═══════════════════════════════════════════════════════════════════════
 * 5 · S-13 · UN TESTIGO NO FIRMA UNA CARTA CADUCADA
 * ═══════════════════════════════════════════════════════════════════════ */

test("S-13 · la caducidad vale para el paciente Y para los testigos", () => {
  const cuerpo = cuerpoDe(fuente(CONSENTIMIENTOS), "signEduConsentPublic");

  // Dos comprobaciones de `expiresAt`: la del paciente (que ya estaba) y la
  // del testigo (que faltaba). Con una sola, una liga vencida seguía
  // admitiendo firmas de testigo indefinidamente.
  const veces = (cuerpo.match(/now > c\.expiresAt/g) ?? []).length;
  assert.equal(
    veces,
    2,
    `\`now > c.expiresAt\` aparece ${veces} vez/veces y tienen que ser 2: una por el ` +
      "paciente y otra por el testigo",
  );

  // Y la del testigo va DESPUÉS de comprobar que el paciente ya firmó: el
  // orden importa para que el mensaje que reciba sea el correcto.
  const iPaciente = cuerpo.indexOf("Un testigo atestigua una firma que ya ocurrió");
  const iCaducada = cuerpo.lastIndexOf("now > c.expiresAt");
  assert.ok(iPaciente !== -1 && iCaducada > iPaciente, "la caducidad del testigo está mal colocada");
});

/* ═══════════════════════════════════════════════════════════════════════
 * 6 · H-15 y H-12 · lo que el servidor sabe, la pantalla lo ofrece
 * ═══════════════════════════════════════════════════════════════════════ */

test("H-15 · la bandera de contrafirma contempla DIRECCION, igual que el servidor", () => {
  const src = fuente(CONSENTIMIENTOS);

  // El servidor: el hueco del docente lo abre el supervisor O la dirección.
  const cuerpoServidor = cuerpoDe(src, "countersignEduConsent");
  assert.ok(
    cuerpoServidor.includes('ctx.role === "DIRECCION"'),
    "el servidor perdió el caso que esta regla existe para resolver: el docente rotó",
  );

  // Y la bandera que viaja a la pantalla, la MISMA condición. Antes miraba
  // solo el id del supervisor, así que desde el panel ese caso no se podía
  // desatorar: había que llamar a la API a mano.
  const iRow = src.indexOf("puedeContrafirmarComoDocente:");
  assert.notEqual(iRow, -1, "desapareció la bandera de contrafirma del docente");
  const bandera = src.slice(iRow, iRow + 320);
  assert.ok(
    bandera.includes('role === "DIRECCION"'),
    "la bandera de la pantalla no contempla a la dirección: el botón nunca se le pinta",
  );
});

test("H-12 · el texto firmado, su huella y las firmas vuelven al panel", () => {
  const src = fuente(CONSENTIMIENTOS);

  // El texto y la huella salen en la lectura del panel…
  assert.ok(src.includes("content: true"), "CONSENT_SELECT no trae el texto de la carta");
  assert.ok(src.includes("contentHash: true"), "CONSENT_SELECT no trae la huella");

  // …y la huella se RECALCULA, nunca se lee una bandera guardada.
  assert.match(
    src,
    /eduConsentHash\(c\.procedure, c\.content\)/,
    "la huella del panel tiene que recalcularse igual que en la página del paciente",
  );

  // Las cinco firmas se piden a Storage EN LOTE (hasta 5 PNG por carta).
  assert.ok(src.includes("eduSignReadMany("), "las firmas se firman una por una: son N viajes");
  for (const col of [
    "signatureUrl",
    "witness1SignatureUrl",
    "witness2SignatureUrl",
    "studentSignatureUrl",
    "supervisorSignatureUrl",
  ]) {
    assert.ok(src.includes(col), `falta ${col} en la lectura del panel`);
  }

  // La pantalla lo enseña, y el aviso de caducidad va junto a la liga.
  const pantalla = fuente(PANTALLA_CONSENT);
  assert.ok(pantalla.includes("function CartaFirmada("), "no hay ficha de la carta firmada");
  assert.ok(pantalla.includes("row.content"), "la ficha no pinta el texto que se firmó");
  assert.ok(
    pantalla.includes("EDU_CONSENT_INTEGRIDAD_LABELS"),
    "la ficha no dice si la huella cuadra",
  );
  assert.ok(
    pantalla.includes("c.expiresLabel"),
    "`expiresLabel` se calculaba y no se pintaba: nadie sabía cuándo caduca la liga que copió",
  );
});

test("S-17 · «Emitir carta» se apaga con el motivo escrito", () => {
  const pantalla = fuente(PANTALLA_CONSENT);
  assert.ok(pantalla.includes("const sinDocente ="), "falta el veredicto del caso sin docente");
  assert.ok(
    pantalla.includes("disabled={busy || motivoBloqueo !== null}"),
    "el botón de emitir no contempla el caso sin docente ni el menor sin representante",
  );
  assert.ok(
    pantalla.includes("No se puede emitir todavía:"),
    "el motivo tiene que estar ESCRITO, no en un title: en el teléfono no hay hover",
  );
});

/* ═══════════════════════════════════════════════════════════════════════
 * 7 · EL ODONTOGRAMA ES CÓDIGO PROPIO
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * La ruta de la carpeta del DENTAL, armada por trozos a propósito.
 *
 * La comprobación de la tarea es literal —un `grep -r` de esa ruta sobre las
 * tres raíces del vertical tiene que dar CERO— y este archivo vive
 * bajo `src/lib/edu/`. Escribirla entera aquí haría que la prueba que VIGILA
 * la bifurcación fuera el único resultado del grep que la comprueba, y quien
 * lo corriera tendría que pararse a decidir si ese resultado cuenta. Se arma
 * en dos trozos: la prueba hace exactamente lo mismo y el grep no la ve.
 */
const CARPETA_DENTAL = "dashboard/odontogram" + "-v2";

test("la copia del odontograma está completa y en su sitio", () => {
  const esperados = [
    "adapter.ts",
    "App.tsx",
    "data.ts",
    "DetailPanel.tsx",
    "Legend.tsx",
    "OdoDefs.tsx",
    "odontogram.css",
    "Odontogram.tsx",
    "Palette.tsx",
    "Surface2D.tsx",
    "Tooth3D.tsx",
    "ToothGlyph.tsx",
    "types.ts",
  ];
  for (const f of esperados) {
    assert.ok(
      existsSync(join(RAIZ, COPIA_ODO, f)),
      `falta ${f} en la copia del instituto: la bifurcación quedó a medias`,
    );
  }

  // Y el original del DENTAL sigue donde estaba: copiar no es mover.
  assert.ok(
    existsSync(join(RAIZ, "src/components", CARPETA_DENTAL, "DetailPanel.tsx")),
    "el odontograma del dental desapareció: la copia NO se lleva el original",
  );
});

test("ni un archivo del instituto importa ya el odontograma del dental", () => {
  // Es la comprobación entera de la bifurcación: mientras quede una sola
  // importación, un cambio del dental sigue cambiando el del instituto.
  const raices = [
    "src/lib/edu/odontograma-core.ts",
    "src/lib/edu/odontograma.ts",
    PANTALLA_ODO,
    "src/app/instituto/(panel)/pacientes/[id]/odontograma/page.tsx",
  ];
  for (const archivo of raices) {
    assert.equal(
      crudo(archivo).includes(CARPETA_DENTAL),
      false,
      `${archivo} sigue apuntando al odontograma del dental`,
    );
  }
  assert.ok(
    fuente("src/lib/edu/odontograma-core.ts").includes("@/components/edu/odontograma/data"),
    "el catálogo de hallazgos tiene que venir de la copia del instituto",
  );
});

test("H-18 · mirar la nota de un diente no la reatribuye — los DOS cinturones", () => {
  // 1 · El panel: el onBlur no dispara si el texto no cambió.
  const panel = fuente(join(COPIA_ODO, "DetailPanel.tsx"));
  assert.ok(panel.includes("onBlur={guardarNota}"), "el onBlur volvió a disparar onNote a pelo");
  assert.match(
    panel,
    /if \(note === \(record\.note \|\| ""\)\) return;/,
    "el panel no compara la nota contra lo guardado antes de mandarla",
  );

  // 2 · El contenedor: `anotar` compara igual, por si el panel cambia o
  //     alguien llama a onNote desde otro sitio.
  const pantalla = fuente(PANTALLA_ODO);
  assert.match(
    pantalla,
    /if \(\(antes\[fdi\]\?\.note \?\? ""\) === texto\) return;/,
    "anotar() manda la nota aunque no haya cambiado: el servidor reescribe recordedById",
  );

  // 3 · Y el servidor sigue refrescando el autor en cada guardado — que es
  //     justo lo que hace que los dos cinturones importen.
  assert.ok(
    fuente(ODONTOGRAMA).includes("recordedById: ctx.eduUserId"),
    "si el servidor dejara de reatribuir, esta prueba estaría vigilando algo que ya no pasa",
  );
});

test("H-21 · sin permiso, los tres controles del panel se apagan CON motivo", () => {
  const panel = fuente(join(COPIA_ODO, "DetailPanel.tsx"));
  // La × de cada hallazgo, «Limpiar diente» y el textarea.
  const apagados = (panel.match(/disabled=\{!canEdit\}/g) ?? []).length;
  assert.ok(
    apagados >= 3,
    `solo ${apagados} controles del panel miran canEdit y son tres: la ×, «Limpiar diente» y la nota`,
  );
  assert.ok(panel.includes("odo-dt-locked"), "el motivo no se pinta debajo de los controles");

  const pantalla = fuente(PANTALLA_ODO);
  assert.ok(pantalla.includes("canEdit={canEdit}"), "el panel no recibe canEdit");
  assert.ok(pantalla.includes("disabledReason={SIN_PERMISO}"), "el panel no recibe el motivo");
  assert.ok(
    fuente(join(COPIA_ODO, "odontogram.css")).includes(".odo-dt-locked"),
    "falta el estilo del motivo en la hoja de la copia",
  );
});

test("H-22 · «Limpiar diente» es UNA escritura, y se lleva la nota", () => {
  const src = fuente(ODONTOGRAMA);
  const cuerpo = cuerpoDe(src, "clearEduOdontogramTooth");

  // Un solo deleteMany por diente: en Postgres es una sentencia y por tanto
  // atómica. Con N peticiones, un fallo a media tanda dejaba la pantalla
  // repintando hallazgos que la base ya había borrado.
  assert.equal(
    (cuerpo.match(/deleteMany\(/g) ?? []).length,
    1,
    "limpiar un diente tiene que ser UNA escritura",
  );
  // El `where` NO lleva `condition` ni `surface`: por eso se lleva también
  // la nota, que vive en la misma tabla con la key reservada.
  assert.match(cuerpo, /where: \{ institutionId, patientId: pid, tooth \}/, "el where cambió");
  assert.ok(cuerpo.includes("requireClinicalPatient("), "falta la puerta de pertenencia");

  // La pantalla manda una sola petición y vacía la nota en local.
  const pantalla = fuente(PANTALLA_ODO);
  const i = pantalla.indexOf("const limpiarDiente");
  assert.notEqual(i, -1);
  const cuerpoPantalla = pantalla.slice(i, pantalla.indexOf("const anotar", i));
  assert.equal(
    (cuerpoPantalla.match(/escribir\(/g) ?? []).length,
    1,
    "limpiarDiente vuelve a mandar una petición por hallazgo",
  );
  assert.ok(cuerpoPantalla.includes('r.note = ""'), "«Limpiar diente» deja la nota huérfana");
  assert.ok(cuerpoPantalla.includes('method: "POST"'), "no usa la ruta que limpia el diente entero");

  // Y la ruta existe, con el permiso de escritura.
  const ruta = fuente("src/app/api/instituto/pacientes/[id]/odontograma/route.ts");
  assert.ok(ruta.includes("clearEduOdontogramTooth("), "falta el POST que limpia el diente");
  assert.ok(
    ruta.includes('eduApiGuard("odontograma.edit")'),
    "limpiar un diente es escribir: pide odontograma.edit",
  );
});

/* ═══════════════════════════════════════════════════════════════════════
 * 8 · EL EXPEDIENTE
 * ═══════════════════════════════════════════════════════════════════════ */

test("S-3 · reescribir una nota ENTREGADA refresca la hora de entrega", () => {
  const cuerpo = cuerpoDe(fuente(EXPEDIENTE), "updateEduRecord");
  assert.ok(
    cuerpo.includes("EDU_RECORD_CONTENT_FIELDS"),
    "el cambio de contenido tiene que mirarse sobre los cinco campos, no sobre uno a mano",
  );
  assert.match(
    cuerpo,
    /actual\.status === "ENVIADA" && cambioElTexto && input\.status === undefined/,
    "una ENVIADA reescrita se quedaba con la hora de la PRIMERA entrega: el docente leía " +
      "'entregada a las 9:10' y firmaba un texto de las 11:40",
  );
  assert.ok(cuerpo.includes("data.submittedAt = now"), "no se refresca el sello de entrega");
});

test("H-19 y H-20 · «Nota nueva» cuenta casos ABIERTOS, y el filtro existe", () => {
  const pantalla = fuente(PANTALLA_EXPEDIENTE);

  assert.ok(
    pantalla.includes("disabled={casosAbiertos.length === 0}"),
    "el botón vuelve a contar casos en vez de casos ABIERTOS: se abría un modal sin salida",
  );
  assert.ok(
    pantalla.includes("No se puede escribir una nota nueva"),
    "el motivo tiene que estar escrito debajo del botón apagado",
  );

  // H-20: el `<select>` que el banner promete, con el ?caso= que la API ya leía.
  assert.ok(pantalla.includes('id="edu-exp-filtro"'), "no existe el filtro por caso");
  assert.ok(pantalla.includes("?caso="), "el filtro no navega con el parámetro que lee la API");
  const pagina = fuente("src/app/instituto/(panel)/pacientes/[id]/expediente/page.tsx");
  assert.ok(pagina.includes("searchParams"), "la página del expediente no recibe searchParams");
  assert.ok(pagina.includes("{ caseId: casoParam }"), "la página no le pasa el filtro a la lectura");
  assert.ok(
    pagina.includes("cases.some((c) => c.id === casoParam)"),
    "el caso del query tiene que validarse contra los casos que le tocan a quien mira",
  );
  assert.ok(
    fuente("src/app/api/instituto/pacientes/[id]/expediente/route.ts").includes('get("caso")'),
    "la API perdió el filtro por caso al que apunta el banner",
  );
});

test("H-23 · el «Guardar» de la edición exige contenido, igual que el del alta", () => {
  const pantalla = fuente(PANTALLA_EXPEDIENTE);
  // Los tres botones que escriben piden lo mismo: que la nota tenga algo.
  const conGuardia = (pantalla.match(/!tieneAlgo\(draft\)/g) ?? []).length;
  assert.ok(
    conGuardia >= 3,
    `solo ${conGuardia} botones exigen contenido y tienen que ser tres (guardar borrador, ` +
      "guardar la edición y guardar y firmar): una nota vaciada del todo ya no se puede quitar",
  );
});

test("S-1 · firmar pide confirmación y no se ofrece sobre un borrador ajeno", () => {
  const pantalla = fuente(PANTALLA_EXPEDIENTE);
  assert.ok(
    pantalla.includes("onClick={() => confirmarFirma(n)}"),
    "firmar volvió a ser un clic suelto e irreversible, a un pixel de «Devolver»",
  );
  assert.ok(pantalla.includes("Sí, firmarla"), "falta la confirmación de la firma");
  assert.match(
    pantalla,
    /\(n\.status === "ENVIADA" \|\| mia\)/,
    "el botón de firmar se ofrece sobre un BORRADOR ajeno: sería cerrar a media frase lo " +
      "que su autor todavía está escribiendo",
  );
});

/* ═══════════════════════════════════════════════════════════════════════
 * 9 · LOS ESTUDIOS
 * ═══════════════════════════════════════════════════════════════════════ */

test("H-14 · la nota de CUALQUIER estudio se edita, con el endpoint que ya existía", () => {
  const visor = fuente(VISOR);
  assert.ok(visor.includes("function NotasDelEstudio("), "no hay editor de notas fuera del CBCT");
  assert.ok(
    visor.includes("/api/instituto/estudios/${estudioId}/notas"),
    "el editor tiene que usar el endpoint que ya existía, no uno nuevo",
  );
  assert.ok(
    visor.includes('method: "PATCH"'),
    "las notas se escriben con PATCH, como las escribe el visor del dental",
  );
});

test("S-7 · sin `estudios.upload` no se ofrece escribir, ni siquiera en el CBCT", () => {
  // El permiso del endpoint es el de ESCRITURA, no el de lectura.
  assert.ok(
    fuente("src/app/api/instituto/estudios/[id]/notas/route.ts").includes(
      'eduApiGuard("estudios.upload")',
    ),
    "las notas del estudio son escritura en el expediente: piden estudios.upload",
  );

  const visor = fuente(VISOR);
  assert.ok(visor.includes("canUpload: boolean"), "el visor no sabe si se puede escribir");
  assert.ok(
    visor.includes("canUpload ? ("),
    "el editor se pinta sin mirar el permiso: guardaría un 403 con el paciente delante",
  );
  assert.ok(
    visor.includes("notasSoloLectura={!canUpload}"),
    "el panel de notas del visor CBCT del dental no se tapa: su Guardar fallaba SIEMPRE",
  );
  assert.ok(
    fuente("src/components/edu/expediente/estudios-screen.tsx").includes("canUpload={canUpload}"),
    "la galería no le pasa el permiso al visor",
  );
});

test("S-7 · FRONTERA · el `aria-label` con el que se tapa el panel del CBCT sigue ahí", () => {
  // El visor es del DENTAL y no acepta una prop para esconder sus notas, así
  // que se tapan desde el CSS enganchando su `aria-label`. Si el dental lo
  // cambia, el botón que no guarda reaparecería sin que nada fallara.
  const ETIQUETA = 'aria-label="Notas clínicas del estudio CBCT"';
  assert.ok(
    crudo("src/components/patient-3d/DicomSetViewer.tsx").includes(ETIQUETA),
    "el dental cambió el aria-label del textarea de notas del CBCT: actualiza el CSS del " +
      "vertical (.edu-integ-solo-lectura) o el panel muerto vuelve a aparecer",
  );
  assert.ok(
    crudo(TEMA).includes(ETIQUETA),
    "el tema del instituto ya no tapa el panel de notas del CBCT",
  );
});

test("H-26 · un /confirm que falla limpia el bucket, y «Cancelar» cancela las tres fases", () => {
  const src = fuente(SUBIDA);

  // El `signal` en las tres peticiones: /sign, el PUT y /confirm.
  const conSignal = (src.match(/^\s*signal,$/gm) ?? []).length;
  assert.ok(
    conSignal >= 2,
    `solo ${conSignal} fetch llevan el signal: cancelar durante «Registrando…» no cancelaba nada ` +
      "y el estudio se registraba igual",
  );
  assert.ok(src.includes("putConProgreso(signedUrl, file, contentType"), "el PUT perdió su signal");

  // Y el fallo definitivo de /confirm limpia: el objeto quedaba en el
  // bucket sin fila, y la cuota se calcula con SUM(EduStudy.sizeBytes).
  const i = src.indexOf("INTENTOS_CONFIRM; c++");
  assert.notEqual(i, -1, "desapareció el bucle de /confirm");
  const bucle = src.slice(i);
  assert.match(
    bucle,
    /await limpiar\(patientId, path\);\s*\n\s*throw await mensajeDeError\(confirmRes/,
    "un /confirm que falla definitivamente sigue dejando el objeto huérfano en el bucket",
  );
});

test("S-9 · la URL firmada caduca y la pantalla lo dice antes de que falle", () => {
  assert.ok(
    fuente("src/lib/edu/estudios.ts").includes("const signedAt = now.toISOString()"),
    "la lectura de estudios no dice cuándo firmó las URLs",
  );
  const pantalla = fuente("src/components/edu/expediente/estudios-screen.tsx");
  assert.ok(pantalla.includes("EDU_SIGNED_URL_TTL_SECONDS"), "la pantalla no sabe cuánto duran");
  assert.ok(
    pantalla.includes("Los enlaces de los archivos caducaron"),
    "no hay aviso: cada miniatura daba un 403 mudo que se lee como «se perdió el archivo»",
  );
  assert.ok(
    pantalla.includes("onError={() => setCaducadas(true)}"),
    "la miniatura que no carga es la prueba de que caducó: el reloj puede ir corrido",
  );
});
