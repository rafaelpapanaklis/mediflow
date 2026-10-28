/**
 * Rojo = por hacer, azul = realizado (ws1-t6, decisiones de Rafael del 28-oct): las piezas puras.
 *
 *  · qué marcas llevan estado y cómo se guarda en el diente (y que lo de antes se lee como hoy);
 *  · el adaptador (GET → records, records → servidor), la cola de autoguardado y la mezcla de la
 *    consulta con el vivo;
 *  · decisión 2: cada marca roja sale en el plan nuevo con su procedimiento y el precio de la clínica;
 *  · decisión 3: «Hecho» pasa la marca de rojo a azul (sin crear otra) y su deshacer la regresa.
 *
 * Run: npm run test:odontograma-rojo-azul
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLAVE_DE_MARCA, admiteEstado, claveEstado, estadoDelModo, estadoEn, fijarEstadoEn, podarEstados, tonoDeEstado,
} from "../estado-marca";
import { CONDITIONS } from "../../../components/dashboard/odontogram-v2/data";
import { entriesToRecords, recordsForServer } from "../../../components/dashboard/odontogram-v2/adapter";
import { applyToothDelta } from "../../../components/dashboard/odontogram-v2/merge-consulta";
import { SaveQueue } from "../../../components/dashboard/odontogram-v2/autosave";
import { colorDe, resolverColor } from "../../../components/dashboard/odontogram-v2/colores";
import type { ToothRecord } from "../../../components/dashboard/odontogram-v2/types";
import { aplicarAEntradas, aplicarHecho, cambioDeshacer, planearDeshacer, type EntradaConId, type EntradaOdontograma } from "../aplicar-hecho";
import { CONDICIONES_CLINICAS, PROCEDIMIENTOS, sugerirProcedimiento, type ProcedimientoTarifario } from "../../treatments/sugerir-procedimiento";
import { hallazgosPorTratar, type EntradaOdontograma as EntradaPlan } from "../../../components/dashboard/plan-tratamiento-rediseno/plan-clinico";
import { agregarDesdeChip, chipsDelPlan, entradasDeRegistros } from "../../../components/dashboard/plan-tratamiento-rediseno/armar-plan";

/* ─────── Qué lleva estado ─────── */

test("solo las marcas de procedimiento llevan estado; los hallazgos no; cada una con su procedimiento del plan", () => {
  for (const id of ["caries", "caries_inc", "fracture", "missing", "pulpitis", "calculus", "pocket", "impacted", "root_remnant", "diastema"]) {
    assert.equal(admiteEstado(id), false, `${id} es un hallazgo: se pinta como hoy`);
  }
  for (const id of ["restoration", "crown", "rct", "implant", "ext_indicated", "ext_done", "sealant", "steel_crown"]) {
    assert.equal(admiteEstado(id), true, `${id} es un procedimiento`);
  }
  // Toda condición con estado existe en el catálogo del odontograma y su procedimiento en el plan.
  const ids = new Set(CONDITIONS.map((c) => c.id));
  for (const [cond, clave] of Object.entries(CLAVE_DE_MARCA)) {
    assert.ok(ids.has(cond), `${cond} está en data.ts`);
    assert.ok(PROCEDIMIENTOS[clave], `${clave} está en el plan`);
    assert.ok(CONDICIONES_CLINICAS[cond], `${cond} está en la lista compartida`);
  }
  assert.equal(tonoDeEstado("por_hacer"), "rojo");
  assert.equal(tonoDeEstado("hecho"), "azul");
  assert.equal(tonoDeEstado("previo"), "azul");
  assert.equal(tonoDeEstado(null), null);
  assert.equal(estadoDelModo("hecho", true), "previo");
  assert.equal(estadoDelModo("por_hacer", true), "por_hacer");
});

test("el estado vive en el diente por «cara:condición» y se poda cuando la marca se va", () => {
  const r: ToothRecord = { surfaces: { O: ["restoration", "caries"] }, tooth: ["crown"] };
  fijarEstadoEn(r, "O", "restoration", "por_hacer");
  fijarEstadoEn(r, null, "crown", "hecho");
  assert.deepEqual(r.estados, { "O:restoration": "por_hacer", "_:crown": "hecho" });
  assert.equal(estadoEn(r, "O", "restoration"), "por_hacer");
  assert.equal(estadoEn(r, "O", "caries"), null, "un hallazgo no tiene estado");
  r.tooth = [];
  podarEstados(r);
  assert.deepEqual(r.estados, { "O:restoration": "por_hacer" });
  fijarEstadoEn(r, "O", "restoration", null);
  assert.equal(r.estados, undefined);
});

test("color: rojo/azul por el estado; sin estado (lo de antes, y los hallazgos), el de la especialidad", () => {
  const resina = CONDITIONS.find((c) => c.id === "restoration")!;
  const caries = CONDITIONS.find((c) => c.id === "caries")!;
  const r: ToothRecord = { surfaces: { O: ["restoration"], M: ["restoration"], D: ["caries"] }, tooth: [], estados: { "O:restoration": "por_hacer" } };
  assert.equal(colorDe(r, "O", resina), "var(--odo-por-hacer)");
  assert.equal(colorDe(r, "M", resina), "#2A6FDB", "la resina de antes, sin estado: como hoy");
  assert.equal(colorDe(r, "D", caries), "#E5484D");
  r.estados = { "O:restoration": "previo" };
  assert.equal(colorDe(r, "O", resina), "var(--odo-realizado)");
  // sin DOM (o sin el token), el 3D cae a un color de respaldo de la paleta
  assert.equal(resolverColor("var(--odo-por-hacer)", null), "#E5484D");
  assert.equal(resolverColor("#123456", null), "#123456");
});

/* ─────── Adaptador, cola y consulta ─────── */

test("GET → records: el estado de cada marca llega al diente; lo viejo (sin estado) se lee como hoy", () => {
  const recs = entriesToRecords([
    { toothNumber: 16, surface: "O", conditionId: "restoration", estado: "por_hacer" },
    { toothNumber: 16, surface: "M", conditionId: "restoration" },
    { toothNumber: 11, surface: "O", conditionId: "restoration", estado: "hecho" }, // incisal: «I» en pantalla
    { toothNumber: 26, surface: null, conditionId: "crown", estado: "previo" },
    { toothNumber: 36, surface: "O", conditionId: "caries", estado: "por_hacer" as never }, // un hallazgo no lleva estado
  ]);
  assert.deepEqual(recs[16].estados, { "O:restoration": "por_hacer" });
  assert.deepEqual(recs[11].estados, { "I:restoration": "hecho" });
  assert.deepEqual(recs[26].estados, { "_:crown": "previo" });
  assert.equal(recs[36].estados, undefined);
  // y de vuelta al servidor, con la letra de la base
  const srv = recordsForServer(recs);
  assert.deepEqual(srv[11].estados, { "O:restoration": "hecho" });
  assert.deepEqual(srv[11].surfaces, { O: ["restoration"] });
});

test("la cola de autoguardado pinta encima el estado pendiente y junta toques de la misma marca", async () => {
  const enviados: unknown[] = [];
  const q = new SaveQueue({ send: async (op) => { enviados.push(op); await new Promise(() => {}); } });
  q.enqueue({ kind: "put", toothNumber: 16, surface: "O", conditionId: "restoration", estado: "por_hacer" });
  q.enqueue({ kind: "put", toothNumber: 16, surface: "M", conditionId: "restoration", estado: "por_hacer" });
  q.enqueue({ kind: "put", toothNumber: 16, surface: "M", conditionId: "restoration", estado: "hecho" });
  const vista = q.overlay({ 16: { surfaces: {}, tooth: [] } });
  assert.deepEqual(vista[16].surfaces, { O: ["restoration"], M: ["restoration"] });
  assert.deepEqual(vista[16].estados, { "O:restoration": "por_hacer", "M:restoration": "hecho" });
  q.enqueue({ kind: "delete", toothNumber: 16, surface: "M", conditionId: "restoration" });
  assert.deepEqual(q.overlay({})[16].estados, { "O:restoration": "por_hacer" }, "lo que se quita no deja su color");
});

test("«Guardar consulta» sobre el vivo: el estado que cambió el doctor manda; el que no tocó, el del vivo", () => {
  const base: ToothRecord = { surfaces: { O: ["restoration"], M: ["restoration"] }, tooth: [], estados: { "O:restoration": "por_hacer", "M:restoration": "por_hacer" } };
  const now: ToothRecord = { ...base, estados: { "O:restoration": "hecho", "M:restoration": "por_hacer" } };
  // mientras, en la otra pestaña, alguien pasó la M a «previo»
  const vivo: ToothRecord = { ...base, estados: { "O:restoration": "por_hacer", "M:restoration": "previo" } };
  const r = applyToothDelta(vivo, base, now);
  assert.deepEqual(r.estados, { "O:restoration": "hecho", "M:restoration": "previo" });
  // lo de antes (sin estados) sigue igual que siempre
  const viejo = applyToothDelta({ surfaces: { O: ["caries"] }, tooth: [] }, { surfaces: { O: ["caries"] }, tooth: [] }, { surfaces: {}, tooth: [] });
  assert.deepEqual(viejo, { surfaces: {}, tooth: [] });
});

/* ─────── Decisión 2: lo rojo alimenta el plan ─────── */

let n = 0;
const p = (name: string, basePrice: number, duration: number | null, code: string | null = null): ProcedimientoTarifario =>
  ({ id: `p${++n}`, name, basePrice, duration, category: "dental", code, isActive: true });
const TARIFARIO = [
  p("Restauración resina 1 cara", 700, 30), p("Restauración resina 2 caras", 900, 45),
  p("Corona metal-porcelana", 4500, 60), p("Extracción simple", 800, 30), p("Endodoncia multirradicular", 4500, 120),
];

test("cada marca roja sale como «Resina · 16 O · $700» con el precio de la clínica, lista para agregar", () => {
  const entradas: EntradaPlan[] = [
    { toothNumber: 16, surface: "O", conditionId: "restoration", estado: "por_hacer" },
    { toothNumber: 26, surface: null, conditionId: "crown", estado: "por_hacer" },
    { toothNumber: 36, surface: "O", conditionId: "restoration", estado: "hecho" },   // azul: no
    { toothNumber: 46, surface: "O", conditionId: "restoration" },                    // de antes: no
    { toothNumber: 47, surface: null, conditionId: "crown", estado: "previo" },       // previo: no
  ];
  const h = hallazgosPorTratar(entradas);
  assert.deepEqual(h.map((x) => `${x.clave}${x.porHacer ? "·rojo" : ""}`), ["16:restoration·rojo", "26:crown·rojo"]);
  const chips = chipsDelPlan(h, TARIFARIO, entradas, []);
  assert.deepEqual(chips.map((c) => `${c.tipo} ${c.clave} → ${c.sugerencia?.nombre} $${c.sugerencia?.precio}`), [
    "por_hacer r:h:16:restoration → Restauración resina 1 cara $700",
    "por_hacer r:h:26:crown → Corona metal-porcelana $4500",
  ]);
  // el toque: un renglón con el procedimiento, la cara, el precio y su origen
  let id = 0;
  const ctx = { tarifario: TARIFARIO, entradas, nuevoId: () => `r${++id}`, motivo: "Marcado por hacer en el odontograma", idioma: "es" as const };
  const rs = agregarDesdeChip([], chips[0], ctx);
  assert.equal(rs.length, 1);
  assert.deepEqual({ p: rs[0].procedimiento, d: rs[0].dientes, c: rs[0].caras, $: rs[0].precio, o: rs[0].origen }, {
    p: "Restauración resina 1 cara", d: "16", c: ["O"], $: "700", o: ["16:restoration"],
  });
  // ya puesto: el chip queda marcado y no se duplica
  const despues = chipsDelPlan(h, TARIFARIO, entradas, rs);
  assert.equal(despues.find((c) => c.clave === "r:h:16:restoration")?.puesto, true);
  assert.equal(agregarDesdeChip(rs, despues[0], ctx).length, 1);
});

test("si el doctor ya marcó la resina en rojo, la caries de ese diente no propone otra resina", () => {
  const entradas: EntradaPlan[] = [
    { toothNumber: 16, surface: "O", conditionId: "caries" },
    { toothNumber: 16, surface: "O", conditionId: "restoration", estado: "por_hacer" },
    { toothNumber: 26, surface: "O", conditionId: "caries" },
  ];
  const chips = chipsDelPlan(hallazgosPorTratar(entradas), TARIFARIO, entradas, []);
  assert.deepEqual(chips.map((c) => c.clave), ["r:h:16:restoration", "h:26:caries"]);
  // sin precio en el tarifario: sale igual, para elegir
  const sin = sugerirProcedimiento({ diente: 16, caras: ["O"], conditionId: "sealant", porHacer: true }, TARIFARIO);
  assert.equal(sin.sugerencias[0].elegir, true);
  assert.equal(sin.sugerencias[0].precio, null);
});

test("la consulta pasa sus marcas al plan con el rojo/azul (letras de pantalla → base)", () => {
  const e = entradasDeRegistros({
    11: { surfaces: { I: ["restoration"] }, tooth: [], estados: { "I:restoration": "por_hacer" } },
    16: { surfaces: { O: ["caries"] }, tooth: ["crown"], estados: { "_:crown": "hecho" } },
  });
  assert.deepEqual(e, [
    { toothNumber: 11, surface: "O", conditionId: "restoration", estado: "por_hacer" },
    { toothNumber: 16, surface: "O", conditionId: "caries" },
    { toothNumber: 16, surface: null, conditionId: "crown", estado: "hecho" },
  ]);
});

/* ─────── Decisión 3: «Hecho» pasa de rojo a azul, y su deshacer lo regresa ─────── */

const ent = (toothNumber: number, surface: EntradaOdontograma["surface"], conditionId: string, estado?: EntradaOdontograma["estado"]): EntradaOdontograma =>
  ({ toothNumber, surface, conditionId, notes: null, ...(estado ? { estado } : {}) });
const corto = (l: EntradaOdontograma[]) => l.map((x) => `${x.toothNumber}${x.surface ?? "·"}:${x.conditionId}${x.estado ? `(${x.estado})` : ""}`).sort();

test("«Hecho» de la resina 16 O: la marca roja pasa a azul (no se crea otra) y la caries de esa cara se va", () => {
  const antes = [ent(16, "O", "restoration", "por_hacer"), ent(16, "O", "caries"), ent(16, "M", "restoration", "por_hacer")];
  const c = aplicarHecho({ nombre: "Restauración resina 1 cara", dientes: [16], caras: ["O"] }, antes);
  assert.equal(c.sinCambio, null);
  assert.deepEqual(corto(c.aHecho), ["16O:restoration"]);
  assert.deepEqual(corto(c.altas), [], "no se duplica la resina");
  assert.deepEqual(corto(c.bajas), ["16O:caries"]);
  const despues = aplicarAEntradas(antes, c);
  assert.deepEqual(corto(despues), ["16M:restoration(por_hacer)", "16O:restoration(hecho)"], "la M (no hecha) sigue roja");
  // el deshacer lo deja exacto
  assert.deepEqual(corto(aplicarAEntradas(despues, cambioDeshacer(c))), corto(antes));
});

test("«Hecho» sin caras en el renglón: va a las caras marcadas en rojo; corona roja → azul", () => {
  const antes = [ent(16, "M", "restoration", "por_hacer"), ent(16, "O", "restoration", "por_hacer"), ent(26, null, "crown", "por_hacer")];
  const r = aplicarHecho({ clave: "resina", dientes: [16] }, antes);
  assert.deepEqual(corto(r.aHecho), ["16M:restoration", "16O:restoration"]);
  const k = aplicarHecho({ clave: "corona", dientes: [26] }, antes);
  assert.deepEqual(corto(k.aHecho), ["26·:crown"]);
  assert.deepEqual(corto(k.altas), []);
  // ya azul: no hay nada que hacer
  assert.equal(aplicarHecho({ clave: "corona", dientes: [26] }, [ent(26, null, "crown", "hecho")]).sinCambio, "ya_estaba");
  // sin marca roja: se pone la corona como siempre (el servidor la deja azul si la base guarda estado)
  assert.deepEqual(corto(aplicarHecho({ clave: "corona", dientes: [27] }, []).altas), ["27·:crown"]);
});

test("deshacer en la base: lo que pasó a azul vuelve a rojo, salvo que alguien lo haya cambiado o quitado", () => {
  const escrito = {
    altas: [] as EntradaConId[],
    bajas: [ent(16, "O", "caries")],
    aHecho: [{ ...ent(16, "O", "restoration", "hecho"), id: "e1" }, { ...ent(16, "M", "restoration", "hecho"), id: "e2" }, { ...ent(26, null, "crown", "hecho"), id: "e3" }],
  };
  const hoy: EntradaConId[] = [
    { ...ent(16, "O", "restoration", "hecho"), id: "e1" },     // sigue azul → vuelve a rojo
    { ...ent(16, "M", "restoration", "previo"), id: "e2" },    // alguien la cambió → no se toca
    // e3 (la corona) ya no está → se avisa
  ];
  const plan = planearDeshacer(escrito, hoy);
  assert.deepEqual(plan.aPorHacer.map((x) => x.id), ["e1"]);
  assert.deepEqual(plan.borrar, []);
  assert.deepEqual(plan.conflictos.map((x) => `${x.toothNumber}:${x.conditionId}:${x.motivo}`), ["26:crown:alta_ya_no_esta"]);
  // la caries de la O vuelve: lo que «hecho» puso ahí (la resina, ya azul) sigue
  assert.deepEqual(corto(plan.crear), ["16O:caries"]);
});

/* ─────── Revisión adversarial (ws1-t6) ─────── */

test("revisión 3 y 5: un conducto ROJO no hace «retratamiento»; una extracción indicada en azul o previa ya no es por tratar", () => {
  const entradas: EntradaPlan[] = [
    { toothNumber: 36, surface: null, conditionId: "periapical2" },
    { toothNumber: 36, surface: null, conditionId: "rct", estado: "por_hacer" },
    { toothNumber: 18, surface: null, conditionId: "ext_indicated", estado: "hecho" },
    { toothNumber: 28, surface: null, conditionId: "ext_indicated", estado: "previo" },
    { toothNumber: 38, surface: null, conditionId: "ext_indicated" }, // de antes: hallazgo por tratar, como hoy
  ];
  const chips = chipsDelPlan(hallazgosPorTratar(entradas), TARIFARIO, entradas, []);
  assert.deepEqual(chips.map((c) => `${c.clave}→${c.sugerencia?.clave}`), ["r:h:36:rct→endodoncia", "h:38:ext_indicated→extraccion"]);
});

test("revisión 4: «Hecho» pasa a azul lo rojo que el procedimiento no dibuja (flúor, profilaxis) y la pulpotomía del temporal", () => {
  const antes = [
    ent(16, null, "fluoride", "por_hacer"), ent(26, null, "fluoride", "por_hacer"),
    ent(11, null, "prophylaxis", "por_hacer"), ent(85, null, "pulpotomy", "por_hacer"), ent(85, null, "pulpitis"),
  ];
  const fl = aplicarHecho({ clave: "fluor", dientes: [] }, antes);
  assert.equal(fl.sinCambio, null);
  assert.deepEqual(corto(fl.aHecho), ["16·:fluoride", "26·:fluoride"], "flúor de toda la boca");
  assert.deepEqual(corto(aplicarHecho({ clave: "fluor", dientes: [16] }, antes).aHecho), ["16·:fluoride"], "con dientes, solo esos");
  assert.deepEqual(corto(aplicarHecho({ clave: "limpieza", dientes: [] }, antes).aHecho), ["11·:prophylaxis"]);
  const pu = aplicarHecho({ clave: "pulpotomia", dientes: [85] }, antes);
  assert.deepEqual(corto(pu.aHecho), ["85·:pulpotomy"], "la roja pasa a azul…");
  assert.deepEqual(corto(pu.altas), [], "…sin crear además la pulpotomía de temporal");
  assert.deepEqual(corto(pu.bajas), ["85·:pulpitis"]);
  assert.deepEqual(corto(aplicarAEntradas(aplicarAEntradas(antes, pu), cambioDeshacer(pu))), corto(antes));
});

/* ─────── v2 (revisión de t1) ─────── */

import { redactarMovimiento } from "../../movimientos-paciente/catalogo";
import { rotuloDeEstado } from "../estado-marca";

test("v2 M1: lo rojo que ya es una fila viva de otro plan activo sale «ya en el plan X», no se agrega y «Agregar todo» lo salta", () => {
  const entradas: EntradaPlan[] = [
    { toothNumber: 16, surface: "O", conditionId: "restoration", estado: "por_hacer" },
    { toothNumber: 26, surface: null, conditionId: "crown", estado: "por_hacer" },
  ];
  const fila = (id: string, nombre: string, dientes: number[], estado: "pendiente" | "hecho" | "cancelado" = "pendiente") =>
    ({ id, planId: "plan-1", nombre, procedureId: null, dientes, cantidad: 1, estado, hechoEn: null, invoiceId: null });
  const otros = [{ planId: "plan-1", nombre: "Plan 20 oct 2026", filas: [fila("f1", "Restauración resina 2 caras", [16]), fila("f2", "Corona metal-porcelana", [27])] }];
  const chips = chipsDelPlan(hallazgosPorTratar(entradas), TARIFARIO, entradas, [], otros);
  assert.deepEqual(chips.map((c) => `${c.clave}:${c.enOtroPlan ?? "-"}`), ["r:h:16:restoration:Plan 20 oct 2026", "r:h:26:crown:-"], "la corona del 27 no es la del 26");
  let id = 0;
  const ctx = { tarifario: TARIFARIO, entradas, nuevoId: () => `r${++id}`, motivo: "x", idioma: "es" as const };
  assert.deepEqual(agregarDesdeChip([], chips[0], ctx), [], "no se agrega: serían dos notas de cobro");
  // una fila cancelada (o hecha hace días) ya no la tapa
  const cancelada = [{ ...otros[0], filas: [fila("f1", "Restauración resina 2 caras", [16], "cancelado")] }];
  assert.equal(chipsDelPlan(hallazgosPorTratar(entradas), TARIFARIO, entradas, [], cancelada)[0].enOtroPlan, undefined);
});

test("v2 m3: la caries de OTRA cara no se la come la resina roja: sale y se junta en una resina de 2 caras", () => {
  const entradas: EntradaPlan[] = [
    { toothNumber: 16, surface: "M", conditionId: "caries" },
    { toothNumber: 16, surface: "O", conditionId: "caries" },
    { toothNumber: 16, surface: "O", conditionId: "restoration", estado: "por_hacer" },
  ];
  const chips = chipsDelPlan(hallazgosPorTratar(entradas), TARIFARIO, entradas, []);
  assert.deepEqual(chips.map((c) => c.clave), ["r:h:16:restoration", "h:16:caries"], "la caries (M y O) sale porque la M no está en rojo");
  let id = 0;
  const ctx = { tarifario: TARIFARIO, entradas, nuevoId: () => `r${++id}`, motivo: "x", idioma: "es" as const };
  const rs = agregarDesdeChip(agregarDesdeChip([], chips[0], ctx), chips[1], ctx);
  assert.equal(rs.length, 1);
  assert.deepEqual({ c: rs[0].caras, p: rs[0].procedimiento, $: rs[0].precio }, { c: ["M", "O"], p: "Restauración resina 2 caras", $: "900" });
  // cubierta del todo (solo O): no sale aparte
  const soloO = entradas.filter((e) => e.surface === "O");
  assert.deepEqual(chipsDelPlan(hallazgosPorTratar(soloO), TARIFARIO, soloO, []).map((c) => c.clave), ["r:h:16:restoration"]);
});

test("v2 m4 y M2: Movimientos dice «Marcó por hacer…» sin valores clínicos; el rótulo fuera del odontograma", () => {
  const fila = (after: Record<string, unknown>) => ({ entityType: "patient", action: "odontogram_write", changes: { _odontogram: { after } } });
  assert.equal(redactarMovimiento(fila({ toothNumber: 16, surface: "O", conditionId: "restoration", estado: "hecho", existia: true })), "Marcó realizado un procedimiento en el odontograma");
  assert.equal(redactarMovimiento(fila({ toothNumber: 16, surface: "O", conditionId: "restoration", estado: "por_hacer", existia: true })), "Marcó por hacer un procedimiento en el odontograma");
  assert.equal(redactarMovimiento(fila({ toothNumber: 26, surface: null, conditionId: "crown", estado: "previo", existia: false })), "Registró un procedimiento previo (de otra clínica) en el odontograma");
  assert.equal(redactarMovimiento(fila({ toothNumber: 36, surface: "O", conditionId: "caries" })), "Registró un hallazgo en el odontograma", "sin estado, como siempre");
  assert.equal(rotuloDeEstado("por_hacer"), "(por hacer)");
  assert.equal(rotuloDeEstado("previo"), "(previo, otra clínica)");
  assert.equal(rotuloDeEstado("hecho"), "");
  assert.equal(rotuloDeEstado(null), "");
});
