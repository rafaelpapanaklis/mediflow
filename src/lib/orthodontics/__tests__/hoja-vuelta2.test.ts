// ws1-t9, vuelta 2: el arco nuevo INFERIOR, las ligas y las mecánicas también en el historial de controles de la ficha y
// en Sabina (orto_caso), y el expansor/distalizador del modelo viejo (`OrthoAuxMechanics`) visible junto con la tabla
// nueva — leído, sin migrar datos. Con el código de la vuelta 1 fallan: no existían `mecanicasDelModeloViejo`,
// `mecanicasDeUnControl` ni `listarMecanicasConLegado`, la fila del historial no sabía del inferior y Sabina no
// hablaba de ligas ni de mecánicas.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mecanicasDeUnControl, mecanicasDelModeloViejo, ordenarMecanicas, type MecanicaDelCaso } from "../hoja-extras";
import { EXPANDER_LABELS, DISTALIZER_LABELS } from "@/components/specialties/orthodontics/redesign/types";
import { adaptToOrthoRedesignViewModel } from "../redesign/adapter";

const RAIZ = join(__dirname, "../../../..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const ETQ = { expansor: EXPANDER_LABELS, distalizador: DISTALIZER_LABELS };

describe("expansor / distalizador del modelo viejo", () => {
  it("se leen como mecánicas del caso (solo lectura), con su tipo, activaciones y estado", () => {
    const m = mecanicasDelModeloViejo(
      {
        expanderType: "RPE_HYRAX",
        expanderActivations: 28,
        expanderInstalledAt: "2026-03-01T12:00:00Z",
        expanderRemovedAt: "2026-06-01T12:00:00Z",
        distalizerType: "CARRIERE",
        distalizerInstalledAt: null,
        distalizerRemovedAt: null,
        notes: "Activación 1/4 diaria",
        createdAt: "2026-02-20T12:00:00Z",
      },
      ETQ,
    );
    assert.equal(m.length, 2);
    assert.deepEqual(
      m.map((x) => [x.id, x.tipo, x.legado, Boolean(x.retiradaEl)]),
      [
        ["legado-expansor", "Expansor (RPE / Hyrax)", true, true],
        ["legado-distalizador", "Distalizador (Carriere)", true, false],
      ],
    );
    assert.equal(m[0].nota, "28 activaciones · Activación 1/4 diaria");
    // Sin fecha de colocación anotada: la del registro.
    assert.equal(m[1].colocadaEl, "2026-02-20T12:00:00.000Z");
    // Activas primero: el distalizador (activo) antes que el expansor retirado.
    assert.deepEqual(ordenarMecanicas(m).map((x) => x.id), ["legado-distalizador", "legado-expansor"]);
  });

  it("sin fila o sin tipos, nada", () => {
    assert.deepEqual(mecanicasDelModeloViejo(null, ETQ), []);
    assert.deepEqual(
      mecanicasDelModeloViejo(
        { expanderType: null, expanderActivations: null, expanderInstalledAt: null, expanderRemovedAt: null, distalizerType: null, distalizerInstalledAt: null, distalizerRemovedAt: null, notes: "x", createdAt: new Date() },
        ETQ,
      ),
      [],
    );
  });

  it("la pantalla no ofrece «Retirar» en las del modelo viejo y la ficha no las pinta dos veces", () => {
    const hoja = leer("src/components/specialties/orthodontics/redesign/drawers/HojaExtras.tsx");
    assert.match(hoja, /onRetirar=\{editable && !m\.legado/);
    const plan = leer("src/components/specialties/orthodontics/redesign/sections/SectionPlan.tsx");
    assert.match(plan, /const aux = listaNueva \? null : auxDelCaso;/);
    assert.match(plan, /onCargado=\{\(\) => setListaNueva\(true\)\}/);
    // Las dos acciones leen las dos fuentes.
    const acc = leer("src/app/actions/orthodontics/hojaExtras.ts");
    assert.equal(acc.match(/listarMecanicasConLegado\(ctx\.clinicId/g)?.length, 2);
  });
});

describe("historial de controles de la ficha", () => {
  const m = (id: string, alta: string | null, retiro: string | null): MecanicaDelCaso => ({
    id,
    tipo: id === "a" ? "Cadeneta" : "Resorte abierto",
    arcada: id === "a" ? "INFERIOR" : "SUPERIOR",
    ubicacion: id === "a" ? "33-43" : null,
    nota: null,
    colocadaEl: "2026-09-01T12:00:00Z",
    retiradaEl: retiro ? "2026-10-01T12:00:00Z" : null,
    cardIdAlta: alta,
    cardIdRetiro: retiro,
  });

  it("cada control dice lo que se colocó y retiró en él", () => {
    const lista = [m("a", "c2", null), m("b", "c1", "c2")];
    assert.deepEqual(mecanicasDeUnControl(lista, "c2"), { colocadas: ["Cadeneta · Inferior · 33-43"], retiradas: ["Resorte abierto · Superior"] });
    assert.deepEqual(mecanicasDeUnControl(lista, "c1"), { colocadas: ["Resorte abierto · Superior"], retiradas: [] });
  });

  it("el adaptador de la ficha pasa a cada hoja su arco inferior, sus ligas y sus mecánicas", () => {
    const paso = (id: string, sup: boolean, inf: boolean) => ({
      id, treatmentPlanId: "plan", clinicId: "cl", orderIndex: 1, phaseKey: "LEVELING", material: "SS", shape: "RECT", gauge: "16x22",
      purpose: null, archUpper: sup, archLower: inf, durationWeeks: 6, auxiliaries: [], notes: null, status: "ACTIVE",
      plannedDate: null, appliedDate: null, completedDate: null, createdAt: new Date(), updatedAt: new Date(), patientId: null,
    });
    const hoja = {
      id: "c2", cardNumber: 2, visitDate: new Date("2026-10-01T16:00:00Z"), durationMin: 30, phaseKey: "LEVELING", monthAt: { toString: () => "6" },
      wireFromId: null, wireToId: "sup", wireToLowerId: "inf", soapS: "", soapO: "", soapA: "", soapP: "P", hygienePlaquePct: null,
      hygieneGingivitis: null, hygieneWhiteSpots: false, hasProgressPhoto: false, photoSetId: null, nextDate: null, nextDurationMin: null,
      status: "SIGNED", signedAt: null, signedBy: null, activationsNote: null, indications: null, elastics: [], iprPoints: [], brokenBrackets: [],
      ligas: [{ tipo: "Elástica", color: "Gris", arcada: "AMBAS", cambiadasHoy: true }],
      mecanicasDelControl: { colocadas: ["Cadeneta · Inferior · 33-43"], retiradas: [] },
    };
    const legacy = {
      patientId: "p", patientName: "Ana Prueba", isMinor: false, patientAge: 20, hasPediatricProfile: false, pediatricHabits: [],
      diagnosis: null, phases: [], monthInTreatment: 6, paymentPlan: null, installments: [], photoSets: [], controls: [], digitalRecords: [],
      plan: { id: "plan", invoiceId: null, totalCostMxn: 0, technique: "METAL_BRACKETS", prescriptionSlot: null, bondingType: null, prescriptionNotes: null,
        techniqueNotes: null, installedAt: null, startDate: null, estimatedDurationMonths: 24, status: "IN_PROGRESS" },
    } as never;
    const vm = adaptToOrthoRedesignViewModel({ legacy, wireSteps: [paso("sup", true, false), paso("inf", false, true)] as never, treatmentCards: [hoja] as never, attendancePct: 0, elasticsCompliancePct: 0 });
    const c = vm.treatmentCards[0];
    assert.equal(c.wireTo?.id, "sup");
    assert.equal(c.wireToLower?.id, "inf");
    assert.equal(c.ligas?.[0].color, "Gris");
    assert.deepEqual(c.mecanicasDelControl?.colocadas, ["Cadeneta · Inferior · 33-43"]);
    // La cabecera («Arcos actuales») dice el inferior de la hoja.
    assert.equal(vm.treatment.wiresCurrent?.superior?.id, "sup");
    assert.equal(vm.treatment.wiresCurrent?.inferior?.id, "inf");
    // La fila del historial pinta el arco de cada arcada, las ligas y las mecánicas.
    const fila = leer("src/components/specialties/orthodontics/redesign/atoms/TimelineRow.tsx");
    assert.match(fila, /arcosNuevosDeLaHoja\(card\.wireTo, card\.wireToLower\)/);
    assert.match(fila, /rotulo="Ligas"/);
    assert.match(fila, /rotulo="Mecánicas"/);
    // Y el cargador de la ficha los lee.
    const loader = leer("src/lib/orthodontics/redesign/loader.ts");
    assert.match(loader, /leerLigasDeHojas\(input\.clinicId, idsDeHojas\)/);
    assert.match(loader, /mecanicasDelControl: mecanicasDeUnControl\(mecanicasDelCaso, c\.id\)/);
  });
});

describe("Sabina (orto_caso)", () => {
  it("dice el arco de cada arcada (con el inferior de la hoja), las ligas del último control y las mecánicas activas", async () => {
    const { ortoCaso, arcosLegibles } = await import("@/lib/sabina/tools/orto-caso");
    assert.equal(
      arcosLegibles({ superior: { id: "s", material: "SS", gauge: "16x22", archUpper: true, archLower: false }, inferior: { id: "i", material: "NITI", gauge: "016", archUpper: false, archLower: true } } as never),
      "SS 16x22 (superior) y NiTi 016 (inferior)",
    );
    const texto = (ortoCaso as unknown as { resumir: (d: unknown) => string }).resumir({
      modulo: "activo",
      noEncontrado: null,
      aclarar: null,
      paciente: "Ana Prueba",
      enlace: "/dashboard/patients/p?tab=ortodoncia",
      caso: { estado: "En curso", mes: 6, de: 24, inicio: null, finEstimado: null },
      tieneValoracion: true,
      clinico: {
        fase: "Nivelación",
        arco: "SS 16x22 (superior) y NiTi 016 (inferior)",
        ligas: ["Elástica gris · Ambas · se cambiaron"],
        mecanicasActivas: ["Cadeneta · Inferior · 33-43", "Expansor (RPE / Hyrax)"],
        higiene: null,
        higieneEmpeora: [],
        plan: [],
        alineadores: null,
      },
      controles: null,
      cobranza: null,
      omitidas: [],
    });
    assert.match(texto, /Arco actual: SS 16x22 \(superior\) y NiTi 016 \(inferior\)/);
    assert.match(texto, /Ligas del último control: Elástica gris · Ambas · se cambiaron\./);
    assert.match(texto, /Mecánicas auxiliares activas: Cadeneta · Inferior · 33-43; Expansor \(RPE \/ Hyrax\)\./);
    // El motor lee el inferior, las ligas y las mecánicas (las dos fuentes) con el permiso clínico.
    const motor = leer("src/lib/sabina/tools/orto-motor.ts");
    assert.match(motor, /wireToLowerId: inferiores\.get\(h\.id\)/);
    assert.match(motor, /listarMecanicasConLegado\(clinicId, plan\.id, db as never\)/);
    assert.match(motor, /const \[inferiores, ligasDeHojas, mecanicas\] = ver\.clinico/);
  });
});
