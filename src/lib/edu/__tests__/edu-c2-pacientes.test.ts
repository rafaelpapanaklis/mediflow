/**
 * OLA C·2 — LAS PANTALLAS DEL PACIENTE (WS2-T1).
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-c2-pacientes.test.ts
 *       (y entra sola en `npm run test:edu`, que descubre la carpeta)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ VIGILA ESTE ARCHIVO
 *
 * La C·base dejó los cores y las rutas; esta casilla los PINTA y los
 * CONECTA. Así que lo que hay que fijar aquí no son los píxeles, son las
 * conexiones que se pueden romper en silencio:
 *
 *   1. Cuestionario — que las CLAVES del formulario sean las que el
 *      servidor mira para encender banderas. Un singular de más y la
 *      bandera roja no se enciende, sin error y sin aviso.
 *   2. El DIFF entre versiones — solo lo que cambió, y ordenado como el
 *      formulario.
 *   3. Plan — que las partidas del tarifario sobrevivan al viaje por
 *      `description` y que el precio NUNCA llegue del cliente.
 *   4. Odontograma — que las TRES escrituras llamen al escritor de
 *      movimientos (N-3), y que no lo llamen cuando no escribieron nada.
 *   5. Bitácora — que el rango de fechas no pise el cursor, y que las
 *      escrituras del paciente y del expediente llamen a `eduAudit`.
 *   6. ARCO — que la lista de bajas exista y que las fichas dadas de baja
 *      salgan de la lista viva, del buscador y del desplegable de agendar.
 *   7. Recetas — que una ARCHIVADA salga de la lista viva.
 *   8. Las pantallas — que las dos pestañas nuevas estén declaradas y que
 *      cada lista nueva vaya envuelta en `.edu-tablewrap`.
 *
 * Las secciones puras se ejecutan sin base de datos. Las que leen el
 * FUENTE son la única forma de comprobar sin Postgres que una llamada está
 * PUESTA — el mismo truco que ya usan edu-rastro.test.ts y edu-caja.test.ts.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EDU_CUESTIONARIO_BLOQUES,
  EDU_CUESTIONARIO_CLAVES,
  eduCuestionarioDiff,
  eduCuestionarioEtiqueta,
  eduCuestionarioRiskFlags,
  eduCuestionarioTexto,
} from "../cuestionario-core";
import {
  EDU_PLAN_MAX_PARTIDAS,
  eduPlanDescripcionCon,
  eduPlanDescripcionHumana,
  eduPlanParseFechaHecha,
  eduPlanParsePartidasPedidas,
  eduPlanPartidasParaPresupuesto,
  eduPlanPartidasParse,
  eduPlanPartidasSerializar,
  eduPlanPartidasTotal,
} from "../plan-tratamiento-core";
import { eduAuditParseDia } from "../auditoria-core";
import { eduOdontoEventAccionAlMarcar } from "../odontograma-eventos-core";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const CUESTIONARIO = "src/lib/edu/cuestionario.ts";
const ODONTOGRAMA = "src/lib/edu/odontograma.ts";
const PACIENTES = "src/lib/edu/pacientes.ts";
const EXPEDIENTE = "src/lib/edu/expediente.ts";
const AUDITORIA = "src/lib/edu/auditoria.ts";
const ARCO = "src/lib/edu/arco.ts";
const FUSION = "src/lib/edu/fusion.ts";
const LAYOUT = "src/app/instituto/(panel)/pacientes/[id]/layout.tsx";
const BITACORA = "src/app/instituto/(panel)/direccion/bitacora/page.tsx";
const ARCO_PAGE = "src/app/instituto/(panel)/pacientes/arco/page.tsx";
const PLAN_SCREEN = "src/components/edu/expediente/plan-screen.tsx";
const RECETAS_SCREEN = "src/components/edu/recetas/recetas-screen.tsx";
const ODO_SCREEN = "src/components/edu/expediente/odontograma-screen.tsx";

/**
 * El fuente SIN comentarios.
 *
 * 🔴 HACE FALTA DE VERDAD: varias de las comprobaciones de abajo buscan una
 * forma que NO puede aparecer en el código —«esto pisaría el alcance»— y
 * los comentarios de este repo citan textualmente la forma prohibida para
 * explicar por qué lo es. Sin quitarlos, la prueba se dispara con su propia
 * documentación.
 */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * El trozo de fuente que va de una función a la SIGUIENTE declaración de
 * primer nivel.
 *
 * 🔴 SE CORTA POR `\nexport ` Y NO CONTANDO LLAVES, que es el mismo truco
 * que ya usa edu-rastro.test.ts. Contar llaves parece más limpio y no lo
 * es: una firma de varias líneas —o un parámetro desestructurado— tiene
 * llaves y paréntesis ANTES del cuerpo, y el contador arranca en el sitio
 * equivocado. Aquí lo que se comprueba es "esta llamada está PUESTA en
 * esta función", y para eso el trozo hasta la siguiente sobra.
 */
function cuerpoDe(src: string, nombre: string): string {
  let desde = src.indexOf(`export async function ${nombre}`);
  if (desde === -1) desde = src.indexOf(`export function ${nombre}`);
  if (desde === -1) desde = src.indexOf(`function ${nombre}`);
  assert.notEqual(desde, -1, `no se encontró ${nombre}: ¿la renombraron?`);
  const siguiente = src.indexOf("\nexport ", desde + 1);
  const hastaFn = src.indexOf("\nfunction ", desde + 1);
  const fin = [siguiente, hastaFn].filter((x) => x > 0).sort((a, b) => a - b)[0];
  return src.slice(desde, fin === undefined ? undefined : fin);
}

/* ═══════════════════════════════════════════════════════════════════════
 * 1 · EL CUESTIONARIO: las claves del formulario SON las del servidor
 * ═══════════════════════════════════════════════════════════════════════ */

test("🔴 cada clave que enciende una bandera está en el formulario", () => {
  // Las claves que `eduCuestionarioRiskFlags` mira, sacadas del FUENTE del
  // core y no de una lista escrita a mano aquí: una bandera nueva que se
  // añada mañana entra sola en esta prueba.
  const src = leer("src/lib/edu/cuestionario-core.ts");
  const cuerpo = cuerpoDe(src, "eduCuestionarioRiskFlags");
  const miradas = new Set<string>();
  for (const m of cuerpo.matchAll(/answers\.([A-Za-z0-9_]+)/g)) miradas.add(m[1]);

  assert.ok(miradas.size >= 8, `solo se detectaron ${miradas.size} claves miradas`);

  const faltan = [...miradas].filter((k) => !EDU_CUESTIONARIO_CLAVES.includes(k));
  assert.deepEqual(
    faltan.sort(),
    [],
    "el servidor mira estas claves y el formulario NO las pregunta: la bandera no se puede " +
      "encender nunca, sin error y sin aviso. Añádelas a EDU_CUESTIONARIO_BLOQUES:\n  · " +
      faltan.join("\n  · "),
  );
});

test("🔴 cada clave del merge a la ficha está en el formulario", () => {
  const src = leer("src/lib/edu/cuestionario-core.ts");
  const cuerpo = cuerpoDe(src, "eduCuestionarioMergeData");
  const miradas = new Set<string>();
  for (const m of cuerpo.matchAll(/answers\.([A-Za-z0-9_]+)/g)) miradas.add(m[1]);
  const faltan = [...miradas].filter((k) => !EDU_CUESTIONARIO_CLAVES.includes(k));
  assert.deepEqual(
    faltan.sort(),
    [],
    "el merge a la ficha lee estas claves y el formulario no las pregunta:\n  · " +
      faltan.join("\n  · "),
  );
});

test("las claves del formulario no se repiten entre bloques", () => {
  const vistas = new Set<string>();
  for (const clave of EDU_CUESTIONARIO_CLAVES) {
    assert.ok(!vistas.has(clave), `la clave "${clave}" está en dos bloques: una pisaría a la otra`);
    vistas.add(clave);
  }
  assert.ok(EDU_CUESTIONARIO_BLOQUES.length >= 4);
});

test("las banderas críticas del formulario coinciden con las que el servidor marca así", () => {
  // Marcadas `critica` en el formulario → tienen que encender una bandera
  // que el core considere crítica. Si no, la pantalla pinta un aviso rojo
  // que la ficha después no repite, y quien lo leyó cree que se le pasó.
  const criticas = EDU_CUESTIONARIO_BLOQUES.flatMap((b) =>
    b.preguntas.filter((p) => p.critica).map((p) => p.clave),
  );
  assert.deepEqual(
    criticas.sort(),
    ["alergiaFarmacos", "anticoagulantes", "bifosfonatos", "embarazo"],
    "cambió qué preguntas se pintan como críticas sin cambiar EDU_RISK_FLAGS_CRITICAS",
  );

  assert.deepEqual(eduCuestionarioRiskFlags({ anticoagulantes: "si" }), ["ANTICOAGULANTE"]);
  assert.deepEqual(eduCuestionarioRiskFlags({ bifosfonatos: true }), ["BIFOSFONATOS"]);
  // La alergia a un fármaco enciende DOS: la crítica va primera.
  assert.deepEqual(eduCuestionarioRiskFlags({ alergiaFarmacos: "penicilina" }), [
    "ALERGIA_FARMACO",
    "ALERGIA",
  ]);
});

/* ═══════════════════════════════════════════════════════════════════════
 * 2 · EL DIFF ENTRE VERSIONES
 * ═══════════════════════════════════════════════════════════════════════ */

test("el diff solo trae lo que CAMBIÓ", () => {
  const d = eduCuestionarioDiff(
    { anticoagulantes: true, diabetes: false, tabaco: "FRECUENTE" },
    { anticoagulantes: true, diabetes: true, tabaco: "FRECUENTE" },
  );
  assert.deepEqual(
    d.map((c) => c.clave),
    ["diabetes"],
  );
  assert.equal(d[0].antes, "Sí");
  assert.equal(d[0].despues, "No");
});

test("una pregunta que la versión nueva ya no trae TAMBIÉN es un cambio", () => {
  // Dejó de contestarse, y esconderlo haría que el diff dijera que no pasó
  // nada. Es la misma regla que el diff de la bitácora.
  const d = eduCuestionarioDiff({ diabetes: true }, { diabetes: true, alergias: "látex" });
  assert.deepEqual(
    d.map((c) => c.clave),
    ["alergias"],
  );
  assert.equal(d[0].antes, "látex");
  assert.equal(d[0].despues, "—");
});

test("el diff sale en el orden del formulario, no en el del JSON", () => {
  const d = eduCuestionarioDiff(
    { tipoSangre: "O+", anticoagulantes: true },
    { tipoSangre: "A+", anticoagulantes: false },
  );
  assert.deepEqual(
    d.map((c) => c.clave),
    ["anticoagulantes", "tipoSangre"],
    "el orden del formulario es la lectura: las críticas primero",
  );
});

test("una clave que la escuela añadió por su cuenta se pinta igual", () => {
  assert.equal(eduCuestionarioEtiqueta("preguntaDeLaEscuela"), "preguntaDeLaEscuela");
  assert.equal(eduCuestionarioTexto(["a", "b"]), "a, b");
  assert.equal(eduCuestionarioTexto(null), "—");
  assert.equal(eduCuestionarioTexto(false), "No");
});

/* ═══════════════════════════════════════════════════════════════════════
 * 3 · EL PLAN: partidas del tarifario
 * ═══════════════════════════════════════════════════════════════════════ */

test("🔴 las partidas sobreviven al viaje de ida y vuelta por `description`", () => {
  const partidas = [
    { name: "Resina simple", quantity: 3, unitPriceCents: 45000 },
    { name: "Endodoncia unirradicular", quantity: 1, unitPriceCents: 180000 },
  ];
  const desc = eduPlanDescripcionCon("Rehabilitación del cuadrante 1.", partidas);
  assert.ok(desc);
  assert.deepEqual(eduPlanPartidasParse(desc), partidas);
  assert.equal(eduPlanDescripcionHumana(desc), "Rehabilitación del cuadrante 1.");
  assert.equal(eduPlanPartidasTotal(partidas), 3 * 45000 + 180000);
});

test("un nombre con los separadores del formato no rompe el parser", () => {
  const bloque = eduPlanPartidasSerializar([
    { name: "Corona ×2 @ metal", quantity: 1, unitPriceCents: 100 },
  ]);
  const leidas = eduPlanPartidasParse(bloque);
  assert.equal(leidas.length, 1);
  assert.equal(leidas[0].quantity, 1);
  assert.equal(leidas[0].unitPriceCents, 100);
  assert.ok(!leidas[0].name.includes("×"), "los separadores se limpian al escribir");
});

test("una descripción sin bloque —o rota a mano— no lanza: devuelve []", () => {
  assert.deepEqual(eduPlanPartidasParse("Solo texto de una persona."), []);
  assert.deepEqual(eduPlanPartidasParse(null), []);
  assert.deepEqual(eduPlanPartidasParse("— Partidas del tarifario —\nbasura"), []);
});

test("🔴 convertir en presupuesto NUNCA sale vacío si el plan tiene importe", () => {
  const sinBloque = eduPlanPartidasParaPresupuesto({
    name: "Ortodoncia 18 meses",
    description: "se perdió el bloque",
    totalCents: 5000000,
  });
  assert.equal(sinBloque.length, 1);
  assert.equal(sinBloque[0].unitPriceCents, 5000000);
  assert.equal(sinBloque[0].quantity, 1);
});

test("🔴 las partidas que manda el cliente NO llevan precio", () => {
  const pedidas = eduPlanParsePartidasPedidas([
    { procedureId: "p1", quantity: 2, unitPriceCents: 1 },
    { procedureId: "p2" },
  ]);
  assert.deepEqual(pedidas, [
    { procedureId: "p1", quantity: 2 },
    { procedureId: "p2", quantity: 1 },
  ]);
  assert.ok(
    !JSON.stringify(pedidas).includes("unitPriceCents"),
    "un precio que llega del navegador es un precio que el navegador puede cambiar (regla (d))",
  );
});

test("el mismo procedimiento dos veces se SUMA en vez de rebotar", () => {
  const pedidas = eduPlanParsePartidasPedidas([
    { procedureId: "p1", quantity: 2 },
    { procedureId: "p1", quantity: 3 },
  ]);
  assert.deepEqual(pedidas, [{ procedureId: "p1", quantity: 5 }]);
});

test("las partidas tienen tope y las cantidades se validan", () => {
  assert.throws(
    () => eduPlanParsePartidasPedidas(new Array(EDU_PLAN_MAX_PARTIDAS + 1).fill({ procedureId: "p" })),
    /tope/,
  );
  assert.throws(() => eduPlanParsePartidasPedidas([{ procedureId: "p", quantity: 0 }]), /entero/);
  assert.throws(() => eduPlanParsePartidasPedidas([{ quantity: 1 }]), /procedimiento/);
  assert.deepEqual(eduPlanParsePartidasPedidas(undefined), []);
});

test("🔴 una sesión no se puede marcar como hecha EN EL FUTURO", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");
  assert.throws(
    () => eduPlanParseFechaHecha("2026-09-09T12:00:00.000Z", now),
    /todavía no ha pasado/,
    "marcar como hecha una sesión que no pasó es escribir un acto que no ocurrió, y el avance " +
      "del plan lo daría por bueno",
  );
  assert.equal(eduPlanParseFechaHecha("", now), null);
  assert.equal(eduPlanParseFechaHecha(undefined, now), null);
  const ayer = eduPlanParseFechaHecha("2026-09-06T12:00:00.000Z", now);
  assert.equal(ayer?.toISOString(), "2026-09-06T12:00:00.000Z");
  // Un minuto de margen para el desfase entre el reloj del navegador y el
  // del servidor: sin él, «hoy» falla la mitad de las veces.
  assert.ok(eduPlanParseFechaHecha("2026-09-07T12:00:30.000Z", now));
});

/* ═══════════════════════════════════════════════════════════════════════
 * 4 · EL ODONTOGRAMA: las tres escrituras escriben su movimiento (N-3)
 * ═══════════════════════════════════════════════════════════════════════ */

test("🔴 las TRES escrituras del odontograma llaman a eduOdontoEvent", () => {
  const src = leer(ODONTOGRAMA);
  for (const fn of ["setEduOdontogramFinding", "clearEduOdontogramTooth", "setEduOdontogramNote"]) {
    const cuerpo = cuerpoDe(src, fn);
    assert.match(
      cuerpo,
      /eduOdontoEvent\(/,
      `${fn} escribe el odontograma y NO deja renglón en el libro de movimientos: el historial ` +
        "vuelve a ser una fila por hallazgo y N-3 se reabre",
    );
    assert.match(
      cuerpo,
      /prisma\.\$transaction\(/,
      `${fn} escribe el movimiento FUERA de la transacción del hallazgo: entre las dos hay una ` +
        "ventana en la que el hallazgo entra y su renglón no",
    );
  }
});

test("🔴 el movimiento va DENTRO de la transacción, con la `tx`", () => {
  const src = leer(ODONTOGRAMA);
  const llamadas = [...src.matchAll(/eduOdontoEvent\(\s*ctx,[\s\S]*?\n\s{6,}tx,\n\s*\);/g)];
  assert.ok(
    llamadas.length >= 4,
    `solo ${llamadas.length} llamadas a eduOdontoEvent pasan la \`tx\`: con el prisma global el ` +
      "movimiento y el hallazgo dejan de entrar juntos",
  );
});

test("🔴 no se escribe un «lo quitó» cuando no se quitó nada", () => {
  const src = leer(ODONTOGRAMA);
  const cuerpo = cuerpoDe(src, "setEduOdontogramFinding");
  assert.match(
    cuerpo,
    /if \(count > 0 && previa\)/,
    "quitar dos veces (un doble clic, una pestaña vieja) escribiría un acto que no ocurrió",
  );
});

test("MARCA, REVIVE y EDITA se siguen distinguiendo", () => {
  assert.equal(eduOdontoEventAccionAlMarcar(null), "MARCA");
  assert.equal(eduOdontoEventAccionAlMarcar({ deletedAt: new Date() }), "REVIVE");
  assert.equal(eduOdontoEventAccionAlMarcar({ deletedAt: null }), "EDITA");
});

test("la pantalla del odontograma lee los MOVIMIENTOS, no solo las filas", () => {
  const src = leer(ODO_SCREEN);
  assert.match(src, /movimientos: EduOdontoEventRow\[\]/, "la pantalla no recibe el libro");
  assert.match(src, /function LibroDeMovimientos\(/);
  // 🔴 EL RÓTULO YA NO PROMETE LO QUE UNA FILA POR HALLAZGO NO PUEDE DAR.
  assert.ok(
    !/quitar no borra, deja escrito quién lo quitó y cuándo/.test(src),
    "el rótulo viejo prometía la FECHA de un retiro que se remarcó, y esa fecha no está en la " +
      "fila: `deletedAt` es justo la columna que hay que soltar para revivirla",
  );
  assert.match(
    src,
    /queda escrito quién lo quitó Y CUÁNDO/,
    "el rótulo nuevo se apoya en el libro de movimientos, donde la fecha SÍ está",
  );
});

/* ═══════════════════════════════════════════════════════════════════════
 * 5 · LA BITÁCORA
 * ═══════════════════════════════════════════════════════════════════════ */

test("el día del filtro se traduce a un rango, y «hasta» incluye el día entero", () => {
  assert.equal(eduAuditParseDia("2026-09-07")?.toISOString(), "2026-09-07T00:00:00.000Z");
  assert.equal(
    eduAuditParseDia("2026-09-07", true)?.toISOString(),
    "2026-09-08T00:00:00.000Z",
    "un `lte` sobre las 00:00 del día se comería el día completo: es el error clásico de este filtro",
  );
  assert.equal(eduAuditParseDia("07/09/2026"), null);
  assert.equal(eduAuditParseDia(""), null);
  assert.equal(eduAuditParseDia(null), null);
});

test("🔴 el rango de fechas NO pisa el cursor de la paginación", () => {
  const cuerpo = cuerpoDe(leer(AUDITORIA), "listEduAuditLog");
  assert.match(
    cuerpo,
    /where\.AND = \[/,
    "el rango entra por AND: escrito como `where.createdAt` pisaría el OR del cursor y el " +
      "paginador saltaría a la primera página al filtrar por fecha, sin error y sin pista",
  );
  assert.match(cuerpo, /where\.OR = \[/, "el cursor sigue expresándose con un OR");
});

test("🔴 las escrituras del PACIENTE dejan renglón en la bitácora", () => {
  const src = leer(PACIENTES);
  for (const fn of [
    "createEduPatient",
    "updateEduPatient",
    "setEduPatientOrigin",
    "updateEduPatientAntecedentes",
  ]) {
    assert.match(
      cuerpoDe(src, fn),
      /eduAudit\(/,
      `${fn} escribe la ficha y no deja renglón: "no hay renglón" y "no pasó" se ven igual desde fuera`,
    );
  }
});

test("🔴 la bitácora del paciente NO copia su PII", () => {
  const src = leer(PACIENTES);
  const cuerpo = cuerpoDe(src, "updateEduPatient");
  // Los campos que SÍ se comparan están escritos como una lista cerrada.
  assert.match(cuerpo, /const mirados = \[/);
  for (const prohibido of ["addressStreet", "guardianPhone", "insurancePolicy", "notes"]) {
    assert.ok(
      !new RegExp(`mirados[\\s\\S]{0,200}"${prohibido}"`).test(cuerpo),
      `${prohibido} entraría a la bitácora, de la que la anonimización ARCO no lo puede sacar`,
    );
  }
});

test("🔴 las escrituras del EXPEDIENTE dejan renglón, y firmar es `sign`", () => {
  const src = leer(EXPEDIENTE);
  for (const fn of ["createEduRecord", "updateEduRecord", "withdrawEduRecord"]) {
    assert.match(cuerpoDe(src, fn), /eduAudit\(/, `${fn} no deja renglón`);
  }
  assert.match(
    cuerpoDe(src, "updateEduRecord"),
    /=== "FIRMADA"[\s\S]{0,80}\? "sign"/,
    "firmar y editar son dos actos distintos: «¿quién firmó esta nota?» no es «¿quién la editó?»",
  );
});

test("🔴 la LECTURA del expediente se registra (NOM-024 §6.3.5)", () => {
  const src = leer(EXPEDIENTE);
  assert.match(src, /export async function registrarEduLecturaExpediente\(/);
  assert.match(cuerpoDe(src, "registrarEduLecturaExpediente"), /action: "view"/);

  const page = leer("src/app/instituto/(panel)/pacientes/[id]/expediente/page.tsx");
  assert.match(
    page,
    /registrarEduLecturaExpediente\(/,
    "la pantalla que ABRE el expediente no registra el acceso, que es justo lo que la norma pide",
  );
});

test("la bitácora se puede leer sin JavaScript y filtra por los cinco campos", () => {
  const src = leer(BITACORA);
  // La directiva solo cuenta en la PRIMERA línea del archivo: en un
  // comentario es prosa, y aquí hay prosa que la nombra a propósito.
  assert.ok(
    !src.split("\n")[0].includes("use client"),
    "la bitácora se volvió un componente cliente: pierde el enlace compartible y el filtro sin JS",
  );
  assert.match(src, /method="get"/);
  for (const campo of ["actorUserId", "action", "entity", "desde", "hasta"]) {
    assert.match(src, new RegExp(`name="${campo}"`), `falta el filtro ${campo}`);
  }
  assert.match(src, /name="patientId"/, "el filtro por paciente se conserva al cambiar otro");
  assert.match(src, /cursor: page\.nextCursor/, "no se pagina por cursor");
});

/* ═══════════════════════════════════════════════════════════════════════
 * 6 · ARCO Y FUSIÓN
 * ═══════════════════════════════════════════════════════════════════════ */

test("🔴 una ficha dada de baja sale de la LISTA, del BUSCADOR y del CSV", () => {
  const src = leer(PACIENTES);
  assert.match(
    cuerpoDe(src, "patientsWhere"),
    /where\.deletedAt = null;/,
    "sin esto la ficha seguiría saliendo al teclear el apellido de quien pidió que dejara de salir",
  );
});

test("🔴 y del desplegable de AGENDAR, junto con las fusionadas (H-05)", () => {
  const cuerpo = cuerpoDe(leer(PACIENTES), "listEduPatientOptions");
  assert.match(cuerpo, /where\.status = \{ not: "INACTIVE" \};/);
  assert.match(cuerpo, /where\.deletedAt = null;/);
  assert.match(
    cuerpo,
    /where\.mergedIntoId = null;/,
    "al duplicado que se acaba de fusionar se le podría seguir agendando cita",
  );
});

test("🔴 `getEduPatient` SÍ encuentra una ficha dada de baja", () => {
  // Es lo que permite reactivarla y lo que permite que el perdedor de una
  // fusión pueda redirigir. Un 404 ahí dejaría la baja sin marcha atrás.
  const cuerpo = cuerpoDe(leer(PACIENTES), "getEduPatient");
  assert.ok(
    !/deletedAt/.test(cuerpo),
    "getEduPatient filtró las bajas: entonces una baja no se puede deshacer desde ninguna pantalla",
  );
});

test("la ficha del perdedor de una fusión REDIRIGE a la ganadora, con aviso", () => {
  const src = leer(LAYOUT);
  assert.match(src, /if \(paciente\.mergedIntoId\) \{/);
  assert.match(src, /fusionadaDe=/, "sin el aviso, quien tecleó el folio viejo aterriza sin saber por qué");
  const arco = leer("src/components/edu/expediente/paciente-arco.tsx");
  assert.match(arco, /sp\.get\("fusionadaDe"\)/);
  assert.match(arco, /sp\.delete\("fusionadaDe"\)/, "el parámetro se limpia de la barra");
});

test("la anonimización pide DOBLE confirmación y teclear el folio", () => {
  const src = leer("src/components/edu/expediente/paciente-arco.tsx");
  assert.match(src, /folioTecleado\.trim\(\) !== props\.folio/);
  assert.match(src, /setPaso2\(true\)/, "el primer paso solo continúa; no anonimiza");
  assert.match(
    src,
    /Antes de anonimizar hay que dar de baja la ficha/,
    "el botón deshabilitado tiene que decir POR QUÉ y qué falta",
  );
});

test("la previsualización de la fusión recorre las MISMAS ocho tablas", () => {
  const cuerpo = cuerpoDe(leer(FUSION), "previsualizarEduFusion");
  assert.match(
    cuerpo,
    /EDU_FUSION_TABLAS/,
    "una lista copiada aquí es la que se queda sin la tabla que la ola siguiente añada",
  );
  assert.ok(!/updateMany|\.create\(/.test(cuerpo), "la previsualización no escribe nada");
  // El pooler: menos de siete consultas por tanda (CLAUDE.md).
  assert.match(cuerpo, /slice\(i, i \+ 6\)/);
});

test("🔴 el listado de bajas NO pisa el `OR` con el que se expresa el alcance", () => {
  // `eduPatientScopeWhere` expresa el alcance de un ALUMNO y el de un
  // DOCENTE con un `OR` de primer nivel. Un `{ ...base, OR: … }` aquí lo
  // borraría entero y la pantalla enseñaría las fichas dadas de baja de
  // toda la escuela. Hoy no explota —las dos llaves de ARCO solo las lleva
  // DIRECCION, cuyo alcance es `all`— pero `permissionsOverride` es
  // editable, y un candado que solo aguanta mientras nadie toque el
  // catálogo de permisos no es un candado.
  const cuerpo = sinComentarios(cuerpoDe(leer(ARCO), "listEduPatientsArco"));
  assert.ok(
    !/\.\.\.[A-Za-z]+,\s*OR:/.test(cuerpo) && !/\bwhere\.OR\s*=/.test(cuerpo),
    "el `where` del listado ARCO vuelve a pisar el OR del alcance",
  );
  assert.match(cuerpo, /where\.AND = and;/, "las condiciones tienen que entrar por AND");
  assert.match(cuerpo, /const and: Prisma\.EduPatientWhereInput\[\] = \[\{ OR: condiciones \}\];/);
});

test("el listado de bajas distingue los TRES estados", () => {
  const cuerpo = cuerpoDe(leer(ARCO), "listEduPatientsArco");
  assert.match(cuerpo, /anonymizedAt: \{ not: null \}/);
  assert.match(cuerpo, /mergedIntoId: \{ not: null \}/);
  assert.match(
    cuerpo,
    /deletedAt: \{ not: null \}, anonymizedAt: null, mergedIntoId: null/,
    "sin distinguirlas, «Dados de baja» ofrecería reactivar una ficha cuyo expediente ya está en otra parte",
  );
  const page = leer(ARCO_PAGE);
  assert.match(page, /pacientes\.manage/);
  assert.match(page, /direccion\.panel/, "el listado pide las DOS llaves");
});

/* ═══════════════════════════════════════════════════════════════════════
 * 7 · RECETAS Y NOTAS
 * ═══════════════════════════════════════════════════════════════════════ */

test("🔴 una receta ARCHIVADA sale de la lista viva", () => {
  const src = leer(RECETAS_SCREEN);
  assert.match(src, /rows\.filter\(\(r\) => r\.status !== "ARCHIVADA"\)/);
  assert.match(src, /rows\.filter\(\(r\) => r\.status === "ARCHIVADA"\)/);
  assert.match(src, /vivas\.map\(tarjeta\)/, "la lista viva sigue pintando `rows` entero");
  assert.match(src, /recetas\/\$\{row\.id\}\/archivar/);
});

test("archivar pide `recetas.propose`, no `recetas.void`", () => {
  const src = leer(RECETAS_SCREEN);
  assert.match(
    src,
    /row\.archivable && canPropose/,
    "obligar a un docente a archivar los rechazos de sus alumnos convierte un gesto de limpieza " +
      "en un trámite",
  );
});

test("🔴 retirar una nota guarda el motivo, y el motivo SE LEE", () => {
  const src = leer(EXPEDIENTE);
  assert.match(
    cuerpoDe(src, "withdrawEduRecord"),
    /deleteReason: reason/,
    "la columna llegó con el SQL de la Ola C y seguiría sin escribirse",
  );
  assert.match(src, /export async function listEduPatientRecordsRetiradas\(/);
  const pantalla = leer("src/components/edu/expediente/expediente-screen.tsx");
  assert.match(pantalla, /<EduRetirados/, "un motivo que ninguna pantalla enseña no es una constancia (N-16)");
});

test("el QUÉ de una nota retirada NO es su texto clínico", () => {
  const cuerpo = cuerpoDe(leer(EXPEDIENTE), "listEduPatientRecordsRetiradas");
  for (const campo of ["subjetivo", "objetivo", "analisis", "plan:", "diagnostico"]) {
    assert.ok(
      !cuerpo.includes(`${campo} true`) && !cuerpo.includes(`${campo}: true`),
      `la sección «Retiradas» la ve todo el que ve el expediente: ${campo} no tiene por qué viajar`,
    );
  }
});

/* ═══════════════════════════════════════════════════════════════════════
 * 8 · LAS PANTALLAS
 * ═══════════════════════════════════════════════════════════════════════ */

test("las dos pestañas nuevas están declaradas y piden expediente.view", () => {
  const src = leer(LAYOUT);
  for (const clave of ["salud", "plan"]) {
    const i = src.indexOf(`key: "${clave}"`);
    assert.notEqual(i, -1, `falta la pestaña "${clave}" en el layout de la ficha`);
    const tras = src.slice(i, i + 400);
    assert.match(
      tras,
      /permission: "expediente\.view"/,
      `la pestaña "${clave}" no exige expediente.view: CAJA vería los antecedentes médicos de ` +
        "toda la escuela",
    );
  }
});

test("las banderas de riesgo suben a la cabecera, y NO para caja", () => {
  const src = leer(LAYOUT);
  assert.match(src, /getEduRiskFlagsVigentes\(/);
  assert.match(
    src,
    /hasEduPermission\(permUser, "expediente\.view"\) &&\s*!eduScopeIsEmpty\(eduClinicalScope\(ctx\)\)/,
    "sin el alcance clínico, caja leería las banderas del cuestionario de toda la escuela",
  );
  assert.match(src, /EDU_RISK_FLAG_LABELS\[f\]/);
});

test("cada lista nueva va envuelta en `.edu-tablewrap` (regla 2 y 4)", () => {
  for (const rel of [ARCO_PAGE, BITACORA, "src/components/edu/expediente/cuestionario-screen.tsx"]) {
    const src = leer(rel);
    const tablas = (src.match(/className="edu-table"/g) ?? []).length;
    const envueltas = (
      src.match(/<div className="edu-tablewrap">\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<div className="edu-table"/g) ?? []
    ).length;
    assert.equal(
      envueltas,
      tablas,
      `${rel}: una lista sin envoltorio no tiene contenedor que medir, así que no se desplaza y ` +
        "recorta datos en silencio",
    );
  }
});

test("el plan esconde el DINERO de quien no lo puede ver", () => {
  const page = leer("src/app/instituto/(panel)/pacientes/[id]/plan/page.tsx");
  assert.match(
    page,
    /partidas: veDinero \? p\.partidas : \[\]/,
    "las partidas llevan el precio dentro: mandarlas y esconderlas en el JSX las deja en el payload RSC",
  );
  assert.match(page, /totalCents: veDinero \? p\.totalCents : 0/);
  assert.match(
    page,
    /veDinero \? getEduTarifaDePaciente\(/,
    "getEduTarifaDePaciente LANZA 403 sin el alcance del dinero: tumbaría la pestaña de un docente",
  );
  const screen = leer(PLAN_SCREEN);
  assert.match(screen, /props\.canPresupuestar/, "convertir en presupuesto es armar dinero");
});

test("el cuestionario se guarda como VERSIÓN NUEVA, nunca con un PUT", () => {
  const screen = leer("src/components/edu/expediente/cuestionario-screen.tsx");
  assert.match(screen, /method: "POST"/);
  assert.ok(
    !/method: "P(UT|ATCH)"/.test(screen),
    "un update deja sin respuesta «¿qué contestó ANTES de la extracción?» para siempre",
  );
  // Las banderas NO se calculan en el navegador.
  assert.ok(
    !/eduCuestionarioRiskFlags\(/.test(screen),
    "una bandera que calcula el navegador es una bandera que el navegador puede no calcular",
  );
});

test("la lectura del cuestionario queda registrada y la de la cabecera NO", () => {
  const src = leer(CUESTIONARIO);
  assert.match(cuerpoDe(src, "listEduCuestionarios"), /action: "view"/);
  assert.ok(
    !/eduAudit\(/.test(cuerpoDe(src, "getEduRiskFlagsVigentes")),
    "la cabecera se pinta en las catorce pestañas: un renglón por navegación ahogaría los " +
      "accesos de verdad, que son los que la norma quiere poder leer",
  );
});
