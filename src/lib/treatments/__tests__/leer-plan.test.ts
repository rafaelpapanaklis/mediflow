/**
 * EL LECTOR DUAL (ws1-t12 · P2): filas si el plan las tiene, texto si es un plan de antes — y lo que
 * sacan de cada uno el PDF y «Convertir en presupuesto». Puro.
 *
 * Run: npm run test:plan-v2
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { componerDescripcion, PLAN_VACIO } from "@/components/dashboard/plan-tratamiento-rediseno/plan-clinico";
import { armarPresupuestoDePlan } from "@/lib/quotes/desde-plan";
import { armarDocumentoDelPlan } from "@/lib/treatments/plan-pdf";
import { leerPlan, nombresDeFase, ordenarParaElPapel } from "@/lib/treatments/leer-plan";
import { filasDesdeConceptos } from "@/lib/treatments/desde-presupuesto";
import type { FilaDelPlan } from "@/lib/treatments/items";

const fila = (id: string, extra: Partial<FilaDelPlan> = {}): FilaDelPlan => ({
  id, clinicId: "c1", planId: "p1", procedureId: null, nombre: `Proc ${id}`, dientes: [], caras: [], fase: "restauradora",
  faseNumero: null, cantidad: 1, precioCentavos: 100_00, estado: "pendiente", hechoEn: null, hechoPor: null, citaId: null,
  motivo: "", hallazgo: null, invoiceId: null, invoiceLinea: null, quoteItemId: null, orden: 0, canceladoEn: null,
  canceladoPor: null, createdById: null, createdAt: new Date(0), updatedAt: new Date(0), ...extra,
});

const rot = {
  diagnostico: "Diagnóstico", pronostico: "Pronóstico", total: "Total de procedimientos", alternativa: "Alternativa", notas: "Notas", por: "por:",
  fase: (f: string) => (f === "higienica" ? "Fase I · Higiénica" : "Fase III · Restauradora"), pronosticoValor: () => "Bueno",
  dinero: (n: number) => `$${n.toLocaleString("en-US")}`,
};
const reng = (procedimiento: string, extra: Record<string, unknown> = {}) => ({
  id: procedimiento, fase: "higienica" as const, procedimiento, procedimientoId: null, dientes: "", caras: [], motivo: "",
  cantidad: "", precio: "", precioDelTarifario: false, minutos: 0, ...extra,
});
const TEXTO = componerDescripcion({ ...PLAN_VACIO, renglones: [reng("Limpieza dental", { precio: "800" })] } as any, rot as any);

test("plan de antes (sin filas): se lee el texto, como hoy", () => {
  const l = leerPlan({ description: TEXTO }, []);
  assert.equal(l.fuente, "texto");
  assert.equal(l.renglones.length, 1);
  assert.equal(l.renglones[0].nombre, "Limpieza dental");
  assert.equal(l.textoRedondeado, true, "texto sin la marca de exacto");
  assert.equal(leerPlan({ description: TEXTO }, null).fuente, "texto");
  // solo canceladas = como si no tuviera filas
  assert.equal(leerPlan({ description: TEXTO }, [fila("x", { estado: "cancelado" })]).fuente, "texto");
});

test("plan con filas: mandan las filas (exactas), en orden clínico, sin las canceladas; el texto se ignora", () => {
  const filas = [
    fila("r", { nombre: "Resina", dientes: [16, 26], caras: ["M", "O"], precioCentavos: 1250_50, cantidad: 2, fase: "restauradora", orden: 0, procedureId: "proc-r", motivo: "Caries" }),
    fila("l", { nombre: "Limpieza", fase: "higienica", orden: 1, precioCentavos: 800_00 }),
    fila("c", { nombre: "Cancelada", estado: "cancelado", orden: 2 }),
    fila("e", { nombre: "Del presupuesto", fase: null, faseNumero: 2, orden: 3 }),
  ];
  const l = leerPlan({ description: TEXTO }, filas);
  assert.equal(l.fuente, "filas");
  assert.equal(l.textoRedondeado, false);
  assert.deepEqual(l.renglones.map((r) => r.nombre), ["Limpieza", "Resina", "Del presupuesto"], "higiénica antes que restauradora; la cancelada no sale");
  const resina = l.renglones[1];
  assert.equal(resina.precio, 1250.5);
  assert.equal(resina.dientes, "16,26");
  assert.equal(resina.caras, "MO");
  assert.equal(resina.procedureId, "proc-r");
  assert.equal(resina.filaId, "r");
  assert.equal(resina.faseNombre, "Fase III · Restauradora");
  assert.deepEqual(l.renglones.map((r) => r.fase), [1, 2, 3]);
  assert.equal(l.renglones[2].faseNombre, "Fase 2");
  assert.equal(nombresDeFase("en")(null, 2), "Phase 2");
  assert.deepEqual(ordenarParaElPapel(filas).map((f) => f.id), ["l", "r", "c", "e"], "por fase y luego por orden (las etapas numéricas al final)");
});

test("PDF con filas: precio exacto, total del plan; una diferencia es «descuento» (texto exacto), nunca «redondeo»", () => {
  const filas = [fila("r", { nombre: "Resina", precioCentavos: 1250_50, cantidad: 2 }), fila("l", { nombre: "Limpieza", fase: "higienica", precioCentavos: 449_60 })];
  const l = leerPlan({ description: null }, filas);
  const doc = armarDocumentoDelPlan({ name: "Plan", description: null, totalCost: 2950.6 }, { renglones: l.renglones });
  assert.equal(doc.sinDetalle, false);
  assert.equal(doc.subtotal, 2950.6);
  assert.equal(doc.ajuste, null);
  assert.deepEqual(doc.grupos.map((g) => g.subtotal), [449.6, 2501]);
  // Plan aceptado con descuento global (totalCost < filas): sale «descuento».
  const conDesc = armarDocumentoDelPlan({ name: "Plan", description: null, totalCost: 2900 }, { renglones: l.renglones });
  assert.deepEqual(conDesc.ajuste, { tipo: "descuento", monto: -50.6 });
  // Sin renglones: igual que hoy (el texto).
  assert.equal(armarDocumentoDelPlan({ name: "Plan", description: TEXTO, totalCost: 800 }, { renglones: [] }).grupos[0].renglones[0].nombre, "Limpieza dental");
});

test("Convertir con filas: precio de la fila (no del tarifario), su procedimiento por id y la fila de cada concepto", () => {
  const filas = [
    fila("r", { nombre: "Resina con otro nombre", procedureId: "proc-r", precioCentavos: 1250_50, dientes: [16] }),
    fila("z", { nombre: "Cortesía", precioCentavos: 0 }),
  ];
  const l = leerPlan({ description: null }, filas);
  const tarifario = [{ id: "proc-r", name: "Resina", basePrice: 1300 }];
  const a = armarPresupuestoDePlan({ name: "Plan", description: TEXTO, totalCost: 1250.5 }, tarifario, { renglones: l.renglones });
  assert.equal(a.sinDetalle, false);
  assert.equal(a.conceptos.length, 2);
  assert.equal(a.conceptos[0].unitPrice, 1250.5);
  assert.equal(a.conceptos[0].procedureId, "proc-r");
  assert.equal(a.conceptos[0].deTarifario, true);
  assert.equal(a.conceptos[0].toothFdi, "16");
  assert.equal(a.conceptos[0].filaId, "r");
  assert.equal(a.conceptos[1].unitPrice, 0, "cortesía en $0, no se costea con el tarifario");
  assert.equal(a.total, 1250.5);
  assert.equal(a.totalDifiere, false);
});

test("presupuesto aceptado → filas: una por concepto, sin perder el concepto por un dato viejo", () => {
  const filas = filasDesdeConceptos([
    { id: "qi1", name: "Resina", toothFdi: "16,26", quantity: 2, unitPrice: "1250.50", phase: 1, procedureId: "proc-r" },
    { id: "qi2", name: "Corona", toothFdi: "99", quantity: 1, unitPrice: 5000, phase: 2 },
    { id: "qi3", name: "Sin fase", toothFdi: null, quantity: 1, unitPrice: 300, phase: 99 },
  ]);
  assert.equal(filas.length, 3);
  assert.deepEqual(filas.map((f) => f.quoteItemId), ["qi1", "qi2", "qi3"]);
  assert.equal(filas[0].fila.precioCentavos, 125050);
  assert.deepEqual(filas[0].fila.dientes, [16, 26]);
  assert.equal(filas[0].fila.faseNumero, 1);
  assert.equal(filas[0].fila.procedureId, "proc-r");
  assert.deepEqual(filas[1].fila.dientes, [], "el 99 no es FDI: la fila entra sin diente");
  assert.equal(filas[2].fila.faseNumero, null, "etapa fuera de rango: sin etapa");
});
