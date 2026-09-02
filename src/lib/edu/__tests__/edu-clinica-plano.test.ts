/**
 * EL PLANO DE LA CLÍNICA (/instituto/clinica) — el piso, no la lista.
 *
 * Run:  npm run test:edu
 *       npx tsx --test src/lib/edu/__tests__/edu-clinica-plano.test.ts
 *
 * Lo que fija este archivo, en orden:
 *   1. EL PLANO AUTOMÁTICO. Una sede que nunca pasó por el editor tiene que
 *      pintarse igual, con TODOS sus sillones y cada uno ligado a su unidad.
 *      Si esto se rompe, la pantalla se estrena vacía el día de la venta.
 *   2. LA LIGA SILLÓN↔EduChair DE LA MISMA SEDE. El número del sillón es
 *      único dentro de la SEDE (Ola 11): el "Sillón 1" del campus norte y el
 *      del sur son unidades distintas con el mismo número pintado. Sin esta
 *      comprobación, el plano del norte pintaría en vivo al paciente que
 *      está sentado a trescientos kilómetros.
 *   3. EL ESTADO POR SILLÓN que se le pasa al mundo 3D: quién se dibuja,
 *      qué nombre flota, qué color y —sobre todo— qué NO viaja.
 *   4. LOS 403. ALUMNO y CAJA no entran ni con la casilla encendida, y el
 *      editor pide una key aparte que solo lleva dirección.
 *   5. EL ARCHIVO DEL DENTAL. Se le añadió UNA prop opcional; esta prueba
 *      exige que siga siendo opcional y que NINGÚN llamador del dental la
 *      pase — que es la única forma mecánica de decir "allá no cambió nada".
 *
 * ⚠️ Las horas del ESTADO se construyen como `Date.now() + offset` y no con
 * un instante fijo: el motor del dental cambia de criterio si el `viewTime`
 * se aleja más de 90 s del reloj. Es la misma razón que en
 * edu-clinica-viva.test.ts. Las del HORARIO, al revés, van con un instante
 * FIJO — no pasan por el motor y sí se recortan por el día de calendario de
 * la sede, así que un `Date.now()` a las once de la noche las rompería una
 * vez al día (probado: pasó al escribir este archivo). Ver su nota.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDU_PLANO_GRID_MAX,
  EDU_PLANO_MAX_ELEMENTOS,
  EDU_PLANO_TIPO_SILLON,
  eduPlanoAuto,
  eduPlanoEsSillon,
  eduPlanoEstado3D,
  eduPlanoMetadata,
  eduPlanoRevision,
  eduPlanoValidar,
  type EduPlanoChair,
} from "../plano-core";
import {
  buildEduVivaBoard,
  eduVivaHorario,
  type EduVivaApptInput,
  type EduVivaCard,
  type EduVivaChairInput,
} from "../clinica-viva-core";
import { eduLiveFloorVisibility, eduScopeIsEmpty } from "../visibility";
import {
  EDU_ALL_PERMISSIONS,
  EDU_PERMISSION_GROUPS,
  EDU_ROLE_DEFAULTS,
  hasEduPermission,
} from "../permissions";
import type { EduRole } from "../types";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const fuente = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const RUTA_ESTADO = "src/app/api/instituto/clinica/3d-state/route.ts";
const RUTA_PLANO = "src/app/api/instituto/clinica/plano/route.ts";
const RUTA_PAGINA_EDITOR = "src/app/instituto/(panel)/clinica/plano/page.tsx";
const DENTAL = "src/components/clinic-3d/Clinic3DClient.tsx";
const DENTAL_HUD = "src/components/clinic-3d/Clinic3DHud.tsx";
const DENTAL_CAPA = "src/components/clinic-3d/live-layer.ts";

const SILLONES: EduPlanoChair[] = [
  { id: "ch_1", name: "Sillón 1", number: 1 },
  { id: "ch_2", name: "Sillón 2", number: 2 },
  { id: "ch_3", name: "Sillón 3", number: 3 },
];

// ═════════════════════════════════════════════════════════════════════
// 1 · EL PLANO AUTOMÁTICO
// ═════════════════════════════════════════════════════════════════════

test("🔴 sin plano guardado, la sede se pinta igual: TODOS sus sillones, cada uno ligado", () => {
  const plano = eduPlanoAuto(SILLONES);

  assert.equal(plano.auto, true, "el automático tiene que decir que lo es");
  assert.equal(plano.savedAtISO, null);

  const sillones = plano.elements.filter((e) => e.type === EDU_PLANO_TIPO_SILLON);
  assert.equal(sillones.length, SILLONES.length, "falta algún sillón en el plano automático");

  const ligados = sillones.map((e) => e.resourceId).sort();
  assert.deepEqual(ligados, ["ch_1", "ch_2", "ch_3"], "un sillón automático sin ligar no se pinta en vivo");

  // Cada elemento tiene su id propio: el mundo 3D los usa como clave.
  const ids = new Set(plano.elements.map((e) => e.id));
  assert.equal(ids.size, plano.elements.length, "hay ids repetidos en el plano automático");

  // El nombre viaja para que el editor lo lea sin ir a la base.
  assert.equal(sillones[0].name, "Sillón 1");
});

test("el automático arma una SALA (paredes y una puerta), no sillones flotando", () => {
  const plano = eduPlanoAuto(SILLONES);
  const tipos = new Set(plano.elements.map((e) => e.type));

  assert.ok(tipos.has("wall_h"), "sin paredes el mundo 3D no tiene contorno");
  assert.ok(tipos.has("wall_v"));
  assert.ok(tipos.has("puerta"), "sin puerta, el visor aparece en una esquina cualquiera");

  const grid = plano.metadata.gridSize;
  assert.ok(grid, "el automático tiene que declarar el tamaño de la rejilla");
  assert.ok(grid!.cols >= 12 && grid!.cols <= EDU_PLANO_GRID_MAX);
  assert.ok(grid!.rows >= 12 && grid!.rows <= EDU_PLANO_GRID_MAX);

  // Todo lo dibujado cae DENTRO de la rejilla declarada: lo que se sale, el
  // parser del mundo 3D lo descarta en silencio.
  for (const el of plano.elements) {
    assert.ok(el.col >= 0 && el.col < grid!.cols, `elemento fuera de la rejilla: col ${el.col}`);
    assert.ok(el.row >= 0 && el.row < grid!.rows, `elemento fuera de la rejilla: row ${el.row}`);
  }
});

test("el automático aguanta 32 sillones (el volumen del cliente que viene) y ninguno se pisa", () => {
  const muchos: EduPlanoChair[] = Array.from({ length: 32 }, (_, i) => ({
    id: `ch_${i + 1}`,
    name: `Sillón ${i + 1}`,
    number: i + 1,
  }));
  const plano = eduPlanoAuto(muchos);

  const sillones = plano.elements.filter((e) => e.type === EDU_PLANO_TIPO_SILLON);
  assert.equal(sillones.length, 32);

  const celdas = new Set(sillones.map((e) => `${e.col}:${e.row}`));
  assert.equal(celdas.size, 32, "dos sillones automáticos cayeron en la misma celda");
  assert.ok(plano.elements.length <= EDU_PLANO_MAX_ELEMENTOS, "el automático se pasa del tope");
});

test("una sede SIN sillones no revienta: sala vacía y cero elementos de sillón", () => {
  const plano = eduPlanoAuto([]);
  assert.equal(plano.elements.filter((e) => e.type === EDU_PLANO_TIPO_SILLON).length, 0);
  assert.ok(plano.elements.length > 0, "aun sin sillones se dibujan las paredes");
});

// ═════════════════════════════════════════════════════════════════════
// 2 · LA LIGA: EL SILLÓN TIENE QUE SER DE ESTA SEDE
// ═════════════════════════════════════════════════════════════════════

test("🔴 un sillón de OTRA sede se rechaza al guardar", () => {
  const elements = [
    { id: 1, type: "sillon", col: 3, row: 3, rotation: 0, resourceId: "ch_de_otra_sede", name: null },
  ];
  const v = eduPlanoValidar({ elements, chairIds: ["ch_1", "ch_2"] });

  assert.equal(v.ok, false, "aceptó ligar una unidad que no es de esta sede");
  assert.ok(v.error && /sede/i.test(v.error), "el motivo tiene que hablar de la sede");
});

test("🔴 dos elementos ligados al MISMO sillón se rechazan", () => {
  const elements = [
    { id: 1, type: "sillon", col: 3, row: 3, rotation: 0, resourceId: "ch_1", name: null },
    { id: 2, type: "sillon", col: 9, row: 3, rotation: 0, resourceId: "ch_1", name: null },
  ];
  const v = eduPlanoValidar({ elements, chairIds: ["ch_1", "ch_2"] });

  // El mundo 3D crea UN ancla por resourceId: el segundo pisaría al primero
  // y una de las dos unidades se quedaría muda para siempre.
  assert.equal(v.ok, false, "aceptó dos dibujos de la misma unidad");
  assert.ok(v.error && /misma unidad/i.test(v.error));
});

test("un sillón SIN ligar se acepta (se dibuja primero y se liga después) y se marca", () => {
  const elements = [
    { id: 1, type: "sillon", col: 3, row: 3, rotation: 0, resourceId: null, name: null },
    { id: 2, type: "sillon", col: 9, row: 3, rotation: 0, resourceId: "ch_1", name: null },
  ];
  const v = eduPlanoValidar({ elements, chairIds: ["ch_1", "ch_2"] });
  assert.equal(v.ok, true, "no se puede obligar a ligar todo antes de guardar nada");
  assert.equal(v.error, null);

  const rev = eduPlanoRevision(v.elements, SILLONES);
  assert.deepEqual(rev.sinLigar, [1], "el sillón suelto tiene que salir marcado");
  assert.equal(rev.ligados, 1);
  assert.deepEqual(
    rev.sinDibujar.map((c) => c.id),
    ["ch_2", "ch_3"],
    "los sillones que faltan en el plano tienen que listarse",
  );
});

test("un sillón que se dio de baja DESPUÉS de dibujarlo sale como colgante, no rompe el guardado", () => {
  const elements = [
    { id: 1, type: "sillon", col: 3, row: 3, rotation: 0, resourceId: "ch_borrado", name: "Sillón 9" },
  ];
  // La LECTURA lo marca…
  const rev = eduPlanoRevision(elements, SILLONES);
  assert.deepEqual(rev.colgantes, [{ elementId: 1, resourceId: "ch_borrado" }]);

  // …y la ESCRITURA lo acepta si la unidad sigue existiendo en la sede
  // aunque esté inactiva: si no, el plano quedaría imposible de guardar
  // justo cuando hay que arreglarlo.
  const v = eduPlanoValidar({ elements, chairIds: ["ch_borrado"] });
  assert.equal(v.ok, true);
});

test("el saneo del dental descarta basura en vez de reventar, y el tope de elementos corta", () => {
  const v = eduPlanoValidar({
    elements: [
      { id: 1, type: "sillon", col: 2, row: 2, rotation: 0, resourceId: "ch_1" },
      { id: 2, type: "", col: 3, row: 3 }, // sin tipo → se descarta
      { type: "planta", col: "no", row: 4 }, // col no numérica → se descarta
      null,
      "esto no es un elemento",
    ],
    chairIds: ["ch_1"],
  });
  assert.equal(v.ok, true);
  assert.equal(v.elements.length, 1, "el saneo dejó pasar algo malformado");

  const demasiados = Array.from({ length: EDU_PLANO_MAX_ELEMENTOS + 1 }, (_, i) => ({
    id: i + 1,
    type: "planta",
    col: 1,
    row: 1,
    rotation: 0,
  }));
  const tope = eduPlanoValidar({ elements: demasiados, chairIds: [] });
  assert.equal(tope.ok, false, "un plano de veinte megas entraría en la columna");
});

test("la rejilla se acota al tope que sabe dibujar el mundo 3D", () => {
  const m = eduPlanoMetadata({ gridSize: { cols: 5_000, rows: 3 } });
  assert.equal(m.gridSize?.cols, EDU_PLANO_GRID_MAX, "una rejilla enorme se recorta en silencio");
  assert.ok((m.gridSize?.rows ?? 0) >= 12, "una rejilla ridícula deja el plano sin sitio");
});

test("«qué es un sillón» lo contesta el catálogo del dental, no una lista escrita aquí", () => {
  assert.equal(eduPlanoEsSillon("sillon"), true);
  assert.equal(eduPlanoEsSillon("lavabo"), false);
  assert.equal(eduPlanoEsSillon("wall_h"), false);
});

// ═════════════════════════════════════════════════════════════════════
// 3 · EL ESTADO QUE SE LE PASA AL MUNDO 3D
// ═════════════════════════════════════════════════════════════════════

const min = (m: number) => new Date(Date.now() + m * 60_000);

const SEDE: EduVivaChairInput = {
  id: "ch_1",
  name: "Sillón 1",
  number: 1,
  campusId: "sede_norte",
  campusName: "Campus Norte",
  campusTimezone: "America/Mexico_City",
};

function cita(over: Partial<EduVivaApptInput> = {}): EduVivaApptInput {
  return {
    id: "appt_1",
    chairId: "ch_1",
    startsAt: min(-20),
    endsAt: min(40),
    status: "IN_PROGRESS",
    patientName: "María González Ruiz",
    patientFolio: "P-0007",
    studentName: "Ana Pérez",
    studentMatricula: "A-01",
    specialty: "Endodoncia",
    specialtyId: "prog_endo",
    patientId: "pat_1",
    caseLabel: "Endodoncia unirradicular · En tratamiento",
    supervisor: "Luis Ramírez",
    detail: true,
    ...over,
  };
}

function tarjetas(appts: EduVivaApptInput[], chairs: EduVivaChairInput[] = [SEDE]): EduVivaCard[] {
  return buildEduVivaBoard({ chairs, appointments: appts, now: new Date() }).cards;
}

test("🔴 un sillón OCUPADO manda los DOS nombres al mundo: paciente y quien lo atiende", () => {
  const [estado] = eduPlanoEstado3D(tarjetas([cita()]));

  assert.equal(estado.status, "ocupado");
  assert.equal(estado.patientName, "María González Ruiz");
  assert.equal(estado.doctorName, "Ana Pérez", "sin esto no se dibuja la figura del estudiante");
  assert.ok(estado.appointmentStartsAt, "sin inicio no hay barra de progreso");
  assert.ok(estado.appointmentEndsAt, "la placa flotante escribe «termina HH:MM» con esto");
  // El INSTANTE, no la etiqueta: con "11:30" el visor pinta una fecha inválida.
  assert.ok(!Number.isNaN(Date.parse(estado.appointmentEndsAt!)));
});

test("🔴 el id del paciente NO viaja en el estado del mundo", () => {
  const [estado] = eduPlanoEstado3D(tarjetas([cita()]));
  // El mundo es un JSON que sale al navegador cada veinte segundos para los
  // treinta sillones. El id solo hace falta cuando alguien clica una figura,
  // y para eso la pantalla usa el tablero del mismo payload.
  assert.equal((estado as Record<string, unknown>).patientId, undefined);
});

test("un sillón LIBRE no manda a nadie (ni el nombre de quien llega en cuatro horas)", () => {
  const [estado] = eduPlanoEstado3D(tarjetas([cita({ startsAt: min(200), endsAt: min(260), status: "SCHEDULED" })]));
  assert.equal(estado.status, "libre");
  assert.equal(estado.patientName, null);
  assert.equal(estado.doctorName, null);
  assert.equal(estado.appointmentEndsAt, null);
});

test("el COLOR del sillón es el de la ESPECIALIDAD, y un sillón callado no lo lleva", () => {
  const [conColor] = eduPlanoEstado3D(tarjetas([cita()]));
  assert.match(conColor.color ?? "", /^#[0-9a-f]{6}$/i, "el color tiene que ser un hex pintable");

  const [callado] = eduPlanoEstado3D(tarjetas([cita({ detail: false })]));
  assert.equal(callado.status, "ocupado", "el estado del piso NO es secreto");
  assert.equal(
    callado.color,
    null,
    "el color con leyenda al lado dice la especialidad que la tarjeta acaba de callar",
  );
  assert.notEqual(callado.patientName, "María González Ruiz", "el nombre completo se escapó al mundo");
});

test("el resourceId del estado es el del SILLÓN: es la clave con la que el mundo lo encuentra", () => {
  const estados = eduPlanoEstado3D(tarjetas([cita()]));
  assert.equal(estados[0].resourceId, "ch_1");
  assert.equal(estados[0].name, "Sillón 1");
});

// ═════════════════════════════════════════════════════════════════════
// 4 · EL HORARIO DE DEBAJO
// ═════════════════════════════════════════════════════════════════════

/**
 * ⚠️ El HORARIO sí se prueba con un instante FIJO, al revés que el estado.
 * No pasa por el motor del dental —no llama a `getChairStatus`— así que no
 * le afecta la ventana de 90 s; y en cambio SÍ recorta por el día de
 * calendario de la sede, que es justo lo que hace flaqueante un `Date.now()`
 * a las once de la noche: "dentro de dos horas" cae en mañana y desaparece
 * de la lista, que es lo correcto y rompería la prueba una vez al día.
 *
 * 16:00 UTC = 10:00 de la mañana en Ciudad de México.
 */
const MEDIODIA = new Date("2026-09-01T16:00:00.000Z");
const enHoras = (h: number) => new Date(MEDIODIA.getTime() + h * 3_600_000);

test("el horario trae la de AHORA y las que vienen, y tira lo que ya terminó", () => {
  const filas = eduVivaHorario(
    [SEDE],
    [
      cita({ id: "vieja", startsAt: enHoras(-3), endsAt: enHoras(-2), status: "SCHEDULED" }),
      cita({ id: "curso", startsAt: enHoras(-0.5), endsAt: enHoras(0.5) }),
      cita({ id: "luego", startsAt: enHoras(2), endsAt: enHoras(3), status: "SCHEDULED" }),
    ],
    MEDIODIA,
  );

  assert.deepEqual(filas.map((f) => f.id), ["curso", "luego"]);
  assert.equal(filas[0].enCurso, true);
  assert.equal(filas[1].enCurso, false);
  assert.equal(filas[0].chairName, "Sillón 1");
  // La hora se escribe en la hora de PARED de su sede, no en UTC.
  assert.equal(filas[0].startLabel, "09:30");
});

test("el horario calla lo que no le toca a quien mira, con la misma regla que la tarjeta", () => {
  const [fila] = eduVivaHorario(
    [SEDE],
    [cita({ detail: false, startsAt: enHoras(-0.5), endsAt: enHoras(0.5) })],
    MEDIODIA,
  );
  assert.equal(fila.masked, true);
  assert.equal(fila.student, null, "el nombre del estudiante de otro docente se escapó");
  assert.equal(fila.specialty, null);
  assert.notEqual(fila.patient, "María González Ruiz");
});

test("el horario solo se arma cuando lo piden (el tablero de tarjetas no lo carga)", () => {
  const laDeAhora = cita({ startsAt: enHoras(-0.5), endsAt: enHoras(0.5) });
  const sin = buildEduVivaBoard({ chairs: [SEDE], appointments: [laDeAhora], now: MEDIODIA });
  assert.equal(sin.schedule, undefined, "treinta renglones por sillón viajando para nada");

  const con = buildEduVivaBoard({
    chairs: [SEDE],
    appointments: [laDeAhora],
    now: MEDIODIA,
    horario: true,
  });
  assert.equal(con.schedule?.length, 1);
});

// ═════════════════════════════════════════════════════════════════════
// 5 · LOS 403
// ═════════════════════════════════════════════════════════════════════

test("🔴 ni ALUMNO ni CAJA llegan al plano: ni el permiso ni el alcance", () => {
  for (const role of ["ALUMNO", "CAJA"] as EduRole[]) {
    assert.equal(
      hasEduPermission({ role, permissionsOverride: [] }, "clinica.view"),
      false,
      `${role} entraría al endpoint del plano`,
    );
    assert.equal(
      hasEduPermission({ role, permissionsOverride: [] }, "clinica.edit"),
      false,
      `${role} podría acomodar el piso`,
    );
    // Y con la casilla encendida a mano, el ALCANCE sigue diciendo que no.
    assert.equal(
      eduScopeIsEmpty(eduLiveFloorVisibility({ role, eduUserId: "u_1" })),
      true,
      `${role} con el permiso puesto vería el piso`,
    );
  }
});

test("🔴 «acomodar el plano» es una key APARTE y solo la lleva quien dirige", () => {
  assert.ok("clinica.edit" in EDU_ALL_PERMISSIONS);
  const desc = EDU_ALL_PERMISSIONS["clinica.edit"];
  assert.ok(desc && desc.length > 8 && desc !== "clinica.edit", "la casilla tiene que explicarse");

  const conLaKey = (Object.keys(EDU_ROLE_DEFAULTS) as EduRole[]).filter((r) =>
    EDU_ROLE_DEFAULTS[r].includes("clinica.edit"),
  );
  assert.deepEqual(conLaKey, ["DIRECCION"], "mover un sillón de sitio lo ven todos los demás");

  // El DOCENTE mira el piso y NO lo redibuja.
  assert.equal(hasEduPermission({ role: "DOCENTE" }, "clinica.view"), true);
  assert.equal(hasEduPermission({ role: "DOCENTE" }, "clinica.edit"), false);

  // Y vive en el grupo del piso clínico, no en el de la agenda.
  const grupos = EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes("clinica.edit"));
  assert.equal(grupos.length, 1);
  assert.deepEqual(grupos[0].keys, ["clinica.view", "clinica.edit"]);
});

test("los dos endpoints nuevos exigen las dos cerraduras", () => {
  const estado = fuente(RUTA_ESTADO);
  assert.match(estado, /eduApiGuard\("clinica\.view"\)/, "el estado vivo no exige el permiso");
  assert.match(estado, /if \("response" in g\) return g\.response/, "el guard no corta la ejecución");
  assert.match(estado, /getEduPlanoEstado/, "no pasa por la capa que aplica el alcance");
  assert.match(estado, /getEduCampusScope/, "no recorta por sede");

  const plano = fuente(RUTA_PLANO);
  assert.match(plano, /eduApiGuard\("clinica\.view"\)/, "leer el plano no exige el permiso");
  assert.match(plano, /eduApiGuard\("clinica\.edit"\)/, "guardar el plano no exige SU permiso");
  assert.match(plano, /getEduCampusScope/);

  const capa = fuente("src/lib/edu/plano.ts");
  assert.match(capa, /eduLiveFloorVisibility/, "la capa de datos no consulta el punto único");
  assert.match(capa, /403/, "el alcance vacío tiene que ser un 403");
  assert.match(capa, /eduCampusCovers/, "no comprueba que la sede sea suya");
  assert.match(capa, /eduChairScopeWhere/, "los sillones no se recortan por sede");

  const editor = fuente(RUTA_PAGINA_EDITOR);
  assert.match(editor, /hasEduPermission\(permUser, "clinica\.edit"\)/, "la página del editor no exige el permiso");
});

test("la visibilidad del piso sigue viviendo en visibility.ts y en NINGÚN otro archivo", () => {
  for (const rel of [
    RUTA_ESTADO,
    RUTA_PLANO,
    RUTA_PAGINA_EDITOR,
    "src/app/instituto/(panel)/clinica/page.tsx",
    "src/lib/edu/plano.ts",
    "src/lib/edu/plano-core.ts",
  ]) {
    assert.equal(
      /["']DIRECCION["']/.test(fuente(rel)) || /["']DOCENTE["']/.test(fuente(rel)),
      false,
      `${rel} decide por su cuenta qué rol ve el piso: eso vive en visibility.ts`,
    );
  }
});

// ═════════════════════════════════════════════════════════════════════
// 6 · EL ARCHIVO DEL DENTAL: UNA PROP OPCIONAL Y NADIE LA PASA
// ═════════════════════════════════════════════════════════════════════

test("🔴 la prop del anfitrión es OPCIONAL y sin ella el dental no ejecuta ni una rama nueva", () => {
  const visor = fuente(DENTAL);

  assert.match(visor, /host\?: Clinic3DHost \| null;/, "la prop dejó de ser opcional");
  assert.match(visor, /host = null,/, "sin la prop el visor tiene que caer en null");
  assert.match(visor, /const isHosted = !!host;/);

  // Todo lo añadido cuelga de `isHosted`. Se cuenta para que nadie meta una
  // rama nueva sin bandera: si aparece, hay que decidir a conciencia.
  const usos = visor.match(/isHosted/g) ?? [];
  assert.ok(usos.length >= 8, "las ramas del anfitrión tienen que ir todas tras la bandera");

  // Y el clic del anfitrión NO puede acabar en una ruta del dental.
  assert.match(
    visor,
    /interaction = isPublic \|\| isHosted/,
    "con anfitrión se seguiría montando la interacción del dental (abre /dashboard/patients)",
  );
});

test("🔴 NINGÚN llamador del dental pasa la prop nueva", () => {
  for (const rel of [
    "src/app/dashboard/clinic-layout/3d/Clinic3DMount.tsx",
    "src/app/live/[slug]/3d/Clinic3DPublicMount.tsx",
  ]) {
    const texto = fuente(rel);
    assert.equal(
      /\bhost\b/.test(texto),
      false,
      `${rel} pasa la prop del anfitrión: el dental dejaría de comportarse igual`,
    );
  }

  // Y el vertical la monta desde UN solo sitio.
  const mundo = fuente("src/components/edu/clinica/plano-mundo.tsx");
  assert.match(mundo, /host=\{host\}/);
  assert.match(mundo, /import\("@\/components\/clinic-3d\/Clinic3DClient"\)/, "el visor tiene que entrar por dynamic()");
  assert.match(mundo, /ssr: false/, "three.js en el servidor revienta el build");
});

test("el alto del mundo se le impone desde el tema del instituto, sin !important", () => {
  // `Clinic3DClient` lleva `h-[100dvh]` en su raíz porque en el dental ocupa
  // la pantalla entera. Aquí vive dentro de una pantalla con el horario
  // debajo. Si esta regla desaparece, el plano empuja el horario fuera.
  const tema = fuente("src/app/instituto/edu-theme.css");
  assert.match(tema, /\.edu-plano__mundo > div \{/, "falta la regla que le pone el alto al visor");
  const bloque = tema.slice(tema.indexOf(".edu-plano__mundo > div {"));
  assert.equal(/!important/.test(bloque.slice(0, 200)), false, "no hace falta !important: gana por especificidad");
});

// ═════════════════════════════════════════════════════════════════════
// 6b · UNA VISTA DE ESTADO, NO UN VIDEOJUEGO
//
// El visor del dental es un recorrido en primera persona (WASD, mano,
// mira, VR) con la vista aérea de modo alterno. Montado aquí tiene que ser
// justo lo contrario, y estas pruebas leen el archivo del dental porque es
// donde vive la decisión: si alguien quita una de estas banderas, la
// escuela vuelve a tener un videojuego y nada más se pondría rojo.
// ═════════════════════════════════════════════════════════════════════

test("🔴 con anfitrión NO se monta ningún control de primera persona", () => {
  const visor = fuente(DENTAL);

  // Caminar: los controles ni se crean. No basta con no llamar a su update
  // —enganchan WASD y las flechas en `window` y les hacen preventDefault—.
  assert.match(
    visor,
    /desktop = !touch && !isHosted \? createDesktopControls\(/,
    "con anfitrión se seguirían montando los controles de caminar (y el teclado de la pantalla dejaría de responder)",
  );
  assert.match(
    visor,
    /touch && !isHosted && touchLayerRef\.current/,
    "en un móvil hospedado se montaría el joystick de caminar",
  );
  // La mano en pantalla es del paseo, no de un plano.
  assert.match(visor, /if \(!touch && !isHosted\) \{\s*\n\s*hand = createHand/);

  // Y se ARRANCA arriba, sin vuelo de entrada.
  assert.match(
    visor,
    /if \(isHosted\) \{\s*\n\s*enterDrone\(\);\s*\n\s*drone\?\.update\(1\);/,
    "con anfitrión el visor tiene que arrancar YA en la vista aérea",
  );
  // Del que no se sale: el alternador es un no-op (tecla V y botón 🚁).
  assert.match(
    visor,
    /const toggleDrone = \(\) => \{\s*\n\s*if \(isHosted\) return;/,
    "con anfitrión se podría volver a primera persona con la tecla V",
  );
  // Y el cerrojo de verdad, por si alguien llega a la salida por otro
  // camino (hoy: el botón de VR, que se entra desde FPS).
  assert.match(
    visor,
    /mode !== "drone" \|\| isHosted/,
    "salir de la vista aérea tiene que estar CERRADO con anfitrión, no solo escondido",
  );

  // La mira solo se alimenta en FPS, y con anfitrión no hay FPS: la rama
  // que le daba rótulo al apuntador se fue con ella.
  assert.equal(/pickLabel/.test(visor), false, "quedó el rótulo del apuntador, que ya no se pinta nunca");
  assert.equal(
    /fps && isHosted/.test(visor),
    false,
    "quedó una rama de primera persona para el anfitrión",
  );
});

test("🔴 el HUD del dental no enseña sus textos ni sus mandos con anfitrión", () => {
  const hud = fuente(DENTAL_HUD);

  // La prop es OPCIONAL y por defecto no existe: el dental, igual que hoy.
  assert.match(hud, /host\?: \{ legend\?: string\[\] \| null \} \| null;/, "la prop dejó de ser opcional");
  assert.match(hud, /host = null,/, "sin la prop el HUD tiene que caer en null");

  // El enlace al panel del DENTAL ya no se tapa con CSS desde el instituto
  // (era una tirita que se caía si el dental cambiaba la ruta): no se pinta.
  assert.match(hud, /\{!host \? \(\s*\n\s*<Link/, "el enlace al editor del dental se sigue pintando");
  const tema = fuente("src/app/instituto/edu-theme.css");
  assert.equal(
    /\.edu-plano__mundo a\[href=/.test(tema),
    false,
    "quedó la regla vieja que escondía el enlace por href: ahora lo resuelve la prop",
  );

  // Los dos textos del dental que el instituto no puede enseñar.
  assert.match(hud, /host\s*\n?\s*\? \(host\.legend \?\? \[\]\)\.map/, "la leyenda del dental no la sustituye el anfitrión");
  assert.match(hud, /vrSupported && !host/, "con anfitrión se ofrecería VR, que ES primera persona");

  // Y el instituto pone la suya, con sus palabras.
  const mundo = fuente("src/components/edu/clinica/plano-mundo.tsx");
  assert.match(mundo, /legend: LEYENDA/);
  assert.match(mundo, /Clic al paciente o al estudiante para abrir su ficha/);
});

test('🔴 la placa NO dice "Dr." en una escuela: el prefijo lo pone el anfitrión', () => {
  const capa = fuente(DENTAL_CAPA);

  // Sin argumento, la placa del dental sigue diciendo exactamente lo de hoy.
  assert.match(capa, /createLiveLayer\(world: WorldModel, labels\?: LiveLayerLabels\)/);
  assert.match(capa, /labels\?\.doctor \?\? "Dr\. "/, "el default dejó de ser el del dental");
  assert.match(capa, /labels\?\.patient \?\? ""/, "el paciente del dental llevaba prefijo y no debe llevarlo");

  // Y el instituto pasa los suyos.
  const mundo = fuente("src/components/edu/clinica/plano-mundo.tsx");
  assert.match(mundo, /patient: "Paciente · ", doctor: "Estudiante · "/);
  assert.match(mundo, /plate: PLACA/);
});

test("la ayuda de la pantalla NO promete caminar por la clínica", () => {
  // La leyenda decía "Camina con W A S D…". Prometer un modo que ya no
  // existe es peor que no decir nada: quien lo intenta cree que se rompió.
  const pantalla = fuente("src/components/edu/clinica/plano-screen.tsx");
  assert.equal(/W A S D|WASD/.test(pantalla), false, "la ayuda sigue prometiendo caminar");
  assert.match(pantalla, /desde arriba/, "la ayuda tiene que decir cómo se mira de verdad");
});

test("la pantalla del plano NO monta un segundo sondeo cuando el visor ya late", () => {
  const pantalla = fuente("src/components/edu/clinica/plano-screen.tsx");
  // El respaldo (tarjetas) tiene su propio latido; el plano usa el del visor.
  assert.match(pantalla, /if \(mundoMontado\) return;/, "el respaldo late encima del visor");
  assert.match(pantalla, /document\.hidden/, "el latido consulta con la pestaña oculta");
  assert.match(pantalla, /removeEventListener\("visibilitychange"/, "el listener no se limpia");
  assert.match(pantalla, /EDU_VIVA_REFRESCO_MS/, "el intervalo está a mano en vez de la constante");
});
