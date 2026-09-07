/**
 * Los permisos que quedaron fuera del lote del PR #190 (hallazgos 44, 45 y 46).
 *
 * Run: npm run test:endpoint-gates-resto
 *
 * El PR #190 cerró ocho endpoints y dejó escrito, en su propio cuerpo, que la
 * cadena presupuesto→factura seguía abierta por tres rutas que no estaban en su
 * lista de archivos. Estas son esas tres, más tres módulos enteros que escribían
 * sin pedir nada y una escritura cruzada de tenant:
 *
 *   · Presupuestos — POST /api/quotes/[id]/invoice EMITE una factura real con
 *     folio de la serie de la clínica (nextInvoiceNumber va por MÁXIMO emitido y
 *     no recicla, ni anulando): cualquiera con sesión facturaba el importe que
 *     quisiera. Sus dos hermanas —from-appointment, que crea el presupuesto por
 *     la otra puerta, y [id]/status, que lo presenta/acepta/rechaza— tampoco
 *     pedían nada, así que el interruptor "Facturación" del modal cerraba una
 *     puerta y dejaba las otras tres abiertas.
 *   · Hallazgo 44 — tres módulos con CERO denyIfMissingPermission:
 *     /api/payment-plans (4 handlers: un READONLY marcaba una cuota como
 *     cobrada o cancelaba el plan), DELETE /api/before-after/[id] (un READONLY
 *     borraba fotos clínicas de antes/después: destrucción de evidencia) y
 *     PATCH /api/orthotics/[id] (además sin assertPatientVisible, cuando el GET
 *     y el POST del mismo módulo sí lo tienen).
 *   · Hallazgo 46 — PATCH /api/waitlist/[id] aceptaba un preferredDoctorId sin
 *     comprobar que el doctor fuera de la clínica; su POST hermano sí lo hace y
 *     devuelve 404.
 *
 * Qué fija este archivo, en cuatro bloques que se vigilan distinto:
 *
 *   1 · CABLEADO (§1) — cada ruta exige la key que se decidió, y la exige ANTES
 *       de tocar la base. Es el bloque que está en rojo con el código de main.
 *   2 · VISIBILIDAD (§2) — las dos escrituras que además se colaban sobre un
 *       paciente restringido comprueban assertPatientVisible antes de escribir.
 *   3 · TENANT (§3) — el PATCH de la lista de espera valida el doctor contra su
 *       clínica, con la misma forma que el POST hermano, antes de guardarlo.
 *   4 · CONSECUENCIA (§4) — la matriz rol × key que resulta de estas
 *       decisiones. No basta con que el gate exista: tiene que dejar trabajar a
 *       quien ya trabajaba. Este bloque es el candado contra el fallo caro de
 *       endurecer permisos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { denyIfMissingPermission } from "../require-permission";
import { ROLE_DEFAULT_PERMISSIONS, type PermissionKey } from "../permissions";

const SRC_ROOT = join(__dirname, "..", "..", "..");            // src/

type Role = keyof typeof ROLE_DEFAULT_PERMISSIONS;
const ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "DOCTOR", "RECEPTIONIST", "READONLY"];

/** Usuario mínimo que entiende denyIfMissingPermission (rol + override). */
const u = (role: Role, permissionsOverride: string[] = []) =>
  ({ role: role as any, permissionsOverride });

/**
 * Los nueve gates de este lote. `firstEffect` es la primera llamada CON EFECTO
 * dentro del handler: el gate tiene que estar antes que ella, porque un permiso
 * que se comprueba después de la consulta ya leyó o ya escribió la fila.
 */
const GATES: Array<{
  rel: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  key: PermissionKey;
  firstEffect: string;
  porque: string;
}> = [
  // Presupuestos: las tres puertas que el PR #190 dejó señaladas.
  { rel: "app/api/quotes/[id]/invoice/route.ts", method: "POST", key: "billing.create",
    firstEffect: "prisma.", porque: "emite una factura real y quema folio de la serie" },
  { rel: "app/api/quotes/from-appointment/route.ts", method: "POST", key: "billing.create",
    firstEffect: "prisma.", porque: "crea el presupuesto por la puerta del odontograma" },
  { rel: "app/api/quotes/[id]/status/route.ts", method: "POST", key: "billing.edit",
    firstEffect: "prisma.", porque: "presenta, acepta o rechaza el presupuesto" },
  // Hallazgo 44 — planes de pago: dinero del paciente, cuota a cuota.
  { rel: "app/api/payment-plans/route.ts", method: "GET", key: "billing.view",
    firstEffect: "prisma.", porque: "lista total, enganche y saldo por cobrar" },
  { rel: "app/api/payment-plans/route.ts", method: "POST", key: "billing.charge",
    firstEffect: "prisma.", porque: "arma el calendario de cuotas de la clínica" },
  { rel: "app/api/payment-plans/[id]/route.ts", method: "PATCH", key: "billing.charge",
    firstEffect: "prisma.", porque: "marca una cuota como COBRADA" },
  { rel: "app/api/payment-plans/[id]/route.ts", method: "DELETE", key: "billing.charge",
    firstEffect: "prisma.", porque: "cancela el plan y deja de cobrarse el resto" },
  // Hallazgo 44 — imagen clínica y pipeline de ortesis.
  { rel: "app/api/before-after/[id]/route.ts", method: "DELETE", key: "medicalRecord.edit",
    firstEffect: "prisma.", porque: "borra imagen clínica del paciente" },
  { rel: "app/api/orthotics/[id]/route.ts", method: "PATCH", key: "treatments.edit",
    firstEffect: "prisma.", porque: "avanza la ortesis de etapa" },
];

/**
 * Cuerpo de un handler exportado: desde su `export async function <METHOD>(`
 * hasta el siguiente `export ` (o el final del archivo). Recortar importa: sin
 * esto, el gate del PATCH daría por bueno al DELETE del mismo archivo.
 */
function handlerBody(text: string, method: string): string {
  const start = text.indexOf(`export async function ${method}(`);
  assert.notEqual(start, -1, `no existe el handler ${method}`);
  const rest = text.slice(start + 1);
  const end = rest.indexOf("\nexport ");
  return end === -1 ? rest : rest.slice(0, end);
}

const fileOf = (rel: string) => readFileSync(join(SRC_ROOT, ...rel.split("/")), "utf8");

const nice = (rel: string) => rel.replace(/^app\/api/, "api").replace(/\/route\.ts$/, "");

// ─────────────────────────────────────────────────────────────────────
// 1 · Cada ruta exige su key, y la exige antes de tocar la base
// ─────────────────────────────────────────────────────────────────────

for (const g of GATES) {
  test(`${g.method} /${nice(g.rel)} exige "${g.key}" antes de ${g.firstEffect} (${g.porque})`, () => {
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
// 2 · Las dos escrituras que además se colaban sobre un paciente restringido
//
// En los dos módulos el GET y el POST hermanos YA comprueban visibilidad; era
// la escritura por id la que no. Un permiso no sustituye a esto: un DOCTOR con
// treatments.edit tiene el permiso y aun así no puede ver a ese paciente.
// ─────────────────────────────────────────────────────────────────────

for (const [rel, method, escritura] of [
  ["app/api/before-after/[id]/route.ts", "DELETE", "prisma.beforeAfterPhoto.deleteMany("],
  ["app/api/orthotics/[id]/route.ts", "PATCH", "prisma.formulaRecord.update("],
] as const) {
  test(`${method} /${nice(rel)} comprueba assertPatientVisible antes de ${escritura}`, () => {
    const body = handlerBody(fileOf(rel), method);
    const vis = body.indexOf("assertPatientVisible(");
    assert.notEqual(
      vis,
      -1,
      `${rel} · ${method} no comprueba visibilidad: escribe sobre el paciente restringido que sus hermanas sí protegen`,
    );
    const write = body.indexOf(escritura);
    assert.notEqual(write, -1, `no encuentro "${escritura}" en ${rel} · ${method}`);
    assert.ok(vis < write, `${rel} · ${method} comprueba visibilidad DESPUÉS de escribir`);
  });
}

// ─────────────────────────────────────────────────────────────────────
// 3 · Hallazgo 46 — el doctor preferido tiene que ser de ESTA clínica
//
// El POST de waitlist/route.ts ya lo valida (clinicId de la sesión + rol
// DOCTOR, 404 si no). El PATCH guardaba el UUID tal cual, así que una entrada
// de la lista de espera podía quedar apuntando a un doctor de otra clínica —
// y el GET de /waitlist filtra por preferredDoctorId cuando quien mira es un
// DOCTOR. Este test compara las dos puertas: la misma validación, en las dos.
// ─────────────────────────────────────────────────────────────────────

test("PATCH /api/waitlist/[id] valida el doctor contra la clínica de la sesión, como su POST hermano", () => {
  const patch = handlerBody(fileOf("app/api/waitlist/[id]/route.ts"), "PATCH");

  const lookup = patch.indexOf("prisma.user.findFirst(");
  assert.notEqual(
    lookup,
    -1,
    "PATCH /api/waitlist/[id] no busca al doctor: acepta el UUID de otra clínica tal cual (escritura cruzada de tenant)",
  );

  // El where tiene que llevar las DOS condiciones del hermano: tenant y rol.
  const where = patch.slice(lookup, lookup + 400);
  assert.ok(
    /clinicId:\s*session\.clinic\.id/.test(where),
    "el findFirst del doctor no filtra por session.clinic.id: no está aislado por tenant",
  );
  assert.ok(
    /role:\s*["']DOCTOR["']/.test(where),
    "el findFirst del doctor no exige role DOCTOR, como sí hace el POST hermano",
  );

  // Y tiene que cortar ANTES de guardar, con el mismo 404 del hermano.
  const update = patch.indexOf("prisma.waitlistEntry.update(");
  assert.notEqual(update, -1, "no encuentro el update del PATCH");
  assert.ok(lookup < update, "el PATCH valida el doctor DESPUÉS de guardarlo");
  assert.ok(
    patch.includes("doctor_not_found"),
    'el PATCH no devuelve "doctor_not_found", el mismo código del POST hermano',
  );

  // El hermano, como referencia viva: si alguien le cambia la forma, se ve aquí.
  const post = handlerBody(fileOf("app/api/waitlist/route.ts"), "POST");
  assert.ok(post.includes("doctor_not_found"), "el POST hermano ya no valida el doctor: revisa los dos juntos");
});

test("PATCH /api/waitlist/[id] sigue admitiendo BORRAR el doctor preferido (null)", () => {
  // La validación va dentro de `if (parsed.data.preferredDoctorId)`, no de
  // `!== undefined`: mandar null limpia el campo y NO puede dar 404, porque
  // "sin doctor preferido" es un estado legítimo de la lista de espera.
  const patch = handlerBody(fileOf("app/api/waitlist/[id]/route.ts"), "PATCH");
  const guard = patch.indexOf("if (parsed.data.preferredDoctorId) {");
  const lookup = patch.indexOf("prisma.user.findFirst(");
  assert.notEqual(guard, -1, "la validación del doctor no está detrás de un guard truthy: un null daría 404");
  assert.ok(guard < lookup, "el guard truthy tiene que envolver al findFirst");
});

// ─────────────────────────────────────────────────────────────────────
// 4 · La consecuencia: quién sigue pudiendo, quién deja de poder
//
// Esta es la tabla que se aprueba antes de integrar. Si alguien recorta un
// default por rol, aquí se entera — no en producción con el paciente delante.
// ─────────────────────────────────────────────────────────────────────

const ESPERADO: Record<string, Record<Role, boolean>> = {
  // Presupuestos y planes de pago van con las keys de Facturación, igual que el
  // PR #190: RECEPTIONIST las tiene todas y no pierde nada. DOCTOR no tiene
  // ninguna billing.* por default — ES la pérdida de este lote, y está en el
  // punto 4 del reporte.
  "billing.view":       { SUPER_ADMIN: true, ADMIN: true, DOCTOR: false, RECEPTIONIST: true,  READONLY: true  },
  "billing.create":     { SUPER_ADMIN: true, ADMIN: true, DOCTOR: false, RECEPTIONIST: true,  READONLY: false },
  "billing.edit":       { SUPER_ADMIN: true, ADMIN: true, DOCTOR: false, RECEPTIONIST: true,  READONLY: false },
  "billing.charge":     { SUPER_ADMIN: true, ADMIN: true, DOCTOR: false, RECEPTIONIST: true,  READONLY: false },
  // Borrar imagen clínica: la doctrina del catálogo (nota de medicalRecord.edit)
  // dice que este borrado NO se le regala a recepción.
  "medicalRecord.edit": { SUPER_ADMIN: true, ADMIN: true, DOCTOR: true,  RECEPTIONIST: false, READONLY: false },
  // Ortesis: la key que deja trabajar a doctor Y recepción, y solo cierra al
  // READONLY, que es el hallazgo.
  "treatments.edit":    { SUPER_ADMIN: true, ADMIN: true, DOCTOR: true,  RECEPTIONIST: true,  READONLY: false },
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

test("READONLY deja de escribir en los tres módulos del hallazgo 44", () => {
  // El caso literal del hallazgo: un READONLY marcaba una cuota como cobrada,
  // cancelaba el plan, borraba fotos de antes/después y movía una ortesis.
  const readonly = u("READONLY");
  for (const key of ["billing.charge", "medicalRecord.edit", "treatments.edit"] as const) {
    assert.equal(
      denyIfMissingPermission(readonly, key)?.status,
      403,
      `READONLY todavía pasa "${key}": sigue escribiendo con solo tener sesión`,
    );
  }
  // Y sigue leyendo lo que un rol de solo lectura debe leer.
  assert.equal(denyIfMissingPermission(readonly, "billing.view"), null, "READONLY perdió la lectura de facturación");
});

test('el interruptor "Facturación" del modal apaga también estas cuatro puertas', () => {
  // Mismo caso que fija el PR #190, extendido a este lote: el dueño destilda
  // Facturación a una recepcionista. Override LLENO = reemplaza al default.
  const sinFacturacion = u("RECEPTIONIST", [
    "today.view", "agenda.view", "agenda.create", "agenda.edit", "agenda.delete",
    "patients.view", "patients.create", "patients.edit",
    "treatments.view", "treatments.edit", "inbox.view", "inbox.send",
  ]);

  // Ya no factura desde un presupuesto, ni lo crea, ni lo acepta, ni cobra cuotas.
  for (const key of ["billing.create", "billing.edit", "billing.charge", "billing.view"] as const) {
    assert.equal(denyIfMissingPermission(sinFacturacion, key)?.status, 403, `${key} sigue abierta`);
  }
  // Y sigue haciendo su trabajo de agenda, ficha y ortesis, que es lo que NO se tocó.
  assert.equal(denyIfMissingPermission(sinFacturacion, "agenda.create"), null);
  assert.equal(denyIfMissingPermission(sinFacturacion, "treatments.edit"), null);
});
