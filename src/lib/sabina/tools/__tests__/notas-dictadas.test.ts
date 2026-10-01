/**
 * Sabina LEE el texto libre que el doctor teclea o dicta — `orto_notas` y `notas_de_consulta` (ws1-t9).
 *
 *   npx tsx --test --experimental-test-module-mocks src/lib/sabina/tools/__tests__/notas-dictadas.test.ts
 *
 * Qué se prueba:
 *  1. Que repite el texto de cada campo: notas/objetivos del plan, hojas de control (S/O/A/P, activaciones,
 *     indicaciones), motivo de reevaluación y notas de consulta.
 *  2. 🔴 Permisos: recepción (sin medicalRecord.view) no recibe nada y se le DICE. El recorte del Super Admin a
 *     Sabina lo prueba candados-integrados sobre todo el catálogo.
 *  3. 🔴 Clínica: nada del SUR sale en el NORTE, y cada consulta lleva el clinicId de la sesión.
 *  4. 🔴 Privacidad: la nota privada de un doctor solo la lee su autor, ni el admin.
 *  5. Resumido: un texto largo se recorta y se dice.
 *  6. 🔴 Solo lectura: contra una base que revienta ante cualquier escritura, contestan.
 */

import { pantalla } from "./preparar-orto"; // PRIMERO
import { test } from "node:test";
import assert from "node:assert/strict";
import { SABINA_TOOLS } from "../../engine-catalog";
import type { SabinaCtx } from "../../tipos";
import { correrHerramienta } from "../base";
import { notasDeConsulta } from "../notas-de-consulta";
import { TOPE_CAMPO, ortoNotas, type DatosOrtoNotas } from "../orto-notas";
import type { BaseDoble } from "./doble-base";
import { baseOrto, sesion } from "./orto-siembra";
import { CL_SUR, TZ_SUR, U_ADMIN_S, U_DOC_N, U_RECEP_N } from "./siembra";

const OPS_DE_LECTURA = new Set(["findMany", "findFirst", "findUnique", "count", "aggregate", "groupBy"]);
const LARGO = "Paciente refiere molestia al masticar. ".repeat(30);

function montar(): { db: BaseDoble; escrituras: string[] } {
  const b = baseOrto();
  const d = b.datos;
  // El plan de Ana: texto libre en cada campo largo.
  const plan = d.orthodonticTreatmentPlans!.find((p) => p.id === "plan-ana")!;
  Object.assign(plan, {
    techniqueNotes: "Slot 022, secuencia NiTi.",
    anchorageNotes: "Anclaje máximo con microtornillo.",
    prescriptionNotes: "Premolares cerámicos.",
    patientGoals: "Quiere cerrar el diastema antes de su boda.",
    retentionPlanText: LARGO,
  });
  // Las del SUR no pueden salir en el norte.
  d.orthodonticTreatmentPlans!.find((p) => p.id === "plan-sur")!.patientGoals = "NO DEBE SALIR EN EL NORTE";
  // La hoja 3 de Ana: lo dictado.
  const hoja = d.orthoTreatmentCards!.find((h) => h.id === "h-ana-3")!;
  Object.assign(hoja, {
    soapS: "Sin dolor.",
    soapP: "Continuar con el arco rectangular.",
    activationsNote: "Cadena elástica de canino a canino.",
    indications: "Elásticos 22 horas, no comer duro.",
  });
  // En el sitio (push): la base ya tomó la lista.
  d.records!.push(
    { id: "rec-n1", clinicId: "cl-norte", patientId: "p-ana", doctorId: U_DOC_N, visitDate: new Date(), isPrivate: false, subjective: "Dolor en el 36 al frío", objective: "Caries profunda", assessment: "Pulpitis reversible", plan: LARGO },
    { id: "rec-n2", clinicId: "cl-norte", patientId: "p-ana", doctorId: U_DOC_N, visitDate: new Date(), isPrivate: true, subjective: "NOTA PRIVADA DEL DOCTOR", objective: null, assessment: null, plan: null },
    { id: "rec-s1", clinicId: CL_SUR, patientId: "p-sur-1", doctorId: U_ADMIN_S, visitDate: new Date(), isPrivate: false, subjective: "NO DEBE SALIR EN EL NORTE" },
  );
  const escrituras: string[] = [];
  const trampa = new Proxy(b.db as any, {
    get(objetivo, clave) {
      const valor = objetivo[clave];
      if (clave === "contador" || typeof clave !== "string" || valor === undefined) return valor;
      if (clave === "$queryRaw") return valor.bind(objetivo);
      if (typeof valor === "function") {
        escrituras.push(clave);
        throw new Error(`escritura prohibida: ${clave}`);
      }
      return new Proxy(valor, {
        get(delegado, op) {
          if (typeof op === "string" && !OPS_DE_LECTURA.has(op)) {
            escrituras.push(`${clave}.${op}`);
            throw new Error(`escritura prohibida: ${clave}.${op}`);
          }
          return delegado[op];
        },
      });
    },
  }) as BaseDoble;
  pantalla.db = trampa;
  pantalla.consultasSql = [];
  const delMotor = b.sql;
  pantalla.sql = (texto, valores) => {
    if (/information_schema/.test(texto)) return [{ existe: true }];
    if (/orthodontic_case_versions/.test(texto)) {
      // Cada consulta debe llevar el clinicId de la sesión.
      const clinicId = String(valores[0] ?? "");
      return clinicId === "cl-norte" && valores[1] === "plan-ana"
        ? [{ id: "v1", numero: 1, iniciadaEl: new Date("2026-01-01"), cerradaEl: new Date("2026-06-01"), motivo: "Control radiográfico a los 12 meses; se cambia el anclaje superior", cerradaPorUserId: null, diagnostico: {}, diagnosticoDetalle: null, plan: {}, planDetalle: null }]
        : [];
    }
    return delMotor(texto, valores);
  };
  return { db: trampa, escrituras };
}

const admin = (db: BaseDoble, over: Partial<SabinaCtx> = {}) => sesion(db, over);
const doctor = (db: BaseDoble) => sesion(db, { userId: U_DOC_N, role: "DOCTOR" });
const recepcion = (db: BaseDoble) => sesion(db, { userId: U_RECEP_N, role: "RECEPTIONIST" });

async function pregunta(tool: any, ctx: SabinaCtx, params: unknown) {
  const r = await correrHerramienta(tool, ctx, params);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r as any;
}

test("orto_notas repite las notas del plan, las hojas de control y el motivo de la reevaluación", async () => {
  const { db } = montar();
  const r = await pregunta(ortoNotas, admin(db), { patientId: "p-ana" });
  const d = r.datos as DatosOrtoNotas;
  assert.equal(d.hayCaso, true);
  const plan = Object.fromEntries(d.plan.map((c) => [c.etiqueta, c.texto]));
  assert.equal(plan["Notas de la técnica"], "Slot 022, secuencia NiTi.");
  assert.equal(plan["Notas del anclaje"], "Anclaje máximo con microtornillo.");
  assert.equal(plan["Objetivos / metas del paciente"], "Quiere cerrar el diastema antes de su boda.");
  const h3 = d.hojas.find((h) => h.numero === 3)!;
  const hoja = Object.fromEntries(h3.campos.map((c) => [c.etiqueta, c.texto]));
  assert.equal(hoja["Indicaciones al paciente"], "Elásticos 22 horas, no comer duro.");
  assert.equal(hoja["Activaciones"], "Cadena elástica de canino a canino.");
  assert.equal(hoja["Subjetivo"], "Sin dolor.");
  assert.equal(d.reevaluaciones.length, 1);
  assert.match(d.reevaluaciones[0].motivo.texto, /anclaje superior/);
  assert.match(r.resumen, /Elásticos 22 horas/);
  assert.match(r.resumen, /Quiere cerrar el diastema/);
  assert.match(r.resumen, /Reevaluación 1/);
  assert.match(r.resumen, /\?tab=ortodoncia/, "el enlace a la ficha va siempre");
});

test("orto_notas resume el texto largo y lo dice", async () => {
  const { db } = montar();
  const r = await pregunta(ortoNotas, admin(db), { patientId: "p-ana" });
  const retencion = (r.datos as DatosOrtoNotas).plan.find((c) => c.etiqueta === "Plan de retención")!;
  assert.equal(retencion.recortado, true);
  assert.ok(retencion.texto.length <= TOPE_CAMPO + 1);
  assert.match(r.resumen, /resumidos/);
});

test("🔴 orto_notas: recepción no recibe ni una nota y se le dice", async () => {
  const { db } = montar();
  const r = await pregunta(ortoNotas, recepcion(db), { patientId: "p-ana" });
  const d = r.datos as DatosOrtoNotas;
  assert.equal(d.plan.length + d.hojas.length + d.reevaluaciones.length, 0);
  assert.ok(d.omitidas.some((o) => o.permiso === "medicalRecord.view"));
  assert.doesNotMatch(r.resumen, /diastema|Elásticos/);
  assert.match(r.resumen, /medicalRecord\.view/);
});

// El recorte del Super Admin a Sabina lo recorre candados-integrados.test.ts sobre TODO el catálogo (incluidas estas dos).

test("🔴 orto_notas: nada de la clínica del SUR sale en el norte", async () => {
  const { db } = montar();
  const r = await pregunta(ortoNotas, admin(db), { patientId: "p-sur-1" });
  assert.doesNotMatch(JSON.stringify(r), /NO DEBE SALIR/);
  const sur = await pregunta(ortoNotas, sesion(db, { clinicId: CL_SUR, userId: U_ADMIN_S, timezone: TZ_SUR }), { patientId: "p-ana" });
  assert.doesNotMatch(JSON.stringify(sur), /diastema|Elásticos/);
});

test("notas_de_consulta repite las notas de la consulta, resumidas si son largas", async () => {
  const { db } = montar();
  const r = await pregunta(notasDeConsulta, admin(db), { patientId: "p-ana" });
  assert.match(r.resumen, /Dolor en el 36 al frío/);
  assert.match(r.resumen, /Pulpitis reversible/);
  assert.match(r.resumen, /resumidos/);
});

test("🔴 notas_de_consulta: la nota privada solo la lee su autor; nada del SUR", async () => {
  const { db } = montar();
  const comoAdmin = await pregunta(notasDeConsulta, admin(db), { patientId: "p-ana" });
  assert.doesNotMatch(JSON.stringify(comoAdmin), /NOTA PRIVADA/);
  assert.doesNotMatch(JSON.stringify(comoAdmin), /NO DEBE SALIR/);
  const comoAutor = await pregunta(notasDeConsulta, doctor(db), { patientId: "p-ana" });
  assert.match(comoAutor.resumen, /NOTA PRIVADA DEL DOCTOR/);
  const sur = await pregunta(notasDeConsulta, admin(db), { patientId: "p-sur-1" });
  assert.doesNotMatch(JSON.stringify(sur), /NO DEBE SALIR/);
});

test("🔴 notas_de_consulta: recepción no tiene medicalRecord.view → el runner la corta", async () => {
  const { db } = montar();
  const r = await correrHerramienta(notasDeConsulta, recepcion(db), { patientId: "p-ana" });
  assert.equal(r.ok, false);
  assert.equal((r as any).motivo, "sin_permiso");
  assert.equal((r as any).permiso, "medicalRecord.view");
});

test("🔴 solo lectura: ninguna escribe, y están en el catálogo del motor", async () => {
  const { db, escrituras } = montar();
  await pregunta(ortoNotas, admin(db), { patientId: "p-ana" });
  await pregunta(notasDeConsulta, admin(db), { patientId: "p-ana" });
  assert.deepEqual(escrituras, []);
  const nombres = SABINA_TOOLS.map((t) => t.nombre);
  assert.ok(nombres.includes("orto_notas") && nombres.includes("notas_de_consulta"));
});
