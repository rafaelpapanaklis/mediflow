/**
 * DEL PLAN DE TRATAMIENTO AL PRESUPUESTO — el parser y el armado (ws1-t3, punto 7e del ticket 3).
 *
 * Run: npm run test:presupuesto-desde-plan
 *
 * El plan guarda sus procedimientos como TEXTO en `description` (`componerDescripcion`). Estas pruebas
 * escriben el texto con la función REAL de la ventana del plan y comprueban que de ahí salen los
 * conceptos del presupuesto: nombre, dientes, cantidad, precio y fase.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { componerDescripcion, PLAN_VACIO, type PlanClinico, type Renglon, type Rotulos } from "@/components/dashboard/plan-tratamiento-rediseno/plan-clinico";
import { armarPresupuestoDePlan, leerDinero, leerRenglonesDelPlan, leerTotalDelPlan } from "../desde-plan";
import { dineroExacto } from "@/lib/treatments/dinero-exacto";
import { formatCurrency } from "@/lib/utils";

const rot: Rotulos = {
  diagnostico: "Diagnóstico", pronostico: "Pronóstico", total: "Total", alternativa: "Alternativa", notas: "Notas", por: "por",
  fase: (f) => ({ urgencia: "Urgencia", sistemica: "Fase sistémica", higienica: "Fase I · Higiénica", correctiva: "Fase II · Correctiva", restauradora: "Fase III · Restauradora", mantenimiento: "Fase IV · Mantenimiento" }[f]),
  pronosticoValor: (p) => ({ bueno: "Bueno", reservado: "Reservado", malo: "Malo" }[p]),
  dinero: (n) => formatCurrency(n),
};

let seq = 0;
const renglon = (r: Partial<Renglon>): Renglon => ({
  id: `r${++seq}`, fase: "higienica", procedimiento: "", procedimientoId: null, dientes: "", caras: [], motivo: "",
  cantidad: "", precio: "", precioDelTarifario: false, minutos: 0, ...r,
});

const plan = (renglones: Renglon[], extra: Partial<PlanClinico> = {}): PlanClinico => ({ ...PLAN_VACIO, renglones, ...extra });

const TARIFARIO = [
  { id: "p-resina", name: "Resina", basePrice: 500 },
  { id: "p-endo", name: "Endodoncia", basePrice: 3500.5 },
  { id: "p-limpieza", name: "Limpieza dental", basePrice: 800 },
];

test("leerDinero: pesos con miles, con centavos y sin símbolo", () => {
  assert.equal(leerDinero("$1,250"), 1250);
  assert.equal(leerDinero("$1,250.50"), 1250.5);
  assert.equal(leerDinero("800"), 800);
  assert.equal(leerDinero("sin precio"), null);
});

test("ida y vuelta: el texto que escribe la ventana del plan se lee de vuelta renglón por renglón", () => {
  const texto = componerDescripcion(
    plan(
      [
        renglon({ fase: "higienica", procedimiento: "Resina", dientes: "16, 26", caras: ["M", "O"], cantidad: "2", precio: "500", motivo: "Caries" }),
        renglon({ fase: "higienica", procedimiento: "Limpieza dental", precio: "800" }),
        renglon({ fase: "restauradora", procedimiento: "Corona de zirconio", dientes: "36", precio: "9000" }),
      ],
      { diagnostico: "Caries múltiple", pronostico: "bueno", alternativa: "Resinas en lugar de coronas", notas: "Paciente nervioso" },
    ),
    rot,
  );
  const leidos = leerRenglonesDelPlan(texto);
  assert.equal(leidos.length, 3);
  const fase1 = "Fase I · Higiénica";
  const fase3 = "Fase III · Restauradora";
  assert.deepEqual(leidos[0], { nombre: "Resina", dientes: "16,26", cantidad: 2, precio: 500, fase: 1, faseNombre: fase1, caras: "MO", motivo: "Caries" });
  assert.deepEqual(leidos[1], { nombre: "Limpieza dental", dientes: "", cantidad: 1, precio: 800, fase: 1, faseNombre: fase1, caras: "", motivo: "" });
  assert.deepEqual(leidos[2], { nombre: "Corona de zirconio", dientes: "36", cantidad: 1, precio: 9000, fase: 2, faseNombre: fase3, caras: "", motivo: "" });
});

test("el diagnóstico, el pronóstico, la alternativa y las notas NO se vuelven conceptos", () => {
  const texto = componerDescripcion(
    plan([renglon({ procedimiento: "Resina", precio: "500" })], { diagnostico: "Caries", pronostico: "malo", alternativa: "Esperar", notas: "Paciente nervioso" }),
    rot,
  );
  const nombres = leerRenglonesDelPlan(texto).map((r) => r.nombre);
  assert.ok(nombres.includes("Resina"));
  assert.deepEqual(nombres, ["Resina"]);
});

test("ws1-t12: unas notas o una alternativa con viñetas «• …» NO se vuelven conceptos (ni salen en el PDF del plan)", () => {
  const texto = componerDescripcion(
    plan([renglon({ procedimiento: "Resina", precio: "500" })], {
      diagnostico: "Caries\n• en 16",
      alternativa: "Esperar\n• o extraer",
      notas: "Interno:\n• no cobrarle la radiografía\n\n• debe $300 de la vez pasada",
    }),
    rot,
  );
  assert.deepEqual(leerRenglonesDelPlan(texto).map((r) => r.nombre), ["Resina"]);
  // Sin total (todo en $0) las notas siguen a la última fase: también se cortan.
  const sinPrecio = componerDescripcion(
    plan([renglon({ procedimiento: "Resina" })], { notas: "• cobrarle aparte\n\n▸ Fase falsa\n• Corona" }),
    rot,
  );
  assert.deepEqual(leerRenglonesDelPlan(sinPrecio).map((r) => r.nombre), ["Resina"]);
});

test("ws1-t12: el motivo se lee igual con «por:» (lo que escribe la ventana) que con «por»", () => {
  const conDosPuntos = componerDescripcion(
    plan([renglon({ procedimiento: "Resina", dientes: "11", caras: ["O"], precio: "500", motivo: "Caries" })]),
    { ...rot, por: "por:" },
  );
  const [r] = leerRenglonesDelPlan(conDosPuntos);
  assert.equal(r.motivo, "Caries");
  assert.equal(r.caras, "I", "en un anterior la cara del centro es la incisal");
});

test("una descripción de las de antes (una frase) o vacía no trae renglones", () => {
  assert.deepEqual(leerRenglonesDelPlan("Ortodoncia de 18 meses"), []);
  assert.deepEqual(leerRenglonesDelPlan(null), []);
  assert.deepEqual(leerRenglonesDelPlan(""), []);
});

test("armado: el procedimiento del tarifario se enlaza por nombre (sin mayúsculas ni acentos) y su precio exacto gana al redondeo del texto", () => {
  const texto = componerDescripcion(
    plan([
      renglon({ procedimiento: "endodoncia", dientes: "46", precio: "3500.5" }), // el texto dice «$3,501» (formatCurrency redondea)
      renglon({ procedimiento: "Resina", dientes: "11", precio: "450" }), // precio pisado a mano: manda el del plan
    ]),
    rot,
  );
  const r = armarPresupuestoDePlan({ name: "Plan", description: texto, totalCost: 0 }, TARIFARIO);
  assert.equal(r.conceptos[0].procedureId, "p-endo");
  assert.equal(r.conceptos[0].unitPrice, 3500.5);
  assert.equal(r.conceptos[0].origen, "tarifario");
  assert.equal(r.conceptos[1].procedureId, "p-resina");
  assert.equal(r.conceptos[1].unitPrice, 450);
  assert.equal(r.conceptos[1].origen, "plan");
  assert.equal(r.total, 3950.5);
  assert.equal(r.sinTarifario, 0);
});

test("armado: en un plan CON costo y sin precios por renglón, un renglón toma el del tarifario; sin tarifario queda en 0 y se avisa", () => {
  // Con costo $0 (plan confirmado en $0) ya no se costea con el tarifario: ver «t8 v3 N3-P4».
  const texto = componerDescripcion(
    plan([renglon({ procedimiento: "Limpieza dental" }), renglon({ procedimiento: "Procedimiento raro" })]),
    rot,
  );
  const r = armarPresupuestoDePlan({ name: "Plan", description: texto, totalCost: 800 }, TARIFARIO);
  assert.equal(r.conceptos[0].unitPrice, 800);
  assert.equal(r.conceptos[1].unitPrice, 0);
  assert.equal(r.conceptos[1].origen, "sinPrecio");
  assert.equal(r.sinPrecio, 1);
  assert.equal(r.sinTarifario, 1);
});

test("armado: sin procedimientos detallados sale UN concepto con el nombre y el costo del plan", () => {
  const r = armarPresupuestoDePlan({ name: "Rehabilitación", description: "Una frase", totalCost: 12000 }, TARIFARIO);
  assert.equal(r.sinDetalle, true);
  assert.equal(r.conceptos.length, 1);
  assert.equal(r.conceptos[0].name, "Rehabilitación");
  assert.equal(r.conceptos[0].unitPrice, 12000);
  assert.equal(r.total, 12000);
});

test("armado: avisa cuando el costo escrito del plan no coincide con la suma de los renglones", () => {
  const texto = componerDescripcion(plan([renglon({ procedimiento: "Resina", precio: "500" })]), rot);
  assert.equal(armarPresupuestoDePlan({ name: "P", description: texto, totalCost: 500 }, TARIFARIO).totalDifiere, false);
  assert.equal(armarPresupuestoDePlan({ name: "P", description: texto, totalCost: 9999 }, TARIFARIO).totalDifiere, true);
});

test("armado: la fase es el orden de los bloques y los dientes salen en CSV de dos dígitos", () => {
  const texto = componerDescripcion(
    plan([
      renglon({ fase: "restauradora", procedimiento: "Corona", dientes: "36, 37", precio: "100" }),
      renglon({ fase: "urgencia", procedimiento: "Drenaje", dientes: "11", precio: "100" }),
    ]),
    rot,
  );
  const r = armarPresupuestoDePlan({ name: "P", description: texto, totalCost: 0 }, []);
  // La ventana escribe por orden de fase clínica: urgencia primero.
  assert.deepEqual(r.conceptos.map((c) => [c.name, c.phase, c.toothFdi]), [["Drenaje", 1, "11"], ["Corona", 2, "36,37"]]);
});

// ── Revisión t8 de ws1-t12 ───────────────────────────────────────────────────

test("t8 N-P2: en un texto exacto (plan nuevo) manda el precio del plan: $449.60 no lo pisa un tarifario de $450, ni $450 uno de $449.60", () => {
  const TAR = [{ id: "r", name: "Resina", basePrice: 450 }];
  const conCentavos = componerDescripcion(plan([renglon({ procedimiento: "Resina", precio: "449.60" })]), { ...rot, dinero: (n) => dineroExacto(n) });
  assert.equal(armarPresupuestoDePlan({ name: "P", description: conCentavos, totalCost: 449.6 }, TAR, { textoRedondeado: false }).conceptos[0].unitPrice, 449.6);
  // Aunque se diga «redondeado», un precio CON centavos ya es exacto: el tarifario no lo toca.
  assert.equal(armarPresupuestoDePlan({ name: "P", description: conCentavos, totalCost: 449.6 }, TAR).conceptos[0].unitPrice, 449.6);
  const entero = componerDescripcion(plan([renglon({ procedimiento: "Resina", precio: "450" })]), rot);
  const TAR2 = [{ id: "r", name: "Resina", basePrice: 449.6 }];
  assert.equal(armarPresupuestoDePlan({ name: "P", description: entero, totalCost: 450 }, TAR2, { textoRedondeado: false }).conceptos[0].unitPrice, 450);
  // En un plan viejo (texto redondeado) el exacto del tarifario sí corrige el «$450» que era $449.60.
  assert.equal(armarPresupuestoDePlan({ name: "P", description: entero, totalCost: 449.6 }, TAR2, { textoRedondeado: true }).conceptos[0].unitPrice, 449.6);
});

test("t8 (P3 en «Convertir»): con algún renglón con precio, uno sin precio es cortesía y pasa en $0 (como avisa la ventana), aunque esté en el tarifario", () => {
  const texto = componerDescripcion(plan([renglon({ procedimiento: "Limpieza dental" }), renglon({ procedimiento: "Resina", precio: "500" })]), rot);
  const r = armarPresupuestoDePlan({ name: "P", description: texto, totalCost: 500 }, TARIFARIO);
  assert.equal(r.conceptos[0].name, "Limpieza dental");
  assert.equal(r.conceptos[0].unitPrice, 0, "el tarifario dice $800, pero el plan la dio de cortesía");
  assert.equal(r.total, 500);
});

test("t8 N-P4: una cantidad con decimales de un plan viejo pasa como 1 al importe exacto, y la nota dice cuánto era", () => {
  const texto = componerDescripcion(plan([renglon({ procedimiento: "Blanqueamiento", cantidad: "1.5", precio: "800", motivo: "Manchas" })]), rot);
  const [leido] = leerRenglonesDelPlan(texto);
  assert.equal(leido.cantidad, 1.5, "el lector ya no redondea la cantidad");
  const c = armarPresupuestoDePlan({ name: "P", description: texto, totalCost: 1200 }, TARIFARIO).conceptos[0];
  assert.equal(c.quantity, 1);
  assert.equal(c.unitPrice, 1200);
  assert.equal(c.notes, "1.5 × $800 · Manchas");
});

test("t8: leerTotalDelPlan lee el «Total de procedimientos» que escribió la ventana (es y en), no el costo", () => {
  const conTotal = componerDescripcion(plan([renglon({ procedimiento: "Resina", cantidad: "2", precio: "500" })]), { ...rot, total: "Total de procedimientos" });
  assert.equal(leerTotalDelPlan(conTotal), 1000);
  assert.equal(leerTotalDelPlan("▸ Phase I · Hygienic — $800\n• Filling · 1 × $800 = $800\n\n▸ Procedures total: $800"), 800);
  assert.equal(leerTotalDelPlan("Una frase"), null);
});

test("t8 (P4): los nombres de fase y de total con que se escribieron los planes están fijos; si el diccionario los cambia, esta prueba lo avisa", async () => {
  const { FASES_ESCRITAS, TOTALES_ESCRITOS, esEncabezadoDeFase } = await import("../desde-plan");
  const es = (await import("@/i18n/dictionaries/es.json")).default as any;
  const en = (await import("@/i18n/dictionaries/en.json")).default as any;
  const delDiccionario = [...Object.values(es.planTratamiento.fase), ...Object.values(en.planTratamiento.fase)] as string[];
  for (const f of delDiccionario) assert.ok((FASES_ESCRITAS as readonly string[]).includes(f), `«${f}» cambió en el diccionario: agrega el nombre nuevo a FASES_ESCRITAS SIN quitar el viejo`);
  for (const f of FASES_ESCRITAS) assert.ok(esEncabezadoDeFase(`▸ ${f} — $500`), f);
  assert.deepEqual([...TOTALES_ESCRITOS].sort(), [es.planTratamiento.texto.total, en.planTratamiento.texto.total].sort());
});
