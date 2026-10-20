/**
 * LOS CENTAVOS EN PANTALLA, IGUAL QUE EN EL PDF DEL PLAN (ws1-t12, revisión t8 N4-PDF2 y N4-PDF1).
 *
 * Run: npm run test:plan-tratamiento-pdf
 *
 * `formatCurrency` redondea a pesos: la vista previa de «Convertir» y el «Costo total» del plan
 * decían «$1,502» para 3 × $500.50, mientras el borrador guarda $1,501.50 y el PDF imprime
 * «$1,501.50». Aquí se PINTAN de verdad (React, `renderToStaticMarkup`) la vista previa —con el
 * armado real del presupuesto— y la ventana «Plan de tratamiento», y se busca el monto en el HTML.
 */
import Module from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { componerDescripcion, importeRenglon, PLAN_VACIO, type Renglon, type Rotulos } from "@/components/dashboard/plan-tratamiento-rediseno/plan-clinico";
import { armarPresupuestoDePlan } from "@/lib/quotes/desde-plan";
import { dineroExacto } from "@/lib/treatments/dinero-exacto";
import { TEXTOS_CONVERTIR_PRESUPUESTO } from "../textos-convertir-presupuesto";

const SRC = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const dict = JSON.parse(leer("i18n/dictionaries/es.json")) as Record<string, unknown>;
function t(clave: string, vars?: Record<string, unknown>): string {
  let nodo: unknown = dict;
  for (const parte of clave.split(".")) nodo = (nodo as Record<string, unknown> | undefined)?.[parte];
  if (typeof nodo !== "string") return clave;
  return nodo.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ""));
}

// `.module.css` no carga en node: cada clase se llama como su llave. Y el i18n, sin proveedor.
const M = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const cargarOriginal = M._load;
const clasesTalCual = new Proxy({}, { get: (_, k) => String(k) });
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request.endsWith(".module.css")) return { __esModule: true, default: clasesTalCual };
  if (request.endsWith("i18n/i18n-provider")) return { useT: () => t, useLocale: () => "es" };
  if (request.startsWith("next/font/")) return { __esModule: true, default: () => ({ variable: "fuente", className: "fuente" }) };
  if (request === "next/navigation") return { useRouter: () => ({ push() {}, refresh() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() };
  return cargarOriginal.call(this, request, parent, isMain);
};
const { VistaDelPresupuesto } = require("../convertir-en-presupuesto") as typeof import("../convertir-en-presupuesto");
const { VentanaVerPlan } = require("../../plan-tratamiento-rediseno/ventanas-plan") as typeof import("../../plan-tratamiento-rediseno/ventanas-plan");

const rot: Rotulos = {
  diagnostico: "Diagnóstico", pronostico: "Pronóstico", total: "Total de procedimientos", alternativa: "Alternativa", notas: "Notas", por: "por",
  fase: () => "Fase I · Higiénica", pronosticoValor: () => "Bueno", dinero: dineroExacto, exacto: true,
};
let seq = 0;
const reng = (r: Partial<Renglon>): Renglon => ({
  id: `r${++seq}`, fase: "higienica", procedimiento: "", procedimientoId: null, dientes: "", caras: [], motivo: "",
  cantidad: "", precio: "", precioDelTarifario: false, minutos: 0, ...r,
});
// Lo que manda `GET /api/treatments/[id]/presupuesto` a la pantalla: el armado real, con `toothFdi` en null.
const vistaDe = (renglones: Renglon[], totalCost: number) => {
  const armado = armarPresupuestoDePlan({ name: "Plan", description: componerDescripcion({ ...PLAN_VACIO, renglones }, rot), totalCost }, []);
  return { ...armado, conceptos: armado.conceptos.map((c) => ({ ...c, toothFdi: c.toothFdi ?? null })) };
};
const es = TEXTOS_CONVERTIR_PRESUPUESTO.es;
const sinEtiquetas = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("N4-PDF2: la vista previa de «Convertir» enseña 3 × $500.50 = $1,501.50, no $1,502", () => {
  const vista = vistaDe([reng({ procedimiento: "Resina", cantidad: "3", precio: "500.50" })], 1501.5);
  const texto = sinEtiquetas(renderToStaticMarkup(<VistaDelPresupuesto vista={vista} planCosto={1501.5} t={es} />));
  assert.ok(texto.includes("$500.50"), `falta el precio con centavos: ${texto}`);
  assert.equal((texto.match(/\$1,501\.50/g) ?? []).length, 2, "importe y total con centavos");
  assert.ok(!texto.includes("$1,502") && !texto.includes("$501 "), "volvió el redondeo a pesos");
});

test("N4-PDF2: sin centavos no aparece «.00» (igual que el PDF)", () => {
  const vista = vistaDe([reng({ procedimiento: "Corona", cantidad: "1", precio: "9000" })], 9000);
  const texto = sinEtiquetas(renderToStaticMarkup(<VistaDelPresupuesto vista={vista} planCosto={9000} t={es} />));
  assert.ok(texto.includes("$9,000") && !texto.includes("$9,000.00"), texto);
});

test("N4-PDF2: el aviso de «el costo no coincide» también lleva los centavos del costo", () => {
  const vista = vistaDe([reng({ procedimiento: "Resina", cantidad: "1", precio: "800" })], 1200.5);
  const texto = sinEtiquetas(renderToStaticMarkup(<VistaDelPresupuesto vista={vista} planCosto={1200.5} t={es} />));
  assert.ok(texto.includes("El costo escrito en el plan ($1,200.50)"), texto);
});

test("N4-PDF1: la vista previa de un plan en $0 con «Corona $9,000» PINTA el aviso, el primero de la lista", () => {
  const vista = vistaDe([reng({ procedimiento: "Corona", dientes: "16", cantidad: "1", precio: "9000" })], 0);
  const html = renderToStaticMarkup(<VistaDelPresupuesto vista={vista} planCosto={0} t={es} />);
  const avisos = [...html.matchAll(/<li class="aviso">([\s\S]*?)<\/li>/g)].map((m) => sinEtiquetas(m[1]).trim());
  assert.ok(avisos[0]?.startsWith("Este plan está en $0, pero sus conceptos suman $9,000."), JSON.stringify(avisos));
  assert.ok(!avisos.some((a) => a.startsWith("El costo escrito")), "no se suma el aviso de «no coincide»");
});

test("N4-PDF2: el «Costo total» de la ventana «Plan de tratamiento» lleva los centavos", () => {
  const plan = {
    id: "plan1", name: "Rehabilitación", description: null, status: "ACTIVE", totalCost: "1501.5", totalSessions: 3,
    sessionIntervalDays: 30, startDate: "2026-10-01T12:00:00.000Z", doctor: { name: "Ana Poot" }, sessions: [],
  };
  const html = renderToStaticMarkup(<VentanaVerPlan plan={plan} puedeEditar={false} onCerrar={() => {}} onEditar={() => {}} />);
  const costo = html.slice(html.indexOf(t("patients.treatment.totalCost")));
  assert.ok(sinEtiquetas(costo).includes("$1,501.50"), sinEtiquetas(costo).slice(0, 120));
  assert.ok(!html.includes("$1,502"));
});

test("N4-PDF2: la ventana del plan nuevo y la ficha clásica usan el mismo dinero que el PDF", () => {
  // La ventana del plan nuevo arranca vacía (no se puede pintar con renglones sin clics): se ejecuta
  // la cuenta que pinta (`dineroExacto(importeRenglon(r))`) y se comprueba que no queda otro formato.
  assert.equal(dineroExacto(importeRenglon(reng({ procedimiento: "Resina", cantidad: "3", precio: "500.50" }))), "$1,501.50");
  for (const archivo of [
    "components/dashboard/plan-tratamiento-rediseno/ventana-nuevo-plan.tsx",
    "components/dashboard/plan-tratamiento-rediseno/ventanas-plan.tsx",
    "components/dashboard/plan-a-presupuesto/convertir-en-presupuesto.tsx",
    "app/dashboard/patients/[id]/patient-detail-client.tsx",
  ]) {
    assert.ok(!/formatCurrency\(/.test(leer(archivo)), `${archivo} sigue redondeando a pesos con formatCurrency`);
  }
});
