// ws1-t9 (auditoría BEVADENT, M1-M4): hoja de control con arco por arcada, ligas, mecánicas auxiliares y catálogos
// propios de la clínica. Reglas puras + lo que se guarda. Con el código de antes fallan todas: los módulos
// hoja-extras / hoja-catalogos no existían, `arcosActuales` no sabía de un segundo arco nuevo y ni las acciones ni los
// llamadores mandaban `extras`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  arcosNuevosDeLaHoja,
  cambiosAlFirmarConDosArcos,
  columnasDeArcosNuevos,
  elegirArco,
  historialDeLigas,
  ligasHeredadas,
  normalizarLigas,
  ordenarMecanicas,
  textoDeLiga,
  textoDeMecanica,
  validarAltaDeMecanica,
} from "../hoja-extras";
import {
  catalogosDeFabrica,
  copiarDeFabrica,
  esTipoSinLigas,
  faltanDeFabrica,
  normalizarCalibre,
  normalizarCatalogos,
  opcionesDeArco,
  opcionesParaElegir,
  validarCatalogos,
} from "../hoja-catalogos";
import { arcosActuales } from "../arcos-actuales";
import { extrasDeHojaSchema } from "../hoja-extras-guardar";

const RAIZ = join(__dirname, "../../../..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const SUP = { id: "sup", archUpper: true, archLower: false };
const INF = { id: "inf", archUpper: false, archLower: true };
const AMBAS = { id: "ambas", archUpper: true, archLower: true };

describe("M1 · dos selectores de arco nuevo (Superior / Inferior)", () => {
  it("lo elegido → columnas: wireToId = superior (o inferior si arriba no cambia); wireToLowerId solo si abajo es otro", () => {
    assert.deepEqual(columnasDeArcosNuevos("sup", "inf"), { wireToId: "sup", wireToLowerId: "inf" });
    assert.deepEqual(columnasDeArcosNuevos("ambas", "ambas"), { wireToId: "ambas", wireToLowerId: null });
    assert.deepEqual(columnasDeArcosNuevos(null, "inf"), { wireToId: "inf", wireToLowerId: null });
    assert.deepEqual(columnasDeArcosNuevos("sup", null), { wireToId: "sup", wireToLowerId: null });
    assert.deepEqual(columnasDeArcosNuevos(null, null), { wireToId: null, wireToLowerId: null });
  });

  it("columnas guardadas → arco nuevo de cada arcada (ida y vuelta)", () => {
    assert.deepEqual(arcosNuevosDeLaHoja(SUP, INF), { superior: SUP, inferior: INF });
    assert.deepEqual(arcosNuevosDeLaHoja(AMBAS, null), { superior: AMBAS, inferior: AMBAS });
    assert.deepEqual(arcosNuevosDeLaHoja(INF, null), { superior: null, inferior: INF });
    // Una hoja vieja (sin arcada en el arco) cuenta para las dos, como siempre.
    assert.deepEqual(arcosNuevosDeLaHoja({ id: "viejo" }, null), { superior: { id: "viejo" }, inferior: { id: "viejo" } });
  });

  it("un arco de las dos arcadas se pone en las dos; uno de una sola no toca la otra", () => {
    assert.deepEqual(elegirArco({ sup: null, inf: null }, "superior", "ambas", AMBAS), { sup: "ambas", inf: "ambas" });
    assert.deepEqual(elegirArco({ sup: "ambas", inf: "ambas" }, "inferior", "inf", INF), { sup: "ambas", inf: "inf" });
    assert.deepEqual(elegirArco({ sup: "x", inf: "y" }, "superior", "sup", SUP), { sup: "sup", inf: "y" });
    // Un arco de las dos no pisa un inferior distinto ya elegido.
    assert.deepEqual(elegirArco({ sup: null, inf: "inf" }, "superior", "ambas", AMBAS), { sup: "ambas", inf: "inf" });
    assert.deepEqual(elegirArco({ sup: "sup", inf: "inf" }, "superior", null, null), { sup: null, inf: "inf" });
  });

  it("al firmar con dos arcos nuevos los dos quedan «Actual» y el de llegada (de las dos arcadas) se cierra", () => {
    const fecha = new Date("2026-10-03T16:00:00Z");
    const pasos = [
      { id: "llegada", status: "ACTIVE" as const, appliedDate: new Date("2026-08-01"), completedDate: null, archUpper: true, archLower: true },
      { id: "sup", status: "PLANNED" as const, appliedDate: null, completedDate: null, archUpper: true, archLower: false },
      { id: "inf", status: "PLANNED" as const, appliedDate: null, completedDate: null, archUpper: false, archLower: true },
    ];
    const cambios = cambiosAlFirmarConDosArcos({ pasos, wireToId: "sup", wireToLowerId: "inf", arcoAnteriorId: "llegada", fecha });
    const por = Object.fromEntries(cambios.map((c) => [c.id, c.status]));
    assert.deepEqual(por, { sup: "ACTIVE", inf: "ACTIVE", llegada: "COMPLETED" });
  });

  it("solo el superior: el de llegada (de las dos) sigue «Actual» abajo", () => {
    const pasos = [
      { id: "llegada", status: "ACTIVE" as const, appliedDate: new Date("2026-08-01"), completedDate: null, archUpper: true, archLower: true },
      { id: "sup", status: "PLANNED" as const, appliedDate: null, completedDate: null, archUpper: true, archLower: false },
    ];
    const cambios = cambiosAlFirmarConDosArcos({ pasos, wireToId: "sup", wireToLowerId: null, arcoAnteriorId: "llegada", fecha: new Date() });
    assert.deepEqual(cambios.map((c) => [c.id, c.status]), [["sup", "ACTIVE"]]);
  });

  it("la cabecera (arcosActuales) dice el arco nuevo inferior de la última hoja firmada", () => {
    const pasos = [
      { ...AMBAS, status: "COMPLETED", orderIndex: 1 },
      { ...SUP, status: "ACTIVE", orderIndex: 2 },
      { ...INF, status: "ACTIVE", orderIndex: 3 },
    ];
    const r = arcosActuales(pasos, [{ status: "SIGNED", visitDate: "2026-10-01", wireFrom: pasos[0], wireTo: pasos[1], wireToLower: pasos[2] }]);
    assert.equal(r.superior?.id, "sup");
    assert.equal(r.inferior?.id, "inf");
  });
});

describe("M2 · ligas", () => {
  it("normaliza: tipo obligatorio, autoligado sin color, arcada válida, máximo 4", () => {
    const l = normalizarLigas([
      { tipo: "Elástica", color: "Gris", arcada: "SUPERIOR", cambiadasHoy: true },
      { tipo: "Autoligado (sin ligas)", color: "Rojo", arcada: "INVENTADA" },
      { tipo: "  ", color: "Azul" },
      { tipo: "Metálica", arcada: "INFERIOR" },
      { tipo: "Elástica" },
      { tipo: "Elástica" },
    ]);
    assert.equal(l.length, 4);
    assert.deepEqual(l[0], { tipo: "Elástica", color: "Gris", arcada: "SUPERIOR", cambiadasHoy: true });
    assert.deepEqual(l[1], { tipo: "Autoligado (sin ligas)", color: null, arcada: "AMBAS", cambiadasHoy: false });
    assert.equal(esTipoSinLigas("Autoligado (sin ligas)"), true);
    assert.equal(esTipoSinLigas("Elástica"), false);
  });

  it("«copiar del control anterior»: las ligas heredan todo menos «se cambiaron hoy»", () => {
    const h = ligasHeredadas([{ tipo: "Elástica", color: "Azul", arcada: "AMBAS", cambiadasHoy: true }]);
    assert.deepEqual(h, [{ tipo: "Elástica", color: "Azul", arcada: "AMBAS", cambiadasHoy: false }]);
    assert.equal(textoDeLiga({ tipo: "Elástica", color: "Azul", arcada: "AMBAS", cambiadasHoy: true }), "Elástica azul · Ambas · se cambiaron");
  });

  it("historial: solo controles con ligas, del más reciente al más viejo", () => {
    const liga = { tipo: "Elástica", color: null, arcada: "AMBAS" as const, cambiadasHoy: true };
    const h = historialDeLigas([
      { cardId: "a", cardNumber: 1, visitDate: "2026-08-01", firmada: true, ligas: [liga] },
      { cardId: "b", cardNumber: 2, visitDate: "2026-09-01", firmada: true, ligas: [] },
      { cardId: "c", cardNumber: 3, visitDate: "2026-10-01", firmada: false, ligas: [liga] },
    ]);
    assert.deepEqual(h.map((c) => c.cardId), ["c", "a"]);
  });

  it("el esquema de guardar acepta lo de la hoja y rechaza una arcada inventada o más de 4", () => {
    assert.equal(extrasDeHojaSchema.safeParse({ wireToLowerId: "cmabc123", ligas: [{ tipo: "Elástica", color: null, arcada: "AMBAS", cambiadasHoy: true }] }).success, true);
    assert.equal(extrasDeHojaSchema.safeParse({ ligas: [{ tipo: "Elástica", arcada: "MEDIA", cambiadasHoy: true }] }).success, false);
    const cinco = Array.from({ length: 5 }, () => ({ tipo: "Elástica", arcada: "AMBAS", cambiadasHoy: false }));
    assert.equal(extrasDeHojaSchema.safeParse({ ligas: cinco }).success, false);
    assert.equal(extrasDeHojaSchema.safeParse(undefined).success, true);
  });
});

describe("M3 · mecánicas auxiliares", () => {
  const hoy = new Date("2026-10-03T18:00:00Z");
  it("el alta pide tipo; arcada opcional y válida; fecha no futura", () => {
    assert.equal(validarAltaDeMecanica({}, hoy).ok, false);
    assert.equal(validarAltaDeMecanica({ tipo: "Resorte abierto", arcada: "LADO" }, hoy).ok, false);
    assert.equal(validarAltaDeMecanica({ tipo: "Cadeneta", colocadaEl: "2026-12-01T12:00:00Z" }, hoy).ok, false);
    const v = validarAltaDeMecanica({ tipo: " Resorte  abierto ", arcada: "SUPERIOR", ubicacion: " 13-14 ", nota: "", colocadaEl: "2026-10-03T12:00:00Z" }, hoy);
    assert.equal(v.ok, true);
    assert.deepEqual(v.alta && { tipo: v.alta.tipo, arcada: v.alta.arcada, ubicacion: v.alta.ubicacion, nota: v.alta.nota }, {
      tipo: "Resorte abierto",
      arcada: "SUPERIOR",
      ubicacion: "13-14",
      nota: null,
    });
    assert.equal(textoDeMecanica({ tipo: "Resorte abierto", arcada: "SUPERIOR", ubicacion: "13-14" }), "Resorte abierto · Superior · 13-14");
  });

  it("activas primero, luego retiradas", () => {
    const m = ordenarMecanicas([
      { id: "r", colocadaEl: "2026-09-01", retiradaEl: "2026-09-20" },
      { id: "a1", colocadaEl: "2026-08-01", retiradaEl: null },
      { id: "a2", colocadaEl: "2026-09-10", retiradaEl: null },
    ]);
    assert.deepEqual(m.map((x) => x.id), ["a2", "a1", "r"]);
  });
});

describe("M4 · catálogos de la clínica", () => {
  it("sin nada guardado: los de fábrica (materiales de siempre, calibres de siempre, ligas y mecánicas)", () => {
    const c = normalizarCatalogos(null);
    assert.deepEqual(c, catalogosDeFabrica());
    assert.deepEqual(c.arcosCalibres.map((g) => g.nombre), ["014", "016", "018", "16x22", "17x25", "19x25"]);
    assert.ok(c.mecanicas.some((m) => m.nombre === "Resorte abierto"));
    assert.ok(c.mecanicas.some((m) => m.nombre === "Expansor"));
    assert.ok(c.ligasTipos.some((m) => m.nombre === "Metálica"));
  });

  it("los calibres se normalizan al formato de la secuencia de arcos", () => {
    assert.equal(normalizarCalibre(".014"), "014");
    assert.equal(normalizarCalibre("0.012"), "012");
    assert.equal(normalizarCalibre("16 X 22"), "16x22");
    assert.equal(normalizarCalibre(".018×.025"), "18x25");
    assert.equal(normalizarCalibre("grueso"), null);
  });

  it("los materiales solo se apagan (no se inventan) y lo guardado se respeta", () => {
    const c = normalizarCatalogos({ arcosMateriales: [{ id: "CRCO", activa: false }, { id: "INVENTADO", nombre: "X", activa: true }] });
    assert.equal(c.arcosMateriales.length, 7);
    assert.equal(c.arcosMateriales.find((m) => m.id === "CRCO")?.activa, false);
    const o = opcionesDeArco(c);
    assert.ok(!o.materiales.some((m) => m.key === "CRCO"));
    assert.deepEqual(o.calibres[0], { key: "014", label: ".014" });
  });

  it("una lista guardada vacía es vacía (la clínica quitó todo); copiar de fábrica las repone sin tocar las propias", () => {
    const c = normalizarCatalogos({ ligasColores: [{ id: "c-1", nombre: "Dorado", activa: true }] });
    assert.deepEqual(c.ligasColores.map((x) => x.nombre), ["Dorado"]);
    assert.equal(faltanDeFabrica("ligasColores", c.ligasColores), true);
    const copiadas = copiarDeFabrica("ligasColores", c.ligasColores);
    assert.equal(copiadas[0].nombre, "Dorado");
    assert.ok(copiadas.some((x) => x.nombre === "Transparente"));
    assert.equal(faltanDeFabrica("ligasColores", copiadas), false);
    assert.deepEqual(normalizarCatalogos({ mecanicas: [] }).mecanicas, []);
  });

  it("validar: nombres vacíos, repetidos o calibres que no lo son", () => {
    assert.match(validarCatalogos({ ligasTipos: [{ nombre: "Elástica" }, { nombre: "elastica" }] }) ?? "", /repetida/);
    assert.match(validarCatalogos({ arcosCalibres: [{ nombre: "grueso" }] }) ?? "", /no es un calibre/);
    assert.equal(validarCatalogos(catalogosDeFabrica()), null);
  });

  it("en la hoja: lo ya anotado se ofrece aunque la clínica lo haya quitado", () => {
    const lista = [{ id: "d-1", nombre: "Gris", activa: true }, { id: "d-2", nombre: "Rojo", activa: false }];
    assert.deepEqual(opcionesParaElegir(lista, ["Rojo", null]), ["Gris", "Rojo"]);
    assert.deepEqual(opcionesParaElegir(lista, []), ["Gris"]);
  });
});

describe("las acciones y los llamadores guardan lo nuevo de la hoja", () => {
  it("guardar borrador y firmar aceptan `extras` y lo escriben después de su transacción", () => {
    for (const f of ["src/app/actions/orthodontics/saveTreatmentCardDraft.ts", "src/app/actions/orthodontics/signTreatmentCard.ts"]) {
      const s = leer(f);
      assert.match(s, /extras: extrasDeHojaSchema/, f);
      assert.match(s, /guardarExtrasDeLaHoja\(\{[^}]*extras: data\.extras/, f);
    }
    // La firma mueve la secuencia de arcos con los DOS arcos nuevos.
    assert.match(leer("src/app/actions/orthodontics/signTreatmentCard.ts"), /cambiosAlFirmarConDosArcos\(/);
  });

  it("la ficha (borrador y firma) y la Agenda mandan `extras` del cajón", () => {
    const ficha = leer("src/components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx");
    assert.equal(ficha.match(/extras: payload\.extras/g)?.length, 2);
    assert.match(leer("src/components/specialties/orthodontics/agenda/BotonHojaControl.tsx"), /extras: payload\.extras/);
  });

  it("nada de lo nuevo se declara en schema.prisma (va por SQL crudo con sonda)", () => {
    const schema = leer("prisma/schema.prisma");
    assert.doesNotMatch(schema, /wireToLowerId|hojaCatalogos|ortho_card_ligatures|ortho_aux_devices/);
    const sql = leer("sql/ws1-t9-hoja-ligas-mecanicas-catalogos.sql");
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "wireToLowerId"/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS "ortho_card_ligatures"/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS "ortho_aux_devices"/);
    assert.match(sql, /ALTER TABLE "ortho_card_ligatures" ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /ALTER TABLE "ortho_aux_devices" ENABLE ROW LEVEL SECURITY/);
    assert.doesNotMatch(sql, /\bDROP\b|\bUPDATE\b|SET SESSION/i);
  });
});
