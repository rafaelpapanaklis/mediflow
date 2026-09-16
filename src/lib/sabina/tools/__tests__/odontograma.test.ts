/**
 * `odontograma` — la herramienta que Rafael pidió por su nombre (ws1-t1).
 *
 *   npm run test:sabina-odontograma
 *
 * Lo que se prueba, y por qué cada cosa:
 *
 *  · 🔴 EL AISLAMIENTO, que aquí es DISTINTO al del resto. `odontogram_entries`
 *    NO tiene `clinicId`: cuelga del paciente. Si la herramienta se saltara el
 *    `pacienteVisibleYActivo`, el `where: { patientId }` le devolvería los
 *    hallazgos del paciente de la otra clínica sin que ningún filtro chille.
 *    Por eso el doble siembra el odontograma del SUR con hallazgos que gritan.
 *  · Sin `medicalRecord.view` se DICE, y no se lee ni una fila (regla 3).
 *  · N19 — un paciente archivado por ARCO no filtra nada, ni para el admin.
 *  · Visibilidad por paciente — el doctor excluido de la lista no lo ve.
 *  · QUE RESUME, NO QUE VUELCA — con 32 dientes marcados, ni `datos` ni
 *    `resumen` sacan 32 líneas: salen agrupados por hallazgo.
 *  · 🔴 QUE NO DIAGNOSTICA — el aviso obligatorio viaja siempre.
 */

import "./preparar";
import { test } from "node:test";
import assert from "node:assert/strict";

import { correrHerramienta } from "../base";
import { odontograma, AVISO_NO_DIAGNOSTICA } from "../odontograma";
import {
  CL_NORTE,
  CL_SUR,
  U_ADMIN_N,
  adminNorte,
  adminSur,
  conPermisos,
  datosDePrueba,
  doctorNorte,
  recepcionNorte,
} from "./siembra";
import { crearBase, type BaseDoble, type Fila } from "./doble-base";

const DIA_MS = 86_400_000;
function haceDias(n: number): Date {
  return new Date(Date.now() - n * DIA_MS);
}

/** Una fila de odontograma. Sin `clinicId`: la tabla real tampoco lo tiene. */
function marca(patientId: string, toothNumber: number, conditionId: string, over: Fila = {}): Fila {
  return {
    id: `odo-${patientId}-${toothNumber}-${conditionId}`,
    patientId,
    toothNumber,
    surface: null,
    conditionId,
    notes: null,
    createdAt: haceDias(30),
    updatedAt: haceDias(3),
    ...over,
  };
}

/* ── El odontograma sembrado ────────────────────────────────────────────
   Ana: caries en tres dientes (una de ellas en dos caras, para comprobar que
   se cuentan DIENTES y no filas), una corona, un ausente y una nota. */
const ENTRIES: Fila[] = [
  marca("p-ana", 16, "caries", { surface: "O" }),
  marca("p-ana", 16, "caries", { surface: "M", id: "odo-ana-16-caries-M" }),
  marca("p-ana", 26, "caries", { surface: "O" }),
  marca("p-ana", 37, "caries", { surface: "D" }),
  marca("p-ana", 46, "crown"),
  marca("p-ana", 18, "missing", { updatedAt: haceDias(1) }),
  marca("p-ana", 36, "__note__", { notes: "El paciente refiere molestia al masticar del lado derecho." }),
  // Un id que NO está en el catálogo de 45: tiene que salir CRUDO, no perderse.
  marca("p-ana", 27, "hallazgo_raro_del_futuro"),

  // Paciente restringida (solo la ve el admin) y paciente archivada por ARCO.
  marca("p-priv", 11, "caries"),
  marca("p-borrado", 11, "caries"),

  // 🔴 LA CLÍNICA DE AL LADO. Si algo de esto sale en una consulta del norte,
  // es una fuga entre clínicas y la prueba tiene que gritarlo.
  marca("p-sur-1", 11, "implant"),
  marca("p-sur-1", 21, "rct"),
];

// 32 dientes marcados, para la prueba de «que resuma, no que vuelque».
const ENTRIES_MASIVAS: Fila[] = [];
for (const fdi of [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28,
                   48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]) {
  ENTRIES_MASIVAS.push(marca("p-beto", fdi, "caries", { id: `odo-beto-${fdi}` }));
}

function base(extra: Fila[] = []): BaseDoble {
  return crearBase({ ...datosDePrueba(), odontogramEntries: [...ENTRIES, ...extra] });
}

/* ═══════════════════════════════════════════════════════════════════════
   1. LO QUE CONTESTA
   ═══════════════════════════════════════════════════════════════════════ */

test("agrupa por hallazgo y cuenta DIENTES, no filas", async () => {
  const db = base();
  const r = await correrHerramienta(odontograma, adminNorte(db), { patientId: "p-ana" });
  assert.equal(r.ok, true);
  if (r.ok !== true) return;

  const caries = r.datos.hallazgos.find((h) => h.hallazgo === "Caries");
  assert.ok(caries, `no salió el grupo de caries: ${JSON.stringify(r.datos.hallazgos)}`);
  // 16 aparece DOS veces (oclusal y mesial) y tiene que contar UNA.
  assert.equal(caries!.cuantosDientes, 3);
  assert.equal(caries!.dientes, "16, 26, 37");

  assert.ok(r.datos.hallazgos.some((h) => h.hallazgo === "Corona" && h.dientes === "46"));
  assert.ok(r.datos.hallazgos.some((h) => h.hallazgo === "Ausente" && h.dientes === "18"));
  // 16, 26, 37, 46, 18, 27 → seis dientes con algo (la nota del 36 NO cuenta).
  assert.equal(r.datos.dientesConHallazgo, 6);
});

test("la nota por diente no es un hallazgo: va aparte, con su texto", async () => {
  const db = base();
  const r = await correrHerramienta(odontograma, adminNorte(db), { patientId: "p-ana" });
  assert.equal(r.ok, true);
  if (r.ok !== true) return;

  assert.equal(r.datos.totalNotas, 1);
  assert.deepEqual(r.datos.notas.map((n) => n.diente), [36]);
  assert.match(r.datos.notas[0].nota, /molestia al masticar/);
  // Y `__note__` jamás se cuela como si fuera un hallazgo del catálogo.
  assert.ok(!r.datos.hallazgos.some((h) => h.hallazgo.includes("__note__")));
});

test("un conditionId que no está en el catálogo sale crudo, no se pierde", async () => {
  const db = base();
  const r = await correrHerramienta(odontograma, adminNorte(db), { patientId: "p-ana" });
  assert.equal(r.ok, true);
  if (r.ok !== true) return;
  assert.ok(
    r.datos.hallazgos.some((h) => h.hallazgo === "hallazgo_raro_del_futuro" && h.dientes === "27"),
    "un hallazgo desconocido se tragó en silencio: eso vuelve falsa la respuesta",
  );
});

test("dice cuándo se tocó el odontograma por última vez", async () => {
  const db = base();
  const r = await correrHerramienta(odontograma, adminNorte(db), { patientId: "p-ana" });
  assert.equal(r.ok, true);
  if (r.ok !== true) return;
  assert.equal(r.datos.ultimaMarca, haceDias(1).toISOString().slice(0, 10));
});

test("un paciente sin odontograma es sin_datos, no una lista vacía", async () => {
  const db = base();
  const r = await correrHerramienta(odontograma, adminNorte(db), { patientId: "p-carla" });
  assert.equal(r.ok, false);
  if (r.ok !== false) return;
  assert.equal(r.motivo, "sin_datos");
});

/* ═══════════════════════════════════════════════════════════════════════
   2. QUE RESUMA, NO QUE VUELQUE
   ═══════════════════════════════════════════════════════════════════════ */

test("con 32 dientes marcados no salen 32 líneas: sale una", async () => {
  const db = base(ENTRIES_MASIVAS);
  const r = await correrHerramienta(odontograma, adminNorte(db), { patientId: "p-beto" });
  assert.equal(r.ok, true);
  if (r.ok !== true) return;

  assert.equal(r.datos.hallazgos.length, 1, "32 dientes con caries son UN grupo");
  assert.equal(r.datos.hallazgos[0].cuantosDientes, 32);
  // La lista de dientes se corta: enumerar 32 números no lo lee nadie.
  assert.match(r.datos.hallazgos[0].dientes, /y 22 más$/);
  // 32 filas caben de sobra: esto NO es el caso del corte por filas.
  assert.equal(r.datos.incompleto, false);
  // Y lo que viaja al modelo cabe en una pantalla.
  assert.ok(
    JSON.stringify(r.datos).length < 700,
    `el volcado al modelo pesa ${JSON.stringify(r.datos).length} caracteres`,
  );
});

test("el resumen contesta la pregunta con sus números", async () => {
  const db = base();
  const r = await correrHerramienta(odontograma, adminNorte(db), { patientId: "p-ana" });
  assert.equal(r.ok, true);
  if (r.ok !== true) return;
  assert.match(r.resumen, /caries en 3 dientes \(16, 26, 37\)/);
  assert.match(r.resumen, /corona en 1 diente \(46\)/);
});

test("🔴 si el odontograma no cabe de una vez, se DICE — no se jura que el resto está sano", async () => {
  // 600 marcas concentradas en los dientes de numeración baja: con el orden por
  // número de diente, el corte se lleva los cuadrantes de abajo ENTEROS. Decir
  // el resto sin avisar sería afirmar que esos dientes no tienen nada.
  const muchas: Fila[] = [];
  let n = 0;
  for (const fdi of [11, 12, 13, 14, 15, 16, 17, 18, 21, 22]) {
    for (const cara of ["O", "M", "D", "V", "L", null]) {
      for (const cond of ["caries", "restoration", "calculus", "sealant", "pigmentation",
                          "caries_inc", "temp_rest", "inlay", "crown", "veneer"]) {
        muchas.push(marca("p-carla", fdi, cond, { surface: cara, id: `masiva-${n++}` }));
      }
    }
  }
  // Y una marca en un molar de abajo, que es justo la que se va a perder.
  muchas.push(marca("p-carla", 47, "rct", { id: "la-que-se-pierde" }));

  const db = base(muchas);
  const r = await correrHerramienta(odontograma, adminNorte(db), { patientId: "p-carla" });
  assert.equal(r.ok, true);
  if (r.ok !== true) return;

  assert.equal(r.datos.incompleto, true, "se cortó por filas y no se marcó");
  assert.match(r.resumen, /más marcas de las que puedo leer/);
  assert.match(r.resumen, /NO digas que el resto está sano/);
});

/* ═══════════════════════════════════════════════════════════════════════
   3. 🔴 QUE NO DIAGNOSTIQUE
   ═══════════════════════════════════════════════════════════════════════ */

test("el aviso de que no es un diagnóstico viaja siempre que hay odontograma", async () => {
  const db = base();
  const r = await correrHerramienta(odontograma, adminNorte(db), { patientId: "p-ana" });
  assert.equal(r.ok, true);
  if (r.ok !== true) return;

  const aviso = odontograma.avisoObligatorio!(r.datos);
  assert.deepEqual(aviso, AVISO_NO_DIAGNOSTICA);
  assert.match(AVISO_NO_DIAGNOSTICA.frase, /no es un diagnóstico/);
  // La marca tiene que estar DENTRO de la frase, o el motor la añadiría dos veces.
  assert.ok(AVISO_NO_DIAGNOSTICA.frase.includes(AVISO_NO_DIAGNOSTICA.marca));
  assert.ok(r.resumen.includes(AVISO_NO_DIAGNOSTICA.frase));
});

test("la descripción que ve el modelo le prohíbe interpretar", async () => {
  assert.match(odontograma.descripcion, /no\s+diagnostica/i);
  assert.match(odontograma.descripcion, /no sugiere tratamiento|no interpreta/i);
});

/* ═══════════════════════════════════════════════════════════════════════
   4. PERMISO — se DICE, y no se lee nada
   ═══════════════════════════════════════════════════════════════════════ */

test("sin medicalRecord.view dice sin_permiso y NO toca la base", async () => {
  const db = base();
  const r = await correrHerramienta(odontograma, recepcionNorte(db), { patientId: "p-ana" });
  assert.equal(r.ok, false);
  if (r.ok !== false) return;
  assert.equal(r.motivo, "sin_permiso");
  assert.equal(r.permiso, "medicalRecord.view");
  assert.deepEqual(db.contador.llamadas, [], "se consultó la base sin permiso");
});

test("la key es la del expediente, no una inventada", async () => {
  assert.equal(odontograma.permiso, "medicalRecord.view");
  const db = base();
  const r = await correrHerramienta(odontograma, conPermisos(db, ["medicalRecord.view", "patients.view"]), {
    patientId: "p-ana",
  });
  assert.equal(r.ok, true, "con la key exacta tiene que contestar");
});

/* ═══════════════════════════════════════════════════════════════════════
   5. 🔴 AISLAMIENTO — y aquí NO lo da ningún where
   ═══════════════════════════════════════════════════════════════════════ */

test("la clínica del norte no ve el odontograma de un paciente del sur", async () => {
  const db = base();
  const r = await correrHerramienta(odontograma, adminNorte(db), { patientId: "p-sur-1" });
  assert.equal(r.ok, false);
  if (r.ok !== false) return;
  assert.equal(r.motivo, "sin_datos");
  // Ni por el texto: nada de "implant" ni "rct" del sur en ninguna parte.
  assert.ok(!JSON.stringify(r).includes("Implante"));
});

test("la clínica del sur no ve el odontograma de un paciente del norte", async () => {
  const db = base();
  const r = await correrHerramienta(odontograma, adminSur(db), { patientId: "p-ana" });
  assert.equal(r.ok, false);
  if (r.ok !== false) return;
  assert.equal(r.motivo, "sin_datos");
});

test("un id de paciente inventado no devuelve nada", async () => {
  const db = base();
  const r = await correrHerramienta(odontograma, adminNorte(db), { patientId: "p-no-existe" });
  assert.equal(r.ok, false);
  if (r.ok !== false) return;
  assert.equal(r.motivo, "sin_datos");
});

test("un paciente archivado por ARCO no filtra su odontograma ni al admin (N19)", async () => {
  const db = base();
  const r = await correrHerramienta(odontograma, adminNorte(db), { patientId: "p-borrado" });
  assert.equal(r.ok, false);
  if (r.ok !== false) return;
  assert.equal(r.motivo, "sin_datos");
});

test("la visibilidad por paciente manda: el doctor excluido no lo ve, el admin sí", async () => {
  const db = base();
  const doctor = await correrHerramienta(odontograma, doctorNorte(db), { patientId: "p-priv" });
  assert.equal(doctor.ok, false);
  if (doctor.ok === false) assert.equal(doctor.motivo, "sin_datos");

  const admin = await correrHerramienta(odontograma, adminNorte(db), { patientId: "p-priv" });
  assert.equal(admin.ok, true, "el admin (en visibleUserIds) sí tiene que verlo");
});

test("sin clinicId en la sesión no se consulta nada", async () => {
  const db = base();
  const roto = { ...adminNorte(db), clinicId: "" };
  const r = await correrHerramienta(odontograma, roto as any, { patientId: "p-ana" });
  assert.equal(r.ok, false);
  if (r.ok !== false) return;
  assert.equal(r.motivo, "error");
  assert.match(r.detalle, /clinicId/);
  assert.deepEqual(db.contador.llamadas, []);
});

test("el zod no acepta un clinicId del modelo", () => {
  const claves = Object.keys((odontograma.parametros as any).shape ?? {});
  assert.deepEqual(claves, ["patientId"]);
  assert.ok(!claves.includes("clinicId"));
  void CL_NORTE;
  void CL_SUR;
  void U_ADMIN_N;
});
