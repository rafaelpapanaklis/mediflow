/**
 * Permisos que faltaban en 8 endpoints dentales (hallazgos 8, 22 y 23).
 *
 * Run: npm run test:endpoint-gates
 *
 * El fallo, en una línea: había endpoints que comprobaban SESIÓN pero no
 * PERMISO, así que el interruptor del modal de Permisos no protegía lo que el
 * dueño de la clínica creía. Tres formas del mismo agujero:
 *
 *   · Hallazgo 8  — GET /api/patients devolvía el padrón entero (nombre,
 *     teléfono, email, saldo) sin exigir "patients.view". El POST de al lado y
 *     todo /api/patients/[id] sí lo exigían: la pantalla redirigía, pero un
 *     fetch('/api/patients?v=2') desde la consola no.
 *   · Hallazgo 22 — presupuestos y órdenes de laboratorio EMITEN Y REESCRIBEN
 *     facturas sin pedir permiso de facturación. POST /api/quotes crea una
 *     factura en borrador y quema folio (la serie va por máximo emitido y no
 *     recicla); PATCH /api/quotes/[id] reescribe total, descuento, ítems y
 *     saldo de esa factura; POST /api/invoices/from-appointment crea una
 *     factura con solo comprobar sesión y clínica; y pagar o cancelar una
 *     orden de laboratorio no pedía nada.
 *   · Hallazgo 23 — /api/caja/current y /api/caja/history se leían con solo
 *     "billing.view", mientras open/close/withdrawal/pin exigen además
 *     canUseCaja. Un usuario con canAccessCaja=false se llevaba el turno
 *     completo por consola: paciente, concepto, monto, método, descuento y
 *     doctor por fila.
 *
 * Qué fija este archivo, en dos bloques que se vigilan distinto:
 *
 *   1 · CABLEADO (§1 y §2) — cada ruta exige la key que se decidió, y la exige
 *       ANTES de tocar nada. Es el bloque que estaba en rojo antes del arreglo:
 *       sin los gates, las nueve comprobaciones fallan.
 *   2 · CONSECUENCIA (§3 y §4) — la matriz rol × endpoint que resulta de esas
 *       keys. No basta con que el gate exista: tiene que dejar trabajar a quien
 *       ya trabajaba. Este bloque es el candado contra el fallo caro de
 *       endurecer permisos — que mañana una recepcionista no pueda facturar
 *       porque alguien recortó un default por rol.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { denyIfMissingPermission } from "../require-permission";
import { canUseCaja } from "../../caja-pin";
import { ROLE_DEFAULT_PERMISSIONS, type PermissionKey } from "../permissions";

const SRC_ROOT = join(__dirname, "..", "..", "..");            // src/

type Role = keyof typeof ROLE_DEFAULT_PERMISSIONS;
const ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "DOCTOR", "RECEPTIONIST", "READONLY"];

/** Usuario mínimo que entiende denyIfMissingPermission (rol + override). */
const u = (role: Role, permissionsOverride: string[] = []) =>
  ({ role: role as any, permissionsOverride });

/**
 * Los nueve gates de este lote. `firstEffect` es la primera llamada CON EFECTO
 * dentro del handler (leer la base, redirigir a otro handler, hablar con
 * MercadoPago): el gate tiene que estar antes que ella, porque un permiso que
 * se comprueba después de la consulta ya filtró la fila.
 */
const GATES: Array<{
  rel: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  key: PermissionKey;
  firstEffect: string;
  porque: string;
}> = [
  // Hallazgo 8
  { rel: "app/api/patients/route.ts", method: "GET", key: "patients.view",
    firstEffect: "legacyHandler(", porque: "el padrón entero con teléfono, email y saldo" },
  // Hallazgo 22 — presupuestos: el efecto real es facturar
  { rel: "app/api/quotes/route.ts", method: "POST", key: "billing.create",
    firstEffect: "prisma.", porque: "crea la factura en borrador y quema folio" },
  { rel: "app/api/quotes/[id]/route.ts", method: "PATCH", key: "billing.edit",
    firstEffect: "prisma.", porque: "reescribe total, descuento, ítems y saldo de la factura ligada" },
  { rel: "app/api/quotes/[id]/route.ts", method: "DELETE", key: "billing.edit",
    firstEffect: "prisma.", porque: "borra el presupuesto y deja viva su factura con folio quemado" },
  // Hallazgo 22 — factura desde la cita
  { rel: "app/api/invoices/from-appointment/route.ts", method: "POST", key: "billing.create",
    firstEffect: "prisma.", porque: "crea una Invoice igual que POST /api/invoices" },
  // Hallazgo 22 — laboratorio
  { rel: "app/api/ordenes-laboratorio/[orderId]/pay/route.ts", method: "POST", key: "suppliers.order",
    firstEffect: "prisma.", porque: "inicia un cobro real con MercadoPago" },
  { rel: "app/api/ordenes-laboratorio/[orderId]/route.ts", method: "PATCH", key: "suppliers.order",
    firstEffect: "prisma.", porque: "cancela la orden de forma irreversible" },
  // Los tres CABOS que quedaron de los lotes anteriores: las últimas puertas de
  // presupuestos que escribían con solo comprobar sesión.
  { rel: "app/api/quotes/[id]/duplicate/route.ts", method: "POST", key: "billing.create",
    firstEffect: "prisma.", porque: "clona el presupuesto y quema un folio nuevo, igual que POST /api/quotes" },
  { rel: "app/api/quotes/[id]/treatment-plan/route.ts", method: "POST", key: "treatments.edit",
    firstEffect: "prisma.", porque: "crea el plan de tratamiento ACTIVE del paciente" },
  { rel: "app/api/quotes/[id]/send-whatsapp/route.ts", method: "POST", key: "billing.edit",
    firstEffect: "prisma.", porque: "presenta el DRAFT (presentQuote) antes de mandar la liga: la cuarta puerta a presentar" },
  // Hallazgo 23 — caja
  { rel: "app/api/caja/current/route.ts", method: "GET", key: "billing.view",
    firstEffect: "getCajaState(", porque: "el turno completo, fila por fila" },
  { rel: "app/api/caja/history/route.ts", method: "GET", key: "billing.view",
    firstEffect: "getCajaHistory(", porque: "los cortes cerrados anteriores" },
];

/**
 * Cuerpo de un handler exportado: desde su `export async function <METHOD>(`
 * hasta el siguiente `export ` (o el final del archivo). Recortar importa: sin
 * esto, el gate del POST daría por bueno al GET del mismo archivo.
 */
function handlerBody(text: string, method: string): string {
  const start = text.indexOf(`export async function ${method}(`);
  assert.notEqual(start, -1, `no existe el handler ${method}`);
  const rest = text.slice(start + 1);
  const end = rest.indexOf("\nexport ");
  return end === -1 ? rest : rest.slice(0, end);
}

const fileOf = (rel: string) => readFileSync(join(SRC_ROOT, ...rel.split("/")), "utf8");

// ─────────────────────────────────────────────────────────────────────
// 1 · Cada ruta exige su key, y la exige antes de tocar nada
// ─────────────────────────────────────────────────────────────────────

for (const g of GATES) {
  test(`${g.method} /${g.rel.replace(/^app\/api/, "api").replace(/\/route\.ts$/, "")} exige "${g.key}" antes de ${g.firstEffect} (${g.porque})`, () => {
    const body = handlerBody(fileOf(g.rel), g.method);

    const gateRe = new RegExp(
      `denyIfMissingPermission\\([^)]*["']${g.key.replace(".", "\\.")}["']`,
    );
    const gate = body.search(gateRe);
    assert.notEqual(
      gate,
      -1,
      `${g.rel} · ${g.method} no exige "${g.key}": expone ${g.porque}`,
    );

    const efecto = body.indexOf(g.firstEffect);
    assert.notEqual(efecto, -1, `no encuentro "${g.firstEffect}" en ${g.rel} · ${g.method}`);
    assert.ok(
      gate < efecto,
      `${g.rel} · ${g.method} comprueba "${g.key}" DESPUÉS de ${g.firstEffect}: el permiso llega tarde`,
    );
  });
}

// ─────────────────────────────────────────────────────────────────────
// 2 · Caja: leer el turno exige lo mismo que operarlo (hallazgo 23)
// ─────────────────────────────────────────────────────────────────────

for (const [rel, method, efecto] of [
  ["app/api/caja/current/route.ts", "GET", "getCajaState("],
  ["app/api/caja/history/route.ts", "GET", "getCajaHistory("],
] as const) {
  test(`${rel} llama canUseCaja antes de ${efecto}, como open/close/withdrawal/pin`, () => {
    const body = handlerBody(fileOf(rel), method);
    const gate = body.indexOf("canUseCaja(");
    assert.notEqual(
      gate,
      -1,
      `${rel} no comprueba canUseCaja: un usuario con canAccessCaja=false lee la Caja por consola`,
    );
    assert.ok(body.includes("CAJA_NO_ACCESS"), `${rel} no devuelve el código CAJA_NO_ACCESS de sus hermanas`);
    assert.ok(gate < body.indexOf(efecto), `${rel} comprueba canUseCaja después de leer la caja`);
  });
}

// ─────────────────────────────────────────────────────────────────────
// 3 · La consecuencia: quién sigue pudiendo, quién deja de poder
//
// Esta es la tabla que se aprueba antes de integrar. Si alguien recorta un
// default por rol, aquí se entera — no en producción con la recepcionista
// delante del paciente.
// ─────────────────────────────────────────────────────────────────────

const ESPERADO: Record<string, Record<Role, boolean>> = {
  // Hallazgo 8 — nadie pierde el padrón: los cinco roles traen patients.view.
  "patients.view":   { SUPER_ADMIN: true, ADMIN: true, DOCTOR: true,  RECEPTIONIST: true,  READONLY: true  },
  // Hallazgo 22 — facturar. READONLY deja de emitir.
  //
  // DOCTOR: true desde que se le devolvieron las billing.* de cotizar. Cuando
  // se pusieron estos gates, el doctor se quedó con los botones a la vista y un
  // 403 al pulsarlos ("Crear presupuesto" al cerrar la consulta, y presentar /
  // aceptar / generar factura en la pestaña Presupuestos): el agujero se tapó
  // bien y la que estaba mal era la fila del rol. Cobrar y reembolsar siguen
  // siendo NO — presupuestar no es tocar el dinero.
  "billing.create":  { SUPER_ADMIN: true, ADMIN: true, DOCTOR: true,  RECEPTIONIST: true,  READONLY: false },
  "billing.edit":    { SUPER_ADMIN: true, ADMIN: true, DOCTOR: true,  RECEPTIONIST: true,  READONLY: false },
  // Hallazgo 22 — laboratorio. Misma key que YA exige el alta de la orden en
  // /api/dental-labs/[labId]/ordenes: quien no puede pedir tampoco paga ni
  // cancela, así que nadie que hoy pueda crear una orden pierde nada.
  "suppliers.order": { SUPER_ADMIN: true, ADMIN: true, DOCTOR: false, RECEPTIONIST: false, READONLY: false },
  // Hallazgo 23 — lo que cierra la Caja NO es esta key, es canUseCaja (bandera
  // por usuario): que el doctor pase billing.view no le abre el turno.
  "billing.view":    { SUPER_ADMIN: true, ADMIN: true, DOCTOR: true,  RECEPTIONIST: true,  READONLY: true  },
  // Los cabos: el plan de tratamiento lo abren doctor y recepción, que son
  // quienes lo ejecutan; READONLY no escribe.
  "treatments.edit": { SUPER_ADMIN: true, ADMIN: true, DOCTOR: true,  RECEPTIONIST: true,  READONLY: false },
};

for (const [key, esperado] of Object.entries(ESPERADO)) {
  for (const role of ROLES) {
    test(`por default, ${role} ${esperado[role] ? "SÍ" : "NO"} pasa el gate "${key}"`, () => {
      const denied = denyIfMissingPermission(u(role), key as PermissionKey);
      if (esperado[role]) {
        assert.equal(denied, null, `${role} perdió "${key}": alguien recortó su default y se queda sin trabajar`);
      } else {
        assert.equal(denied?.status, 403, `${role} pasa "${key}" sin tenerlo`);
      }
    });
  }
}

test('el interruptor "Facturación" del modal por fin apaga los presupuestos', () => {
  // El caso exacto del hallazgo 22: el dueño destilda Facturación a una
  // recepcionista. Override LLENO = reemplaza al default (no se mergea), así
  // que basta con listar lo que le deja encendido.
  const sinFacturacion = u("RECEPTIONIST", [
    "today.view", "agenda.view", "agenda.create", "agenda.edit", "agenda.delete",
    "patients.view", "patients.create", "patients.edit",
    "treatments.view", "treatments.edit", "inbox.view", "inbox.send",
  ]);

  // Antes: creaba presupuestos y cada uno paría una factura con folio quemado.
  assert.equal(denyIfMissingPermission(sinFacturacion, "billing.create")?.status, 403);
  assert.equal(denyIfMissingPermission(sinFacturacion, "billing.edit")?.status, 403);
  // Y sigue haciendo su trabajo de agenda y ficha, que es lo que NO se tocó.
  assert.equal(denyIfMissingPermission(sinFacturacion, "agenda.create"), null);
  assert.equal(denyIfMissingPermission(sinFacturacion, "patients.view"), null);
});

// ─────────────────────────────────────────────────────────────────────
// 4 · Caja: el permiso de Caja es del USUARIO, no del rol (hallazgo 23)
// ─────────────────────────────────────────────────────────────────────

test("canUseCaja: billing.view no alcanza para leer la Caja", () => {
  // Los dos que hoy se llevaban el turno por consola: pasan billing.view por
  // default y no tienen canAccessCaja.
  for (const role of ["READONLY", "RECEPTIONIST"] as const) {
    assert.equal(denyIfMissingPermission(u(role), "billing.view"), null, `${role} pasa billing.view`);
    assert.equal(canUseCaja({ role, canAccessCaja: false }), false, `${role} sin canAccessCaja NO opera la Caja`);
  }
  // Habilitada por el admin, entra.
  assert.equal(canUseCaja({ role: "RECEPTIONIST", canAccessCaja: true }), true);
  // El dueño no depende de la bandera.
  assert.equal(canUseCaja({ role: "SUPER_ADMIN", canAccessCaja: false }), true);
  // Y un ctx.user ausente no abre la caja por descuido.
  assert.equal(canUseCaja(null), false);
  assert.equal(canUseCaja(undefined), false);
});
