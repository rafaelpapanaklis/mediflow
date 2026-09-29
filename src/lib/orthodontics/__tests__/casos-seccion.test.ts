/**
 * Sección «Casos» del módulo de Ortodoncia (ws1-t8): la lista y sus filtros,
 * «Casos de este paciente» en la ficha y «Eliminar caso (abierto por error)».
 *
 * Run: npm run test:orto-casos
 *
 * «Eliminar» se prueba de verdad, con una base en memoria que hace lo que hace
 * Prisma en lo que el código usa (filtros por clínica, `deletedAt`, `updateMany`
 * con su WHERE y una transacción que se deshace si se corta).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HISTORIAL_VACIO,
  TEXTO_CON_HISTORIAL,
  evaluarEliminacion,
  explicacionDeHistorial,
  motivoValido,
  textoDelMovimiento,
} from "../eliminar-caso";
import { eliminarCasoEnBase, type DbEliminar, type EntradaEliminar, type MovimientoAEscribir } from "../eliminar-caso-core";
import {
  casoPorDefecto,
  destinoDelCaso,
  esCasoCerrado,
  leerCasoPedido,
  opcionesDeCasos,
  type CasoDelPaciente,
} from "../casos-del-paciente";
import {
  contarPorEstado,
  doctoresDeLaLista,
  filaDeCaso,
  filtrarCasos,
  saldoDeFactura,
  type CasoParaLaLista,
  type FilaDeCaso,
} from "../pacientes-modulo";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const AHORA = new Date("2026-09-29T18:00:00.000Z");

// ═══ La lista: filas y filtros ═════════════════════════════════════════════

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
const CLINICO = { technique: "METAL_BRACKETS", phases: [{ status: "IN_PROGRESS", phaseKey: "ALIGNMENT" }] };

describe("la lista de casos", () => {
  it("cada fila trae paciente, técnica, doctor, etapa, inicio y saldo", () => {
    const f = filaDeCaso(caso(), CLINICO, undefined, AHORA, { saldoMxn: 12500 })!;
    assert.equal(f.patientName, "Ana Ruiz");
    assert.equal(f.aparatologia, "Brackets metálicos");
    assert.equal(f.treatingDoctorName, "Mariana Cortés");
    assert.equal(f.etiquetaEstado, "En curso");
    assert.match(f.etapa, /Alineación/);
    assert.equal(f.inicio, "2026-07-28T16:00:00.000Z");
    assert.equal(f.saldoMxn, 12500);
  });

  it("un caso sin colocar no tiene inicio y sin factura no tiene saldo", () => {
    const f = filaDeCaso(caso({ status: "PLANNED", installedAt: null, cobranza: null }), CLINICO, undefined, AHORA)!;
    assert.equal(f.inicio, null);
    assert.equal(f.saldoMxn, null);
  });

  it("el saldo es el total menos lo cobrado, sin bajar de cero", () => {
    assert.equal(saldoDeFactura(20000, [{ amount: 5000 }, { amount: "2500.5" }]), 12499.5);
    assert.equal(saldoDeFactura(1000, [{ amount: 1500 }]), 0);
    assert.equal(saldoDeFactura(1000, []), 1000);
  });

  it("sin saber qué tiene el caso, «Eliminar» no se ofrece ni se dice que hay historial", () => {
    const f = filaDeCaso(caso(), CLINICO, undefined, AHORA)!;
    assert.equal(f.eliminar.puede, false);
    assert.equal(f.eliminar.explicacion, "");
  });

  it("un caso vacío se puede eliminar; uno con historia dice por qué no", () => {
    const vacio = filaDeCaso(caso(), CLINICO, undefined, AHORA, { saldoMxn: null, historial: HISTORIAL_VACIO })!;
    assert.equal(vacio.eliminar.puede, true);
    const conHistoria = filaDeCaso(caso(), CLINICO, undefined, AHORA, {
      saldoMxn: null,
      historial: { ...HISTORIAL_VACIO, hojasDeControl: 2, facturasConPagos: 1 },
    })!;
    assert.equal(conHistoria.eliminar.puede, false);
    assert.equal(conHistoria.eliminar.explicacion, "Tiene historial (2 hojas de control, 1 factura con pagos): márcalo como Terminado o Abandonó.");
  });

  const filas: FilaDeCaso[] = [
    filaDeCaso(caso({ planId: "a", patientId: "pa", patientName: "Ana Ruiz" }), CLINICO, undefined, AHORA)!,
    filaDeCaso(caso({ planId: "b", patientId: "pb", patientName: "Beto Núñez", treatingDoctorId: "doc-2", treatingDoctorName: "Luis Peña", status: "COMPLETED" }), CLINICO, undefined, AHORA)!,
    filaDeCaso(caso({ planId: "c", patientId: "pc", patientName: "Carla Díaz", treatingDoctorId: null, treatingDoctorName: null, status: "PLANNED", installedAt: null }), CLINICO, undefined, AHORA)!,
    // Dos casos del mismo paciente: los dos salen, cada uno con su fila.
    filaDeCaso(caso({ planId: "d", patientId: "pa", patientName: "Ana Ruiz", status: "DROPPED_OUT", treatingDoctorId: "doc-2", treatingDoctorName: "Luis Peña" }), CLINICO, undefined, AHORA)!,
  ];
  const F = { estado: "todos" as const, doctor: null, ver: null, consulta: "" };

  it("«todos» trae todos los casos de la sede, también los de un mismo paciente", () => {
    assert.deepEqual(filtrarCasos(filas, F).map((f) => f.planId), ["a", "b", "c", "d"]);
  });
  it("filtra por etapa", () => {
    assert.deepEqual(filtrarCasos(filas, { ...F, estado: "terminado" }).map((f) => f.planId), ["b"]);
    assert.deepEqual(filtrarCasos(filas, { ...F, estado: "activos" }).map((f) => f.planId), ["a", "c"]);
    assert.equal(contarPorEstado(filas).abandonado, 1);
  });
  it("filtra por doctor, incluido «sin doctor»", () => {
    assert.deepEqual(filtrarCasos(filas, { ...F, doctor: "doc-2" }).map((f) => f.planId), ["b", "d"]);
    assert.deepEqual(filtrarCasos(filas, { ...F, doctor: "sin-doctor" }).map((f) => f.planId), ["c"]);
    assert.deepEqual(doctoresDeLaLista(filas).map((d) => d.nombre), ["Luis Peña", "Mariana Cortés", "Sin doctor tratante"]);
  });
  it("el buscador encuentra por paciente o doctor, sin acentos ni mayúsculas", () => {
    assert.deepEqual(filtrarCasos(filas, { ...F, consulta: "nunez" }).map((f) => f.planId), ["b"]);
    assert.deepEqual(filtrarCasos(filas, { ...F, consulta: "PEÑA" }).map((f) => f.planId), ["b", "d"]);
    assert.deepEqual(filtrarCasos(filas, { ...F, consulta: "ana", estado: "activos" }).map((f) => f.planId), ["a"]);
  });
});

// ═══ Casos de este paciente ════════════════════════════════════════════════

describe("casos de este paciente", () => {
  const casos: CasoDelPaciente[] = [
    { id: "nuevo", status: "PLANNED", installedAt: null, createdAt: "2026-09-20T00:00:00.000Z", tecnica: "Alineadores transparentes" },
    { id: "viejo", status: "COMPLETED", installedAt: "2024-02-10T00:00:00.000Z", createdAt: "2024-01-05T00:00:00.000Z", tecnica: "Brackets metálicos" },
  ];
  it("por defecto sale el activo más reciente, aunque haya uno cerrado más nuevo", () => {
    assert.equal(casoPorDefecto(casos), "nuevo");
    assert.equal(casoPorDefecto([{ id: "cerrado-nuevo", status: "DROPPED_OUT" }, { id: "activo-viejo", status: "IN_PROGRESS" }]), "activo-viejo");
  });
  it("si todos cerraron, el más reciente; sin casos, ninguno", () => {
    assert.equal(casoPorDefecto([{ id: "a", status: "COMPLETED" }, { id: "b", status: "DROPPED_OUT" }]), "a");
    assert.equal(casoPorDefecto([]), null);
  });
  it("el caso pedido gana solo si es de este paciente", () => {
    assert.equal(casoPorDefecto(casos, "viejo"), "viejo");
    assert.equal(casoPorDefecto(casos, "de-otro-paciente"), "nuevo");
  });
  it("las opciones se explican solas y marcan el que se ve", () => {
    const o = opcionesDeCasos(casos, "viejo");
    assert.equal(o[0].etiqueta, "Alineadores transparentes · Por colocar · abierto sep 2026");
    assert.equal(o[1].etiqueta, "Brackets metálicos · Terminado · desde feb 2024");
    assert.deepEqual(o.map((x) => x.actual), [false, true]);
    assert.equal(esCasoCerrado("COMPLETED"), true);
    assert.equal(esCasoCerrado("RETENTION"), false);
  });
  it("«Ver caso» lleva a ESE caso; un `?caso=` raro se ignora", () => {
    assert.equal(destinoDelCaso("pac 1", "plan-9"), "/dashboard/patients/pac%201?tab=ortodoncia&caso=plan-9");
    assert.equal(leerCasoPedido("plan-9"), "plan-9");
    assert.equal(leerCasoPedido(["a", "b"]), "a");
    assert.equal(leerCasoPedido("../../x"), null);
    assert.equal(leerCasoPedido(""), null);
    assert.equal(leerCasoPedido("x".repeat(65)), null);
    assert.equal(leerCasoPedido(undefined), null);
  });
});

// ═══ Las reglas de eliminar (puras) ════════════════════════════════════════

describe("reglas de eliminar", () => {
  const CADA_MOTIVO: Array<[string, Partial<typeof HISTORIAL_VACIO>, RegExp]> = [
    ["hojas de control", { hojasDeControl: 1 }, /1 hoja de control/],
    ["facturas con pagos", { facturasConPagos: 2 }, /2 facturas con pagos/],
    ["pagos del plan de pagos antiguo", { pagosDelPlanAntiguo: 1 }, /plan de pagos/],
    ["factura timbrada", { facturasTimbradas: 1 }, /1 factura timbrada/],
    ["fotos", { fotos: 3 }, /3 fotos/],
    ["análisis", { analisis: 1 }, /1 análisis/],
    ["alineadores", { alineadores: 1 }, /1 alineador/],
    ["citas atendidas", { citasAtendidas: 2 }, /2 citas atendidas/],
    ["otros registros clínicos", { otrosRegistros: 1 }, /1 registro clínico/],
  ];
  for (const [nombre, h, texto] of CADA_MOTIVO) {
    it(`niega por ${nombre}`, () => {
      const v = evaluarEliminacion({ ...HISTORIAL_VACIO, ...h });
      assert.equal(v.puede, false);
      assert.match(explicacionDeHistorial(v), texto);
      assert.match(explicacionDeHistorial(v), /márcalo como Terminado o Abandonó/);
    });
  }
  it("un caso vacío se puede eliminar, y sus facturas sin pagos no lo impiden: se cancelan", () => {
    assert.equal(evaluarEliminacion(HISTORIAL_VACIO).puede, true);
    const v = evaluarEliminacion({ ...HISTORIAL_VACIO, facturasSinPagos: ["f1", "f2"] });
    assert.equal(v.puede, true);
    assert.equal(v.facturasACancelar, 2);
    assert.equal(explicacionDeHistorial(v), "");
  });
  it("el texto corto de la fila es el que pidió Rafael", () => {
    assert.match(TEXTO_CON_HISTORIAL, /^Tiene historial: márcalo como Terminado o Abandonó/);
  });
  it("el motivo pide al menos 10 letras, sin contar espacios de sobra", () => {
    assert.equal(motivoValido("corto"), null);
    assert.equal(motivoValido("   " + "a".repeat(9) + "   "), null);
    assert.equal(motivoValido("  se abrió   en el paciente equivocado "), "se abrió en el paciente equivocado");
    assert.equal(motivoValido(undefined), null);
    assert.equal(motivoValido("a".repeat(301)), null);
  });
  it("el movimiento dice qué y por qué", () => {
    assert.equal(textoDelMovimiento("se abrió en el paciente equivocado", 0), "Eliminó un caso de ortodoncia abierto por error. Motivo: se abrió en el paciente equivocado.");
    assert.match(textoDelMovimiento("error de captura x", 1), /Se canceló 1 factura sin pagos del caso\.$/);
    assert.match(textoDelMovimiento("error de captura x", 2), /Se cancelaron 2 facturas sin pagos del caso\.$/);
  });
});

// ═══ Eliminar, contra una base en memoria ══════════════════════════════════

type Fila = Record<string, unknown>;
interface Estado {
  planes: Fila[];
  diagnosticos: Fila[];
  facturas: Fila[];
  citas: Fila[];
  /** Filas de las tablas que cuelgan del caso, por nombre de modelo de Prisma. */
  tablas: Record<string, Fila[]>;
  enlacesDeFacturas: Array<{ id: string; plan: string }>;
}

const MODELOS_AGRUPADOS = [
  "orthoTreatmentCard",
  "orthoPhotoSet",
  "orthodonticMonitoringPhoto",
  "orthodonticCephalometryAnalysis",
  "orthodonticFacialAnalysis",
  "orthodonticBoltonAnalysis",
  "orthodonticAligner",
  "orthodonticControlAppointment",
  "orthodonticDigitalRecord",
  "orthodonticConsent",
  "orthoTAD",
  "orthoWireStep",
  "orthoAuxMechanics",
] as const;

function estadoInicial(): Estado {
  return {
    planes: [
      { id: "plan-1", clinicId: "c1", patientId: "pac-1", diagnosisId: "dx-1", createdAt: new Date("2026-09-20T10:00:00Z"), invoiceId: null, deletedAt: null },
      { id: "plan-otra", clinicId: "c2", patientId: "pac-9", diagnosisId: "dx-9", createdAt: new Date("2026-09-20T10:00:00Z"), invoiceId: null, deletedAt: null },
    ],
    diagnosticos: [
      { id: "dx-1", clinicId: "c1", deletedAt: null, initialPhotoSetId: null, initialCephFileId: null, initialScanFileId: null },
      { id: "dx-9", clinicId: "c2", deletedAt: null, initialPhotoSetId: null, initialCephFileId: null, initialScanFileId: null },
    ],
    facturas: [],
    citas: [],
    tablas: Object.fromEntries([...MODELOS_AGRUPADOS, "orthoPaymentPlan"].map((m) => [m, [] as Fila[]])),
    enlacesDeFacturas: [],
  };
}

const enConj = (v: unknown, x: unknown) => (v as { in?: unknown[] })?.in?.includes(x) ?? true;

function crearBase(estado: Estado) {
  const state = { ref: estado };
  const gancho = { antesDeLaTransaccion: (() => {}) as () => void };
  const llamadasDeEscritura: string[] = [];
  const cumple = (fila: Fila, where: Fila): boolean => {
    for (const [k, v] of Object.entries(where)) {
      if (k === "AND" || k === "OR" || k === "diagnosis") continue;
      if (v === null) { if (fila[k] !== null && fila[k] !== undefined) return false; continue; }
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const o = v as Record<string, unknown>;
        if ("in" in o && !(o.in as unknown[]).includes(fila[k])) return false;
        if ("lte" in o && !((fila[k] as number) <= (o.lte as number))) return false;
        if ("gt" in o && !((fila[k] as number) > (o.gt as number))) return false;
        if ("gte" in o && !((fila[k] as Date) >= (o.gte as Date))) return false;
        if ("not" in o && fila[k] === o.not) return false;
        continue;
      }
      if (fila[k] !== v) return false;
    }
    return true;
  };
  const agrupada = (modelo: string) => ({
    groupBy: async ({ where }: { where: Fila }) => {
      const cuenta = new Map<string, number>();
      for (const f of state.ref.tablas[modelo]) {
        if (cumple(f, { deletedAt: undefined, ...where } as Fila) || false) {
          if (where.deletedAt === null && f.deletedAt) continue;
          if (where.attendance && f.attendance !== where.attendance) continue;
          if (!enConj(where.treatmentPlanId, f.treatmentPlanId) || f.clinicId !== where.clinicId) continue;
          cuenta.set(String(f.treatmentPlanId), (cuenta.get(String(f.treatmentPlanId)) ?? 0) + 1);
        }
      }
      return [...cuenta].map(([treatmentPlanId, n]) => ({ treatmentPlanId, _count: { _all: n } }));
    },
  });

  const db = {
    orthodonticTreatmentPlan: {
      findFirst: async ({ where }: { where: Fila }) => state.ref.planes.find((p) => cumple(p, where)) ?? null,
      findMany: async ({ where }: { where: Fila }) =>
        state.ref.planes.filter((p) => {
          if (p.clinicId !== where.clinicId || !enConj(where.id, p.id)) return false;
          const dx = state.ref.diagnosticos.find((d) => d.id === p.diagnosisId);
          return !!dx && (dx.initialPhotoSetId !== null || dx.initialCephFileId !== null || dx.initialScanFileId !== null);
        }),
      updateMany: async ({ where, data }: { where: Fila; data: Fila }) => {
        llamadasDeEscritura.push("plan");
        const filas = state.ref.planes.filter((p) => cumple(p, where));
        for (const f of filas) Object.assign(f, data);
        return { count: filas.length };
      },
    },
    orthodonticDiagnosis: {
      updateMany: async ({ where, data }: { where: Fila; data: Fila }) => {
        llamadasDeEscritura.push("diagnostico");
        const filas = state.ref.diagnosticos.filter((d) => cumple(d, where));
        for (const f of filas) Object.assign(f, data);
        return { count: filas.length };
      },
    },
    orthoPaymentPlan: {
      findMany: async ({ where }: { where: Fila }) =>
        state.ref.tablas.orthoPaymentPlan.filter((f) => f.clinicId === where.clinicId && enConj(where.treatmentPlanId, f.treatmentPlanId) && (f.paidAmount as number) > 0),
    },
    appointment: {
      findMany: async ({ where }: { where: Fila }) => state.ref.citas.filter((c) => cumple(c, where)),
    },
    invoice: {
      findMany: async ({ where }: { where: Fila }) =>
        state.ref.facturas
          .filter((f) => f.clinicId === where.clinicId && enConj(where.id, f.id))
          .map((f) => ({ ...f, _count: { payments: (f.payments as number) ?? 0 } })),
      updateMany: async ({ where, data }: { where: Fila; data: Fila }) => {
        llamadasDeEscritura.push("factura");
        const filas = state.ref.facturas.filter((f) => cumple(f, where));
        for (const f of filas) Object.assign(f, data);
        return { count: filas.length };
      },
    },
    $queryRaw: async (strings: TemplateStringsArray, ...valores: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes("FOR UPDATE")) return [];
      if (sql.includes("orthodonticTreatmentPlanId")) return state.ref.enlacesDeFacturas;
      throw new Error(`consulta cruda inesperada: ${sql} ${valores.length}`);
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
      gancho.antesDeLaTransaccion();
      const copia = structuredClone(state.ref);
      try {
        return await fn(db);
      } catch (e) {
        state.ref = copia; // se corta: no queda nada a medias
        throw e;
      }
    },
  } as Record<string, unknown>;
  for (const m of MODELOS_AGRUPADOS) db[m] = agrupada(m);
  return { db: db as unknown as DbEliminar, estado: () => state.ref, gancho, llamadasDeEscritura };
}

function armar(over: Partial<EntradaEliminar> = {}, tocar?: (e: Estado) => void) {
  const estado = estadoInicial();
  tocar?.(estado);
  const base = crearBase(estado);
  const movimientos: MovimientoAEscribir[] = [];
  const cerradas: string[] = [];
  const entrada: EntradaEliminar = {
    db: base.db,
    clinicId: "c1",
    userId: "u1",
    treatmentPlanId: "plan-1",
    motivo: "se abrió en el paciente equivocado",
    puedeCancelarFacturas: true,
    columnaDeFacturas: true,
    puedeVerPaciente: async () => true,
    registrar: async (m) => void movimientos.push(m),
    alCancelarFactura: async (id) => void cerradas.push(id),
    ...over,
  };
  return { entrada, base, movimientos, cerradas };
}

const fila = (extra: Fila = {}): Fila => ({ treatmentPlanId: "plan-1", clinicId: "c1", ...extra });
const plan = (e: Estado, id = "plan-1") => e.planes.find((p) => p.id === id)!;
const factura = (extra: Fila = {}): Fila => ({
  id: "f1", clinicId: "c1", invoiceNumber: "FAC-0001", status: "PENDING", paid: 0, cfdiUuid: null, notes: null, payments: 0, ...extra,
});

describe("eliminar un caso vacío", () => {
  it("lo borra (lógico), borra su diagnóstico y deja el movimiento con el motivo", async () => {
    const { entrada, base, movimientos } = armar();
    const r = await eliminarCasoEnBase(entrada);
    assert.deepEqual(r, { ok: true, patientId: "pac-1", planId: "plan-1", facturasCanceladas: 0 });
    const e = base.estado();
    assert.ok(plan(e).deletedAt instanceof Date, "borrado lógico: la fila sigue, con deletedAt");
    assert.ok(e.diagnosticos.find((d) => d.id === "dx-1")!.deletedAt instanceof Date);
    assert.equal(plan(e, "plan-otra").deletedAt, null, "el de otra clínica no se toca");
    assert.equal(movimientos.length, 1);
    assert.deepEqual(
      { t: movimientos[0].entityType, a: movimientos[0].action, id: movimientos[0].entityId, p: movimientos[0].patientId },
      { t: "orthodontic-case", a: "delete", id: "plan-1", p: "pac-1" },
    );
    assert.equal(movimientos[0].texto, "Eliminó un caso de ortodoncia abierto por error. Motivo: se abrió en el paciente equivocado.");
    assert.equal(movimientos[0].cambios?.motivo.after, "se abrió en el paciente equivocado");
  });

  it("cancela la factura SIN pagos del caso, con el motivo, y lo deja en movimientos", async () => {
    const { entrada, base, movimientos, cerradas } = armar({}, (e) => {
      plan(e).invoiceId = "f1";
      e.facturas.push(factura({ notes: "nota vieja" }));
    });
    const r = await eliminarCasoEnBase(entrada);
    assert.equal(r.ok && r.facturasCanceladas, 1);
    const f = base.estado().facturas[0];
    assert.equal(f.status, "CANCELLED");
    assert.match(String(f.notes), /^nota vieja\n\[CANCELADA: Caso de ortodoncia eliminado \(abierto por error\): se abrió en el paciente equivocado\]$/);
    assert.deepEqual(movimientos.map((m) => m.entityType), ["orthodontic-case", "invoice"]);
    assert.equal(movimientos[1].texto, "Canceló la factura FAC-0001 al eliminar el caso de ortodoncia");
    assert.match(movimientos[0].texto, /Se canceló 1 factura sin pagos del caso\./);
    assert.deepEqual(cerradas, ["f1"], "se cierran los links de pago de la factura cancelada");
  });

  it("cancela también las facturas de extras o controles ligadas al caso por la columna", async () => {
    const { entrada, base } = armar({}, (e) => {
      plan(e).invoiceId = "f1";
      e.facturas.push(factura(), factura({ id: "f2", invoiceNumber: "FAC-0002" }));
      e.enlacesDeFacturas.push({ id: "f2", plan: "plan-1" });
    });
    const r = await eliminarCasoEnBase(entrada);
    assert.equal(r.ok && r.facturasCanceladas, 2);
    assert.deepEqual(base.estado().facturas.map((f) => f.status), ["CANCELLED", "CANCELLED"]);
  });

  it("una factura ya cancelada y sin dinero no impide nada ni se cancela otra vez", async () => {
    const { entrada, movimientos } = armar({}, (e) => {
      plan(e).invoiceId = "f1";
      e.facturas.push(factura({ status: "CANCELLED" }));
    });
    const r = await eliminarCasoEnBase(entrada);
    assert.equal(r.ok && r.facturasCanceladas, 0);
    assert.equal(movimientos.length, 1);
  });

  it("una cita atendida ANTERIOR al caso no lo impide (era de un caso viejo)", async () => {
    const { entrada } = armar({}, (e) => {
      e.citas.push({ clinicId: "c1", patientId: "pac-1", type: "Control de ortodoncia", status: "COMPLETED", startsAt: new Date("2025-01-10T10:00:00Z") });
    });
    assert.equal((await eliminarCasoEnBase(entrada)).ok, true);
  });
});

describe("eliminar se niega si el caso tiene historial", () => {
  const POR_MOTIVO: Array<[string, (e: Estado) => void, RegExp]> = [
    ["una hoja de control firmada", (e) => e.tablas.orthoTreatmentCard.push(fila({ status: "SIGNED", deletedAt: null })), /1 hoja de control/],
    ["una factura con pagos (paid)", (e) => { plan(e).invoiceId = "f1"; e.facturas.push(factura({ paid: 500, status: "PARTIAL" })); }, /1 factura con pagos/],
    ["una factura con pagos (filas de pago)", (e) => { plan(e).invoiceId = "f1"; e.facturas.push(factura({ payments: 1 })); }, /1 factura con pagos/],
    ["una factura de extras con pagos, ligada por la columna", (e) => { e.facturas.push(factura({ id: "f7", paid: 350 })); e.enlacesDeFacturas.push({ id: "f7", plan: "plan-1" }); }, /1 factura con pagos/],
    ["un pago del plan de pagos antiguo", (e) => e.tablas.orthoPaymentPlan.push(fila({ paidAmount: 100 })), /plan de pagos/],
    ["una factura ya timbrada", (e) => { plan(e).invoiceId = "f1"; e.facturas.push(factura({ cfdiUuid: "UUID-1" })); }, /1 factura timbrada/],
    ["un juego de fotos", (e) => e.tablas.orthoPhotoSet.push(fila()), /1 foto/],
    ["una foto de seguimiento", (e) => e.tablas.orthodonticMonitoringPhoto.push(fila()), /1 foto/],
    ["las fotos del diagnóstico", (e) => { e.diagnosticos[0].initialPhotoSetId = "set-1"; }, /1 foto/],
    ["un análisis cefalométrico", (e) => e.tablas.orthodonticCephalometryAnalysis.push(fila({ deletedAt: null })), /1 análisis/],
    ["un análisis facial", (e) => e.tablas.orthodonticFacialAnalysis.push(fila({ deletedAt: null })), /1 análisis/],
    ["un análisis de Bolton", (e) => e.tablas.orthodonticBoltonAnalysis.push(fila()), /1 análisis/],
    ["un alineador", (e) => e.tablas.orthodonticAligner.push(fila({ deletedAt: null })), /1 alineador/],
    ["una cita de control atendida", (e) => e.citas.push({ clinicId: "c1", patientId: "pac-1", type: "Control de ortodoncia", status: "COMPLETED", startsAt: new Date("2026-09-25T10:00:00Z") }), /1 cita atendida/],
    ["un control registrado como atendido", (e) => e.tablas.orthodonticControlAppointment.push(fila({ attendance: "ATTENDED" })), /1 cita atendida/],
    ["un consentimiento del caso", (e) => e.tablas.orthodonticConsent.push(fila()), /1 registro clínico/],
    ["un registro digital", (e) => e.tablas.orthodonticDigitalRecord.push(fila()), /1 registro clínico/],
    ["un arco o un TAD", (e) => e.tablas.orthoWireStep.push(fila()), /1 registro clínico/],
  ];
  for (const [nombre, tocar, texto] of POR_MOTIVO) {
    it(`por ${nombre}: no borra nada, no cancela nada y no deja movimiento`, async () => {
      const { entrada, base, movimientos, cerradas } = armar({}, tocar);
      const antes = JSON.stringify(base.estado());
      const r = await eliminarCasoEnBase(entrada);
      assert.equal(r.ok, false);
      assert.match((r as { error: string }).error, /^Tiene historial \(/);
      assert.match((r as { error: string }).error, texto);
      assert.match((r as { error: string }).error, /márcalo como Terminado o Abandonó\.$/);
      assert.equal(JSON.stringify(base.estado()), antes, "la base queda idéntica");
      assert.deepEqual(base.llamadasDeEscritura, []);
      assert.deepEqual(movimientos, []);
      assert.deepEqual(cerradas, []);
    });
  }

  it("un registro que ya se borró (deletedAt) no cuenta como historial", async () => {
    const { entrada } = armar({}, (e) => e.tablas.orthoTreatmentCard.push(fila({ deletedAt: new Date() })));
    assert.equal((await eliminarCasoEnBase(entrada)).ok, true);
  });

  it("con varias cosas las dice todas", async () => {
    const { entrada } = armar({}, (e) => {
      e.tablas.orthoTreatmentCard.push(fila({ deletedAt: null }), fila({ deletedAt: null }));
      e.tablas.orthoPhotoSet.push(fila());
    });
    const r = await eliminarCasoEnBase(entrada);
    assert.equal((r as { error: string }).error, "Tiene historial (2 hojas de control, 1 foto o juego de fotos): márcalo como Terminado o Abandonó.");
  });
});

describe("eliminar: quién, de qué clínica y con qué motivo", () => {
  it("sin motivo (o muy corto) no hace nada", async () => {
    for (const motivo of [undefined, "", "error", "         "]) {
      const { entrada, base, movimientos } = armar({ motivo });
      const r = await eliminarCasoEnBase(entrada);
      assert.equal(r.ok, false);
      assert.match((r as { error: string }).error, /^Escribe el motivo/);
      assert.equal(plan(base.estado()).deletedAt, null);
      assert.deepEqual(movimientos, []);
    }
  });

  it("un caso de otra clínica no existe", async () => {
    const { entrada, base } = armar({ treatmentPlanId: "plan-otra" });
    const r = await eliminarCasoEnBase(entrada);
    assert.deepEqual(r, { ok: false, error: "Caso no encontrado" });
    assert.equal(plan(base.estado(), "plan-otra").deletedAt, null);
  });

  it("sin clínica en la sesión no se consulta nada", async () => {
    const { entrada, base } = armar({ clinicId: "" });
    assert.deepEqual(await eliminarCasoEnBase(entrada), { ok: false, error: "No autenticado" });
    assert.deepEqual(base.llamadasDeEscritura, []);
  });

  it("un paciente restringido no existe para quien no lo ve", async () => {
    const { entrada, base } = armar({ puedeVerPaciente: async () => false });
    assert.deepEqual(await eliminarCasoEnBase(entrada), { ok: false, error: "Caso no encontrado" });
    assert.equal(plan(base.estado()).deletedAt, null);
  });

  it("un caso ya eliminado no se elimina otra vez", async () => {
    const { entrada } = armar({}, (e) => { plan(e).deletedAt = new Date(); });
    assert.deepEqual(await eliminarCasoEnBase(entrada), { ok: false, error: "Caso no encontrado" });
  });

  it("cancelar la factura sin pagos pide billing.refund; sin factura no hace falta", async () => {
    const con = armar({ puedeCancelarFacturas: false }, (e) => { plan(e).invoiceId = "f1"; e.facturas.push(factura()); });
    const r = await eliminarCasoEnBase(con.entrada);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /billing\.refund/);
    assert.equal(con.base.estado().facturas[0].status, "PENDING");
    assert.equal(plan(con.base.estado()).deletedAt, null);

    const sin = armar({ puedeCancelarFacturas: false });
    assert.equal((await eliminarCasoEnBase(sin.entrada)).ok, true);
  });
});

describe("eliminar: si algo cambia mientras tanto, se corta y no queda nada a medias", () => {
  it("un pago que entra entre la lectura y la transacción", async () => {
    const { entrada, base, movimientos } = armar({}, (e) => { plan(e).invoiceId = "f1"; e.facturas.push(factura()); });
    base.gancho.antesDeLaTransaccion = () => {
      const f = base.estado().facturas[0];
      f.paid = 800;
      f.payments = 1;
    };
    const r = await eliminarCasoEnBase(entrada);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /^Tiene historial \(1 factura con pagos\)/);
    const e = base.estado();
    assert.equal(e.facturas[0].status, "PENDING");
    assert.equal(plan(e).deletedAt, null);
    assert.equal(e.diagnosticos[0].deletedAt, null);
    assert.deepEqual(movimientos, []);
  });

  it("una hoja de control que se firma en ese instante", async () => {
    const { entrada, base } = armar();
    base.gancho.antesDeLaTransaccion = () => base.estado().tablas.orthoTreatmentCard.push(fila({ deletedAt: null }));
    const r = await eliminarCasoEnBase(entrada);
    assert.match((r as { error: string }).error, /1 hoja de control/);
    assert.equal(plan(base.estado()).deletedAt, null);
  });

  it("si la factura se timbra en ese instante, ni se cancela ni se borra el caso", async () => {
    const { entrada, base } = armar({}, (e) => { plan(e).invoiceId = "f1"; e.facturas.push(factura()); });
    base.gancho.antesDeLaTransaccion = () => { base.estado().facturas[0].cfdiUuid = "UUID-2"; };
    const r = await eliminarCasoEnBase(entrada);
    assert.equal(r.ok, false);
    assert.equal(base.estado().facturas[0].status, "PENDING");
    assert.equal(plan(base.estado()).deletedAt, null);
  });
});

// ═══ El cableado (que no se pierda) ════════════════════════════════════════

describe("cableado de la sección Casos", () => {
  it("el menú dice «Casos» y la ruta sigue siendo /pacientes (hay enlaces y atajos que la usan)", () => {
    const layout = leer("src/app/dashboard/orthodontics/layout.tsx");
    assert.match(layout, /\{ href: "\/dashboard\/orthodontics\/pacientes", label: "Casos", corto: "Casos" \}/);
    assert.doesNotMatch(layout, /label: "Pacientes en tratamiento"/);
    const pagina = leer("src/app/dashboard/orthodontics/pacientes/page.tsx");
    assert.match(pagina, /titulo="Casos"/);
    assert.doesNotMatch(pagina, /titulo="Pacientes en tratamiento"/);
  });

  it("la página pide el historial solo a quien puede editar, y la llave de reembolsos para las facturas", () => {
    const pagina = leer("src/app/dashboard/orthodontics/pacientes/page.tsx");
    assert.match(pagina, /conHistorial: puedeAbrirCaso/);
    assert.match(pagina, /"billing\.refund"/);
    assert.match(pagina, /puedeCancelarFacturas=\{puedeCancelarFacturas\}/);
    const db = leer("src/lib/orthodontics/pacientes-modulo-db.ts");
    assert.match(db, /if \(!clinicId\) return \[\]/, "sin clínica no se consulta nada");
    assert.match(db, /loadOrthoCases\(clinicId, zonaHoraria, viewer, ahora\)/, "la visibilidad de pacientes la trae la base compartida");
  });

  it("la tabla tiene las columnas pedidas y las tres acciones por fila, sin color suelto", () => {
    const tabla = leer("src/components/specialties/orthodontics/OrthoPacientesTable.tsx");
    for (const col of ["Paciente", "Doctor", "Técnica", "Etapa", "Inicio", "Saldo"]) {
      assert.match(tabla, new RegExp(`role="columnheader"[^>]*>(<span[^>]*>)?${col}`), `columna ${col}`);
    }
    assert.match(tabla, /Ver caso\n/);
    assert.match(tabla, /Editar datos\n/);
    assert.match(tabla, /Eliminar\n/);
    assert.match(tabla, /destinoDelCaso\(r\.patientId, r\.planId\)/, "«Ver caso» abre ESE caso");
    assert.match(tabla, /puedeAbrirCaso && r\.eliminar\.puede/, "«Eliminar» solo a quien edita y solo si aplica");
    assert.match(tabla, /TEXTO_CON_HISTORIAL/, "con historial, la fila lo explica");
    assert.doesNotMatch(tabla, /#[0-9a-fA-F]{3,8}\b|\brgba?\(/);
  });

  it("«Editar datos» es el mismo cajón «Datos del caso» y guarda por la misma acción", () => {
    const acciones = leer("src/components/specialties/orthodontics/modulo/acciones-de-caso.tsx");
    assert.match(acciones, /^"use client";/);
    assert.match(acciones, /<DrawerCaseSettings/);
    assert.match(acciones, /updateTreatmentPlan\(\{/);
    assert.match(acciones, /createPortal\(/, "fuera del contenedor del módulo: lo fijo se ancla a la pantalla");
    assert.match(acciones, /role="dialog"\s+aria-modal="true"/);
  });

  it("la acción de eliminar saca clínica y usuario de la sesión, y del cliente solo el caso y el motivo", () => {
    const accion = leer("src/app/actions/orthodontics/modulo/eliminarCaso.ts");
    assert.match(accion, /^"use server";/);
    assert.match(accion, /await getOrthoActionContext\(\{ write: true \}\)/, "módulo activo + permiso de escribir el expediente");
    assert.match(accion, /clinicId: ctx\.clinicId/);
    assert.match(accion, /userId: ctx\.userId/);
    assert.doesNotMatch(accion, /crudo\.(clinicId|userId)|input[^;\n]*clinicId/);
    assert.match(accion, /loadPatientForOrtho\(/, "visibilidad de pacientes restringidos");
    // "use server": solo se exportan funciones async.
    const exportados = Array.from(accion.matchAll(/^export\s+(?!async function)(\w+)/gm), (m) => m[0]);
    assert.deepEqual(exportados, []);
  });

  it("el núcleo borra en lógico: nunca `delete` ni `deleteMany`", () => {
    const nucleo = leer("src/lib/orthodontics/eliminar-caso-core.ts");
    assert.doesNotMatch(nucleo, /\.delete(Many)?\(/);
    assert.match(nucleo, /data: \{ deletedAt: ahora \}/);
    assert.match(nucleo, /FOR UPDATE/, "las facturas se bloquean como en el cobro");
    assert.match(nucleo, /paid: \{ lte: 0 \}, cfdiUuid: null, status: \{ not: "CANCELLED" \}/, "el WHERE de cancelar repite la regla");
  });

  it("la ficha lee `?caso=`, lo pasa al cargador y enseña el selector", () => {
    const pagina = leer("src/app/dashboard/patients/[id]/page.tsx");
    assert.match(pagina, /planId: leerCasoPedido\(searchParams\?\.caso\)/);
    assert.match(pagina, /orthoCasos=\{orthoCasos\}/);
    const cliente = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
    assert.match(cliente, /<SelectorDeCasos patientId=\{patient\.id\} casos=\{orthoCasos\}/);
    const cargador = leer("src/lib/orthodontics/load-data.ts");
    assert.match(cargador, /\.\.\.base, id: planId/, "el caso pedido se busca por paciente y clínica de la sesión");
    assert.match(cargador, /notIn: \["COMPLETED", "DROPPED_OUT"\]/, "por defecto, el activo");
  });
});
