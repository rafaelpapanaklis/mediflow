/**
 * Procedimiento hecho → altas y bajas del odontograma, con su deshacer (ws1-t5, pieza B).
 *
 * Run: npm run test:plan-hecho-odontograma
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyToothDelta } from "../../../components/dashboard/odontogram-v2/merge-consulta";
import { entriesToRecords } from "../../../components/dashboard/odontogram-v2/adapter";
import {
  CONDICION_TRAS_EXTRACCION, EFECTO_HECHO, aplicarAEntradas, aplicarHecho, cambioDeshacer, comoCambiosDeSync,
  planearDeshacer, type EntradaConId, type EntradaOdontograma,
} from "../aplicar-hecho";
import { CONDICIONES_CLINICAS, PROCEDIMIENTOS, type ClaveProcedimiento } from "../../treatments/sugerir-procedimiento";
import { CONDITIONS } from "../../../components/dashboard/odontogram-v2/data";

const e = (toothNumber: number, surface: EntradaOdontograma["surface"], conditionId: string, notes: string | null = null): EntradaOdontograma =>
  ({ toothNumber, surface, conditionId, notes });
const corto = (l: EntradaOdontograma[]) => l.map((x) => `${x.toothNumber}${x.surface ?? "·"}:${x.conditionId}`);
const ordenado = (l: EntradaOdontograma[]) => corto(l).sort();

/** El cambio, aplicado y deshecho, deja el odontograma EXACTAMENTE como estaba. */
function idaYVuelta(entradas: EntradaOdontograma[], c: ReturnType<typeof aplicarHecho>) {
  const despues = aplicarAEntradas(entradas, c);
  const vuelta = aplicarAEntradas(despues, cambioDeshacer(c));
  assert.deepEqual(ordenado(vuelta), ordenado(entradas));
  // Las notas de lo que se quitó regresan con el deshacer.
  for (const b of c.bajas) {
    const original = entradas.find((x) => x.toothNumber === b.toothNumber && x.surface === b.surface && x.conditionId === b.conditionId);
    assert.equal(c.deshacer.altas.find((a) => a.conditionId === b.conditionId && a.surface === b.surface && a.toothNumber === b.toothNumber)?.notes ?? null, original?.notes ?? null);
  }
  return despues;
}

test("resina sobre la caries de esas caras: se quita la caries y queda la restauración", () => {
  const ent = [e(16, "M", "caries"), e(16, "O", "caries"), e(16, "D", "caries"), e(16, null, "__note__", "sensible al frío")];
  const c = aplicarHecho({ nombre: "Restauración resina 2 caras", dientes: [16], caras: ["M", "O"] }, ent);
  assert.equal(c.clave, "resina");
  assert.equal(c.sinCambio, null);
  assert.deepEqual(corto(c.bajas), ["16M:caries", "16O:caries"]);
  assert.deepEqual(corto(c.altas), ["16M:restoration", "16O:restoration"]);
  const despues = idaYVuelta(ent, c);
  // La caries distal (no trabajada) y la nota del diente siguen ahí.
  assert.deepEqual(ordenado(despues), ["16D:caries", "16M:restoration", "16O:restoration", "16·:__note__"]);
});

test("resina sin caras: va donde está la caries; incisal de un anterior es la «O» de la base", () => {
  const ent = [e(21, "O", "caries"), e(21, "M", "caries_inc"), e(21, "V", "pigmentation")];
  const c = aplicarHecho({ codigo: "ODO_RESINA", dientes: [21] }, ent);
  assert.deepEqual(corto(c.bajas), ["21M:caries_inc", "21O:caries"]);
  assert.deepEqual(corto(c.altas), ["21M:restoration", "21O:restoration"]);
  const conI = aplicarHecho({ clave: "resina", dientes: [21], caras: ["I"] }, ent);
  assert.deepEqual(corto(conI.altas), ["21O:restoration"]);
  // Sin caras y sin caries que la ubique: no se inventa dónde.
  assert.equal(aplicarHecho({ clave: "resina", dientes: [11] }, []).sinCambio, "sin_caras");
});

test("resina sobre una restauración temporal la sustituye", () => {
  const ent = [e(36, "O", "temp_rest")];
  const c = aplicarHecho({ clave: "resina", dientes: [36], caras: ["O"] }, ent);
  assert.deepEqual([corto(c.bajas), corto(c.altas)], [["36O:temp_rest"], ["36O:restoration"]]);
});

test("conducto sobre la pulpitis (la lesión periapical se queda: se controla con radiografía)", () => {
  const ent = [e(46, null, "pulpitis"), e(46, null, "periapical2"), e(46, "O", "caries")];
  const c = aplicarHecho({ nombre: "Endodoncia multirradicular", dientes: [46] }, ent);
  assert.deepEqual([corto(c.bajas), corto(c.altas)], [["46·:pulpitis"], ["46·:rct"]]);
  idaYVuelta(ent, c);
  // Necrosis también se va; retratamiento deja su marca propia.
  const re = aplicarHecho({ nombre: "Retratamiento de conductos", dientes: [36] }, [e(36, null, "rct"), e(36, null, "necrosis")]);
  assert.deepEqual([corto(re.bajas), corto(re.altas)], [["36·:necrosis"], ["36·:retreatment"]]);
});

test("pulpotomía: la de temporal en un temporal, la de permanente en un permanente", () => {
  assert.deepEqual(corto(aplicarHecho({ clave: "pulpotomia", dientes: [85] }, [e(85, null, "pulpitis")]).altas), ["85·:pulpotomy_ped"]);
  assert.deepEqual(corto(aplicarHecho({ clave: "pulpotomia", dientes: [46] }, [e(46, null, "pulpitis")]).altas), ["46·:pulpotomy"]);
});

test("ausente tras la extracción: se va todo lo del diente menos su nota, y el deshacer lo devuelve con sus notas", () => {
  const ent = [
    e(38, null, "ext_indicated", "tercer molar en mesioversión"), e(38, "O", "caries"), e(38, null, "impacted"),
    e(38, null, "__note__", "riesgo de nervio"), e(37, "O", "caries"),
  ];
  const c = aplicarHecho({ nombre: "Extracción quirúrgica", dientes: [38] }, ent);
  assert.equal(c.clave, "extraccion_quirurgica");
  assert.deepEqual(corto(c.bajas), ["38·:ext_indicated", "38·:impacted", "38O:caries"]);
  assert.deepEqual(corto(c.altas), [`38·:${CONDICION_TRAS_EXTRACCION}`]);
  assert.equal(CONDICION_TRAS_EXTRACCION, "missing");
  assert.equal(c.deshacer.altas.find((x) => x.conditionId === "ext_indicated")?.notes, "tercer molar en mesioversión");
  const despues = idaYVuelta(ent, c);
  assert.ok(corto(despues).includes("38·:__note__"));
  assert.ok(corto(despues).includes("37O:caries"));
  // Extraer un diente que ya está ausente: no cambia nada.
  assert.equal(aplicarHecho({ codigo: "ODO_EXTRACCION", dientes: [36] }, [e(36, null, "missing")]).sinCambio, "ya_estaba");
  // Si tenía «ausente» y más cosas, el «ausente» se queda y se va lo demás.
  const conAusente = aplicarHecho({ codigo: "ODO_EXTRACCION", dientes: [36] }, [e(36, null, "missing"), e(36, null, "root_remnant")]);
  assert.deepEqual([corto(conAusente.bajas), corto(conAusente.altas)], [["36·:root_remnant"], []]);
});

test("corona: tapa la fractura y las caries del diente; implante: reemplaza el ausente", () => {
  const ent = [e(11, null, "fracture"), e(11, "O", "caries"), e(11, null, "rct"), e(11, "M", "restoration")];
  const c = aplicarHecho({ nombre: "Corona de zirconio", dientes: [11] }, ent);
  assert.deepEqual([corto(c.bajas), corto(c.altas)], [["11·:fracture", "11O:caries"], ["11·:crown"]]);
  idaYVuelta(ent, c);
  const imp = aplicarHecho({ codigo: "ODO_IMPLANTE", dientes: [36] }, [e(36, null, "missing")]);
  assert.deepEqual([corto(imp.bajas), corto(imp.altas)], [["36·:missing"], ["36·:implant"]]);
  const acero = aplicarHecho({ nombre: "Corona de acero cromo", dientes: [75] }, []);
  assert.deepEqual(corto(acero.altas), ["75·:steel_crown"]);
});

test("limpieza de toda la boca: sin dientes, quita el cálculo y el sangrado donde estén", () => {
  const ent = [e(31, "L", "calculus"), e(41, "L", "calculus"), e(41, "V", "calculus"), e(16, null, "bleeding"), e(16, null, "pocket")];
  const c = aplicarHecho({ nombre: "Profilaxis (limpieza)", dientes: [] }, ent);
  assert.deepEqual(corto(c.bajas), ["16·:bleeding", "31L:calculus", "41L:calculus", "41V:calculus"]);
  assert.deepEqual(c.altas, []);
  const despues = idaYVuelta(ent, c);
  assert.deepEqual(corto(despues), ["16·:pocket"]); // la bolsa periodontal no se va con una limpieza
  // Raspado de un cuadrante: solo esos dientes.
  const q = aplicarHecho({ clave: "raspado", dientes: [41] }, ent);
  assert.deepEqual(corto(q.bajas), ["41L:calculus", "41V:calculus"]);
  // Nada que limpiar.
  assert.equal(aplicarHecho({ clave: "limpieza", dientes: [] }, []).sinCambio, "ya_estaba");
});

test("sellante: solo en oclusal, aunque se le pidan otras caras", () => {
  const c = aplicarHecho({ nombre: "Sellador de fosetas", dientes: [36, 46], caras: ["M", "O"] }, [e(36, "O", "caries_inc")]);
  assert.deepEqual([corto(c.bajas), corto(c.altas)], [["36O:caries_inc"], ["36O:sealant", "46O:sealant"]]);
  const sinCaras = aplicarHecho({ clave: "sellante", dientes: [16] }, []);
  assert.deepEqual(corto(sinCaras.altas), ["16O:sealant"]);
});

test("varios dientes en un renglón; dientes que no existen se ignoran y se reportan", () => {
  const ent = [e(16, "O", "caries"), e(26, "O", "caries")];
  const c = aplicarHecho({ clave: "resina", dientes: [16, 26, 99, 16], caras: ["O"] }, ent);
  assert.deepEqual(corto(c.altas), ["16O:restoration", "26O:restoration"]);
  assert.deepEqual(c.dientesInvalidos, [99]);
  assert.equal(aplicarHecho({ clave: "endodoncia", dientes: [99] }, []).sinCambio, "sin_dientes");
});

test("lo que no deja marca o no se reconoce no cambia nada", () => {
  assert.equal(aplicarHecho({ nombre: "Consulta general", dientes: [16] }, []).sinCambio, "procedimiento_desconocido");
  assert.equal(aplicarHecho({ codigo: "ODO_BLANQUEAMIENTO", nombre: "Blanqueamiento", dientes: [11] }, []).sinCambio, "procedimiento_desconocido");
  assert.equal(aplicarHecho({ nombre: "Aplicación de flúor", dientes: [] }, []).sinCambio, "no_cambia_el_odontograma");
  // Repetir lo hecho no duplica.
  const ent = [e(46, null, "rct")];
  assert.equal(aplicarHecho({ clave: "endodoncia", dientes: [46] }, ent).sinCambio, "ya_estaba");
});

test("todo lo que se sugiere tiene efecto declarado, y toda condición que pone existe en el odontograma", () => {
  const ids = new Set(CONDITIONS.map((c) => c.id));
  for (const clave of Object.keys(PROCEDIMIENTOS) as ClaveProcedimiento[]) {
    assert.ok(clave in EFECTO_HECHO, `${clave} sin efecto declarado`);
    const ef = EFECTO_HECHO[clave];
    if (!ef) continue;
    const pone = typeof ef.ponerEnDiente === "function" ? [ef.ponerEnDiente(16), ef.ponerEnDiente(85)] : [ef.ponerEnDiente];
    for (const id of [...pone, ef.ponerEnCaras, ...(ef.quitarDeCaras ?? []), ...(ef.quitarDelDiente ?? []), ...(ef.quitarDeTodasLasCaras ?? [])]) {
      if (id) assert.ok(ids.has(id), `${clave}: ${id} no existe en odontogram-v2/data.ts`);
    }
  }
  // Ida y vuelta: lo que se sugiere para un hallazgo, hecho, quita ese hallazgo (salvo los que se controlan aparte).
  const seControla = new Set(["periapical1", "periapical2", "periapical3", "mobility", "perio_mobility", "recession", "pocket", "furcation", "caries_inc"]);
  for (const [id, c] of Object.entries(CONDICIONES_CLINICAS)) {
    if (!c.sugiere || seControla.has(id)) continue;
    const cond = CONDITIONS.find((x) => x.id === id)!;
    const ent = [e(16, cond.target === "surface" ? "O" : null, id)];
    const hecho = aplicarHecho({ clave: c.sugiere, dientes: [16], caras: cond.target === "surface" ? ["O"] : [] }, ent);
    assert.ok(hecho.bajas.some((b) => b.conditionId === id) || (id === "fracture" && c.sugiere === "resina"),
      `${id} → ${c.sugiere} no quita el hallazgo`);
  }
});

test("el cambio en el formato de «Guardar consulta» (sync con cambios) da lo mismo que aplicarlo", () => {
  const ent = [e(16, "M", "caries"), e(16, "O", "caries"), e(16, null, "__note__", "nota"), e(17, "O", "caries")];
  const c = aplicarHecho({ clave: "resina", dientes: [16], caras: ["M", "O"] }, ent);
  const cambios = comoCambiosDeSync(ent, c);
  assert.deepEqual(Object.keys(cambios), ["16"]);
  assert.deepEqual(cambios[16], {
    base: { surfaces: { M: ["caries"], O: ["caries"] }, tooth: [] },
    now: { surfaces: { M: ["restoration"], O: ["restoration"] }, tooth: [] },
  });
  assert.equal("note" in cambios[16].now, false); // la nota no viaja: no se toca
  // Aplicar el delta como lo hace el odontograma sobre lo vivo da lo mismo que aplicarAEntradas.
  const vivo = entriesToRecords(ent.map((x) => ({ ...x })));
  const conDelta = applyToothDelta(vivo[16], cambios[16].base, cambios[16].now);
  const esperado = entriesToRecords(aplicarAEntradas(ent, c).map((x) => ({ ...x })))[16];
  assert.deepEqual(conDelta, esperado);
  // Y el deshacer, también como delta.
  const atras = comoCambiosDeSync(aplicarAEntradas(ent, c), cambioDeshacer(c));
  assert.deepEqual(atras[16].now, cambios[16].base);
});

/* ─────── Fase 2: el deshacer contra el odontograma de HOY (planearDeshacer) ─────── */

let siguiente = 0;
const conId = (l: EntradaOdontograma[]): EntradaConId[] => l.map((x) => ({ ...x, id: `e${++siguiente}` }));
/** Lo que deja «hecho» en la base: las altas con su id nuevo y las bajas con su nota. */
function escribir(ent: EntradaConId[], c: ReturnType<typeof aplicarHecho>) {
  const k = (x: EntradaOdontograma) => `${x.toothNumber}:${x.surface ?? "_"}:${x.conditionId}`;
  const fuera = new Set(c.bajas.map(k));
  const altas = conId(c.altas);
  return { despues: [...ent.filter((x) => !fuera.has(k(x))), ...altas], escrito: { altas, bajas: c.bajas } };
}
const aplicarPlan = (ent: EntradaConId[], p: ReturnType<typeof planearDeshacer>) => {
  const fuera = new Set(p.borrar.map((x) => x.id));
  return [...ent.filter((x) => !fuera.has(x.id)), ...conId(p.crear)];
};

test("deshacer sin cambios posteriores: el odontograma vuelve EXACTO, con la nota del hallazgo devuelto", () => {
  const ent = conId([e(16, "M", "caries", "profunda"), e(16, "O", "caries"), e(16, null, "__note__", "sensible"), e(17, "O", "caries")]);
  const { despues, escrito } = escribir(ent, aplicarHecho({ clave: "resina", dientes: [16], caras: ["M", "O"] }, ent));
  const p = planearDeshacer(escrito, despues);
  assert.deepEqual(p.conflictos, []);
  assert.deepEqual(corto(p.borrar), ["16M:restoration", "16O:restoration"]);
  assert.equal(p.crear.find((x) => x.surface === "M")?.notes, "profunda");
  assert.deepEqual(ordenado(aplicarPlan(despues, p)), ordenado(ent));
});

test("deshacer no pisa lo de después: lo que «hecho» puso y alguien quitó no se toca, y ahí no vuelve la caries", () => {
  const ent = conId([e(16, "M", "caries"), e(16, "O", "caries")]);
  const { despues, escrito } = escribir(ent, aplicarHecho({ clave: "resina", dientes: [16], caras: ["M", "O"] }, ent));
  // Después, el doctor cambió la oclusal: quitó la restauración y puso una incrustación.
  const luego = [...despues.filter((x) => !(x.surface === "O" && x.conditionId === "restoration")), ...conId([e(16, "O", "inlay")])];
  const p = planearDeshacer(escrito, luego);
  assert.deepEqual(corto(p.borrar), ["16M:restoration"]);
  assert.deepEqual(corto(p.crear), ["16M:caries"]);
  assert.deepEqual(p.conflictos.map((c) => `${c.toothNumber}${c.surface}:${c.conditionId}:${c.motivo}`).sort(),
    ["16O:caries:cambio_posterior", "16O:restoration:alta_ya_no_esta"]);
  assert.deepEqual(ordenado(aplicarPlan(luego, p)), ["16M:caries", "16O:inlay"]);
});

test("deshacer una extracción cuando el diente ya tiene implante: no vuelve nada a ese diente", () => {
  const ent = conId([e(36, "O", "caries"), e(36, null, "rct"), e(36, null, "crown")]);
  const ext = escribir(ent, aplicarHecho({ clave: "extraccion", dientes: [36] }, ent));
  const imp = escribir(ext.despues, aplicarHecho({ clave: "implante", dientes: [36] }, ext.despues));
  const p = planearDeshacer(ext.escrito, imp.despues);
  assert.deepEqual(p.borrar, []);
  assert.deepEqual(p.crear, []);
  assert.equal(p.conflictos.filter((c) => c.motivo === "cambio_posterior").length, 3);
  assert.deepEqual(ordenado(aplicarPlan(imp.despues, p)), ["36·:implant"]);
});

test("deshacer: lo que ya volvió a estar no se duplica, y la alta que alguien repintó (otro id) no se borra", () => {
  const ent = conId([e(16, "O", "caries")]);
  const { despues, escrito } = escribir(ent, aplicarHecho({ clave: "resina", dientes: [16], caras: ["O"] }, ent));
  // Alguien borró la restauración y la volvió a pintar (otro id), y volvió a marcar la caries.
  const luego = [...despues.filter((x) => x.conditionId !== "restoration"), ...conId([e(16, "O", "restoration"), e(16, "O", "caries")])];
  const p = planearDeshacer(escrito, luego);
  assert.deepEqual(p.borrar, []);
  assert.deepEqual(p.crear, []);
  assert.deepEqual(p.conflictos.map((c) => c.motivo), ["alta_ya_no_esta"]);
});
