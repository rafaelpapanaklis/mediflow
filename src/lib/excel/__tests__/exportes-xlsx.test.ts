/**
 * Los tres exportes .xlsx después de pasar de SheetJS (`xlsx`) a exceljs
 * (ws1-t12, auditoría H4): plantilla del importador, reporte de /admin y
 * reporte de afiliados. Se llama al GET de cada ruta DE VERDAD, con Prisma y la
 * sesión falsos, y el archivo que sale se abre con exceljs.
 *
 * Los valores esperados son los que daban esas mismas rutas con SheetJS: misma
 * hoja, mismas columnas en el mismo orden, mismos anchos (wch → 18.83203125…),
 * texto como texto ("5551234567", "1250.00"), números como número, celdas
 * vacías donde antes iba "" o null, y el mismo nombre de archivo.
 *
 * Necesita --experimental-test-module-mocks (mock.module sustituye prisma y la
 * sesión). Las rutas se importan DESPUÉS de los mocks.
 *
 * Run: npm run test:exportes-xlsx
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import * as ExcelJS from "exceljs";
import JSZip from "jszip";

let vacio = false;

const clinicas = [
  { id: "c1", name: "Clínica Sonrisa", plan: "pro", monthlyPrice: 1499, subscriptionStatus: "active", createdAt: new Date("2026-01-05T15:00:00Z"), trialEndsAt: new Date("2026-01-20T00:00:00Z"), archivedAt: null },
  { id: "c2", name: "Dental Norte", plan: "basic", monthlyPrice: 0, subscriptionStatus: "trialing", createdAt: new Date("2026-02-10T03:30:00Z"), trialEndsAt: new Date("2099-01-01T00:00:00Z"), archivedAt: null },
  { id: "c3", name: "Odonto Sur", plan: "pro", monthlyPrice: 999, subscriptionStatus: "cancelled", createdAt: new Date("2025-06-01T00:00:00Z"), trialEndsAt: null, archivedAt: null },
];
const facturas = [
  { id: "i1", clinicId: "c1", amount: 1499.5, currency: "MXN", status: "paid", method: "stripe", reference: "in_123", periodStart: new Date("2026-02-01T00:00:00Z"), periodEnd: new Date("2026-03-01T00:00:00Z"), paidAt: new Date("2026-02-01T18:00:00Z"), createdAt: new Date("2026-02-01T05:00:00Z"), clinic: { name: "Clínica Sonrisa", plan: "pro" } },
  { id: "i2", clinicId: "c2", amount: 0, currency: "USD", status: "pending", method: null, reference: null, periodStart: new Date("2026-03-01T00:00:00Z"), periodEnd: new Date("2026-03-31T00:00:00Z"), paidAt: null, createdAt: new Date("2026-03-02T12:00:00Z"), clinic: null },
];
const comisiones = [
  { id: "k1", affiliateId: "af1", clinicId: "c1", kind: "subscription", monthsCovered: 3, amountMxn: 4498.5, commissionMxn: 899.699, status: "paid", paidAt: new Date("2026-03-05T00:00:00Z"), createdAt: new Date("2026-03-01T10:00:00Z") },
  { id: "k2", affiliateId: "af1", clinicId: "", kind: "network_bonus", monthsCovered: null, amountMxn: 0, commissionMxn: 500, status: "pending", paidAt: null, createdAt: new Date("2026-03-02T10:00:00Z") },
  { id: "k3", affiliateId: "af1", clinicId: "c9", kind: null, monthsCovered: 1, amountMxn: 999, commissionMxn: 199.8, status: "pending", paidAt: null, createdAt: new Date("2026-03-03T10:00:00Z") },
];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      clinic: {
        findMany: async (a: any) => {
          if (a?.where?.affiliateId) return clinicas.slice(0, 2);
          if (a?.where?.id?.in) return clinicas.filter((c) => a.where.id.in.includes(c.id));
          if (a?.where?.subscriptionStatus === "active") return clinicas.filter((c) => c.subscriptionStatus === "active");
          return clinicas;
        },
        count: async (a: any) => (a?.where?.subscriptionStatus === "cancelled" ? 1 : 2),
      },
      subscriptionInvoice: {
        findMany: async () => (vacio ? [] : facturas),
        aggregate: async () => ({ _sum: { amount: 1499.5 }, _count: 1 }),
      },
      affiliateCommission: { findMany: async () => (vacio ? [] : comisiones) },
    },
  },
});
mock.module("@/lib/admin-auth", { namedExports: { isAdminAuthed: async () => true } });
mock.module("@/lib/affiliate-auth", { namedExports: { getAffiliateContext: async () => ({ affiliateId: "af1" }) } });
mock.module("@/lib/admin/mrr", { namedExports: { getAdminMrr: async () => ({ total: 2497.35 }) } });
mock.module("@/lib/admin/modulos", {
  namedExports: { loadModulosContratados: async () => ({ medido: false, filas: [] }), computeMrrModulos: () => ({ total: 0 }) },
});

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function abrir(res: Response) {
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), XLSX_MIME);
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  return { wb, buf, archivo: /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] };
}

function fila(ws: ExcelJS.Worksheet, n: number): unknown[] {
  const valores = ws.getRow(n).values as unknown[];
  return Array.from({ length: ws.columnCount }, (_, i) => valores[i + 1] ?? null);
}

/** El `wch` de SheetJS tal como lo escribía en el XML (MDW = 6). */
const ancho = (wch: number) => Math.round(((wch * 6 + 5) / 6) * 256) / 256;

const req = async (url: string) => {
  const { NextRequest } = await import("next/server");
  return new NextRequest(url);
};

test("plantilla del importador: 6 hojas, encabezados, filas de muestra como texto y anchos", async () => {
  const { GET } = await import("../../../app/api/patients/import/template/route");
  const { wb, buf, archivo } = await abrir(await GET());
  assert.equal(archivo, "plantilla-dalecontrol.xlsx");
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Pacientes", "Saldos", "Citas", "Expedientes", "Notas", "Presupuestos"]);

  const pacientes = wb.getWorksheet("Pacientes")!;
  assert.equal(pacientes.dimensions.range, "A1:I2");
  assert.deepEqual(fila(pacientes, 1), ["nombre", "apellido", "email", "telefono", "fecha de nacimiento", "genero", "tipo sangre", "direccion", "notas"]);
  assert.deepEqual(fila(pacientes, 2), ["María", "Hernández", "maria.h@example.com", "5551234567", "15/03/1985", "F", "O+", "Av. Reforma 123, CDMX", "Alergia a penicilina"]);
  assert.deepEqual(pacientes.columns.map((c) => c.width), [18, 18, 28, 14, 20, 8, 12, 32, 32].map(ancho));

  // Teléfono e importes siguen siendo TEXTO: el importador los lee igual que antes.
  const saldos = wb.getWorksheet("Saldos")!;
  assert.equal(saldos.getCell("C2").type, ExcelJS.ValueType.String);
  assert.equal(saldos.getCell("D2").value, "1250.00");

  // La línea sin pieza deja la celda vacía, como SheetJS con "".
  const presupuestos = wb.getWorksheet("Presupuestos")!;
  assert.equal(presupuestos.dimensions.range, "A1:M3");
  assert.equal(presupuestos.getCell("H2").value, "16");
  assert.equal(presupuestos.getCell("H3").value, null);
  assert.equal(presupuestos.getCell("G3").value, "Profilaxis");
  assert.equal(wb.getWorksheet("Notas")!.getColumn(7).width, ancho(60));

  // Sin triángulo verde de «número guardado como texto» y con la letra de antes.
  const zip = await JSZip.loadAsync(buf);
  const hoja1 = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  assert.match(hoja1, /<ignoredErrors><ignoredError numberStoredAsText="1" sqref="A1:I2"\/><\/ignoredErrors><\/worksheet>$/);
  const estilos = await zip.file("xl/styles.xml")!.async("string");
  assert.match(estilos, /<fonts\b[^>]*><font>(?:(?!<\/font>).)*<sz val="12"\/>/);
});

test("reporte de /admin: Resumen, Mensual y Pagos con números como número y nombre por periodo", async () => {
  vacio = false;
  const { GET } = await import("../../../app/api/admin/reports/route");
  const { wb, archivo } = await abrir(await GET(await req("http://x/api/admin/reports?format=xlsx&from=2026-01-01&to=2026-03-15")));
  assert.equal(archivo, "dalecontrol-reporte-2026-01-01_2026-03-15.xlsx");
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Resumen", "Mensual", "Pagos"]);

  const resumen = wb.getWorksheet("Resumen")!;
  assert.equal(resumen.dimensions.range, "A1:B15");
  assert.deepEqual(fila(resumen, 1), ["Métrica", "Valor"]);
  assert.deepEqual(fila(resumen, 2), ["Periodo", "2026-01-01 → 2026-03-15"]);
  assert.deepEqual(fila(resumen, 3), ["MRR (activo)", 2497.35]);
  assert.deepEqual(fila(resumen, 15), ["Pagos periodo", 1]);
  assert.equal(resumen.getCell("B3").type, ExcelJS.ValueType.Number);
  assert.equal(resumen.getColumn(1).width, undefined, "el reporte de /admin nunca llevó anchos");

  const mensual = wb.getWorksheet("Mensual")!;
  assert.deepEqual(fila(mensual, 1), ["Mes", "Ingresos", "# Pagos", "Nuevas", "Churn"]);
  assert.deepEqual(fila(mensual, 2).slice(1), [1499.5, 1, 2, 1]);

  const pagos = wb.getWorksheet("Pagos")!;
  assert.equal(pagos.dimensions.range, "A1:J3");
  assert.deepEqual(fila(pagos, 1), ["Fecha", "Clínica", "Plan", "Monto", "Moneda", "Método", "Estado", "Referencia", "PeriodoInicio", "PeriodoFin"]);
  assert.deepEqual(fila(pagos, 2), ["2026-01-31", "Clínica Sonrisa", "pro", 1499.5, "MXN", "stripe", "paid", "in_123", "2026-02-01", "2026-03-01"]);
  // Factura sin clínica, método ni referencia: celdas vacías, monto 0 como número.
  assert.deepEqual(fila(pagos, 3), ["2026-03-02", null, null, 0, "USD", null, "pending", null, "2026-03-01", "2026-03-31"]);
});

test("reporte de /admin sin facturas: la hoja Pagos sale vacía, sin encabezados (como con SheetJS)", async () => {
  vacio = true;
  const { GET } = await import("../../../app/api/admin/reports/route");
  const { wb } = await abrir(await GET(await req("http://x/api/admin/reports?format=xlsx&from=2026-03-01&to=2026-03-15")));
  vacio = false;
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Resumen", "Mensual", "Pagos"]);
  assert.equal(wb.getWorksheet("Pagos")!.rowCount, 0);
});

test("afiliados: Referidos y Comisiones con sus columnas, anchos y nombre de archivo", async () => {
  const { GET } = await import("../../../app/api/afiliados/reportes/export/route");

  const ref = await abrir(await GET(await req("http://x/api/afiliados/reportes/export?type=referidos&from=2026-01-01&to=2026-03-15")));
  assert.equal(ref.archivo, "dalecontrol-afiliado-referidos-2026-01-01-2026-03-15.xlsx");
  const referidos = ref.wb.getWorksheet("Referidos")!;
  assert.equal(ref.wb.worksheets.length, 1);
  assert.deepEqual(fila(referidos, 1), ["Clínica", "Fecha de registro", "Estado"]);
  assert.deepEqual(fila(referidos, 2), ["Clínica Sonrisa", "05/01/2026", "Pagando"]);
  assert.deepEqual(fila(referidos, 3), ["Dental Norte", "10/02/2026", "En prueba"]);
  assert.deepEqual(referidos.columns.map((c) => c.width), [34, 18, 16].map(ancho));

  vacio = false;
  const com = await abrir(await GET(await req("http://x/api/afiliados/reportes/export?type=comisiones&from=2026-01-01&to=2026-03-15")));
  assert.equal(com.archivo, "dalecontrol-afiliado-comisiones-2026-01-01-2026-03-15.xlsx");
  const comis = com.wb.getWorksheet("Comisiones")!;
  assert.equal(comis.dimensions.range, "A1:H4");
  assert.deepEqual(fila(comis, 1), ["Fecha", "Clínica", "Tipo", "Meses cubiertos", "Factura base (MXN)", "Comisión (MXN)", "Estado", "Fecha de pago"]);
  assert.deepEqual(fila(comis, 2).slice(3, 8), [3, 4498.5, 899.7, "Pagada", "05/03/2026"]);
  assert.equal(comis.getCell("F2").type, ExcelJS.ValueType.Number);
  assert.equal(comis.getCell("H3").value, "—");
  assert.deepEqual(comis.columns.map((c) => c.width), [12, 34, 17, 16, 18, 16, 12, 14].map(ancho));

  // Sin comisiones en el rango: la hoja conserva los encabezados.
  vacio = true;
  const sin = await abrir(await GET(await req("http://x/api/afiliados/reportes/export?type=comisiones&from=2026-03-01&to=2026-03-15")));
  vacio = false;
  const hojaSin = sin.wb.getWorksheet("Comisiones")!;
  assert.equal(hojaSin.rowCount, 1);
  assert.equal(hojaSin.getCell("H1").value, "Fecha de pago");
});
