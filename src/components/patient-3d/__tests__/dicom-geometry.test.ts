/**
 * Pruebas de la GEOMETRÍA del visor CBCT: de dónde sale el orden de los cortes,
 * cómo se mide la separación entre ellos, qué letra anatómica lleva cada borde y
 * cuándo el visor tiene que decir que no se fía.
 *
 * Todo con cabeceras construidas A MANO (src/components/patient-3d/__tests__/
 * dicom-synth.ts): no hay ni un .dcm en el repo, y no debe haberlo — un estudio
 * real lleva datos de paciente. Los archivos sintéticos son Part 10 de verdad, así
 * que las pruebas atraviesan `dicomParser.parseDicom` y el `readHeaders` real.
 *
 * Correr con:
 *   npm run test:cbct-geometry
 *   # o:
 *   npx tsx --tsconfig tsconfig.test.json --test src/components/patient-3d/__tests__/dicom-geometry.test.ts
 *
 * (El tsconfig de pruebas hace falta porque GeometryWarning.tsx trae JSX; el de la
 * app deja `jsx: preserve` para que lo resuelva el compilador de Next.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeSlice, type DecodedSlice } from "../dicom-decode-core";
import {
  edgeLabelsFor,
  flipNormV,
  isPhysicallyOrdered,
  keepDominantSeries,
  measureZSpacing,
  normToVox,
  sameOrientation,
  sampleDepthAtRow,
  sortSlicesForVolume,
  voxToNorm,
  type Slice,
} from "../cbct-mpr-shared";
import { geometryDoubtReason } from "../GeometryWarning";
import { encodeCbctLite, decodeCbctLite, type CbctLiteMeta } from "../cbct-lite-shared";
import { buildSlice, BS } from "./dicom-synth";

const AXIAL_IOP = [1, 0, 0, 0, 1, 0];

/** Decodifica un corte sintético y falla la prueba si el núcleo lo rechaza. */
function decodeOne(buf: ArrayBuffer, fallbackOrder = 0): DecodedSlice {
  const out = decodeSlice(buf, fallbackOrder);
  assert.ok(out && out.length === 1, "decodeSlice devolvió null o multi-frame inesperado");
  return out[0];
}

/** Set sintético: n cortes axiales en z0, z0+step, … con IOP estándar. */
function axialSet(
  n: number,
  z0: number,
  step: number,
  opts: { instanceDescending?: boolean; iop?: number[] | null } = {},
): DecodedSlice[] {
  const out: DecodedSlice[] = [];
  for (let i = 0; i < n; i++) {
    out.push(
      decodeOne(
        buildSlice({
          ipp: [0, 0, z0 + i * step],
          iop: opts.iop === null ? null : opts.iop ?? AXIAL_IOP,
          instanceNumber: opts.instanceDescending ? n - i : i + 1,
          fill: i,
        }),
        i,
      ),
    );
  }
  return out;
}

/* ========================================================================== */
/* 1. El orden sale de la POSICIÓN, no del InstanceNumber                     */
/* ========================================================================== */

test("InstanceNumber ascendente con ImagePositionPatient descendente: manda la posición", () => {
  // Un CBCT en el que el equipo numeró de la corona al mentón (InstanceNumber 1
  // arriba) mientras la z del paciente BAJA. Es el caso que justifica todo el
  // cambio: ordenar por el número de catálogo deja el volumen invertido.
  const slices: DecodedSlice[] = [];
  for (let i = 0; i < 5; i++) {
    // InstanceNumber 1,2,3,4,5 ; z 40, 30, 20, 10, 0
    slices.push(decodeOne(buildSlice({ ipp: [0, 0, 40 - i * 10], iop: AXIAL_IOP, instanceNumber: i + 1, fill: i }), i));
  }
  assert.deepEqual(
    slices.map((s) => s.orderSource),
    ["position", "position", "position", "position", "position"],
  );
  // `order` es la proyección sobre la normal (0,0,1), o sea la z.
  assert.deepEqual(
    slices.map((s) => s.order),
    [40, 30, 20, 10, 0],
  );

  sortSlicesForVolume(slices as Slice[]);
  // Tras ordenar, el array va de z=0 a z=40: el InstanceNumber quedó al revés,
  // que es exactamente lo que se busca.
  assert.deepEqual(
    slices.map((s) => s.order),
    [0, 10, 20, 30, 40],
  );
  assert.deepEqual(
    slices.map((s) => s.pixels[0]),
    [4, 3, 2, 1, 0],
    "el corte que estaba en z=0 (el último del zip) tiene que quedar primero",
  );
});

test("sin ImagePositionPatient el orden cae a InstanceNumber y lo declara", () => {
  const slices: DecodedSlice[] = [];
  for (const inst of [3, 1, 2]) {
    slices.push(decodeOne(buildSlice({ ipp: null, iop: AXIAL_IOP, instanceNumber: inst, fill: inst }), 99));
  }
  assert.deepEqual(
    slices.map((s) => s.orderSource),
    ["instance", "instance", "instance"],
  );
  assert.deepEqual(
    slices.map((s) => s.imagePosition),
    [null, null, null],
    "sin el tag NO se inventa una posición",
  );
  sortSlicesForVolume(slices as Slice[]);
  assert.deepEqual(
    slices.map((s) => s.order),
    [1, 2, 3],
  );
});

test("sin ImagePositionPatient ni InstanceNumber manda el índice de entrada del zip", () => {
  const s = decodeOne(buildSlice({ ipp: null, iop: AXIAL_IOP, instanceNumber: null }), 7);
  assert.equal(s.orderSource, "instance");
  assert.equal(s.order, 7);
});

test("un `order` no finito se va al FINAL, no al medio del volumen", () => {
  // No se puede fabricar con un DICOM (leadingNums rechaza lo no finito), pero sí
  // puede llegar de un registro viejo de IndexedDB. El comparador tiene que
  // aguantarlo sin dejar el resultado del sort indefinido.
  const arr = [
    { order: 5, orderSource: "instance" as const, tag: "cinco" },
    { order: NaN, orderSource: "instance" as const, tag: "nan" },
    { order: 1, orderSource: "instance" as const, tag: "uno" },
  ];
  sortSlicesForVolume(arr);
  assert.deepEqual(
    arr.map((a) => a.tag),
    ["uno", "cinco", "nan"],
  );
});

test("set MEZCLADO: la mayoría se ordena y la minoría queda anclada donde llegó", () => {
  // 3 cortes con posición (mm) + 1 sin ella (índice). Sus `order` no son
  // comparables: ordenarlos juntos intercalaría milímetros con un entero.
  const a = decodeOne(buildSlice({ ipp: [0, 0, 30], iop: AXIAL_IOP, fill: 30 }), 0);
  const b = decodeOne(buildSlice({ ipp: null, iop: AXIAL_IOP, instanceNumber: 2, fill: 99 }), 1);
  const c = decodeOne(buildSlice({ ipp: [0, 0, 10], iop: AXIAL_IOP, fill: 10 }), 2);
  const d = decodeOne(buildSlice({ ipp: [0, 0, 20], iop: AXIAL_IOP, fill: 20 }), 3);
  const arr = [a, b, c, d];
  sortSlicesForVolume(arr as Slice[]);
  // La ranura 1 sigue siendo la del corte sin posición; las otras tres se
  // ordenaron entre ellas (10, 20, 30).
  assert.deepEqual(
    arr.map((s) => s.pixels[0]),
    [10, 99, 20, 30],
  );
});

test("empates de `order` se rompen por orden de llegada, no por el motor", () => {
  const arr = [
    { order: 1, orderSource: "position" as const, tag: "a" },
    { order: 1, orderSource: "position" as const, tag: "b" },
    { order: 0, orderSource: "position" as const, tag: "c" },
  ];
  sortSlicesForVolume(arr);
  assert.deepEqual(
    arr.map((x) => x.tag),
    ["c", "a", "b"],
  );
});

/* ========================================================================== */
/* 2. Espaciado entre cortes: medido, no creído                               */
/* ========================================================================== */

test("set contiguo de 0.3 mm: sz = 0.3 con tolerancia 1e-6 y espaciado regular", () => {
  const set = axialSet(20, -3, 0.3);
  sortSlicesForVolume(set as Slice[]);
  const m = measureZSpacing(set as Slice[]);
  assert.ok(m, "measureZSpacing devolvió null con un set contiguo");
  assert.ok(m.sz !== null);
  assert.ok(Math.abs(m.sz - 0.3) < 1e-6, `sz=${m.sz}, se esperaba 0.3`);
  assert.equal(m.variable, false);
});

test("la medida le GANA al SliceThickness del header (grosor ≠ paso)", () => {
  // Cortes solapados: el equipo declara 0.4 de grosor y avanza 0.3. El header
  // miente sobre el paso; las posiciones no.
  const set: DecodedSlice[] = [];
  for (let i = 0; i < 10; i++) {
    set.push(decodeOne(buildSlice({ ipp: [0, 0, i * 0.3], iop: AXIAL_IOP, sliceThickness: 0.4 }), i));
  }
  assert.equal(set[0].zSpacing, 0.4, "el header sigue diciendo 0.4");
  const m = measureZSpacing(set as Slice[]);
  assert.ok(m && m.sz !== null);
  assert.ok(Math.abs(m.sz - 0.3) < 1e-6, `sz=${m.sz}`);
});

test("espaciado irregular: zVariable === true", () => {
  // Falta un corte en medio: un delta vale el doble.
  const zs = [0, 0.3, 0.6, 1.2, 1.5, 1.8];
  const set = zs.map((z, i) => decodeOne(buildSlice({ ipp: [0, 0, z], iop: AXIAL_IOP }), i));
  const m = measureZSpacing(set as Slice[]);
  assert.ok(m);
  assert.equal(m.variable, true);
  // La mediana ignora el salto: sigue siendo 0.3, no la media (0.36).
  assert.ok(m.sz !== null && Math.abs(m.sz - 0.3) < 1e-9, `sz=${m.sz}`);
});

test("un desvío por debajo del 10 % NO marca el estudio como irregular", () => {
  const zs = [0, 0.3, 0.6, 0.92, 1.22]; // el tercer paso es 0.32 (+6.7 %)
  const set = zs.map((z, i) => decodeOne(buildSlice({ ipp: [0, 0, z], iop: AXIAL_IOP }), i));
  const m = measureZSpacing(set as Slice[]);
  assert.ok(m);
  assert.equal(m.variable, false);
});

test("posiciones a dos decimales: el afinado por extremos recupera el paso real", () => {
  // Paso real 0.125 mm con IPP escrito a 2 decimales: los deltas alternan 0.12 y
  // 0.13 y la MEDIANA se queda con uno de los dos (4 % de error, por debajo del
  // umbral de irregularidad, así que ni siquiera se avisaría). Repartir el
  // recorrido total entre los pasos lo arregla.
  const n = 41;
  const set: DecodedSlice[] = [];
  for (let i = 0; i < n; i++) {
    const z = Math.round(i * 0.125 * 100) / 100; // cuantizado a 0.01
    set.push(decodeOne(buildSlice({ ipp: [0, 0, z], iop: AXIAL_IOP }), i));
  }
  const m = measureZSpacing(set as Slice[]);
  assert.ok(m && m.sz !== null);
  assert.equal(m.variable, false);
  assert.ok(Math.abs(m.sz - 0.125) < 1e-6, `sz=${m.sz}, se esperaba 0.125`);
});

test("pila PLEGADA: el afinado por extremos no puede dar un sz nueve veces menor", () => {
  // Regresión del propio afinado. Dos series axiales de lateralidad opuesta sobre
  // z solapado se ordenan por la normal de CADA corte y luego se proyectan sobre
  // UNA: las posiciones salen 4,3,2,1,0,1,2,3,4,5. Todos los deltas valen 1 (el
  // valor absoluto no ve el pliegue), ninguno se desvía de la mediana, y el
  // recorrido total |5−4| repartido entre 9 pasos daba 0.111 mm en vez de 1 —
  // coronal nueve veces más aplastado, y marcado como calibrado.
  const proj = [4, 3, 2, 1, 0, 1, 2, 3, 4, 5];
  const set = proj.map((z) => decodeOne(buildSlice({ ipp: [0, 0, z], iop: AXIAL_IOP })));
  const m = measureZSpacing(set as Slice[]);
  assert.ok(m && m.sz !== null);
  assert.ok(Math.abs(m.sz - 1) < 1e-9, `sz=${m.sz}, se esperaba 1 (la mediana, no el afinado)`);
  assert.equal(m.folded, true, "el pliegue se señala aparte del paso irregular");
  assert.equal(m.variable, true, "una pila que se pliega no es un volumen y hay que decirlo");
  // Y no se puede declarar apilada por geometría: no hay un sentido que voltear.
  assert.equal(isPhysicallyOrdered(set as Slice[], m), false);
});

test("un corte que falta hace el paso irregular pero NO tumba el volteo ni las letras", () => {
  // La contraparte del caso de arriba, y la razón de que `folded` viaje aparte de
  // `variable`: a este estudio le falta un corte —el paso salta al doble— y sin
  // embargo está perfectamente apilado. Quitarle las letras por eso sería perder
  // información correcta por un defecto que ya se avisa por su cuenta.
  const set = [0, 0.3, 0.6, 1.2, 1.5].map((z) =>
    decodeOne(buildSlice({ ipp: [0, 0, z], iop: AXIAL_IOP })),
  );
  const m = measureZSpacing(set as Slice[]);
  assert.ok(m);
  assert.equal(m.variable, true);
  assert.equal(m.folded, false);
  assert.equal(isPhysicallyOrdered(set as Slice[], m), true);
});

test("pila que va y vuelve al mismo sitio: se denuncia igual", () => {
  const set = [0, 0.3, 0.6, 0.3, 0].map((z) =>
    decodeOne(buildSlice({ ipp: [0, 0, z], iop: AXIAL_IOP })),
  );
  const m = measureZSpacing(set as Slice[]);
  assert.ok(m);
  assert.equal(m.variable, true);
});

test("isPhysicallyOrdered exige las TRES condiciones, y es el mismo juicio en los dos lados", () => {
  const sano = axialSet(10, 0, 0.3);
  assert.equal(isPhysicallyOrdered(sano as Slice[], measureZSpacing(sano as Slice[])), true);

  // (a) falta procedencia física en uno.
  const conHuerfano = axialSet(10, 0, 0.3);
  const huerfano = decodeOne(buildSlice({ ipp: null, iop: AXIAL_IOP, instanceNumber: 1 }));
  const mezcla = [...conHuerfano, huerfano];
  assert.equal(isPhysicallyOrdered(mezcla as Slice[], measureZSpacing(mezcla as Slice[])), false);

  // (b) dos orientaciones.
  const otraSerie = [
    ...axialSet(4, 0, 0.3),
    decodeOne(buildSlice({ ipp: [0, 0, 9], iop: [0, 1, 0, 0, 0, -1] })),
  ];
  assert.equal(isPhysicallyOrdered(otraSerie as Slice[], measureZSpacing(otraSerie as Slice[])), false);

  // (c) posición presente pero sin separar nada.
  const pegados = axialSet(8, 5, 0);
  assert.equal(isPhysicallyOrdered(pegados as Slice[], measureZSpacing(pegados as Slice[])), false);

  // Sin medida no hay promesa que hacer.
  assert.equal(isPhysicallyOrdered(sano as Slice[], null), false);
  assert.equal(isPhysicallyOrdered([], null), false);
});

test("un solo corte: no truena y no afirma nada del eje Z", () => {
  const set = axialSet(1, 0, 0.3);
  assert.equal(measureZSpacing(set as Slice[]), null);
  sortSlicesForVolume(set as Slice[]); // no debe lanzar
  assert.equal(set.length, 1);
  // Las letras EN PLANO sí se pueden dar con un solo corte (no dependen de Z).
  const ax = edgeLabelsFor("axial", set[0] as Slice, false);
  assert.deepEqual(ax, { left: "R", right: "L", top: "A", bottom: "P" });
});

test("set vacío: measureZSpacing y sortSlicesForVolume aguantan", () => {
  assert.equal(measureZSpacing([]), null);
  const empty: Slice[] = [];
  sortSlicesForVolume(empty);
  assert.equal(empty.length, 0);
});

/* ========================================================================== */
/* 3. Cortes duplicados y posiciones idénticas                                */
/* ========================================================================== */

test("cortes duplicados en medio del set: se avisa y la mediana no se va a cero", () => {
  const zs = [0, 0.3, 0.3, 0.6, 0.9];
  const set = zs.map((z, i) => decodeOne(buildSlice({ ipp: [0, 0, z], iop: AXIAL_IOP }), i));
  const m = measureZSpacing(set as Slice[]);
  assert.ok(m && m.sz !== null);
  assert.ok(Math.abs(m.sz - 0.3) < 1e-9, `sz=${m.sz}`);
  assert.equal(m.variable, true, "un corte repetido es un paso que el estudio no cumple");
});

test("TODOS los cortes en la misma posición: se denuncia en vez de pasar mudo", () => {
  // El caso que antes se colaba entero: `every(orderSource === "position")` se
  // cumple, no había ningún delta que medir, y el visor volteaba la imagen y
  // rotulaba S/I sobre 20 copias del mismo plano sin decir nada.
  const set = axialSet(20, 12.5, 0);
  const m = measureZSpacing(set as Slice[]);
  assert.ok(m, "hay posiciones: measureZSpacing tiene algo que decir");
  assert.equal(m.sz, null, "no hay distancia que medir");
  assert.equal(m.variable, true);

  const reason = geometryDoubtReason({
    route: "full",
    orderSources: set.map((s) => s.orderSource),
    samePosition: m.sz === null,
    zVariable: m.variable,
  });
  assert.equal(reason, "same-position");
});

/* ========================================================================== */
/* 4. Orientación: normal, letras, casos degenerados                          */
/* ========================================================================== */

test("IOP [1,0,0,0,1,0]: normal (0,0,1) y etiquetas axiales R/L/A/P", () => {
  const s = decodeOne(buildSlice({ ipp: [0, 0, 0], iop: AXIAL_IOP }));
  assert.deepEqual(s.planeNormal, [0, 0, 1]);
  assert.deepEqual(s.imageOrientation, [1, 0, 0, 0, 1, 0]);

  // Axial: la columna crece hacia +X = IZQUIERDA del paciente, así que la columna
  // 0 —el borde izquierdo del lienzo— es la DERECHA del paciente.
  assert.deepEqual(edgeLabelsFor("axial", s as Slice, true), {
    left: "R",
    right: "L",
    top: "A",
    bottom: "P",
  });
  // Coronal y sagital: convención radiológica, con S arriba porque el pintado
  // recorre la pila volteada cuando el orden es físico.
  assert.deepEqual(edgeLabelsFor("coronal", s as Slice, true), {
    left: "R",
    right: "L",
    top: "S",
    bottom: "I",
  });
  assert.deepEqual(edgeLabelsFor("sagittal", s as Slice, true), {
    left: "A",
    right: "P",
    top: "S",
    bottom: "I",
  });
});

test("sin orden físico NO se rotulan S/I, pero las letras en plano se mantienen", () => {
  const s = decodeOne(buildSlice({ ipp: [0, 0, 0], iop: AXIAL_IOP }));
  assert.deepEqual(edgeLabelsFor("coronal", s as Slice, false), {
    left: "R",
    right: "L",
    top: null,
    bottom: null,
  });
  // El axial no usa el eje Z en ninguno de sus dos ejes: no pierde nada.
  assert.deepEqual(edgeLabelsFor("axial", s as Slice, false), {
    left: "R",
    right: "L",
    top: "A",
    bottom: "P",
  });
});

test("normal NEGATIVA: la letra sigue al vector real, no a la costumbre", () => {
  // IOP [1,0,0, 0,-1,0] ⇒ normal (0,0,-1): `order` crece hacia INFERIOR, así que
  // el extremo que el pintado pone arriba es el inferior — y la letra lo dice.
  const s = decodeOne(buildSlice({ ipp: [0, 0, 0], iop: [1, 0, 0, 0, -1, 0] }));
  assert.deepEqual(s.planeNormal, [0, 0, -1]);
  const cor = edgeLabelsFor("coronal", s as Slice, true);
  assert.equal(cor?.top, "I");
  assert.equal(cor?.bottom, "S");
});

test("decúbito prono (IOP invertido): R y L cambian de lado", () => {
  const s = decodeOne(buildSlice({ ipp: [0, 0, 0], iop: [-1, 0, 0, 0, -1, 0] }));
  assert.deepEqual(edgeLabelsFor("axial", s as Slice, true), {
    left: "L",
    right: "R",
    top: "P",
    bottom: "A",
  });
});

test("IOP degenerado (ceros): cae al axial por defecto SIN romperse y sin rotular", () => {
  const s = decodeOne(buildSlice({ ipp: [0, 0, 5], iop: [0, 0, 0, 0, 0, 0] }));
  assert.deepEqual(s.planeNormal, [0, 0, 1], "la normal cae al axial para poder ordenar");
  assert.equal(s.imageOrientation, null, "pero el IOP degenerado NO se conserva");
  assert.equal(s.order, 5);
  assert.equal(s.orderSource, "position");
  assert.equal(edgeLabelsFor("axial", s as Slice, true), null, "sin orientación no se rotula nada");
});

test("IOP con vectores paralelos: mismo trato que el degenerado", () => {
  const s = decodeOne(buildSlice({ ipp: [0, 0, 0], iop: [1, 0, 0, 1, 0, 0] }));
  assert.deepEqual(s.planeNormal, [0, 0, 1]);
  assert.equal(s.imageOrientation, null);
});

test("sin ImageOrientationPatient: se ordena igual y no se rotula", () => {
  const s = decodeOne(buildSlice({ ipp: [0, 0, -7.5], iop: null }));
  assert.equal(s.imageOrientation, null);
  assert.deepEqual(s.planeNormal, [0, 0, 1]);
  assert.equal(s.orderSource, "position");
  assert.equal(s.order, -7.5, "sin IOP se proyecta sobre +Z, o sea se usa la z");
  assert.equal(edgeLabelsFor("axial", s as Slice, true), null);
  assert.equal(edgeLabelsFor("coronal", s as Slice, true), null);
});

/* ========================================================================== */
/* 5. Tags vacíos, corruptos y a medias                                       */
/* ========================================================================== */

test("una barra invertida de más en el IPP no tira la posición", () => {
  // Escritor real: "-12.5\-3.2\40.1\" deja un cuarto componente vacío.
  const s = decodeOne(buildSlice({ ipp: `-12.5${BS}-3.2${BS}40.1${BS}`, iop: AXIAL_IOP }));
  assert.equal(s.orderSource, "position");
  assert.deepEqual(s.imagePosition, [-12.5, -3.2, 40.1]);
});

test("IPP a medias (2 componentes) = sin posición", () => {
  const s = decodeOne(buildSlice({ ipp: `1${BS}2`, iop: AXIAL_IOP, instanceNumber: 4 }));
  assert.equal(s.orderSource, "instance");
  assert.equal(s.imagePosition, null);
  assert.equal(s.order, 4);
});

test("IPP con un valor no numérico = sin posición", () => {
  const s = decodeOne(buildSlice({ ipp: `1${BS}abc${BS}3`, iop: AXIAL_IOP, instanceNumber: 9 }));
  assert.equal(s.orderSource, "instance");
  assert.equal(s.imagePosition, null);
});

test("IPP de solo barras = sin posición", () => {
  const s = decodeOne(buildSlice({ ipp: `${BS}${BS}`, iop: AXIAL_IOP, instanceNumber: 2 }));
  assert.equal(s.orderSource, "instance");
});

test("IOP con solo 5 componentes: normal por defecto y sin rotular", () => {
  const s = decodeOne(buildSlice({ ipp: [0, 0, 1], iop: `1${BS}0${BS}0${BS}0${BS}1` }));
  assert.deepEqual(s.planeNormal, [0, 0, 1]);
  assert.equal(s.imageOrientation, null);
});

test("el relleno con espacios del VR DS se tolera", () => {
  const s = decodeOne(buildSlice({ ipp: ` 1.5 ${BS} 2.5 ${BS} 3.5 `, iop: AXIAL_IOP }));
  assert.deepEqual(s.imagePosition, [1.5, 2.5, 3.5]);
  assert.equal(s.order, 3.5);
});

/* ========================================================================== */
/* 6. Dos series en la misma carpeta                                          */
/* ========================================================================== */

test("orientaciones distintas en el mismo set: sameOrientation lo caza", () => {
  const axial = decodeOne(buildSlice({ ipp: [0, 0, 0], iop: AXIAL_IOP }));
  const scout = decodeOne(buildSlice({ ipp: [10, 0, 0], iop: [0, 1, 0, 0, 0, -1] }));
  assert.equal(sameOrientation([axial, scout] as Slice[]), false);
  assert.equal(sameOrientation([axial, axial] as Slice[]), true);
  // Los dos declaran posición, así que la procedencia sola NO los separa: es
  // justo por eso que hace falta mirar también la orientación.
  assert.equal(axial.orderSource, "position");
  assert.equal(scout.orderSource, "position");

  const reason = geometryDoubtReason({
    route: "full",
    orderSources: [axial.orderSource, scout.orderSource],
    mixedSeries: true,
  });
  assert.equal(reason, "mixed-series");
});

test("un corte declara orientación y el otro no: tampoco es un set homogéneo", () => {
  const conIop = decodeOne(buildSlice({ ipp: [0, 0, 0], iop: AXIAL_IOP }));
  const sinIop = decodeOne(buildSlice({ ipp: [0, 0, 1], iop: null }));
  assert.equal(sameOrientation([conIop, sinIop] as Slice[]), false);
});

test("cortes de otro tamaño se descartan en vez de pintarse con el stride corrido", () => {
  const a = decodeOne(buildSlice({ rows: 4, cols: 4, ipp: [0, 0, 0], iop: AXIAL_IOP, fill: 1 }));
  const b = decodeOne(buildSlice({ rows: 2, cols: 2, ipp: [0, 0, 1], iop: AXIAL_IOP, fill: 2 }));
  const c = decodeOne(buildSlice({ rows: 4, cols: 4, ipp: [0, 0, 2], iop: AXIAL_IOP, fill: 3 }));
  const kept = keepDominantSeries([a, b, c]);
  assert.equal(kept.length, 2);
  assert.deepEqual(
    kept.map((s) => s.pixels[0]),
    [1, 3],
  );
  // Sin nada que descartar devuelve EL MISMO array (no fuerza un repintado).
  const homog = [a, c];
  assert.equal(keepDominantSeries(homog), homog);
});

test("el scout PRIMERO en el zip no se lleva por delante el volumen: manda la mayoría", () => {
  // El filtro corre ANTES de ordenar, así que el primer corte es el que venga
  // primero dentro del .zip. Tomarlo como referencia dejaba el estudio reducido a
  // la imagen de localización, y todo lo que se juzga después se calcula sobre lo
  // que quedó —que es homogéneo y coherente consigo mismo—, así que no avisaba.
  const scout = decodeOne(buildSlice({ rows: 2, cols: 2, ipp: [0, 0, 0], iop: AXIAL_IOP, fill: 99 }));
  const volumen = [];
  for (let i = 0; i < 6; i++) {
    volumen.push(decodeOne(buildSlice({ rows: 4, cols: 4, ipp: [0, 0, i], iop: AXIAL_IOP, fill: i + 1 })));
  }
  const kept = keepDominantSeries([scout, ...volumen]);
  assert.equal(kept.length, 6, "se quedó con el scout en vez de con el volumen");
  assert.deepEqual(
    kept.map((s) => s.pixels[0]),
    [1, 2, 3, 4, 5, 6],
  );
  // Y el hecho de haber descartado algo tiene que llegar al aviso: si no, el
  // estudio parece sano porque los cortes que sobran ya no están para desmentirlo.
  assert.equal(
    geometryDoubtReason({
      route: "full",
      orderSources: kept.map((s) => s.orderSource),
      mixedSeries: kept.length !== 1 + volumen.length,
    }),
    "mixed-series",
  );
});

test("dos series con la MISMA matriz y lateralidad opuesta: se descarta la minoritaria", () => {
  // El fallo más grave de toda la auditoría, y el que sobrevivió al primer
  // arreglo: dos series axiales de 4×4 con IOP opuesto. El filtro por raster no
  // las separa (misma matriz), `zPhysicalOrder` solo apaga las letras del eje Z, y
  // el panel AXIAL saca sus cuatro letras del IOP de `slices[0]` — así que si el
  // primero es de la serie invertida, se pinta "R" donde está la IZQUIERDA del
  // paciente. Una letra ausente se tolera; una invertida, no.
  const invertida = [];
  for (let i = 0; i < 2; i++) {
    invertida.push(
      decodeOne(buildSlice({ rows: 4, cols: 4, ipp: [0, 0, i], iop: [-1, 0, 0, 0, -1, 0], fill: 90 + i })),
    );
  }
  const buena = [];
  for (let i = 0; i < 6; i++) {
    buena.push(decodeOne(buildSlice({ rows: 4, cols: 4, ipp: [0, 0, i], iop: AXIAL_IOP, fill: i + 1 })));
  }
  // La serie invertida llega PRIMERO en el .zip.
  const kept = keepDominantSeries([...invertida, ...buena]);
  assert.equal(kept.length, 6, "la minoritaria tenía que caer aunque llegue primero");
  assert.equal(sameOrientation(kept), true);
  // Y ahora la letra del borde izquierdo es la del paciente de VERDAD.
  assert.deepEqual(edgeLabelsFor("axial", kept[0] as Slice, true), {
    left: "R",
    right: "L",
    top: "A",
    bottom: "P",
  });
  // Sin el filtro, `slices[0]` sería el de la serie invertida y saldría al revés:
  // esto documenta la inversión exacta que se estaba pintando.
  assert.deepEqual(edgeLabelsFor("axial", invertida[0] as Slice, true), {
    left: "L",
    right: "R",
    top: "P",
    bottom: "A",
  });
});

test("dos campos de visión con la MISMA matriz y orientación: los separa el SeriesInstanceUID", () => {
  // El caso que ni la matriz ni la orientación distinguen: dos adquisiciones del
  // mismo paciente, mismo raster, mismo IOP, distinto FoV (0.3 y 0.15 mm/px). Por
  // indicios caen en la misma clave y se apilan juntas — el doble de escala en
  // media pila y un salto de dos centímetros en el coronal, sin un solo aviso. La
  // identidad que el equipo escribió las separa sin discutir.
  const finas = [];
  for (let i = 0; i < 3; i++) {
    finas.push(
      decodeOne(
        buildSlice({
          seriesUid: "1.2.3.SERIE.FINA",
          ipp: [0, 0, i * 0.15],
          iop: AXIAL_IOP,
          pixelSpacing: [0.15, 0.15],
          fill: 50 + i,
        }),
      ),
    );
  }
  const gruesas = [];
  for (let i = 0; i < 8; i++) {
    gruesas.push(
      decodeOne(
        buildSlice({
          seriesUid: "1.2.3.SERIE.GRUESA",
          ipp: [0, 0, i * 0.3],
          iop: AXIAL_IOP,
          pixelSpacing: [0.3, 0.3],
          fill: i + 1,
        }),
      ),
    );
  }
  assert.equal(finas[0].seriesUid, "1.2.3.SERIE.FINA");
  // Mismos indicios: misma matriz y misma orientación en las dos series.
  assert.equal(sameOrientation([...finas, ...gruesas]), true);
  assert.equal(finas[0].rows, gruesas[0].rows);

  const kept = keepDominantSeries([...finas, ...gruesas]);
  assert.equal(kept.length, 8, "sin el UID las dos series se apilaban juntas");
  assert.deepEqual(
    kept.map((s) => s.pixelSpacing[0]),
    [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3],
  );
});

test("sin SeriesInstanceUID se cae a los indicios (raster + orientación)", () => {
  // Hay .zip anonimizados que borran el UID. Ahí el filtro sigue funcionando con
  // lo que queda, que es como se comportaba antes de leerlo.
  const buena = [];
  for (let i = 0; i < 4; i++) {
    buena.push(decodeOne(buildSlice({ seriesUid: null, ipp: [0, 0, i], iop: AXIAL_IOP, fill: i + 1 })));
  }
  const otra = decodeOne(
    buildSlice({ seriesUid: null, ipp: [0, 0, 0], iop: [-1, 0, 0, 0, -1, 0], fill: 99 }),
  );
  assert.equal(buena[0].seriesUid, null);
  const kept = keepDominantSeries([otra, ...buena]);
  assert.equal(kept.length, 4);
  assert.deepEqual(
    kept.map((s) => s.pixels[0]),
    [1, 2, 3, 4],
  );
});

test("empate exacto de rasters: gana el del primer corte, y siempre el mismo", () => {
  const a = decodeOne(buildSlice({ rows: 4, cols: 4, ipp: [0, 0, 0], iop: AXIAL_IOP, fill: 1 }));
  const b = decodeOne(buildSlice({ rows: 2, cols: 2, ipp: [0, 0, 1], iop: AXIAL_IOP, fill: 2 }));
  const kept = keepDominantSeries([a, b]);
  assert.deepEqual(
    kept.map((s) => s.pixels[0]),
    [1],
  );
  // Determinista: repetirlo da lo mismo (nada de recorrer un Map con orden
  // dependiente de la inserción para elegir el ganador de un empate).
  assert.deepEqual(keepDominantSeries([a, b]).length, 1);
});

/* ========================================================================== */
/* 7. Multi-frame: no se inventa la posición de los frames                    */
/* ========================================================================== */

/** PixelData de `frames` cortes de rows×cols, cada uno relleno con f+1. */
function framePixels(rows: number, cols: number, frames: number): Int16Array {
  const per = rows * cols;
  const px = new Int16Array(per * frames);
  for (let f = 0; f < frames; f++) px.fill(f + 1, f * per, (f + 1) * per);
  return px;
}

test("multi-frame SIN posición por frame: se degrada a índice en vez de suponerla", () => {
  // NumberOfFrames = 3 con IPP raíz y SIN PerFrameFunctionalGroupsSequence. Antes
  // se sintetizaba la posición de los frames 1 y 2 sumando `zSpacing` sobre la
  // normal; después el visor "medía" esas posiciones, recuperaba el número que él
  // mismo había inventado y lo declaraba calibrado y regular. Ahora se dice que no
  // se sabe: los frames pasan a "instance" y solo el frame 0 conserva su posición.
  const out = decodeSlice(
    buildSlice({
      ipp: [0, 0, 10],
      iop: AXIAL_IOP,
      instanceNumber: 5,
      sliceThickness: 0.4,
      numberOfFrames: 3,
      pixels: framePixels(2, 2, 3),
    }),
    0,
  );
  assert.ok(out && out.length === 3, `se esperaban 3 frames, llegaron ${out?.length}`);
  assert.deepEqual(
    out.map((s) => s.orderSource),
    ["instance", "instance", "instance"],
  );
  assert.deepEqual(
    out.map((s) => s.order),
    [5, 6, 7],
    "`order` vuelve a ser un ÍNDICE: InstanceNumber + el número de frame",
  );
  assert.deepEqual(out[0].imagePosition, [0, 0, 10], "la del frame 0 sí consta (tag raíz)");
  assert.equal(out[1].imagePosition, null, "la de los demás NO se inventa");
  assert.equal(out[2].imagePosition, null);
  // Y como consecuencia: nada que medir, así que el visor no puede declararse
  // calibrado con un número que se habría inventado él solo.
  assert.equal(measureZSpacing(out as Slice[]), null);
  assert.equal(
    geometryDoubtReason({ route: "full", orderSources: out.map((s) => s.orderSource) }),
    "no-position",
  );
});

test("multi-frame CON posición por frame: se lee de verdad y ordena por geometría", () => {
  // Frames en z DECRECIENTE (40, 39.7, 39.4): el caso que la síntesis anterior no
  // podía representar y que dejaba el volumen del revés con la letra equivocada.
  const out = decodeSlice(
    buildSlice({
      ipp: [0, 0, 40],
      iop: AXIAL_IOP,
      instanceNumber: 1,
      sliceThickness: 0.4,
      numberOfFrames: 3,
      framePositions: [
        [0, 0, 40],
        [0, 0, 39.7],
        [0, 0, 39.4],
      ],
      pixels: framePixels(2, 2, 3),
    }),
    0,
  );
  assert.ok(out && out.length === 3);
  assert.deepEqual(
    out.map((s) => s.orderSource),
    ["position", "position", "position"],
  );
  assert.deepEqual(
    out.map((s) => s.imagePosition),
    [
      [0, 0, 40],
      [0, 0, 39.7],
      [0, 0, 39.4],
    ],
  );
  // `order` es la proyección sobre la normal, o sea la z de cada frame.
  out.forEach((s, i) => assert.ok(Math.abs(s.order - [40, 39.7, 39.4][i]) < 1e-9));

  // Y al ordenar, el volumen queda de menor a mayor z: los frames se dan la vuelta.
  sortSlicesForVolume(out as Slice[]);
  assert.deepEqual(
    out.map((s) => s.pixels[0]),
    [3, 2, 1],
    "el frame 2 (z=39.4) es el más inferior y va primero",
  );
  const m = measureZSpacing(out as Slice[]);
  assert.ok(m && m.sz !== null);
  assert.ok(Math.abs(m.sz - 0.3) < 1e-6, `sz=${m.sz}, se esperaba 0.3 (paso REAL, no el 0.4 del header)`);
});

test("enhanced multi-frame SIN ImagePositionPatient raíz: la posición sale de los frames", () => {
  // Un enhanced multi-frame CONFORME no trae el tag raíz: su sitio está dentro de
  // PerFrameFunctionalGroupsSequence. Exigir la raíz mandaba justo esos archivos
  // —los que MEJOR declaran su geometría— a la rama de "no se sabe", con las
  // posiciones ya leídas y en la mano.
  const out = decodeSlice(
    buildSlice({
      ipp: null, // ← la raíz NO lo trae, como manda el IOD
      iop: AXIAL_IOP,
      numberOfFrames: 3,
      framePositions: [
        [0, 0, 5],
        [0, 0, 5.3],
        [0, 0, 5.6],
      ],
      pixels: framePixels(2, 2, 3),
    }),
    0,
  );
  assert.ok(out && out.length === 3);
  assert.deepEqual(
    out.map((s) => s.orderSource),
    ["position", "position", "position"],
    "con las posiciones por frame leídas, esto SÍ es geometría física",
  );
  out.forEach((s, i) => assert.ok(Math.abs(s.order - [5, 5.3, 5.6][i]) < 1e-9));
  const m = measureZSpacing(out as Slice[]);
  assert.ok(m && m.sz !== null && Math.abs(m.sz - 0.3) < 1e-6);
  assert.equal(isPhysicallyOrdered(out as Slice[], m), true);
});

test("multi-frame con menos frames en el PixelData de los declarados: no se sale de rango", () => {
  // NumberOfFrames dice 4 pero solo caben 2 en el PixelData. El núcleo recorta a
  // lo que de verdad hay; las posiciones por frame se leyeron para 4.
  const out = decodeSlice(
    buildSlice({
      ipp: [0, 0, 0],
      iop: AXIAL_IOP,
      numberOfFrames: 4,
      framePositions: [
        [0, 0, 0],
        [0, 0, 0.3],
        [0, 0, 0.6],
        [0, 0, 0.9],
      ],
      pixels: framePixels(2, 2, 2),
    }),
    0,
  );
  assert.ok(out && out.length === 2, `se esperaban 2 frames reales, llegaron ${out?.length}`);
  assert.deepEqual(
    out.map((s) => s.imagePosition),
    [
      [0, 0, 0],
      [0, 0, 0.3],
    ],
  );
});

/* ========================================================================== */
/* 8. El aviso: se advierte de lo que consta, y solo de eso                   */
/* ========================================================================== */

test("estudio sano: ninguna advertencia", () => {
  const set = axialSet(10, 0, 0.3);
  const m = measureZSpacing(set as Slice[]);
  assert.ok(m);
  assert.equal(
    geometryDoubtReason({
      route: "full",
      orderSources: set.map((s) => s.orderSource),
      samePosition: m.sz === null,
      mixedSeries: !sameOrientation(set as Slice[]),
      zVariable: m.variable,
    }),
    null,
  );
});

test("ningún corte con posición: motivo no-position", () => {
  assert.equal(
    geometryDoubtReason({ route: "full", orderSources: ["instance", "instance"] }),
    "no-position",
  );
});

test("procedencias mezcladas: motivo mixed-order, que es el peor de los que aplican", () => {
  assert.equal(
    geometryDoubtReason({
      route: "full",
      orderSources: ["position", "instance", "position"],
      zVariable: true, // aunque también sea irregular, manda el orden
    }),
    "mixed-order",
  );
});

test("espaciado irregular con todo lo demás bien: motivo variable-z", () => {
  assert.equal(
    geometryDoubtReason({ route: "full", orderSources: ["position", "position"], zVariable: true }),
    "variable-z",
  );
});

test("ruta móvil: un lite 'positioned' NO dispara la advertencia", () => {
  // Sus cortes declaran "instance" siempre; juzgarlos por ahí haría que todos los
  // usuarios de móvil vieran un aviso falso en todos los estudios.
  assert.equal(geometryDoubtReason({ route: "lite", sourceGeometry: "positioned" }), null);
  assert.equal(geometryDoubtReason({ route: "lite", sourceGeometry: "unpositioned" }), "no-position");
  // "unknown" = binario anterior al campo: no consta que esté mal.
  assert.equal(geometryDoubtReason({ route: "lite", sourceGeometry: "unknown" }), null);
});

test("sin cortes todavía no se juzga nada", () => {
  assert.equal(geometryDoubtReason({ route: "full", orderSources: [] }), null);
});

/* ========================================================================== */
/* 9. Cruz y sonda: el vóxel leído es el pintado, también con volteo          */
/* ========================================================================== */

// Las conversiones que se ejercitan aquí son EXACTAMENTE las que usa MprPane:
// se importan del módulo compartido, no se reescriben. Esa es la diferencia entre
// probar el pintado y probar una copia del pintado — con la copia se podía romper
// la fórmula del bucle real y las tres pruebas seguían en verde.
//   pintado  (MprPane, rama coronal/sagital) → sampleDepthAtRow
//   cruz     (overlay)                       → flipNormV(voxToNorm(z, d)) * H
//   clic     (crossFromNorm)                 → normToVox(flipNormV(v), d)
//   sonda    (sampleValueAt)                 → igual que el clic

// El índice del corte más cercano a una coordenada continua. El `+ 0` normaliza
// el CERO NEGATIVO y no es adorno: `Math.round(-0.4)` da `-0`, y la guarda
// `v < 0 ? 0 : v` de `normToVox` no lo atrapa porque `-0 < 0` es falso. En el
// visor da igual —`slices[-0]` es `slices[0]` y `Math.max(-0, 0)` es `0`— pero
// `assert.equal` usa `Object.is`, que sí los distingue. Se normaliza aquí, en la
// prueba, y no en el código: cambiar `normToVox` por esto sería añadirle una
// operación a un bucle de píxeles para arreglar un problema que solo tiene el
// comparador de las pruebas.
const nearestSlice = (fz: number, depth: number) => {
  const z = Math.round(fz) + 0;
  return z < 0 ? 0 : z > depth - 1 ? depth - 1 : z;
};

test("volteo activo: el clic en el centro de una fila devuelve el vóxel que se pintó ahí", () => {
  const depth = 10;
  const H = 40; // filas del raster (submuestreo 4:1 respecto de los cortes)
  for (const flip of [true, false]) {
    for (let b = 0; b < H; b++) {
      // Qué corte se pintó en la fila b.
      const fz = sampleDepthAtRow(b, H, depth, flip);
      const pintado = nearestSlice(fz, depth);
      // El usuario hace clic en el CENTRO de esa fila del lienzo.
      const v = (b + 0.5) / H;
      const leido = normToVox(flipNormV(v, flip), depth) + 0; // ver nearestSlice (−0)
      assert.equal(leido, pintado, `flip=${flip} fila b=${b}: pintó ${pintado} y leyó ${leido}`);
    }
  }
});

test("volteo activo: la cruz cae en el centro EXACTO de la fila donde está su vóxel", () => {
  const depth = 10;
  const H = 40;
  for (const flip of [true, false]) {
    for (let z = 0; z < depth; z++) {
      const hy = flipNormV(voxToNorm(z, depth), flip) * H;
      // Fila del raster en la que cae la línea de la cruz.
      const b = Math.floor(hy);
      const fz = sampleDepthAtRow(b, H, depth, flip);
      assert.equal(
        nearestSlice(fz, depth),
        z,
        `flip=${flip} z=${z}: la cruz cayó en la fila ${b}, que pinta ${nearestSlice(fz, depth)}`,
      );
    }
  }
});

test("volteo activo: el vóxel de valor conocido se lee donde se pintó (caso cerrado)", () => {
  // Volumen 4×4×10, todo a 0 salvo el vóxel (x=2, y=1, z=7) que vale 1234.
  const depth = 10;
  const rows = 4;
  const cols = 4;
  const vol: Int16Array[] = [];
  for (let z = 0; z < depth; z++) vol.push(new Int16Array(rows * cols));
  vol[7][1 * cols + 2] = 1234;

  const H = 40;
  const flip = true;
  // Fila del raster que muestra z=7 (con volteo: fz(b) = (H−1−b+0.5)·d/H − 0.5).
  let filaDelSiete = -1;
  for (let b = 0; b < H; b++) {
    const fz = sampleDepthAtRow(b, H, depth, flip);
    if (nearestSlice(fz, depth) === 7) {
      filaDelSiete = b;
      break;
    }
  }
  assert.ok(filaDelSiete >= 0, "no se encontró la fila que pinta z=7");

  // Clic en el centro de esa fila, sobre la columna x=2 (plano coronal, y fijo=1).
  const v = (filaDelSiete + 0.5) / H;
  const z = normToVox(flipNormV(v, flip), depth);
  assert.equal(z, 7);
  const valor = vol[z][1 * cols + 2];
  assert.equal(valor, 1234, "la sonda leyó otro vóxel del que se está pintando");
});

/* ========================================================================== */
/* 10. Binario lite: ida y vuelta de la geometría                             */
/* ========================================================================== */

function liteMeta(over: Partial<CbctLiteMeta> = {}): CbctLiteMeta {
  return {
    count: 2,
    rows: 2,
    cols: 2,
    dx: 0.25,
    dy: 0.25,
    dz: 0.3,
    center: 0,
    width: 2000,
    invert: false,
    hasRealSpacing: true,
    sourceGeometry: "positioned",
    zVariable: false,
    droppedForeign: false,
    imageOrientation: [1, 0, 0, 0, 1, 0],
    ...over,
  };
}

test("el lite transporta la procedencia y el IOP de ida y vuelta", () => {
  const voxels = new Int16Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const bytes = encodeCbctLite(liteMeta(), voxels);
  const parsed = decodeCbctLite(bytes.buffer.slice(0) as ArrayBuffer);
  assert.ok(parsed);
  assert.equal(parsed.meta.sourceGeometry, "positioned");
  assert.deepEqual(parsed.meta.imageOrientation, [1, 0, 0, 0, 1, 0]);
  // Y los cortes llegan rotulables: es lo que le faltaba a la ruta de móvil.
  assert.deepEqual(edgeLabelsFor("axial", parsed.slices[0] as Slice, true), {
    left: "R",
    right: "L",
    top: "A",
    bottom: "P",
  });
  assert.deepEqual(Array.from(parsed.slices[1].pixels), [5, 6, 7, 8]);
});

test("lite sin orientación: se lee como 'no declarada' y no se rotula", () => {
  const voxels = new Int16Array([0, 0, 0, 0, 0, 0, 0, 0]);
  const bytes = encodeCbctLite(liteMeta({ imageOrientation: null }), voxels);
  const parsed = decodeCbctLite(bytes.buffer.slice(0) as ArrayBuffer);
  assert.ok(parsed);
  assert.equal(parsed.meta.imageOrientation, null);
  assert.equal(parsed.slices[0].imageOrientation, null);
  assert.equal(edgeLabelsFor("axial", parsed.slices[0] as Slice, true), null);
});

test("lite con dz inválido se RECHAZA en vez de dejar el visor en blanco", () => {
  // Un dz de 0 o NaN atraviesa rasterDims/fitContain hasta `createImageData(0,0)`,
  // que LANZA dentro de un efecto de React.
  for (const dz of [0, -1, NaN]) {
    const bytes = encodeCbctLite(liteMeta({ dz }), new Int16Array(8));
    assert.equal(decodeCbctLite(bytes.buffer.slice(0) as ArrayBuffer), null, `dz=${dz}`);
  }
});

test("el lite transporta el espaciado irregular: el móvil también avisa", () => {
  // Sin este bit, un CBCT de paso irregular avisaba en el escritorio y callaba en
  // el teléfono — la divergencia exacta que este arreglo existe para cerrar.
  const bytes = encodeCbctLite(liteMeta({ zVariable: true }), new Int16Array(8));
  const parsed = decodeCbctLite(bytes.buffer.slice(0) as ArrayBuffer);
  assert.ok(parsed);
  assert.equal(parsed.meta.zVariable, true);
  assert.equal(parsed.meta.sourceGeometry, "positioned", "el bit no pisa la procedencia");
  assert.equal(
    geometryDoubtReason({ route: "lite", sourceGeometry: "positioned", zVariable: true }),
    "variable-z",
  );
  // Y sin él, nada que advertir.
  const limpio = decodeCbctLite(
    encodeCbctLite(liteMeta({ zVariable: false }), new Int16Array(8)).buffer.slice(0) as ArrayBuffer,
  );
  assert.equal(limpio?.meta.zVariable, false);
});

test("el lite transporta que se descartaron cortes de otra serie", () => {
  // El movil recibe el volumen YA filtrado por el servidor: los cortes que lo
  // delatarian no estan. Sin este bit, el mismo .zip con dos series avisaba en el
  // escritorio y se veia impecable en el telefono.
  const bytes = encodeCbctLite(liteMeta({ droppedForeign: true }), new Int16Array(8));
  const parsed = decodeCbctLite(bytes.buffer.slice(0) as ArrayBuffer);
  assert.ok(parsed);
  assert.equal(parsed.meta.droppedForeign, true);
  assert.equal(parsed.meta.sourceGeometry, "positioned", "el bit no pisa la procedencia");
  assert.equal(parsed.meta.zVariable, false, "ni al vecino");
  assert.equal(
    geometryDoubtReason({ route: "lite", sourceGeometry: "positioned", mixedSeries: true }),
    "mixed-series",
  );
});

test("bits desconocidos del byte de geometría no rompen la lectura", () => {
  // Los bits 5-7 quedan libres. Un escritor futuro que los use no debe hacer que
  // este lector confunda la procedencia: por eso enmascara en vez de comparar el
  // byte entero, que es lo que hacía antes.
  const bytes = encodeCbctLite(liteMeta({ sourceGeometry: "positioned" }), new Int16Array(8));
  bytes[7] |= 0b1010_0000; // dos bits que este código no conoce
  const parsed = decodeCbctLite(bytes.buffer.slice(0) as ArrayBuffer);
  assert.ok(parsed);
  assert.equal(parsed.meta.sourceGeometry, "positioned");
});

test("un binario que no es un lite devuelve null y no lanza", () => {
  assert.equal(decodeCbctLite(new ArrayBuffer(0)), null);
  assert.equal(decodeCbctLite(new ArrayBuffer(64)), null); // magic a ceros
});
