/**
 * DOBLE TIMBRADO (N2) y FACTURAS TIMBRADAS QUE CAMBIAN SIN TOCAR EL SAT (N3).
 *
 * Run: npm run test:cfdi-candado
 *
 *   N2 · POST /api/cfdi revisaba `cfdiUuid`, timbraba y escribía sin candado:
 *        dos pestañas a la vez daban DOS CFDI vigentes y dos timbres cobrados.
 *        Y si la escritura fallaba DESPUÉS de timbrar, el UUID se perdía y el
 *        reintento timbraba otro.
 *   N3 · cancelar, anular (DELETE), reembolsar y editar precio no miraban
 *        `cfdiUuid`: la factura cambiaba y el CFDI seguía vigente ante el SAT
 *        por el importe original.
 *
 * Cómo prueba: ejercita los HANDLERS REALES con `mock.module` (de ahí el flag
 * `--experimental-test-module-mocks`). El doble de Prisma hace dos cosas que
 * importan aquí y que un doble ingenuo no haría:
 *   · respeta TODAS las claves del `where` (`cfdiUuid: null`, `status.notIn`,
 *     `total`), igual que el UPDATE … WHERE de Postgres, que es atómico, y
 *     revienta ante una condición que no sabe evaluar en vez de darla por buena;
 *   · las operaciones son perezosas, como las de Prisma: una `$transaction`
 *     que falla no deja escrito NADA de lo que traía.
 * Facturapi es un doble que tarda unos milisegundos en timbrar, para que dos
 * peticiones simultáneas se crucen de verdad.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CLAVES_SAT_MEDICOS, UNIDAD_SAT, FORMAS_PAGO_SAT } from "@/lib/cfdi-catalogs";
import { marcarTimbre } from "@/lib/invoices/cfdi-timbre-incierto";

// ── Estado del doble de Prisma ──────────────────────────────────────────────
const db = {
  invoice: null as any,
  payments: [] as any[],
  cfdiRecords: [] as any[],
  usage: 0,
  /** La base no contesta: toda operación revienta. */
  caida: false,
  /** La próxima `$transaction` de arreglo revienta sin escribir nada. */
  txFalla: false,
  /** Se ejecuta una vez justo después de la próxima lectura de la factura. */
  trasLeer: null as null | (() => void),
};

function vivo() {
  if (db.caida) throw new Error("Can't reach database server");
}

/** Como una PrismaPromise: no hace nada hasta que alguien la espera. */
function perezosa<T>(run: () => T): any {
  let p: Promise<T> | null = null;
  const go = () => (p ??= Promise.resolve().then(() => { vivo(); return run(); }));
  return {
    _go: go,
    then: (a: any, b: any) => go().then(a, b),
    catch: (b: any) => go().catch(b),
    finally: (f: any) => go().finally(f),
  };
}

/** ¿La fila cumple el `where`? Todas las claves, como Postgres. */
function cumple(row: any, where: any): boolean {
  if (!row) return false;
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      const cond = v as any;
      const ops = Object.keys(cond);
      if (ops.some((op) => op !== "notIn" && op !== "lte")) throw new Error(`el doble no sabe evaluar ${k}: ${ops.join(",")}`);
      if (cond.notIn !== undefined && cond.notIn.includes(row[k])) return false;
      // `paid: { lte: 0 }` de /cancel y del DELETE: no se cancela con dinero dentro.
      if (cond.lte !== undefined && !(row[k] <= cond.lte)) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function aplicar(target: any, data: any) {
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v !== undefined) target[k] = v;
  }
}

const invoiceDelegate = {
  findFirst: ({ where }: any = {}) => perezosa(() => {
    if (!cumple(db.invoice, where)) return null;
    const copia = {
      ...db.invoice,
      patient: { firstName: "Ana", lastName: "Pérez", email: null },
      payments: [...db.payments],
    };
    const hook = db.trasLeer;
    db.trasLeer = null;
    hook?.();
    return copia;
  }),
  updateMany: ({ where, data }: any) => perezosa(() => {
    if (!cumple(db.invoice, where)) return { count: 0 };
    aplicar(db.invoice, data);
    return { count: 1 };
  }),
  update: ({ where, data }: any) => perezosa(() => {
    if (!cumple(db.invoice, where)) throw new Error("P2025: Record to update not found.");
    aplicar(db.invoice, data);
    return { ...db.invoice };
  }),
  deleteMany: ({ where }: any) => perezosa(() => {
    if (!cumple(db.invoice, where)) return { count: 0 };
    db.invoice = null;
    return { count: 1 };
  }),
};

const prismaStub: any = {
  $transaction: async (arg: any) => {
    vivo();
    if (typeof arg === "function") return arg(prismaStub);
    if (db.txFalla) {
      db.txFalla = false;
      throw new Error("Transaction API error: Unable to start a transaction in the given time.");
    }
    const out: any[] = [];
    for (const op of arg) out.push(await op._go());
    return out;
  },
  // El reembolso toma el candado de fila (`SELECT … FOR UPDATE`) dentro de su
  // transacción (N1, #311). Aquí no hay concurrencia de candados que simular:
  // basta con que la consulta exista.
  $queryRaw: () => perezosa(() => []),
  clinic: {
    findUnique: () => perezosa(() => ({
      facturApiOrgId: "org_1", facturApiEnabled: true, name: "Clínica", rfcEmisor: "AAA010101AAA",
      plan: "pro", timezone: "America/Mexico_City", cfdiTaxMode: "exempt", csdUploaded: true,
    })),
  },
  invoice: invoiceDelegate,
  payment: {
    create: ({ data }: any) => perezosa(() => {
      const row = { id: `pay${db.payments.length + 1}`, ...data };
      db.payments.push(row);
      return row;
    }),
  },
  cfdiRecord: {
    create: ({ data }: any) => perezosa(() => {
      const row = { id: `cfdi${db.cfdiRecords.length + 1}`, ...data };
      db.cfdiRecords.push(row);
      return row;
    }),
  },
  cfdiUsage: {
    upsert: () => perezosa(() => ({ stamped: ++db.usage })),
  },
  cashRegister: { findFirst: () => perezosa(() => null) },
};

// ── Doble de Facturapi ──────────────────────────────────────────────────────
const pac = {
  timbres: 0,
  /** Si trae texto, el timbrado lo rechaza con ese mensaje. */
  rechazo: null as string | null,
  efos: false,
  /** Se ejecuta justo después de timbrar, antes de devolver el resultado. */
  alTimbrar: null as null | (() => void),
  /**
   * El timbre SALE y la respuesta se pierde (H-8). El contador de timbres sube
   * —el CFDI ya existe ante el SAT— y acto seguido revienta como revienta
   * `fetch` de verdad cuando se corta la red: TypeError("fetch failed").
   * A propósito SIN marcar el error: así la prueba mide lo que hace la ruta
   * ante un error crudo, no lo que le dijimos que hiciera.
   */
  respuestaPerdida: false,
  /** Facturapi contesta 200 pero sin `uuid` legible. */
  sinUuid: false,
  /** Error MARCADO como incierto cuyo texto suena a rechazo (5xx de Facturapi). */
  rechazoMarcadoIncierto: null as string | null,
};

(mock as any).module("@/lib/facturapi", {
  namedExports: {
    getOrgApiKey: async () => "sk_test",
    getOrganizationStatus: async () => ({ exists: true, isProductionReady: true, pendingSteps: [] }),
    validateRfc: async () => ({ ok: !pac.efos }),
    createOrUpdateCustomer: async () => {
      // Falla de red ANTES de apartar la factura y de pedir el timbre.
      if (fallaCliente) throw new TypeError("fetch failed");
      return "cus_1";
    },
    createInvoice: async (args: any) => {
      await new Promise((r) => setTimeout(r, 15));
      if (pac.rechazo) throw new Error(pac.rechazo);
      pac.timbres += 1;
      const n = pac.timbres;
      pac.alTimbrar?.();
      if (pac.respuestaPerdida) throw new TypeError("fetch failed");
      if (pac.rechazoMarcadoIncierto) {
        throw marcarTimbre(new Error(pac.rechazoMarcadoIncierto), true);
      }
      // El createInvoice de verdad solo lanza si quien llama pasa `exigirUuid`.
      if (pac.sinUuid) {
        if (!args?.exigirUuid) return { id: `fapi_${n}`, total: 1000 } as any;
        throw marcarTimbre(
          new Error("Facturapi aceptó el timbrado pero la respuesta llegó sin UUID."),
          true,
        );
      }
      return { id: `fapi_${n}`, uuid: `UUID-${n}`, total: 1000, xml_url: `x${n}`, pdf_url: `p${n}` };
    },
    CLAVES_SAT_MEDICOS, UNIDAD_SAT, FORMAS_PAGO_SAT,
  },
});
/** La llamada a Facturapi PREVIA al timbrado se corta por red. */
let fallaCliente = false;
/** FACTURAPI_ENV=live (timbra ante el SAT) o pruebas. */
const entorno = { live: true };
(mock as any).module("@/lib/facturapi-env", { namedExports: { isFacturapiLive: () => entorno.live } });
(mock as any).module("@/lib/plans", {
  namedExports: { getResolvedPlan: async () => ({ cfdiMonthly: 100, cfdiOverageCents: 0 }) },
});
(mock as any).module("@/lib/rate-limit", { namedExports: { rateLimit: () => null } });

// ── Sesión, visibilidad, caché y auditoría ─────────────────────────────────
const authCtx: any = {
  clinicId: "c1", userId: "u1", role: "ADMIN", isAdmin: true, isSuperAdmin: false, permissionsOverride: null,
};
/** Si trae promesa, la visibilidad del paciente espera a que se resuelva. */
const vis = { espera: null as Promise<void> | null };

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () => authCtx,
    requireAdmin: (ctx: any) => (ctx?.isAdmin ? null : new Response(null, { status: 403 })),
  },
});
(mock as any).module("@/lib/patient-visibility", {
  namedExports: {
    assertPatientVisible: async () => { if (vis.espera) await vis.espera; return null; },
    relatedPatientVisibilityAnd: () => [],
  },
});
(mock as any).module("next/cache", { namedExports: { revalidatePath: () => {}, revalidateTag: () => {} } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
(mock as any).module("@/lib/stripe", { namedExports: { getStripeSafe: () => null } });

// ── Utilidades ──────────────────────────────────────────────────────────────
function req(body?: any): any {
  return { json: async () => (body ?? {}), headers: new Headers(), url: "http://localhost/api/x" };
}
const P = { params: { id: "inv1" } };

const TIMBRAR = {
  invoiceId: "inv1",
  receptor: { rfc: "XAXX010101000", nombre: "PUBLICO EN GENERAL", regimenFiscal: "616", cp: "06000" },
  usoCfdi: "S01",
  paymentForm: "03",
  taxMode: "exento",
  confirmUnpaidPue: true,
};

/** Factura de $1,000 exenta con un concepto. */
function setInvoice(inv: Record<string, any> = {}) {
  db.invoice = {
    id: "inv1", clinicId: "c1", patientId: "p1", invoiceNumber: "MF-0042",
    status: "PENDING", items: [{ description: "Corona", quantity: 1, unitPrice: 1000, total: 1000 }],
    subtotal: 1000, discount: 0, total: 1000, paid: 0, balance: 1000,
    taxRate: 0, taxIncluded: true, notes: null, paidAt: null, paymentMethod: null, cfdiUuid: null,
    ...inv,
  };
}

async function leer(res: any) {
  return { status: res.status, body: await res.json() };
}

/** Silencia los console.error/warn de las rutas: los fallos son parte de la prueba. */
async function quieto<T>(fn: () => Promise<T>): Promise<T> {
  const [e, w] = [console.error, console.warn];
  console.error = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { console.error = e; console.warn = w; }
}

beforeEach(() => {
  setInvoice();
  db.payments = [];
  db.cfdiRecords = [];
  db.usage = 0;
  db.caida = false;
  db.txFalla = false;
  db.trasLeer = null;
  pac.timbres = 0;
  pac.rechazo = null;
  pac.efos = false;
  pac.alTimbrar = null;
  pac.respuestaPerdida = false;
  pac.sinUuid = false;
  pac.rechazoMarcadoIncierto = null;
  fallaCliente = false;
  vis.espera = null;
  entorno.live = true;
});

// ═══════════════════════════════════════════════════════════════════════════
// N2 — una factura, un timbre
// ═══════════════════════════════════════════════════════════════════════════

test("N2 · dos pestañas timbran a la vez la misma factura: timbra UNA y la otra se rechaza", async () => {
  const { POST } = await import("@/app/api/cfdi/route");

  const [a, b] = await quieto(() => Promise.all([POST(req(TIMBRAR)), POST(req(TIMBRAR))]));
  const r = [await leer(a), await leer(b)].sort((x, y) => x.status - y.status);

  assert.equal(pac.timbres, 1, "Facturapi tiene que timbrar UNA sola vez");
  assert.equal(r[0].status, 200);
  assert.equal(r[0].body.uuid, "UUID-1");
  assert.equal(r[1].status, 409, `la segunda se rechaza (${JSON.stringify(r[1].body)})`);
  assert.ok(typeof r[1].body.error === "string" && r[1].body.error.length > 0, "con un mensaje");
  assert.equal(db.invoice.cfdiUuid, "UUID-1");
  assert.equal(db.cfdiRecords.length, 1, "un solo CfdiRecord");
  assert.equal(db.usage, 1, "un solo timbre al contador del mes");
});

test("N2 · la escritura falla DESPUÉS de timbrar: el UUID queda guardado y el reintento no timbra otro", async () => {
  const { POST } = await import("@/app/api/cfdi/route");
  db.txFalla = true;

  const primero = await quieto(async () => leer(await POST(req(TIMBRAR))));
  assert.equal(pac.timbres, 1);
  assert.equal(db.invoice.cfdiUuid, "UUID-1", "el UUID del CFDI ya emitido no se pierde");
  assert.ok(String(primero.body.error ?? "").includes("UUID-1"),
    `la respuesta dice que SÍ se timbró y con qué UUID (${JSON.stringify(primero.body)})`);

  const reintento = await quieto(async () => leer(await POST(req(TIMBRAR))));
  assert.equal(pac.timbres, 1, "el reintento NO vuelve a timbrar");
  assert.notEqual(reintento.status, 200);
});

test("N2 · si la base se cae mientras Facturapi timbra, el reintento tampoco timbra otro", async () => {
  const { POST } = await import("@/app/api/cfdi/route");
  pac.alTimbrar = () => { db.caida = true; };

  const primero = await quieto(async () => leer(await POST(req(TIMBRAR))));
  assert.equal(pac.timbres, 1);
  assert.equal(primero.status, 500);

  db.caida = false;
  const reintento = await quieto(async () => leer(await POST(req(TIMBRAR))));
  assert.equal(pac.timbres, 1, "no se sabe qué quedó guardado: se bloquea, no se vuelve a timbrar");
  assert.equal(reintento.status, 409);
  assert.match(String(db.invoice.cfdiUuid), /^timbrando:inv1:./, "la factura queda apartada");
});

// ── H-8 · se timbró y no nos enteramos ─────────────────────────────────────
// El candado de arriba cubre «dos pestañas» y «falló al guardar». Falta el
// tercero: Facturapi TIMBRA y la respuesta se pierde por el camino. La
// excepción llega igual que un rechazo, así que la ruta soltaba el apartado y
// el reintento emitía un SEGUNDO CFDI — dos timbres cobrados y dos
// comprobantes vigentes ante el SAT que en dental no se pueden cancelar.

test("H-8 · la respuesta se pierde DESPUÉS de timbrar: el reintento NO vuelve a timbrar", async () => {
  const { POST } = await import("@/app/api/cfdi/route");
  pac.respuestaPerdida = true;

  const primero = await quieto(async () => leer(await POST(req(TIMBRAR))));
  assert.equal(pac.timbres, 1, "el CFDI ya salió: eso es justo lo que no sabemos");

  // EL RENGLÓN QUE IMPORTA: aquí es donde salía el CFDI duplicado. Va antes que
  // cualquier comprobación de forma para que, si esto se rompe, el fallo diga
  // «se timbró dos veces» y no «falta un código».
  pac.respuestaPerdida = false;
  const reintento = await quieto(async () => leer(await POST(req(TIMBRAR))));
  assert.equal(pac.timbres, 1,
    `el reintento NO puede volver a timbrar: ${pac.timbres} timbres = ${pac.timbres} CFDI ante el SAT`);

  assert.equal(primero.body.code, "CFDI_TIMBRE_INCIERTO",
    `la primera responde que no se sabe si timbró (${JSON.stringify(primero.body)})`);
  assert.match(String(db.invoice.cfdiUuid), /^timbrando:inv1:./,
    "la factura SE QUEDA apartada: soltarla es lo que permitía el segundo timbre");
  assert.equal(reintento.status, 409);
  assert.equal(reintento.body.code, "CFDI_EN_CURSO");
  assert.equal(db.cfdiRecords.length, 0, "y no se inventa un CfdiRecord");
});

test("H-8 · si la red falla ANTES de pedir el timbre, la factura NO se bloquea", async () => {
  // El otro lado del arreglo: `createOrUpdateCustomer` y `validateRfc` también
  // hablan con Facturapi y también pueden fallar por red, pero ahí todavía no
  // se pidió ningún timbre. Bloquear la factura ahí sería un susto gratis y
  // trabajo para soporte.
  const { POST } = await import("@/app/api/cfdi/route");
  fallaCliente = true;

  const r = await quieto(async () => leer(await POST(req(TIMBRAR))));
  assert.equal(pac.timbres, 0, "no se llegó a timbrar");
  assert.equal(db.invoice.cfdiUuid, null, "la factura queda libre para reintentar");
  assert.notEqual(r.body.code, "CFDI_TIMBRE_INCIERTO", "y no se le dice que quizá se timbró");

  fallaCliente = false;
  const reintento = await quieto(async () => leer(await POST(req(TIMBRAR))));
  assert.equal(reintento.status, 200, "el reintento funciona con normalidad");
  assert.equal(pac.timbres, 1);
});

test("H-8 · Facturapi acepta pero no manda UUID: tampoco se vuelve a timbrar", async () => {
  const { POST } = await import("@/app/api/cfdi/route");
  pac.sinUuid = true;

  const primero = await quieto(async () => leer(await POST(req(TIMBRAR))));
  assert.equal(pac.timbres, 1);
  assert.equal(primero.body.code, "CFDI_TIMBRE_INCIERTO");
  assert.match(String(db.invoice.cfdiUuid), /^timbrando:inv1:./);
  assert.equal(db.cfdiRecords.length, 0, "no se guarda un CfdiRecord sin UUID");

  pac.sinUuid = false;
  await quieto(async () => leer(await POST(req(TIMBRAR))));
  assert.equal(pac.timbres, 1, "el reintento NO vuelve a timbrar");
});

test("H-8 · manda la MARCA del error, no lo que parezca su mensaje", async () => {
  // La costura entre createInvoice y la ruta. Un 500 de Facturapi trae un
  // mensaje que suena a rechazo («El RFC no es válido»), pero createInvoice lo
  // marcó como incierto porque un 5xx no dice nada sobre el comprobante. Si la
  // ruta se guiara por el texto en vez de por la marca, soltaría el apartado.
  const { POST } = await import("@/app/api/cfdi/route");
  pac.rechazoMarcadoIncierto = "El RFC del receptor no está en la lista de RFC inscritos";

  const r = await quieto(async () => leer(await POST(req(TIMBRAR))));
  assert.equal(r.body.code, "CFDI_TIMBRE_INCIERTO", "gana la marca");
  assert.match(String(db.invoice.cfdiUuid), /^timbrando:inv1:./, "el apartado se queda");
});

test("H-8 · el mensaje le dice a la clínica que NO lo vuelva a timbrar", async () => {
  const { POST } = await import("@/app/api/cfdi/route");
  pac.respuestaPerdida = true;

  const r = await quieto(async () => leer(await POST(req(TIMBRAR))));
  const msg = String(r.body.error ?? "");
  assert.match(msg, /no se sabe/i, "dice que no se sabe qué pasó");
  assert.match(msg, /segundo CFDI|volver a timbrar|vuelva a timbrar/i,
    `y advierte del duplicado (${msg})`);
  assert.match(msg, /soporte/i, "y da salida: soporte");
});

test("N2 · el precio cambió entre la lectura y el timbrado: no se timbra el importe viejo", async () => {
  const { POST } = await import("@/app/api/cfdi/route");
  // Justo después de que el timbrado lee la factura, otra pestaña le baja el
  // precio a $500 (edit-price). Timbrar ahora emitiría un CFDI de $1,000.
  db.trasLeer = () => { db.invoice.total = 500; db.invoice.discount = 500; db.invoice.balance = 500; };

  const r = await quieto(async () => leer(await POST(req(TIMBRAR))));
  assert.equal(pac.timbres, 0, "no se timbra");
  assert.equal(r.status, 409);
  assert.equal(db.invoice.cfdiUuid, null, "y la factura no queda apartada");
});

test("N2 · la factura se canceló entre la lectura y el timbrado: no se timbra", async () => {
  const { POST } = await import("@/app/api/cfdi/route");
  db.trasLeer = () => { db.invoice.status = "CANCELLED"; };

  const r = await quieto(async () => leer(await POST(req(TIMBRAR))));
  assert.equal(pac.timbres, 0);
  assert.equal(r.status, 409);
  assert.equal(db.invoice.cfdiUuid, null);
});

test("N2 · Facturapi rechaza (RFC mal): la factura queda libre para corregir y reintentar", async () => {
  const { POST } = await import("@/app/api/cfdi/route");
  pac.rechazo = "El RFC del receptor no está en la lista de RFC inscritos";

  const malo = await quieto(async () => leer(await POST(req(TIMBRAR))));
  assert.equal(malo.status, 500);
  assert.equal(malo.body.error, pac.rechazo, "el mensaje de Facturapi llega igual que antes");
  assert.equal(db.invoice.cfdiUuid, null, "sin timbre, la factura no queda apartada");

  pac.rechazo = null;
  const bueno = await quieto(async () => leer(await POST(req(TIMBRAR))));
  assert.equal(bueno.status, 200);
  assert.equal(pac.timbres, 1);
  assert.equal(db.invoice.cfdiUuid, "UUID-1");
});

test("N2 · RFC en la lista negra del SAT: no timbra y no deja la factura apartada", async () => {
  const { POST } = await import("@/app/api/cfdi/route");
  pac.efos = true;

  const r = await quieto(async () => leer(await POST(req(TIMBRAR))));
  assert.equal(r.status, 400);
  assert.equal(pac.timbres, 0);
  assert.equal(db.invoice.cfdiUuid, null);
});

test("N2 · el timbrado normal sigue igual: UUID, CfdiRecord, contador y respuesta", async () => {
  const { POST } = await import("@/app/api/cfdi/route");
  setInvoice({ status: "PAID", paid: 1000, balance: 0 });

  const r = await quieto(async () => leer(await POST(req({ ...TIMBRAR, confirmUnpaidPue: undefined }))));
  assert.equal(r.status, 200);
  assert.equal(r.body.uuid, "UUID-1");
  assert.equal(r.body.cfdiId, "cfdi1");
  assert.equal(r.body.quota.used, 1);
  assert.equal(db.invoice.cfdiUuid, "UUID-1");
  assert.equal(db.cfdiRecords[0].uuid, "UUID-1");
  assert.equal(db.cfdiRecords[0].invoiceId, "inv1");

  const otraVez = await quieto(async () => leer(await POST(req(TIMBRAR))));
  assert.equal(otraVez.status, 400);
  assert.equal(otraVez.body.error, "Esta factura ya tiene CFDI timbrado");
  assert.equal(pac.timbres, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// N3 — una factura timbrada no cambia a espaldas del SAT
// ═══════════════════════════════════════════════════════════════════════════

function assertBloqueoCfdi(r: { status: number; body: any }) {
  assert.equal(r.status, 409, `se bloquea (${JSON.stringify(r.body)})`);
  assert.equal(r.body.code, "CFDI_VIGENTE");
  assert.ok(r.body.error.includes("UUID-X"), "el mensaje dice qué CFDI está vigente");
  assert.ok(r.body.error.includes("SAT"), "y que el problema es ante el SAT");
}

test("N3 · cancelar una factura timbrada se bloquea y explica qué hacer", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/cancel/route");
  setInvoice({ cfdiUuid: "UUID-X" });

  assertBloqueoCfdi(await leer(await POST(req({ reason: "error de captura" }), P)));
  assert.equal(db.invoice.status, "PENDING", "la factura NO se cancela");
  assert.equal(db.invoice.notes, null);
});

test("N3 · anular por DELETE una factura timbrada se bloquea", async () => {
  const { DELETE } = await import("@/app/api/invoices/[id]/route");
  setInvoice({ cfdiUuid: "UUID-X" });

  assertBloqueoCfdi(await leer(await DELETE(req(), P)));
  assert.equal(db.invoice.status, "PENDING");
});

test("N3 · reembolsar una factura timbrada se bloquea", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/refund/route");
  setInvoice({ cfdiUuid: "UUID-X", status: "PAID", paid: 1000, balance: 0 });

  assertBloqueoCfdi(await leer(await POST(req({ amount: 1000, reason: "no se hizo" }), P)));
  assert.equal(db.invoice.paid, 1000, "lo pagado no cambia");
  assert.equal(db.invoice.status, "PAID");
  assert.equal(db.payments.length, 0, "no se registra el reembolso");
});

test("N3 · cambiar el precio o el descuento de una factura timbrada se bloquea", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/edit-price/route");
  setInvoice({ cfdiUuid: "UUID-X" });

  assertBloqueoCfdi(await leer(await POST(req({ total: 500 }), P)));
  assertBloqueoCfdi(await leer(await POST(req({ discount: 100 }), P)));
  assert.equal(db.invoice.total, 1000, "el total sigue siendo el del CFDI");
  assert.equal(db.invoice.discount, 0);
});

test("N3 · sin CFDI, cancelar, anular, reembolsar y editar precio siguen funcionando", async () => {
  const cancel = (await import("@/app/api/invoices/[id]/cancel/route")).POST;
  const { DELETE } = await import("@/app/api/invoices/[id]/route");
  const refund = (await import("@/app/api/invoices/[id]/refund/route")).POST;
  const editPrice = (await import("@/app/api/invoices/[id]/edit-price/route")).POST;

  setInvoice();
  assert.equal((await cancel(req({ reason: "duplicada" }), P)).status, 200);
  assert.equal(db.invoice.status, "CANCELLED");

  setInvoice();
  assert.equal((await DELETE(req(), P)).status, 200);
  assert.equal(db.invoice.status, "CANCELLED");

  setInvoice({ status: "PAID", paid: 1000, balance: 0 });
  assert.equal((await refund(req({ amount: 400 }), P)).status, 200);
  assert.equal(db.invoice.paid, 600);

  setInvoice();
  assert.equal((await editPrice(req({ total: 800 }), P)).status, 200);
  assert.equal(db.invoice.total, 800);
});

test("N3 · en PRUEBAS (FACTURAPI_ENV no es live) un CFDI de prueba no bloquea: no llegó al SAT", async () => {
  const cancel = (await import("@/app/api/invoices/[id]/cancel/route")).POST;
  const editPrice = (await import("@/app/api/invoices/[id]/edit-price/route")).POST;
  entorno.live = false;

  setInvoice({ cfdiUuid: "UUID-PRUEBA" });
  assert.equal((await editPrice(req({ total: 800 }), P)).status, 200);
  assert.equal(db.invoice.total, 800);
  assert.equal((await cancel(req({ reason: "prueba" }), P)).status, 200);
  assert.equal(db.invoice.status, "CANCELLED");
});

test("N3 · alguien timbra mientras otro cancela: la cancelación no pisa el CFDI", async () => {
  const cancel = (await import("@/app/api/invoices/[id]/cancel/route")).POST;
  const timbrar = (await import("@/app/api/cfdi/route")).POST;

  // La cancelación lee la factura (sin CFDI) y se queda esperando la
  // comprobación de visibilidad del paciente…
  let soltar!: () => void;
  vis.espera = new Promise<void>((r) => { soltar = r; });
  const cancelando = cancel(req({ reason: "ya no" }), P);
  await new Promise((r) => setTimeout(r, 5));

  // …mientras tanto el administrador timbra la misma factura.
  vis.espera = null;
  const t = await quieto(async () => leer(await timbrar(req(TIMBRAR))));
  assert.equal(t.status, 200);
  assert.equal(db.invoice.cfdiUuid, "UUID-1");

  soltar();
  const c = await leer(await cancelando);
  assert.equal(c.status, 409, `la cancelación ya no puede seguir (${JSON.stringify(c.body)})`);
  assert.equal(db.invoice.status, "PENDING", "la factura timbrada no queda cancelada");
});

test("N3 · alguien timbra mientras otro reembolsa: el reembolso no deja el CFDI vigente por el total", async () => {
  const refund = (await import("@/app/api/invoices/[id]/refund/route")).POST;
  const timbrar = (await import("@/app/api/cfdi/route")).POST;
  setInvoice({ status: "PAID", paid: 1000, balance: 0 });

  // El reembolso ya miró la factura (sin CFDI) y se queda esperando la
  // comprobación de visibilidad del paciente, antes de su transacción…
  let soltar!: () => void;
  vis.espera = new Promise<void>((r) => { soltar = r; });
  const reembolsando = refund(req({ amount: 1000, reason: "no se hizo" }), P);
  await new Promise((r) => setTimeout(r, 5));

  // …mientras tanto el administrador timbra la misma factura.
  vis.espera = null;
  const t = await quieto(async () => leer(await timbrar(req(TIMBRAR))));
  assert.equal(t.status, 200);
  assert.equal(db.invoice.cfdiUuid, "UUID-1");

  // La comprobación del CFDI mira la factura leída DENTRO de la transacción,
  // no la de antes: el reembolso ya no puede seguir.
  soltar();
  const r = await leer(await reembolsando);
  assert.equal(r.status, 409, `el reembolso ya no puede seguir (${JSON.stringify(r.body)})`);
  assert.equal(r.body.code, "CFDI_VIGENTE");
  assert.equal(db.invoice.paid, 1000, "lo pagado no cambia");
  assert.equal(db.payments.length, 0, "no se registra el reembolso");
});
