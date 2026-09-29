/**
 * Movimientos del paciente — que el cableado no se pierda.
 *
 * Es un recorrido del árbol de fuentes (igual que la matriz de permisos): no
 * ejecuta las rutas, comprueba que cada escritura de datos del paciente sigue
 * pasando por el registro. Si alguien añade una acción de ortodoncia sin
 * `patientId`, o un helper de módulo vuelve a escribir en `audit_logs` por su
 * cuenta, esto falla en rojo y dice cuál.
 *
 * El inventario completo (cubierto / no cubierto) está en REPORTE-ws1-t12.md.
 *
 * Corre con: npm run test:movimientos-paciente
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), "utf8");

function archivos(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) archivos(rel, acc);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.|__tests__/.test(rel)) acc.push(rel);
  }
  return acc;
}

/** Los bloques `fn({ ... })` de un archivo, con su línea. */
function llamadas(src: string, fn: string): Array<{ linea: number; bloque: string }> {
  const out: Array<{ linea: number; bloque: string }> = [];
  const re = new RegExp(`${fn}\\(\\{`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const i = m.index + m[0].length - 1;
    let d = 0;
    let j = i;
    for (; j < src.length; j++) {
      if (src[j] === "{") d++;
      else if (src[j] === "}" && --d === 0) break;
    }
    out.push({ linea: src.slice(0, m.index).split("\n").length, bloque: src.slice(i, j + 1) });
  }
  return out;
}

describe("los helpers de módulo pasan por un solo lugar", () => {
  const HELPERS = [
    "src/app/actions/orthodontics/_helpers.ts",
    "src/app/actions/orthodontics/cobro/_ctx.ts",
    "src/app/actions/pediatrics/_helpers.ts",
    "src/app/actions/periodontics/_helpers.ts",
    "src/app/actions/endodontics/_helpers.ts",
    "src/app/actions/implants/_helpers.ts",
    "src/lib/clinical-shared/auth/guard.ts",
  ];
  for (const h of HELPERS) {
    it(`${h} usa anotarFilaDeModulo y no escribe audit_logs por su cuenta`, () => {
      const s = leer(h);
      assert.match(s, /anotarFilaDeModulo\(/);
      assert.ok(!/prisma\.auditLog\.create\(/.test(s), "volvió a escribir auditLog.create directo: perdería patientId");
      assert.match(s, /patientId\?: string \| null/);
    });
  }
});

describe("ortodoncia: cada acción con paciente lleva patientId", () => {
  // Solo lo que NO es de un paciente: ajustes de la clínica, catálogo, política de cobro y un recálculo del sistema.
  const SIN_PACIENTE = [
    "catalogo/sembrarProcedimientosSugeridos.ts",
    "cobro/condicionesDelConvenio.ts",
    "cobro/guardarConfigDeCobro.ts",
    "guardarPreciosPorTecnica.ts",
    "guardarTecnicasDeLaClinica.ts",
    "recalculatePaymentStatus.ts",
    "updateOrthoClinicSettings.ts",
  ];
  const base = "src/app/actions/orthodontics/";
  const faltan: string[] = [];
  for (const f of archivos("src/app/actions/orthodontics")) {
    if (/_helpers\.ts$|_ctx\.ts$/.test(f)) continue;
    const rel = f.slice(base.length);
    const s = leer(f);
    for (const fn of ["auditOrtho", "auditarCobro"]) {
      for (const c of llamadas(s, fn)) {
        if (!/patientId/.test(c.bloque) && SIN_PACIENTE.indexOf(rel) === -1) faltan.push(`${rel}:${c.linea}`);
      }
    }
  }
  it("ninguna acción de ortodoncia con paciente deja fila sin patientId", () => {
    assert.deepEqual(faltan, []);
  });
  it("la lista de excepciones no tiene archivos que ya lo llevan (se mantiene honesta)", () => {
    for (const rel of SIN_PACIENTE) {
      const s = leer(base + rel);
      const conPaciente = ["auditOrtho", "auditarCobro"].some((fn) => llamadas(s, fn).some((c) => /patientId/.test(c.bloque)));
      assert.equal(conPaciente, false, `${rel} ya lleva patientId: quítalo de SIN_PACIENTE`);
    }
  });
});

describe("las escrituras de datos del paciente llaman al registro", () => {
  const CON_REGISTRO = [
    "src/app/api/appointments/[id]/status/route.ts",
    "src/app/api/appointments/[id]/check-in/route.ts",
    "src/app/api/booking-requests/[id]/route.ts",
    "src/app/api/patients/[id]/uploads/confirm/route.ts",
    "src/app/api/patients/[id]/models-3d/route.ts",
    "src/app/api/patients/[id]/models-3d/[fileId]/route.ts",
    "src/app/api/patients/[id]/dicom-set/register/route.ts",
    "src/app/api/xrays/route.ts",
    "src/app/api/orthodontics/imagen/upload/route.ts",
    "src/app/api/before-after/route.ts",
    "src/app/api/before-after/[id]/route.ts",
    "src/app/api/odontogram/note/route.ts",
    "src/app/api/clinical-notes/[id]/attach/route.ts",
    "src/app/api/packages/redeem/route.ts",
  ];
  for (const f of CON_REGISTRO) {
    it(`${f} llama a registrarMovimientoDelPaciente`, () => {
      assert.match(leer(f), /registrarMovimientoDelPaciente\(\{/);
    });
  }

  // Rutas que ya tenían bitácora: cada llamada lleva ahora su frase para «Movimientos».
  const CON_TEXTO = [
    "src/app/api/appointments/route.ts",
    "src/app/api/appointments/[id]/route.ts",
    "src/app/api/appointments/[id]/complete/route.ts",
    "src/app/api/appointment-change-requests/[id]/resolve/route.ts",
    "src/app/api/invoices/route.ts",
    "src/app/api/invoices/[id]/route.ts",
    "src/app/api/invoices/[id]/mark-paid/route.ts",
    "src/app/api/invoices/[id]/refund/route.ts",
    "src/app/api/invoices/[id]/cancel/route.ts",
    "src/app/api/invoices/[id]/confirm/route.ts",
    "src/app/api/invoices/[id]/edit-price/route.ts",
    "src/app/api/quotes/route.ts",
    "src/app/api/quotes/[id]/route.ts",
    "src/app/api/quotes/[id]/status/route.ts",
    "src/app/api/payment-plans/route.ts",
    "src/app/api/payment-plans/[id]/route.ts",
  ];
  for (const f of CON_TEXTO) {
    it(`${f}: cada logMutation/logAudit lleva texto`, () => {
      const s = leer(f);
      const todas = [...llamadas(s, "logMutation"), ...llamadas(s, "logAudit")];
      assert.ok(todas.length > 0, "ya no hay llamadas a la bitácora");
      const sin = todas.filter((c) => !/texto:/.test(c.bloque)).map((c) => c.linea);
      assert.deepEqual(sin, []);
    });
  }
});

describe("el modelo de Prisma NO declara patientId en AuditLog (sin el SQL rompería toda la bitácora)", () => {
  it("model AuditLog no tiene el campo", () => {
    const schema = leer("prisma/schema.prisma");
    const modelo = schema.slice(schema.indexOf("model AuditLog {"));
    const cuerpo = modelo.slice(0, modelo.indexOf("\n}\n"));
    assert.ok(!/^\s+patientId\s/m.test(cuerpo));
  });
  it("y existe el SQL, aditivo e idempotente", () => {
    const sql = leer("sql/audit-logs-patient-id.sql");
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "patientId"/);
    assert.match(sql, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
    assert.ok(!/\b(DROP|DELETE|UPDATE|TRUNCATE)\b\s+(TABLE|FROM|"?audit_logs)/i.test(sql.replace(/^--.*$/gm, "")));
  });
});
