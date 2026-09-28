// «Pacientes en tratamiento» del módulo: filas clínicas y filtros
// (ws1-t4 ronda 6, filas 18, 19 y 20 de la revisión de lógica de uso).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SIN_DOCTOR,
  contarPorEstado,
  controlesPorPaciente,
  doctoresDeLaLista,
  filaDeCaso,
  filtrarCasos,
  leerFiltroEstado,
  leerFiltroVer,
  type CasoParaLaLista,
  type FilaDeCaso,
  type FiltrosDeCasos,
} from "../pacientes-modulo";

const AHORA = new Date("2026-09-28T18:00:00.000Z");

function caso(extra: Partial<CasoParaLaLista> = {}): CasoParaLaLista {
  return {
    planId: "plan-1",
    patientId: "pac-1",
    patientName: "Ana Ruiz",
    treatingDoctorId: "doc-1",
    treatingDoctorName: "Mariana Cortés",
    status: "IN_PROGRESS",
    installedAt: new Date("2026-07-28T16:00:00.000Z"),
    estimatedDurationMonths: 18,
    statusUpdatedAt: new Date("2026-07-28T16:00:00.000Z"),
    cobranza: { vencidas: [] },
    ...extra,
  };
}

const CLINICO = {
  technique: "METAL_BRACKETS",
  phases: [
    { status: "IN_PROGRESS", phaseKey: "ALIGNMENT" },
    { status: "NOT_STARTED", phaseKey: "LEVELING" },
  ],
};

const SIN_FILTROS: FiltrosDeCasos = { estado: "activos", doctor: null, ver: null, consulta: "" };

function fila(extra: Partial<CasoParaLaLista> = {}): FilaDeCaso {
  const f = filaDeCaso(caso(extra), CLINICO, undefined, AHORA);
  assert.ok(f);
  return f;
}

describe("filaDeCaso", () => {
  it("un caso en curso dice por dónde va y qué lleva, igual que la ficha", () => {
    const f = fila();
    assert.equal(f.etiquetaEstado, "En curso");
    assert.equal(f.etapa, "Mes 2 de 18 · Alineación");
    assert.equal(f.aparatologia, "Brackets metálicos");
  });

  it("fuera de «en curso» manda el estado: un caso en pausa no dice «Mes 9 de 18»", () => {
    for (const [status, etiqueta] of [
      ["PLANNED", "Por colocar"],
      ["ON_HOLD", "Pausado"],
      ["RETENTION", "En retención"],
      ["COMPLETED", "Terminado"],
      ["DROPPED_OUT", "Abandonado"],
    ] as const) {
      const f = fila({ status });
      assert.equal(f.etiquetaEstado, etiqueta);
      assert.equal(f.etapa, "", `${status} no lleva etapa`);
    }
  });

  it("sin plan de pago NO es «al día»", () => {
    assert.equal(fila({ cobranza: null }).cobranza, "sin-plan");
    assert.equal(fila({ cobranza: { vencidas: [] } }).cobranza, "al-dia");
    const conDeuda = fila({ cobranza: { vencidas: [{ falta: 2000 }, { falta: 1000.4 }] } });
    assert.equal(conDeuda.cobranza, "vencido");
    assert.equal(conDeuda.vencidoMxn, 3000);
  });

  it("sin técnica leída pinta una raya, no una clave en inglés", () => {
    const f = filaDeCaso(caso(), undefined, undefined, AHORA);
    assert.equal(f?.aparatologia, "—");
  });

  it("un estado que no conoce no se pinta", () => {
    assert.equal(filaDeCaso(caso({ status: "ALGO_NUEVO" }), CLINICO, undefined, AHORA), null);
  });

  it("colocado y retirado este mes, con el criterio de los indicadores del Tablero", () => {
    assert.equal(fila({ installedAt: new Date("2026-09-03T16:00:00.000Z") }).colocadoEsteMes, true);
    assert.equal(fila().colocadoEsteMes, false);
    const retiro = fila({ status: "RETENTION", statusUpdatedAt: new Date("2026-09-20T16:00:00.000Z") });
    assert.equal(retiro.retiradoEsteMes, true);
    assert.equal(fila({ status: "ON_HOLD", statusUpdatedAt: AHORA }).retiradoEsteMes, false);
  });
});

describe("controlesPorPaciente", () => {
  const cita = (startsAt: string, status: string, patientId = "pac-1") => ({
    patientId,
    startsAt: new Date(startsAt),
    status,
  });

  it("el último es al que SÍ vino, y el próximo el más cercano que sigue en pie", () => {
    const m = controlesPorPaciente(
      [
        cita("2026-08-10T16:00:00.000Z", "COMPLETED"),
        cita("2026-09-10T16:00:00.000Z", "CHECKED_OUT"),
        cita("2026-09-20T16:00:00.000Z", "NO_SHOW"),
        cita("2026-10-30T16:00:00.000Z", "SCHEDULED"),
        cita("2026-10-12T16:00:00.000Z", "CONFIRMED"),
        cita("2026-10-05T16:00:00.000Z", "CANCELLED"),
      ],
      [],
      AHORA,
    );
    assert.equal(m.get("pac-1")?.ultimo?.toISOString(), "2026-09-10T16:00:00.000Z");
    assert.equal(m.get("pac-1")?.proximo?.toISOString(), "2026-10-12T16:00:00.000Z");
  });

  it("una cita pasada que nadie marcó como atendida no cuenta como control hecho", () => {
    const m = controlesPorPaciente([cita("2026-09-27T16:00:00.000Z", "SCHEDULED")], [], AHORA);
    assert.equal(m.get("pac-1")?.ultimo ?? null, null);
  });

  it("una hoja de control registrada sí cuenta, aunque la cita siga «agendada»", () => {
    const m = controlesPorPaciente(
      [cita("2026-09-28T15:00:00.000Z", "SCHEDULED")],
      [{ patientId: "pac-1", visitDate: new Date("2026-09-28T15:30:00.000Z") }],
      AHORA,
    );
    assert.equal(m.get("pac-1")?.ultimo?.toISOString(), "2026-09-28T15:30:00.000Z");
  });
});

describe("filtrarCasos", () => {
  const filas = [
    fila({ planId: "a", patientName: "Ana Ruiz" }),
    fila({ planId: "b", patientName: "Beto Díaz", status: "RETENTION", statusUpdatedAt: new Date("2026-09-15T16:00:00.000Z") }),
    fila({ planId: "c", patientName: "Carla Peña", status: "COMPLETED", treatingDoctorId: "doc-2", treatingDoctorName: "Renata Solís" }),
    fila({ planId: "d", patientName: "Dani Soto", status: "DROPPED_OUT", treatingDoctorId: null, treatingDoctorName: null }),
    fila({ planId: "e", patientName: "Eva Lara", status: "ON_HOLD" }),
  ];
  const ids = (f: Partial<FiltrosDeCasos>) => filtrarCasos(filas, { ...SIN_FILTROS, ...f }).map((r) => r.planId);

  it("abre con los casos activos: en curso, por colocar, en pausa y en retención", () => {
    assert.deepEqual(ids({}), ["a", "b", "e"]);
  });

  it("se puede encontrar a quien terminó o abandonó", () => {
    assert.deepEqual(ids({ estado: "terminado" }), ["c"]);
    assert.deepEqual(ids({ estado: "abandonado" }), ["d"]);
    assert.deepEqual(ids({ estado: "todos" }), ["a", "b", "c", "d", "e"]);
  });

  it("por doctor tratante, y también los que no tienen", () => {
    assert.deepEqual(ids({ estado: "todos", doctor: "doc-2" }), ["c"]);
    assert.deepEqual(ids({ estado: "todos", doctor: SIN_DOCTOR }), ["d"]);
  });

  it("«retirados este mes» manda sobre el estado", () => {
    assert.deepEqual(ids({ ver: "retirados-este-mes" }), ["b"]);
  });

  it("la búsqueda no distingue acentos ni mayúsculas, y también busca por doctor", () => {
    assert.deepEqual(ids({ estado: "todos", consulta: "pena" }), ["c"]);
    assert.deepEqual(ids({ estado: "todos", consulta: "RENATA" }), ["c"]);
  });

  it("los conteos de cada filtro cuadran con lo que filtran", () => {
    const c = contarPorEstado(filas);
    assert.equal(c.activos, ids({}).length);
    assert.equal(c.todos, filas.length);
    assert.equal(c.terminado, 1);
    assert.equal(c.pausado, 1);
  });

  it("la lista de doctores sale por nombre, con «Sin doctor tratante» al final", () => {
    assert.deepEqual(
      doctoresDeLaLista(filas).map((d) => d.nombre),
      ["Mariana Cortés", "Renata Solís", "Sin doctor tratante"],
    );
  });
});

describe("lo que llega en la dirección", () => {
  it("un estado que no existe abre con los casos activos", () => {
    assert.equal(leerFiltroEstado(undefined), "activos");
    assert.equal(leerFiltroEstado("borrados"), "activos");
    assert.equal(leerFiltroEstado("retencion"), "retencion");
    assert.equal(leerFiltroEstado(["pausado", "todos"]), "pausado");
  });

  it("`ver` solo acepta sus dos valores", () => {
    assert.equal(leerFiltroVer("colocados-este-mes"), "colocados-este-mes");
    assert.equal(leerFiltroVer("retirados-este-mes"), "retirados-este-mes");
    assert.equal(leerFiltroVer("todo"), null);
    assert.equal(leerFiltroVer(undefined), null);
  });
});
