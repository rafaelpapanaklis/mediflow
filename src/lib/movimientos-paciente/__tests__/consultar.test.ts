/**
 * Movimientos del paciente — la LECTURA paginada.
 *
 * Lo que tiene que ser verdad:
 *  1. la consulta SIEMPRE filtra por las sedes de la sesión y por el paciente, y
 *     nunca lista lecturas ni PDFs;
 *  2. pagina: página, tamaño (con tope) y total;
 *  3. sin la columna `patientId` cae al modo degradado (lee de `changes._mov`, solo
 *     los últimos 90 días) en vez de romper;
 *  4. el permiso se aplica en el servidor: sin permiso clínico o de facturación, el
 *     texto verdadero NO sale de aquí;
 *  5. filtros de tipo y fechas llegan a la consulta como parámetros, no pegados;
 *  6. sin sedes o sin paciente no se consulta (un `IN ()` vacío no debe devolver todo).
 *
 * Corre con: npm run test:movimientos-paciente
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";

type Consulta = { sql: string; values: unknown[] };
let consultas: Consulta[] = [];
let filas: any[] = [];
let total = 0;
let sinColumna = false;

function aplanar(strings: TemplateStringsArray, values: unknown[]): Consulta {
  const q = Prisma.sql(strings, ...values);
  return { sql: q.sql, values: q.values as unknown[] };
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
        const q = aplanar(strings, values);
        consultas.push(q);
        if (sinColumna && /a\."patientId"/.test(q.sql)) {
          return Promise.reject(
            Object.assign(new Error('column a.patientId does not exist'), { code: "P2010", meta: { code: "42703" } }),
          );
        }
        return Promise.resolve(/COUNT\(\*\)/.test(q.sql) ? [{ n: BigInt(total) }] : filas);
      },
    },
  },
});

async function cargar() {
  const consultar = await import("../consultar");
  const fila = await import("../fila");
  return { consultar, fila };
}

const TODO = { verClinico: true, verDinero: true };
const F = { clinicIds: ["cli_1"], patientId: "pat_1" };

function filaCruda(o: Partial<any> = {}) {
  return {
    id: "log_1",
    entityType: "appointment",
    entityId: "apt_1",
    action: "create",
    changes: { _mov: { before: null, after: { texto: "Agendó una cita para el 3 oct 2026 10:00" } } },
    createdAt: new Date("2026-10-03T16:00:00.000Z"),
    actorType: "staff",
    firstName: "Ana",
    lastName: "Pérez",
    ...o,
  };
}

describe("listarMovimientosDelPaciente", () => {
  beforeEach(async () => {
    consultas = [];
    filas = [filaCruda()];
    total = 1;
    sinColumna = false;
    (await cargar()).fila._reiniciarEstadoDeColumna();
  });

  it("filtra por las sedes de la sesión y por el paciente, y deja fuera lecturas y PDFs", async () => {
    const { consultar } = await cargar();
    await consultar.listarMovimientosDelPaciente({ ...F, clinicIds: ["cli_1", "cli_2"] }, TODO);
    const q = consultas[0];
    assert.match(q.sql, /a\."clinicId" IN \(\?,\?\)/);
    assert.ok(q.values.includes("cli_1") && q.values.includes("cli_2"));
    assert.ok(q.values.includes("pat_1"));
    assert.match(q.sql, /a\."action" <> 'view'/);
    assert.match(q.sql, /NOT LIKE '%\.pdf'/);
    // el paciente y las sedes viajan como parámetros, no pegados al texto
    assert.ok(!q.sql.includes("pat_1") && !q.sql.includes("cli_1"));
  });

  it("atribuye al paciente las filas de antes (deduciéndolas de su entidad) sin un UPDATE", async () => {
    const { consultar } = await cargar();
    await consultar.listarMovimientosDelPaciente(F, TODO);
    const sql = consultas[0].sql;
    for (const tabla of ["appointments", "invoices", "medical_records", "prescriptions", "quotes", "patient_files", "payment_plans", "treatment_plans", "consent_forms"]) {
      assert.match(sql, new RegExp(`"${tabla}"`), tabla);
    }
    // y cada subconsulta lleva su propio filtro de tenant
    const conTenant = sql.match(/t\."clinicId" IN/g) ?? [];
    const conTabla = sql.match(/FROM "[a-z_]+" t WHERE/g) ?? [];
    assert.equal(conTenant.length, conTabla.length);
    assert.ok(conTabla.length >= 9);
  });

  it("devuelve texto, quién y fecha; pagina con total", async () => {
    total = 61;
    const { consultar } = await cargar();
    const p = await consultar.listarMovimientosDelPaciente({ ...F, page: 2, pageSize: 25 }, TODO);
    assert.equal(p.items.length, 1);
    assert.equal(p.items[0].texto, "Agendó una cita para el 3 oct 2026 10:00");
    assert.equal(p.items[0].actor, "Ana Pérez");
    assert.equal(p.items[0].fecha, "2026-10-03T16:00:00.000Z");
    assert.equal(p.items[0].categoria, "citas");
    assert.equal(p.total, 61);
    assert.equal(p.paginas, 3);
    assert.equal(p.page, 2);
    const lista = consultas[0];
    assert.match(lista.sql, /LIMIT \? OFFSET \?/);
    assert.deepEqual(lista.values.slice(-2), [25, 25]); // limit 25, offset (2-1)*25
    assert.match(lista.sql, /ORDER BY a\."createdAt" DESC, a\."id" DESC/);
  });

  it("normaliza página y tamaño: basura → defecto, tamaño con tope", async () => {
    const { consultar } = await cargar();
    assert.deepEqual(consultar.normalizarPagina("x", undefined), { page: 1, pageSize: 25 });
    assert.deepEqual(consultar.normalizarPagina(0, 0), { page: 1, pageSize: 25 });
    assert.deepEqual(consultar.normalizarPagina(-3, 5000), { page: 1, pageSize: 100 });
    assert.deepEqual(consultar.normalizarPagina(4, 12), { page: 4, pageSize: 12 });
  });

  it("sin permiso clínico, lo clínico sale enmascarado y el texto verdadero no viaja", async () => {
    filas = [
      filaCruda({ id: "1", entityType: "record", action: "create", changes: { _mov: { after: { texto: "Creó una nota de consulta" } } } }),
      filaCruda({ id: "2", entityType: "patient-file", action: "create", changes: { _mov: { after: { texto: "Subió una radiografía" } } } }),
      filaCruda({ id: "3", entityType: "appointment", changes: { _mov: { after: { texto: "Agendó una cita" } } } }),
      filaCruda({ id: "4", entityType: "patient", action: "odontogram_write", changes: { _odontogram: { after: { toothNumber: 16 } } } }),
    ];
    const { consultar } = await cargar();
    const p = await consultar.listarMovimientosDelPaciente(F, { verClinico: false, verDinero: true });
    assert.deepEqual(p.items.map((i) => i.texto), [
      "Se actualizó el expediente",
      "Se actualizó el expediente",
      "Agendó una cita",
      "Se actualizó el expediente",
    ]);
    const plano = JSON.stringify(p);
    assert.ok(!plano.includes("radiografía") && !plano.includes("nota de consulta") && !plano.includes("toothNumber"));
    // pero sí se sabe cuándo y quién
    assert.equal(p.items[0].actor, "Ana Pérez");
    assert.ok(p.items[0].fecha);
  });

  it("sin permiso de facturación, el dinero sale enmascarado", async () => {
    filas = [filaCruda({ entityType: "invoice", action: "update", changes: { _mov: { after: { texto: "Registró un pago de $500.00" } } } })];
    const { consultar } = await cargar();
    const p = await consultar.listarMovimientosDelPaciente(F, { verClinico: true, verDinero: false });
    assert.equal(p.items[0].texto, "Se actualizó la facturación");
    assert.ok(!JSON.stringify(p).includes("500"));
  });

  it("un movimiento hecho por soporte de plataforma se ve como tal, sin nombre", async () => {
    filas = [filaCruda({ actorType: "admin", firstName: "Tomás", lastName: "Root" })];
    const { consultar } = await cargar();
    const p = await consultar.listarMovimientosDelPaciente(F, TODO);
    assert.equal(p.items[0].actor, "Soporte DaleControl");
  });

  it("filtro de tipo y fechas llegan como parámetros", async () => {
    const { consultar } = await cargar();
    await consultar.listarMovimientosDelPaciente(
      { ...F, categoria: "dinero", desde: consultar.fechaDeFiltro("2026-01-01"), hasta: consultar.fechaDeFiltro("2026-01-31", true) },
      TODO,
    );
    const q = consultas[0];
    assert.ok(q.values.includes("dinero"));
    assert.ok(q.values.includes("2026-01-01T00:00:00.000Z"));
    assert.ok(q.values.includes("2026-01-31T23:59:59.999Z"));
    assert.match(q.sql, /a\."createdAt" >= /);
    assert.match(q.sql, /a\."createdAt" <= /);
    assert.match(q.sql, /CASE/);
  });

  it("la categoría de SQL nombra a las cinco categorías y sus reglas", async () => {
    const { consultar } = await cargar();
    const q = Prisma.sql`${consultar.sqlCategoria()}`;
    const sql = q.sql;
    assert.match(sql, /jsonb_exists/);
    assert.match(sql, /left\(a\."action"/);
    for (const c of ["citas", "perfil", "expediente", "archivos", "dinero"]) {
      assert.ok(q.values.includes(c) || sql.includes(c), c);
    }
  });

  it("todo parámetro suelto de la categoría lleva su tipo (sin él Postgres da 500: «could not determine data type»)", async () => {
    const { consultar } = await cargar();
    const sql = Prisma.sql`${consultar.sqlCategoria()}`.sql;
    // dentro de un CASE (THEN ?), de una función (left(x, ?), jsonb_exists(x, ?)) o de una comparación (= ?)
    assert.ok(!/THEN \?(?!::)/.test(sql), "THEN ? sin tipo");
    assert.ok(!/left\(a\."action", \?(?!::)/.test(sql), "left(…, ?) sin tipo");
    assert.ok(!/jsonb_exists\(a\."changes", \?(?!::)/.test(sql), "jsonb_exists(…, ?) sin tipo");
    assert.ok(!/\) = \?(?!::)/.test(sql), "comparación con ? sin tipo");
    await consultar.listarMovimientosDelPaciente({ ...F, categoria: "citas" }, TODO);
    assert.match(consultas[0].sql, /\) = \?::text/);
  });

  it("fechas inválidas se ignoran, no se pegan", async () => {
    const { consultar } = await cargar();
    assert.equal(consultar.fechaDeFiltro("2026-13-99"), null);
    assert.equal(consultar.fechaDeFiltro("'; DROP TABLE audit_logs;--"), null);
    assert.equal(consultar.fechaDeFiltro(undefined), null);
    assert.equal(consultar.categoriaValida("dinero"), "dinero");
    assert.equal(consultar.categoriaValida("' OR 1=1"), null);
  });

  it("sin la columna cae al modo degradado (lee _mov, últimos 90 días) en vez de romper", async () => {
    sinColumna = true;
    const { consultar } = await cargar();
    const p = await consultar.listarMovimientosDelPaciente(F, TODO);
    assert.equal(p.degradado, true);
    assert.equal(p.items.length, 1);
    const ultima = consultas[consultas.length - 1];
    assert.match(ultima.sql, /'_mov' -> 'after' ->> 'patientId'/);
    assert.ok(!/a\."patientId"/.test(ultima.sql));
    assert.match(ultima.sql, /a\."createdAt" >= /);
  });

  it("con la columna no hay modo degradado", async () => {
    const { consultar } = await cargar();
    const p = await consultar.listarMovimientosDelPaciente(F, TODO);
    assert.equal(p.degradado, false);
    assert.match(consultas[0].sql, /a\."patientId" = /);
  });

  it("sin sedes o sin paciente NO se consulta", async () => {
    const { consultar } = await cargar();
    for (const roto of [
      { clinicIds: [] as string[] },
      { patientId: "" },
      { patientId: undefined as unknown as string },
    ]) {
      const p = await consultar.listarMovimientosDelPaciente({ ...F, ...roto }, TODO);
      assert.deepEqual(p.items, []);
      assert.equal(p.total, 0);
    }
    const d = await consultar.listarMovimientosParaDescarga({ ...F, clinicIds: [] }, TODO);
    assert.deepEqual(d.items, []);
    assert.equal(consultas.length, 0);
  });

  it("la descarga marca si se cortó en el tope", async () => {
    total = 9000;
    const { consultar } = await cargar();
    const d = await consultar.listarMovimientosParaDescarga(F, TODO);
    assert.equal(d.total, 9000);
    assert.equal(d.recortado, true);
    assert.ok(consultas[0].values.includes(consultar.TOPE_DESCARGA));
  });
});
