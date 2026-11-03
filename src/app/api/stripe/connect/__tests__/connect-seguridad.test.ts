/**
 * STRIPE CONNECT: QUIÉN LIGA UNA CUENTA Y A DÓNDE VA EL DINERO DEL PORTAL (ws1-t1, ola 2b, leads 1 y 2).
 *
 * Run: npm run test:stripe-connect
 *
 * `POST /api/stripe/connect` DE VERDAD y `getClinicConnectAccount(s)` DE VERDAD, con dobles en memoria de
 * la sesión, de prisma, de Stripe y de la bitácora. ⛔ No sale ni una llamada a Stripe ni a ninguna base.
 *
 *   · lead 1: una RECEPCIONISTA (o un usuario de solo lectura) ligaba su propia cuenta Express y, si ningún
 *     ADMIN tenía Connect, el portal del paciente le mandaba ahí los cobros de TODA la clínica;
 *   · lead 2: un ADMIN creaba la cuenta Connect de otro miembro (el dueño incluido) y recibía ÉL el link
 *     de alta, que es el que fija la cuenta bancaria;
 *   · y lo legítimo sigue igual: un doctor (o el dueño) liga SU cuenta y recibe SU link.
 */
import Module from "node:module";
import path from "node:path";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(__dirname, "../../../../../..");
const CLINIC = "clinic_c";

type Usuario = {
  id: string;
  clinicId: string;
  role: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  createdAt: Date;
  stripeAccountId: string | null;
  stripeOnboarded: boolean;
};

let usuarios: Usuario[];
let sesion: Usuario | null;
let cuentasCreadas: Array<{ email: string; nombre: string }>;
let linksCreados: Array<{ accountId: string; clinicId: string }>;
let bitacora: any[];
let siguienteCuenta: number;
let suplantando: boolean;

function coincide(fila: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    const valor = fila[k];
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(valor);
      if ("not" in v) return v.not === null ? valor != null : valor !== v.not;
      throw new Error(`operador no soportado en el doble: ${JSON.stringify(v)}`);
    }
    return valor === v;
  });
}

function elegir(fila: any, select: any) {
  if (!select) return { ...fila };
  return Object.fromEntries(Object.keys(select).map((k) => [k, fila[k]]));
}

const prismaDoble: any = {
  user: {
    findFirst: async ({ where, select }: any) => {
      const u = usuarios.find((x) => coincide(x, where));
      return u ? elegir(u, select) : null;
    },
    findMany: async ({ where, select, orderBy }: any) => {
      const filas = usuarios.filter((x) => coincide(x, where));
      if (orderBy?.createdAt === "asc") filas.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return filas.map((f) => elegir(f, select));
    },
    update: async ({ where, data }: any) => {
      const u = usuarios.find((x) => x.id === where.id);
      if (!u) throw new Error("usuario inexistente");
      Object.assign(u, data);
      return u;
    },
    updateMany: async ({ where, data }: any) => {
      const filas = usuarios.filter((x) => coincide(x, where));
      filas.forEach((f) => Object.assign(f, data));
      return { count: filas.length };
    },
  },
};

const stripeDoble: any = {
  accounts: { retrieve: async () => ({ charges_enabled: true }) },
};

const dobles = new Map<string, unknown>();
type M = typeof Module & {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const Mod = Module as M;
const cargaOriginal = Mod._load;
Mod._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let resuelto: string | null = null;
  try {
    resuelto = Mod._resolveFilename(req, parent, isMain);
  } catch {
    resuelto = null;
  }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

let POST: (req: any) => Promise<Response>;
let getClinicConnectAccount: (clinicId: string) => Promise<string | null>;

before(async () => {
  dobles.set(path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble });
  dobles.set(path.join(RAIZ, "src/lib/auth-context.ts"), {
    getAuthContext: async () => {
      if (!sesion) return null;
      const role = sesion.role;
      return {
        userId: sesion.id,
        clinicId: sesion.clinicId,
        role,
        user: sesion,
        permissionsOverride: [],
        isSuperAdmin: role === "SUPER_ADMIN",
        isAdmin: role === "ADMIN" || role === "SUPER_ADMIN",
        isDoctor: role === "DOCTOR",
        isReceptionist: role === "RECEPTIONIST",
        suplantacion: suplantando ? { adminUserId: "adm", adminEmail: "adm@dalecontrol.test", expiresAt: new Date(Date.now() + 3_600_000) } : null,
      };
    },
  });
  dobles.set(path.join(RAIZ, "src/lib/stripe.ts"), {
    getStripeSafe: () => stripeDoble,
    default: () => stripeDoble,
  });
  dobles.set(path.join(RAIZ, "src/lib/stripe-connect.ts"), {
    createConnectAccount: async (email: string, nombre: string) => {
      cuentasCreadas.push({ email, nombre });
      return `acct_${++siguienteCuenta}`;
    },
    createOnboardingLink: async (accountId: string, clinicId: string) => {
      linksCreados.push({ accountId, clinicId });
      return `https://connect.stripe.test/setup/${accountId}`;
    },
  });
  dobles.set(path.join(RAIZ, "src/lib/audit.ts"), {
    logAudit: async (a: any) => {
      // audit_logs.userId tiene FK a users: un userId que no es de un usuario se perdería en producción.
      if (!usuarios.some((u) => u.id === a.userId)) throw new Error(`userId ${a.userId} no es un usuario`);
      bitacora.push(a);
    },
    extractAuditMeta: () => ({ ipAddress: "10.0.0.1", userAgent: "prueba" }),
  });
  ({ POST } = await import("../route"));
  ({ getClinicConnectAccount } = await import("@/lib/patient-portal/online-payment"));
});

function usuario(id: string, role: string, minutos: number, extra: Partial<Usuario> = {}): Usuario {
  return {
    id,
    clinicId: CLINIC,
    role,
    email: `${id}@clinica.test`,
    firstName: id,
    lastName: "Prueba",
    isActive: true,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, minutos)),
    stripeAccountId: null,
    stripeOnboarded: false,
    ...extra,
  };
}

beforeEach(() => {
  usuarios = [
    usuario("dueno", "SUPER_ADMIN", 0),
    usuario("admin", "ADMIN", 1),
    usuario("doctora", "DOCTOR", 2),
    usuario("recepcion", "RECEPTIONIST", 3),
    usuario("lectura", "READONLY", 4),
    { ...usuario("ajeno", "SUPER_ADMIN", 0), clinicId: "otra_clinica" },
  ];
  sesion = null;
  cuentasCreadas = [];
  linksCreados = [];
  bitacora = [];
  siguienteCuenta = 0;
  suplantando = false;
});

const quien = (id: string) => usuarios.find((u) => u.id === id)!;

async function ligar(como: string, body: Record<string, unknown> = {}) {
  sesion = quien(como);
  const res = await POST({ json: async () => body, headers: new Headers() } as any);
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

// ── lead 1 ────────────────────────────────────────────────────────────────

test("lead 1: una recepcionista NO puede ligar una cuenta Connect (403, sin cuenta creada ni link)", async () => {
  const r = await ligar("recepcion");
  assert.equal(r.status, 403);
  assert.equal(r.json.url, undefined);
  assert.equal(cuentasCreadas.length, 0);
  assert.equal(linksCreados.length, 0);
  assert.equal(quien("recepcion").stripeAccountId, null);
});

test("lead 1: un usuario de solo lectura tampoco", async () => {
  const r = await ligar("lectura");
  assert.equal(r.status, 403);
  assert.equal(quien("lectura").stripeAccountId, null);
});

test("lead 1: el portal NO manda los cobros a la cuenta de una recepcionista aunque sea la única ligada (fila vieja)", async () => {
  quien("recepcion").stripeAccountId = "acct_recepcion";
  quien("recepcion").stripeOnboarded = true;
  assert.equal(await getClinicConnectAccount(CLINIC), null);
});

test("lead 1: tampoco a la de una doctora sola: el destino del portal es solo un ADMIN/dueño", async () => {
  quien("doctora").stripeAccountId = "acct_doctora";
  quien("doctora").stripeOnboarded = true;
  assert.equal(await getClinicConnectAccount(CLINIC), null);
});

test("lead 1: el portal no usa la cuenta de un ADMIN que no terminó el alta en Stripe", async () => {
  quien("admin").stripeAccountId = "acct_admin";
  quien("admin").stripeOnboarded = false;
  assert.equal(await getClinicConnectAccount(CLINIC), null);
});

test("lead 1: con el alta terminada, el portal usa la del ADMIN/dueño más antiguo, y una recepcionista ligada no cambia nada", async () => {
  quien("admin").stripeAccountId = "acct_admin";
  quien("admin").stripeOnboarded = true;
  quien("recepcion").stripeAccountId = "acct_recepcion";
  quien("recepcion").stripeOnboarded = true;
  assert.equal(await getClinicConnectAccount(CLINIC), "acct_admin");
  quien("dueno").stripeAccountId = "acct_dueno";
  quien("dueno").stripeOnboarded = true;
  assert.equal(await getClinicConnectAccount(CLINIC), "acct_dueno");
});

test("lead 1: un ADMIN inactivo no recibe los cobros", async () => {
  quien("admin").stripeAccountId = "acct_admin";
  quien("admin").stripeOnboarded = true;
  quien("admin").isActive = false;
  assert.equal(await getClinicConnectAccount(CLINIC), null);
});

// ── lead 2 ────────────────────────────────────────────────────────────────

test("lead 2: un ADMIN NO crea la cuenta Connect del dueño ni recibe su link", async () => {
  const r = await ligar("admin", { doctorId: "dueno" });
  assert.equal(r.status, 403);
  assert.equal(r.json.url, undefined);
  assert.equal(cuentasCreadas.length, 0);
  assert.equal(linksCreados.length, 0);
  assert.equal(quien("dueno").stripeAccountId, null);
});

test("lead 2: tampoco la de una doctora, ni un link nuevo de una cuenta que ya existe", async () => {
  const r = await ligar("admin", { doctorId: "doctora" });
  assert.equal(r.status, 403);
  assert.equal(quien("doctora").stripeAccountId, null);
  quien("doctora").stripeAccountId = "acct_doctora";
  const r2 = await ligar("admin", { doctorId: "doctora" });
  assert.equal(r2.status, 403);
  assert.equal(linksCreados.length, 0);
});

test("lead 2: ni el dueño elige la cuenta de otro miembro", async () => {
  const r = await ligar("dueno", { doctorId: "doctora" });
  assert.equal(r.status, 403);
  assert.equal(quien("doctora").stripeAccountId, null);
});

// ── lo legítimo ───────────────────────────────────────────────────────────

test("una doctora liga SU cuenta: se crea con SU correo, recibe SU link y queda una línea de bitácora", async () => {
  const r = await ligar("doctora");
  assert.equal(r.status, 200);
  assert.equal(r.json.url, "https://connect.stripe.test/setup/acct_1");
  assert.deepEqual(cuentasCreadas, [{ email: "doctora@clinica.test", nombre: "doctora Prueba" }]);
  assert.equal(quien("doctora").stripeAccountId, "acct_1");
  const fila = bitacora.find((b) => b.entityType === "user" && b.entityId === "doctora");
  assert.ok(fila, "cambiar la cuenta de cobro deja una línea de bitácora");
  assert.equal(fila.userId, "doctora");
  assert.equal(fila.clinicId, CLINIC);
  assert.deepEqual(fila.changes.stripeAccountId, { before: null, after: "acct_1" });
});

test("mandar su propio id en doctorId es lo mismo que no mandarlo", async () => {
  const r = await ligar("dueno", { doctorId: "dueno" });
  assert.equal(r.status, 200);
  assert.equal(quien("dueno").stripeAccountId, "acct_1");
});

test("con la cuenta ya creada: solo un link nuevo, sin otra cuenta ni línea de bitácora (no cambió nada)", async () => {
  quien("admin").stripeAccountId = "acct_admin";
  const r = await ligar("admin");
  assert.equal(r.status, 200);
  assert.equal(cuentasCreadas.length, 0);
  assert.deepEqual(linksCreados, [{ accountId: "acct_admin", clinicId: CLINIC }]);
  assert.equal(bitacora.length, 0);
});

test("«Ver como clínica» (admin de plataforma con la sesión del dueño) no liga la cuenta de cobro del dueño", async () => {
  suplantando = true;
  const r = await ligar("dueno");
  assert.equal(r.status, 403);
  assert.equal(quien("dueno").stripeAccountId, null);
  assert.equal(cuentasCreadas.length, 0);
});

test("sin sesión: 401", async () => {
  sesion = null;
  const res = await POST({ json: async () => ({}), headers: new Headers() } as any);
  assert.equal(res.status, 401);
});
