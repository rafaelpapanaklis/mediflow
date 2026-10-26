/**
 * Sabina y la nota del plan (decisión de Rafael, 26-oct-2026): «¿quién me debe?» y «dinero que se
 * escapa» cuentan de una nota de plan solo lo HECHO menos lo pagado. Un plan recién aceptado no hace
 * deudor a nadie; lo aceptado y sin hacer sigue contando como trabajo sin agendar.
 *
 * Run: npm run test:plan-por-cobrar
 */
import "./preparar";
import { test } from "node:test";
import assert from "node:assert/strict";

import { ejecutarHerramienta } from "../index";
import { CL_NORTE, adminNorte, datosDePrueba } from "./siembra";
import { crearBase } from "./doble-base";

/** La base de siempre + la nota de un plan de $18,000 de Ana, recién aceptado (nada hecho). */
function conNotaDePlan(hechas: string[] = []) {
  const datos = datosDePrueba();
  const ayer = new Date(Date.now() - 86_400_000);
  datos.invoices!.push({
    id: "inv-plan", clinicId: CL_NORTE, patientId: "p-ana", status: "PENDING",
    total: 18000, paid: 0, balance: 18000, discount: 0, dueDate: null, createdAt: ayer, taxRate: 0, taxIncluded: true,
    items: [
      { description: "Resina", quantity: 1, unitPrice: 3000, planItemId: "r" },
      { description: "Endodoncia", quantity: 1, unitPrice: 7000, planItemId: "e" },
      { description: "Corona", quantity: 1, unitPrice: 8000, planItemId: "c" },
    ],
  });
  const db = crearBase(datos);
  const original = db.$queryRaw.bind(db);
  // Lo único crudo que se añade: ¿está el SQL del plan?, ¿qué facturas son notas de plan? y sus filas.
  (db as any).$queryRaw = async (consulta: any, ...resto: unknown[]) => {
    const texto = Array.isArray(consulta?.strings) ? consulta.strings.join(" ? ") : Array.isArray(consulta) ? consulta.join(" ? ") : "";
    const valores: unknown[] = Array.isArray(consulta?.values) ? consulta.values : resto;
    if (/information_schema\.columns/.test(texto) && /treatmentPlanId/.test(texto)) return [{ existe: true }];
    if (/to_regclass\('public\.treatment_plan_items'\)/.test(texto)) return [{ existe: true }];
    if (/to_regclass\('public\.invoice_payment_terms'\)/.test(texto)) return [{ existe: false }];
    if (/"treatmentPlanId" IS NOT NULL/.test(texto)) {
      // `Prisma.join(ids)` llega como un fragmento con sus propios valores.
      if (valores[0] !== CL_NORTE || !JSON.stringify(valores).includes('"inv-plan"')) return [];
      const n = datos.invoices!.find((i) => i.id === "inv-plan")!;
      return [{ ...n, treatmentPlanId: "plan-ana" }];
    }
    if (/FROM "treatment_plan_items"/.test(texto)) {
      return ["r", "e", "c"].map((id, i) => ({
        id, planId: "plan-ana", estado: hechas.includes(id) ? "hecho" : "pendiente",
        hechoEn: hechas.includes(id) ? ayer : null, nombre: id, invoiceId: "inv-plan", invoiceLinea: i,
      }));
    }
    return original(consulta, ...resto);
  };
  return db;
}

test("«¿quién me debe?»: el plan de $18,000 recién aceptado no hace deudora a Ana", async () => {
  const r = await ejecutarHerramienta("pacientes_con_deuda", adminNorte(conNotaDePlan()), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // Las mismas cifras que sin la nota (dinero.test.ts): 3 deudores, $11,277.
  assert.equal(r.datos.deudores.total, 3);
  assert.equal(r.datos.totalAdeudado, 11277);
  assert.equal(JSON.stringify(r.datos.deudores.filas).indexOf("Ana"), -1);
});

test("«¿quién me debe?»: hecha la resina, Ana debe $3,000 (no $18,000)", async () => {
  const r = await ejecutarHerramienta("pacientes_con_deuda", adminNorte(conNotaDePlan(["r"])), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.deudores.total, 4);
  assert.equal(r.datos.totalAdeudado, 11277 + 3000);
  const ana = r.datos.deudores.filas.find((f: any) => /Ana/.test(f.paciente));
  assert.equal(ana?.saldo, 3000);
});
