/**
 * Sabina cuenta el histórico de ORTODONCIA — `orto_resumen` (ws1-t9).
 *
 *   npm run test:sabina-orto-resumen
 *
 * Lo que se prueba, y por qué:
 *  1. 🔴 LAS CIFRAS SON LAS DE LA PANTALLA. La herramienta no calcula: se corren
 *     los cargadores del módulo (`loadOrthoCases` → `deudaDelCaso`,
 *     `conteoDeCasos`, `loadOrthoTableroData`) contra la MISMA base y se exige el
 *     mismo número: casos, activos, saldo, vencido y lo cobrado en el periodo.
 *     Lo cobrado es `Invoice.paid` de las facturas del caso, partido en
 *     colocación (enganche), mensualidades, controles y extras.
 *  2. LOS FILTROS: por periodo (rango, año, mes) los casos que arrancaron ahí; y
 *     por doctor.
 *  3. 🔴 NO ESCRIBE: la base REVIENTA ante cualquier operación que no sea de lectura.
 *  4. 🔴 PERMISOS: sin billing.view salen los conteos y NO el dinero, y se DICE;
 *     el doctor no ve la paciente restringida; sin la key del módulo no se consulta.
 *  5. 🔴 OTRA CLÍNICA → NADA, y cada consulta en SQL crudo lleva el clinicId de la sesión.
 *  6. SIN EL MÓDULO dice que no está contratado, sin leer ni un caso.
 */

import { pantalla } from "./preparar-orto"; // PRIMERO
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { subMonths } from "date-fns";

import { loadOrthoCases, loadOrthoTableroData } from "@/lib/orthodontics/tablero-data";
import { deudaDelCaso } from "@/lib/orthodontics/cobranza-caso";
import { conteoDeCasos } from "@/lib/orthodontics/finanzas-ortodoncia";
import { hoyEnZona } from "@/lib/fechas/hoy-en-zona";
import { getEffectivePermissions } from "@/lib/auth/permissions";
import { SABINA_TOOLS } from "../../engine-catalog";
import { accionDeHerramienta } from "../../engine-acciones";
import type { SabinaCtx } from "../../tipos";
import { correrHerramienta } from "../base";
import { ortoResumen, resolverPeriodo, type DatosOrtoResumen } from "../orto-resumen";
import type { BaseDoble } from "./doble-base";
import { CL_SIN_MODULO, baseOrto, sesion } from "./orto-siembra";
import { CL_SUR, TZ_NORTE, TZ_SUR, U_ADMIN_S, U_DOC_N, U_RECEP_N } from "./siembra";

const OPS_DE_LECTURA = new Set(["findMany", "findFirst", "findUnique", "count", "aggregate", "groupBy"]);
const RAIZ = process.cwd();

/**
 * La base de ortodoncia, detrás del `prisma` global, que REVIENTA ante cualquier
 * escritura. Más el SQL crudo de `orto_resumen` (los extras), contestado desde la
 * siembra con el MISMO filtro que el real, y con un extra PAGADO de $350 en el caso
 * de Ana (sin cita: es lo que distingue un extra de un control).
 */
function montar(): { db: BaseDoble; escrituras: string[]; datos: ReturnType<typeof baseOrto>["datos"] } {
  const b = baseOrto();
  b.datos.invoices!.push({
    id: "inv-extra-ana", clinicId: "cl-norte", patientId: "p-ana", status: "PAID", total: 350, paid: 350, balance: 0, discount: 0,
    dueDate: null, createdAt: new Date(), invoiceNumber: "MF-0901", appointmentId: null, orthodonticTreatmentPlanId: "plan-ana",
    notes: null, items: [],
  });
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
    if (!/orto-resumen-extras/.test(texto)) return delMotor(texto, valores);
    const clinicId = String(valores[0] ?? "");
    const ids = ((valores[1] as { values?: unknown[] })?.values ?? []).map(String);
    return (b.datos.invoices ?? [])
      .filter(
        (i) =>
          i.clinicId === clinicId &&
          ids.includes(i.orthodonticTreatmentPlanId) &&
          i.status !== "CANCELLED" &&
          !i.appointmentId &&
          !String(i.notes ?? "").startsWith("[control-hoja:"),
      )
      .map((i) => ({ planId: i.orthodonticTreatmentPlanId, total: i.total, paid: i.paid, status: i.status }));
  };
  return { db: trampa, escrituras, datos: b.datos };
}

const admin = (db: BaseDoble, over: Partial<SabinaCtx> = {}) => sesion(db, over);
const doctor = (db: BaseDoble) => sesion(db, { userId: U_DOC_N, role: "DOCTOR" });
const adminDelSur = (db: BaseDoble) => sesion(db, { clinicId: CL_SUR, userId: U_ADMIN_S, timezone: TZ_SUR });
/** Las keys del ADMIN menos las que se quitan: lo que deja el Super Admin en Equipo. */
const sinEstas = (...quitar: string[]) =>
  getEffectivePermissions({ role: "ADMIN" as any, permissionsOverride: [] }).filter((k) => !quitar.includes(k));

async function pregunta(ctx: SabinaCtx, params: unknown) {
  const r = await correrHerramienta(ortoResumen, ctx, params);
  assert.equal(r.ok, true, `${JSON.stringify(params)} → ${JSON.stringify(r)}`);
  return { d: (r as any).datos as DatosOrtoResumen, resumen: (r as any).resumen as string };
}
const visor = (ctx: SabinaCtx) => ({ userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
const aDia = (f: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ_NORTE }).format(f);

/* ═══════════════════════════════════════════════════════════════════════
   1. LAS CIFRAS DE LA PANTALLA
   ═══════════════════════════════════════════════════════════════════════ */

test("casos y estados: los de la pantalla (loadOrthoCases + conteoDeCasos), por estado, técnica y doctor", async () => {
  const { db } = montar();
  const ctx = admin(db);
  const { cases } = await loadOrthoCases(ctx.clinicId, TZ_NORTE, visor(ctx));
  const cuenta = conteoDeCasos(cases);

  const { d, resumen } = await pregunta(ctx, {});
  assert.equal(d.modulo, "activo");
  assert.equal(d.casos!.total, cases.length);
  assert.equal(d.casos!.activos, cuenta.activos);
  assert.equal(d.casos!.tasaDeAbandono, cuenta.tasaDeAbandono);
  assert.deepEqual(Object.fromEntries(d.casos!.porEstado.map((e) => [e.estado, e.casos])), {
    "Por colocar": 0, "En curso": 4, Pausados: 0, "En retención": 1, Terminados: 1, Abandonados: 1,
  });
  assert.equal(d.casos!.total, 7);
  assert.equal(d.casos!.activos, 5);
  assert.equal(d.casos!.tasaDeAbandono, 50);

  const doctores = Object.fromEntries(d.porDoctor!.filas.map((g) => [g.nombre, g.casos]));
  assert.deepEqual(doctores, { "Hugo Salas": 4, "Nadia Rojas": 3 });
  const tecnicas = Object.fromEntries(d.porTecnica!.filas.map((g) => [g.nombre, g.casos]));
  assert.deepEqual(tecnicas, { "Brackets metálicos": 6, "Alineadores transparentes": 1 });

  assert.match(resumen, /Casos de ortodoncia: 7 \(4 en curso, 1 en retención, 1 terminados, 1 abandonados\); 5 abiertos\./);
  assert.match(resumen, /Abandono: 50%/);
  assert.ok(resumen.includes("[Casos de ortodoncia](/dashboard/orthodontics/pacientes)"), "falta el enlace");
});

test("🔴 dinero: saldo y vencido = deudaDelCaso de la pantalla; cobrado = Invoice.paid del caso, partido en colocación, mensualidades, controles y extras", async () => {
  const { db } = montar();
  const ctx = admin(db);
  const { cases } = await loadOrthoCases(ctx.clinicId, TZ_NORTE, visor(ctx));
  const centavos = (f: (c: (typeof cases)[number]) => number) => cases.reduce((s, c) => s + Math.round(f(c) * 100), 0) / 100;

  const { d, resumen } = await pregunta(ctx, {});
  const m = d.dinero!;
  assert.equal(m.pendiente, centavos((c) => deudaDelCaso(c.cobranza, c.extrasPendientes).porCobrar), "el saldo no es el de Casos/Cobranza");
  assert.equal(m.vencido, centavos((c) => deudaDelCaso(c.cobranza, c.extrasPendientes).vencido));
  assert.equal(m.pendiente, 26800);
  assert.equal(m.vencido, 8800); // Ana 2,000 + Dora 800 + la restringida 6,000

  // Lo cobrado: Ana 9,000 + Carla 12,000 + Elías 6,000 de su factura del tratamiento; el control pagado de Dora, 800; el extra de Ana, 350.
  assert.deepEqual(m.cobrado, { total: 28150, colocacion: 7000, mensualidades: 20000, controles: 800, extras: 350 });
  assert.equal(m.cobrado.colocacion + m.cobrado.mensualidades + m.cobrado.controles + m.cobrado.extras, m.cobrado.total);
  // El valor: lo facturado de todos los casos (25,000 + 12,000 + 6,000 + 10,000 + 800 + 800 + 350).
  assert.equal(m.valorTotal, 54950);

  assert.match(resumen, /Valor de esos casos: \$54,950\. Cobrado: \$28,150 \(colocación \$7,000, mensualidades \$20,000, controles \$800, extras \$350\)\./);
  assert.match(resumen, /Por cobrar: \$26,800, de los cuales \$8,800 ya vencieron/);
  // Por doctor: la suma de las filas es el total.
  const salas = d.porDoctor!.filas.find((g) => g.nombre === "Hugo Salas")!;
  const rojas = d.porDoctor!.filas.find((g) => g.nombre === "Nadia Rojas")!;
  assert.equal(salas.cobrado! + rojas.cobrado!, m.cobrado.total);
  assert.equal(salas.pendiente! + rojas.pendiente!, m.pendiente);
});

/* ═══════════════════════════════════════════════════════════════════════
   2. LOS FILTROS
   ═══════════════════════════════════════════════════════════════════════ */

test("periodo: los casos que ARRANCARON en el rango, y lo cobrado en esas fechas es el de la Producción del Tablero", async () => {
  const { db } = montar();
  const ctx = admin(db);
  const hoy = aDia(new Date());
  const desde = aDia(subMonths(new Date(), 6));

  // Colocados en los últimos seis meses: Beto (2), Dora (3) y la restringida (5).
  const { d } = await pregunta(ctx, { desde, hasta: hoy });
  assert.equal(d.casos!.total, 3);
  assert.deepEqual(d.porDoctor!.filas.map((g) => g.nombre).sort(), ["Hugo Salas", "Nadia Rojas"]);
  assert.equal(d.periodo.desde, desde);
  assert.equal(d.dinero!.valorTotal, 10000 + 800 + 800);

  // «Este mes»: lo cobrado en el periodo es lo que el Tablero llama Producción del mes.
  const tablero = await loadOrthoTableroData(ctx.clinicId, TZ_NORTE, visor(ctx));
  const delMes = Math.round(tablero.productionByDoctor.reduce((s, p) => s + p.amountMxn, 0) * 100) / 100;
  const mes = await pregunta(ctx, { periodo: "este_mes" });
  assert.equal(mes.d.cobradoEnElPeriodo!.neto, delMes, "la producción del periodo no es la del Tablero");
  assert.ok(delMes >= 2000, "la siembra cobra $2,000 de Ana hoy");
  assert.match(mes.resumen, /los pagos que entraron/);

  // Sin periodo no hay «cobrado en el periodo».
  assert.equal((await pregunta(ctx, {})).d.cobradoEnElPeriodo, null);
});

test("año, mes y «este año»: el mismo periodo dicho de tres maneras", async () => {
  const { db } = montar();
  const ctx = admin(db);
  const hoy = hoyEnZona(new Date(), TZ_NORTE);
  const anio = Number(hoy.slice(0, 4));
  const esteAnio = await pregunta(ctx, { periodo: "este_anio" });
  const porAnio = await pregunta(ctx, { anio });
  const porRango = await pregunta(ctx, { desde: `${anio}-01-01`, hasta: `${anio}-12-31` });
  assert.equal(esteAnio.d.casos!.total, porAnio.d.casos!.total);
  assert.equal(porAnio.d.casos!.total, porRango.d.casos!.total);
  assert.equal(esteAnio.d.periodo.etiqueta, String(anio));

  const mes = await pregunta(ctx, { mes: hoy.slice(0, 7) });
  assert.equal(mes.d.periodo.desde, `${hoy.slice(0, 7)}-01`);
  const vacio = await pregunta(ctx, { anio: 2001 });
  assert.equal(vacio.d.casos!.total, 0);
  assert.match(vacio.resumen, /No hay casos de ortodoncia que arrancaron 2001/);

  // El periodo se arma sin sorpresas: el último día de febrero, un rango al revés se rechaza.
  assert.deepEqual(resolverPeriodo({ mes: "2028-02" }, "2026-10-01"), { etiqueta: "febrero de 2028", desde: "2028-02-01", hasta: "2028-02-29" });
  assert.throws(() => resolverPeriodo({ desde: "2026-05-02", hasta: "2026-05-01" }, "2026-10-01"), /desde es posterior a hasta/);
  const mal = await correrHerramienta(ortoResumen, ctx, { mes: "octubre" });
  assert.equal((mal as any).motivo, "error");
  assert.match((mal as any).detalle, /parametros_invalidos/);
});

test("doctor: se ciñe a sus casos, sin acentos ni mayúsculas; si no existe, lo dice y no da cifras sueltas", async () => {
  const { db } = montar();
  const ctx = admin(db);
  const { d, resumen } = await pregunta(ctx, { doctor: "hugo" });
  assert.deepEqual(d.doctoresFiltrados, ["Hugo Salas"]);
  assert.equal(d.casos!.total, 4);
  assert.equal(d.dinero!.valorTotal, 25000 + 12000 + 10000 + 350);
  assert.match(resumen, /Casos de ortodoncia de Hugo Salas: 4/);

  const nadie = await pregunta(ctx, { doctor: "Zuleima" });
  assert.deepEqual(nadie.d.doctorNoEncontrado, { dijo: "Zuleima", doctores: ["Hugo Salas", "Nadia Rojas"] });
  assert.equal(nadie.d.casos, null);
  assert.match(nadie.resumen, /NO des cifras sin filtro/);
});

/* ═══════════════════════════════════════════════════════════════════════
   3. NO ESCRIBE
   ═══════════════════════════════════════════════════════════════════════ */

test("🔴 solo lectura: contesta contra una base que revienta ante cualquier escritura, y no es una acción", async () => {
  const { db, escrituras } = montar();
  for (const p of [{}, { periodo: "este_anio" }, { doctor: "Rojas" }, { desde: "2025-01-01", hasta: "2026-12-31" }]) {
    await pregunta(admin(db), p);
  }
  assert.deepEqual(escrituras, []);
  const delMotor = SABINA_TOOLS.find((t) => t.nombre === "orto_resumen");
  assert.ok(delMotor, "el motor no ve orto_resumen");
  assert.equal(delMotor.permiso, "specialties.orthodontics");
  assert.equal(accionDeHerramienta(delMotor), null);
  const fuente = ["orto-resumen.ts", "orto-resumen-motor.ts"].map((f) => readFileSync(path.join(RAIZ, "src/lib/sabina/tools", f), "utf8")).join("\n");
  assert.doesNotMatch(fuente, /\.(create|update|updateMany|upsert|delete|deleteMany|createMany)\(|\$executeRaw|\$transaction|fetch\(/);
});

/* ═══════════════════════════════════════════════════════════════════════
   4. PERMISOS
   ═══════════════════════════════════════════════════════════════════════ */

test("🔴 sin billing.view salen los conteos y NO el dinero, y se DICE", async () => {
  const { db } = montar();
  const ctx = admin(db, { permissionsOverride: sinEstas("billing.view") });
  const { d, resumen } = await pregunta(ctx, { periodo: "este_anio" });
  assert.equal(d.dinero, null);
  assert.equal(d.cobradoEnElPeriodo, null);
  assert.ok(d.porDoctor!.filas.every((g) => g.valor === null && g.cobrado === null && g.pendiente === null));
  assert.deepEqual(d.omitidas.map((o) => o.permiso), ["billing.view"]);
  assert.match(resumen, /NO tienes acceso a: el dinero de los casos .*falta billing\.view/);
  assert.doesNotMatch(resumen, /\$\d/, "salió dinero sin permiso");
  assert.doesNotMatch(JSON.stringify(d), /54950|28150|26800/);
});

test("🔴 sin la key del módulo: sin_permiso y no se consulta nada", async () => {
  const { db } = montar();
  const antes = db.contador.llamadas.length;
  const r = await correrHerramienta(ortoResumen, admin(db, { permissionsOverride: sinEstas("specialties.orthodontics") }), {});
  assert.deepEqual(r, { ok: false, motivo: "sin_permiso", permiso: "specialties.orthodontics" });
  assert.equal(db.contador.llamadas.length, antes);
});

test("🔴 el doctor no se entera de la paciente restringida (la visibilidad es la del panel)", async () => {
  const { db } = montar();
  const { d } = await pregunta(doctor(db), {});
  assert.equal(d.casos!.total, 6, "la restringida solo la ve la administradora");
  assert.equal(d.dinero!.valorTotal, 54950 - 10000);
  assert.ok(!JSON.stringify(d).includes("Paula"));
});

/* ═══════════════════════════════════════════════════════════════════════
   5. OTRA CLÍNICA → NADA
   ═══════════════════════════════════════════════════════════════════════ */

test("🔴 el sur ve SU caso y nada del norte (y al revés); cada consulta cruda lleva el clinicId de la sesión", async () => {
  const { db } = montar();
  const sur = await pregunta(adminDelSur(db), {});
  assert.equal(sur.d.casos!.total, 1);
  assert.equal(sur.d.dinero!.valorTotal, 99999);
  assert.equal(sur.d.porDoctor!.filas.length, 1);
  assert.doesNotMatch(JSON.stringify(sur.d), /Hugo|Nadia|54950/);
  for (const c of pantalla.consultasSql.filter((q) => q.valores.length > 0)) assert.equal(c.valores[0], CL_SUR, `una consulta cruda sin el clinicId de la sesión: ${c.texto.slice(0, 80)}`);

  const norte = await pregunta(admin(db), {});
  assert.doesNotMatch(JSON.stringify(norte.d), /99999|SUR/);

  // Sin clínica en la sesión no se consulta nada.
  const roto = await correrHerramienta(ortoResumen, { ...admin(db), clinicId: undefined as any }, {});
  assert.equal((roto as any).motivo, "error");
});

/* ═══════════════════════════════════════════════════════════════════════
   6. SIN EL MÓDULO
   ═══════════════════════════════════════════════════════════════════════ */

test("🔴 una sede sin el módulo contratado lo dice y no lee ni un caso", async () => {
  const { db } = montar();
  const { d, resumen } = await pregunta(sesion(db, { clinicId: CL_SIN_MODULO }), {});
  assert.equal(d.modulo, "no_contratado");
  assert.equal(d.casos, null);
  assert.match(resumen, /no tiene contratado el módulo de Ortodoncia/);
  assert.ok(!db.contador.llamadas.some((l) => l.modelo.startsWith("ortho")), "se leyó un caso en una sede sin módulo");
});

test("el enlace va siempre, aunque el modelo se lo coma", () => {
  const aviso = ortoResumen.avisoObligatorio!({ modulo: "activo", doctorNoEncontrado: null } as any);
  assert.ok(aviso && aviso.marca === "/dashboard/orthodontics/pacientes");
});
