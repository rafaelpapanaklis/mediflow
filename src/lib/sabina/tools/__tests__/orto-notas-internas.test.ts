/**
 * Sabina LEE las notas internas del caso de ortodoncia — `orto_notas_internas` (Salamanca). SOLO-EQUIPO.
 *
 *   npx tsx --test --experimental-test-module-mocks src/lib/sabina/tools/__tests__/orto-notas-internas.test.ts
 *
 * Qué se prueba:
 *  1. Repite lo anotado (quién, cuándo, texto) y cuenta las correcciones sin repetir el texto anterior.
 *  2. 🔴 Permisos: sin `patients.view` no recibe nada y se le DICE; el runner corta sin la key del módulo.
 *  3. 🔴 Clínica: cada consulta lleva el clinicId de la sesión; nada del SUR sale en el norte.
 *  4. Sin las tablas (falta el SQL) lo dice y no revienta.
 *  5. 🔴 Solo lectura: contra una base que revienta ante cualquier escritura, contesta; lo único que escribe es la
 *     bitácora de lectura (la misma del expediente).
 *  6. Está en el catálogo del motor, y es de consulta (no una acción).
 */

import { pantalla } from "./preparar-orto"; // PRIMERO
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCIONES_SABINA, SABINA_TOOLS } from "../../engine-catalog";
import type { SabinaCtx } from "../../tipos";
import { correrHerramienta } from "../base";
import { TOPE_NOTA, ortoNotasInternas, type DatosOrtoNotasInternas } from "../orto-notas-internas";
import type { BaseDoble } from "./doble-base";
import { baseOrto, sesion } from "./orto-siembra";
import { CL_SUR, TZ_SUR, U_ADMIN_S, U_RECEP_N } from "./siembra";

const OPS_DE_LECTURA = new Set(["findMany", "findFirst", "findUnique", "count", "aggregate", "groupBy"]);
const LARGA = "Pidió que no le llamen por teléfono, solo WhatsApp. ".repeat(20);

interface FilaNota {
  id: string;
  clinicId: string;
  patientId: string;
  caseId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

function montar(opciones: { tablas?: boolean; casoAnterior?: boolean; moduloVencido?: boolean } = {}) {
  const b = baseOrto();
  if (opciones.casoAnterior) {
    // ws1-t8 · P10: un caso anterior del mismo paciente (el más reciente sigue siendo plan-ana).
    const planes = b.datos.orthodonticTreatmentPlans ?? [];
    const ana = planes.find((p: any) => p.id === "plan-ana") as any;
    ana.createdAt = new Date("2026-01-01T00:00:00Z");
    planes.push({ ...ana, id: "plan-ana-viejo", status: "COMPLETED", createdAt: new Date("2024-01-01T00:00:00Z") });
  }
  if (opciones.moduloVencido) {
    // ws1-t8 · P11: el módulo venció; la ficha conserva la lectura de lo ya escrito.
    for (const cm of (b.datos.clinicModules ?? []) as any[]) if (cm.id === "cm-n") cm.currentPeriodEnd = new Date("2026-01-01T00:00:00Z");
  }
  const escrituras: string[] = [];
  const auditorias: Array<Record<string, any>> = [];
  const consultasSobreNotas: Array<{ texto: string; valores: unknown[] }> = [];
  const t = (iso: string) => new Date(iso);

  const notas: FilaNota[] = [
    { id: "n1", clinicId: "cl-norte", patientId: "p-ana", caseId: "plan-ana", authorId: "u-recep-n", body: "Pidió que la llamen solo por WhatsApp.", createdAt: t("2026-09-01T16:00:00Z"), updatedAt: t("2026-09-01T16:00:00Z") },
    { id: "n2", clinicId: "cl-norte", patientId: "p-ana", caseId: "plan-ana", authorId: "u-doc-n", body: LARGA, createdAt: t("2026-09-10T17:30:00Z"), updatedAt: t("2026-09-12T18:00:00Z") },
    ...(opciones.casoAnterior
      ? [{ id: "n-viejo", clinicId: "cl-norte", patientId: "p-ana", caseId: "plan-ana-viejo", authorId: "u-recep-n", body: "No llamarle después de las 6.", createdAt: t("2025-03-01T16:00:00Z"), updatedAt: t("2025-03-01T16:00:00Z") }]
      : []),
    { id: "n-sur", clinicId: CL_SUR, patientId: "p-sur-1", caseId: "plan-sur", authorId: U_ADMIN_S, body: "NO DEBE SALIR EN EL NORTE", createdAt: t("2026-09-02T10:00:00Z"), updatedAt: t("2026-09-02T10:00:00Z") },
    // Una nota de OTRA clínica pegada, por error de datos, al mismo caso: el clinicId la deja fuera.
    { id: "n-intruso", clinicId: CL_SUR, patientId: "p-ana", caseId: "plan-ana", authorId: U_ADMIN_S, body: "INTRUSO DEL SUR EN EL CASO DEL NORTE", createdAt: t("2026-09-03T10:00:00Z"), updatedAt: t("2026-09-03T10:00:00Z") },
  ];
  const revisiones = [
    { id: "r1", clinicId: "cl-norte", noteId: "n2", previousBody: "TEXTO VIEJO QUE NO SE REPITE", previousFrom: t("2026-09-10T17:30:00Z"), editedById: "u-doc-n", editedAt: t("2026-09-12T18:00:00Z") },
  ];

  const trampa = new Proxy(b.db as any, {
    get(objetivo, clave) {
      const valor = objetivo[clave];
      if (clave === "contador" || typeof clave !== "string") return valor;
      if (clave === "auditLog") return { create: async (a: { data: Record<string, any> }) => { auditorias.push(a.data); return {}; } };
      if (valor === undefined) return valor;
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
    if (/to_regclass\('public\.ortho_internal_notes'\)/.test(texto)) {
      return [{ existe: opciones.tablas !== false }];
    }
    if (/FROM "ortho_internal_notes"/.test(texto)) {
      consultasSobreNotas.push({ texto, valores });
      const [clinicId, caseId] = valores as [string, string];
      // Exactamente lo que haría el WHERE de la consulta real.
      return notas
        .filter((n) => n.clinicId === clinicId && n.caseId === caseId)
        .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
    }
    if (/FROM "ortho_internal_note_revisions"/.test(texto)) {
      consultasSobreNotas.push({ texto, valores });
      const [clinicId, ids] = valores as [string, string[]];
      return revisiones.filter((r) => r.clinicId === clinicId && ids.includes(r.noteId));
    }
    return delMotor(texto, valores);
  };
  return { db: trampa, escrituras, auditorias, consultasSobreNotas };
}

const admin = (db: BaseDoble, over: Partial<SabinaCtx> = {}) => sesion(db, over);
const recepcion = (db: BaseDoble) => sesion(db, { userId: U_RECEP_N, role: "RECEPTIONIST" });

async function pregunta(ctx: SabinaCtx, params: unknown) {
  const r = await correrHerramienta(ortoNotasInternas, ctx, params);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r as any;
}

test("repite las notas internas: quién, cuándo, texto; cuenta la corrección sin repetir el texto viejo", async () => {
  const { db } = montar();
  const r = await pregunta(admin(db), { patientId: "p-ana" });
  const d = r.datos as DatosOrtoNotasInternas;
  assert.equal(d.hayCaso, true);
  assert.equal(d.disponible, true);
  assert.equal(d.total, 2);
  assert.equal(d.notas.length, 2);
  // De la más reciente a la más antigua.
  assert.match(d.notas[0].texto, /Pidió que no le llamen/);
  assert.equal(d.notas[1].texto, "Pidió que la llamen solo por WhatsApp.");
  assert.ok(d.notas[0].corregidaEl, "la nota con una revisión sale como corregida");
  assert.equal(d.notas[1].corregidaEl, null);
  assert.match(r.resumen, /Pidió que la llamen solo por WhatsApp/);
  assert.match(r.resumen, /corregida el/);
  assert.doesNotMatch(JSON.stringify(r), /TEXTO VIEJO QUE NO SE REPITE/, "el texto anterior se lee en la ficha, no aquí");
  assert.match(r.resumen, /NUNCA las incluyas en un mensaje al paciente/);
  assert.match(r.resumen, /\?tab=ortodoncia/, "el enlace a la ficha va siempre");
});

test("resume el texto largo y lo dice", async () => {
  const { db } = montar();
  const r = await pregunta(admin(db), { patientId: "p-ana" });
  const larga = (r.datos as DatosOrtoNotasInternas).notas.find((n) => n.recortado)!;
  assert.ok(larga.texto.length <= TOPE_NOTA + 1);
  assert.match(r.resumen, /resumidos/);
});

test("🔴 sin patients.view no recibe ni una nota y se le dice", async () => {
  const { db } = montar();
  // Recepción tiene patients.view por defecto: se le quita a mano para medir el candado de adentro.
  const ctx = sesion(db, { userId: U_RECEP_N, role: "RECEPTIONIST", permissionsOverride: ["specialties.orthodontics"] });
  const r = await pregunta(ctx, { patientId: "p-ana" });
  const d = r.datos as DatosOrtoNotasInternas;
  assert.equal(d.notas.length, 0);
  assert.ok(d.omitidas.some((o) => o.permiso === "patients.view"));
  assert.doesNotMatch(r.resumen, /WhatsApp\./);
  assert.match(r.resumen, /patients\.view/);
});

test("el equipo de recepción SÍ las lee (las ve todo el equipo con acceso a pacientes)", async () => {
  const { db } = montar();
  const r = await pregunta(recepcion(db), { patientId: "p-ana" });
  assert.equal((r.datos as DatosOrtoNotasInternas).notas.length, 2);
});

test("🔴 sin la key del módulo, el runner corta antes de consultar", async () => {
  const { db, consultasSobreNotas } = montar();
  const ctx = sesion(db, { permissionsOverride: ["patients.view"] });
  const r = await correrHerramienta(ortoNotasInternas, ctx, { patientId: "p-ana" });
  assert.equal(r.ok, false);
  assert.equal((r as any).motivo, "sin_permiso");
  assert.equal((r as any).permiso, "specialties.orthodontics");
  assert.deepEqual(consultasSobreNotas, []);
});

test("🔴 clínica: cada consulta lleva el clinicId de la sesión y nada del SUR sale en el norte", async () => {
  const { db, consultasSobreNotas } = montar();
  const r = await pregunta(admin(db), { patientId: "p-ana" });
  assert.doesNotMatch(JSON.stringify(r), /INTRUSO DEL SUR|NO DEBE SALIR/);
  assert.ok(consultasSobreNotas.length >= 2);
  for (const c of consultasSobreNotas) assert.equal(c.valores[0], "cl-norte", c.texto);

  const delSur = await pregunta(admin(db), { patientId: "p-sur-1" });
  assert.doesNotMatch(JSON.stringify(delSur), /NO DEBE SALIR/);
  const sur = await pregunta(sesion(db, { clinicId: CL_SUR, userId: U_ADMIN_S, timezone: TZ_SUR }), { patientId: "p-ana" });
  assert.doesNotMatch(JSON.stringify(sur), /Pidió que la llamen/);
});

test("sin las tablas (falta pegar el SQL) lo dice y no revienta", async () => {
  const { db, consultasSobreNotas } = montar({ tablas: false });
  // La memoria de «las tablas existen» es del proceso: se olvida para medir este caso.
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("dalecontrol.orto.notasInternas.tablas")];
  const r = await pregunta(admin(db), { patientId: "p-ana" });
  const d = r.datos as DatosOrtoNotasInternas;
  assert.equal(d.disponible, false);
  assert.equal(d.notas.length, 0);
  assert.match(r.resumen, /todavía no están activas/);
  assert.deepEqual(consultasSobreNotas, []);
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("dalecontrol.orto.notasInternas.tablas")];
});

test("🔴 solo lectura: contesta con una base que revienta ante cualquier escritura; solo se anota la bitácora de lectura", async () => {
  const { db, escrituras, auditorias } = montar();
  await pregunta(admin(db), { patientId: "p-ana" });
  assert.deepEqual(escrituras, []);
  assert.equal(auditorias.length, 1, "quedó UNA fila de bitácora por la lectura");
  assert.equal(auditorias[0].action, "view");
  assert.equal(auditorias[0].clinicId, "cl-norte");
  assert.equal(auditorias[0].entityId, "p-ana");
  assert.equal(auditorias[0].changes._read.after.kind, "orto_notas_internas");
  assert.doesNotMatch(JSON.stringify(auditorias[0]), /WhatsApp|Pidió/, "la bitácora no lleva el contenido de las notas");
});

test("está en el catálogo del motor y es de consulta, no una acción", () => {
  const nombres = SABINA_TOOLS.map((t) => t.nombre);
  assert.ok(nombres.includes("orto_notas_internas"));
  assert.ok(!ACCIONES_SABINA.some((a) => a.nombre === "orto_notas_internas"));
  assert.equal(new Set(nombres).size, nombres.length);
});

test("P10: lee las notas de TODOS los casos del paciente, no solo las del último", async () => {
  const { db, consultasSobreNotas } = montar({ casoAnterior: true });
  const r = await pregunta(admin(db), { patientId: "p-ana" });
  const d = r.datos as DatosOrtoNotasInternas;
  assert.equal(d.total, 3);
  assert.match(r.resumen, /No llamarle después de las 6/);
  assert.equal(d.notas[d.notas.length - 1].texto, "No llamarle después de las 6.", "la más antigua va al final");
  for (const c of consultasSobreNotas) assert.equal(c.valores[0], "cl-norte", c.texto);
});

test("P11: con el módulo vencido sigue leyendo lo ya escrito, igual que la ficha", async () => {
  const { db } = montar({ moduloVencido: true });
  const r = await pregunta(admin(db), { patientId: "p-ana" });
  const d = r.datos as DatosOrtoNotasInternas;
  assert.equal(d.notas.length, 2);
  assert.doesNotMatch(r.resumen, /no tiene contratado/);
});
