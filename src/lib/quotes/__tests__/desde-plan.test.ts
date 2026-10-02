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
import { armarPresupuestoDePlan, leerDinero, leerRenglonesDelPlan } from "../desde-plan";
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
  assert.deepEqual(leidos[0], { nombre: "Resina", dientes: "16,26", cantidad: 2, precio: 500, fase: 1, motivo: "Caries" });
  assert.deepEqual(leidos[1], { nombre: "Limpieza dental", dientes: "", cantidad: 1, precio: 800, fase: 1, motivo: "" });
  assert.deepEqual(leidos[2], { nombre: "Corona de zirconio", dientes: "36", cantidad: 1, precio: 9000, fase: 2, motivo: "" });
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

test("armado: un renglón sin precio toma el del tarifario; sin tarifario queda en 0 y se avisa", () => {
  const texto = componerDescripcion(
    plan([renglon({ procedimiento: "Limpieza dental" }), renglon({ procedimiento: "Procedimiento raro" })]),
    rot,
  );
  const r = armarPresupuestoDePlan({ name: "Plan", description: texto, totalCost: 0 }, TARIFARIO);
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
