/* ============================================================
   EL GATE DE 2FA TIENE QUE CORTAR EN EL HANDLER, NO EN UNA LISTA.

     npm run test:2fa-handlers

   ── POR QUÉ EXISTE ESTE ARCHIVO Y NO BASTA two-factor-gate.test.ts ──
   `/api/dashboard/sidebar-counts` YA figuraba en el grupo B de
   two-factor-gate.test.ts como "exige 2FA", y el test pasaba en verde
   mientras la ruta servía los datos con el segundo factor pendiente. No
   mentía: comprobaba que el PATHNAME no está en la allowlist. Pero el
   gate autoritativo vive DENTRO de getAuthContext, así que solo alcanza
   a las rutas que lo llaman — y estas seis resolvían el usuario con una
   copia local (createClient + prisma.user.findFirst) que no pasa por
   ningún gate. La lista de rutas decía una cosa y el handler hacía otra.

   Así que aquí no se comprueban rutas: se EJECUTAN los handlers con sus
   dependencias falsas y se mira lo que responden.

   ── EL ATAQUE QUE SE REPRODUCE ──────────────────────────────────
   Con la contraseña robada se hace signInWithPassword contra Supabase
   FUERA del navegador. Así no se siembra df_2fa_pending, y el fast-path
   del middleware —que solo mira esa cookie— no ve nada que cortar. La
   sesión de Supabase es válida y la fila de `users` existe: la copia
   local daba por bueno al ladrón. El único que sabe que hay un segundo
   factor sin satisfacer es getAuthContext, que en ese caso devuelve
   null. Eso es exactamente lo que simula `ctxActual = null` aquí.

   Y en `/api/users/me` el premio era el propio 2FA: `prisma.user.update`
   iba sin `select` y respondía la fila entera con `totpSecret` en base32
   EN CLARO. Con ese secreto se generan códigos válidos y `/api/auth/2fa/
   verify` (que solo hace authenticator.check) los acepta.
   ============================================================ */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { join } from "node:path";

// ── El contexto que devuelve el helper central ───────────────────────
//
// null  = getAuthContext cortó. Es lo que hace su gate de 2FA cuando la
//         persona tiene segundo factor y no trae la prueba (df_2fa).
// objeto = sesión buena: o no usa 2FA, o ya pasó el reto.
let ctxActual: any = null;

const CLINICA = "cli_1";

/** La fila de `users` COMPLETA, como la devuelve un findFirst sin select. */
function filaUsuario() {
  return {
    id: "usr_1",
    clinicId: CLINICA,
    supabaseId: "sb_1",
    email: "dueno@clinica.mx",
    firstName: "Laura",
    lastName: "Mena",
    role: "ADMIN",
    phone: "5512345678",
    specialty: "Ortodoncia",
    isActive: true,
    permissionsOverride: [],
    totpEnabled: true,
    // Los seis secretos que viajaban al navegador.
    totpSecret: "JBSWY3DPEHPK3PXP",
    recoveryCodes: ["$2b$10$hashuno", "$2b$10$hashdos"],
    cajaPinHash: "$2b$10$hashdelpin",
    googleRefreshToken: "1//refresh-de-google",
    googleCalendarToken: "ya29.token-de-calendario",
    stripeAccountId: "acct_1234567890",
  };
}

const SECRETOS = [
  "totpSecret",
  "recoveryCodes",
  "cajaPinHash",
  "googleRefreshToken",
  "googleCalendarToken",
  "stripeAccountId",
] as const;

// ── Prisma falso: registra cada llamada y devuelve datos de clínica ──
//
// Los datos son de verdad reconocibles a propósito: si un handler
// contesta 200 con el segundo factor pendiente, el nombre de la paciente
// aparece en el cuerpo y el test lo enseña.
const llamadas: string[] = [];

const RESPUESTAS: Record<string, unknown> = {
  "user.findFirst": filaUsuario(),
  "user.update": filaUsuario(),
  "clinic.findUnique": { name: "Clínica Demo", category: "DENTAL", timezone: "America/Mexico_City" },
  "clinicLayout.findUnique": { elements: [], metadata: null },
  "resource.findMany": [{ id: "res_1", name: "Sillón 1", color: "#3b82f6", orderIndex: 0 }],
  "appointment.findMany": [
    {
      id: "apt_1",
      resourceId: "res_1",
      startsAt: new Date("2026-09-06T16:00:00.000Z"),
      endsAt: new Date("2026-09-06T17:00:00.000Z"),
      checkedInAt: new Date("2026-09-06T15:50:00.000Z"),
      status: "CHECKED_IN",
      type: "Limpieza",
      notes: null,
      patientId: "pac_1",
      patient: { id: "pac_1", firstName: "Ana", lastName: "Ruiz" },
      doctor: { firstName: "Laura", lastName: "Mena" },
    },
  ],
  "reminder.findMany": [
    { id: "rem_1", title: "Llamar a Ana Ruiz", body: null, dueAt: new Date("2026-09-06T18:00:00.000Z"), status: "PENDING", completedAt: null, threadId: null, patient: { id: "pac_1", firstName: "Ana", lastName: "Ruiz" }, assignedTo: null, createdBy: null },
  ],
  "reminder.findFirst": { id: "rem_1", clinicId: CLINICA, patientId: null, assignedToId: "usr_1" },
  "reminder.update": { id: "rem_1", title: "Llamar a Ana Ruiz", status: "DONE" },
  "reminder.create": { id: "rem_2", title: "Nuevo" },
  "reminder.deleteMany": { count: 1 },
  "patient.findFirst": { id: "pac_1", clinicId: CLINICA, firstName: "Ana", lastName: "Ruiz" },
  "inboxThread.findFirst": { id: "thr_1", clinicId: CLINICA },
  "inboxThread.count": 7,
  "medicalRecord.count": 3,
};

const prismaFalso: any = new Proxy(
  {},
  {
    get: (_t, modelo: string) =>
      new Proxy(
        {},
        {
          get: (_t2, metodo: string) => async () => {
            const clave = `${modelo}.${metodo}`;
            llamadas.push(clave);
            if (clave in RESPUESTAS) return RESPUESTAS[clave];
            if (metodo.startsWith("findMany")) return [];
            if (metodo.startsWith("count")) return 0;
            return null;
          },
        },
      ),
  },
);

/** La sesión de Supabase del ladrón: válida, obtenida con la contraseña. */
let getUserDeSupabase = 0;

// ── Dependencias falsas, ANTES de cargar ningún handler ──────────────
//
// Se interceptan también las dos piezas de la copia local (createClient y
// readActiveClinicCookie) a propósito: así este mismo archivo puede correr
// contra el código de ANTES del arreglo y enseñar que devolvía 200.
const FALSOS: Record<string, unknown> = {
  "@/lib/auth-context": { getAuthContext: async () => ctxActual },
  "@/lib/prisma": { prisma: prismaFalso },
  "@/lib/cache/revalidate": { revalidateAfter: () => {} },
  "@/lib/supabase/server": {
    createClient: () => ({
      auth: {
        getUser: async () => {
          getUserDeSupabase++;
          return { data: { user: { id: "sb_1" } } };
        },
      },
    }),
  },
  "@/lib/active-clinic": { readActiveClinicCookie: () => CLINICA, logClinicFallback: () => {} },
};

const cargaOriginal = (Module as any)._load;
(Module as any)._load = function (peticion: string, padre: unknown, esMain: boolean) {
  if (peticion in FALSOS) return FALSOS[peticion];
  return cargaOriginal.call(this, peticion, padre, esMain);
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { NextRequest } = require("next/server");

function ruta(rel: string): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(join(process.cwd(), "src/app/api", rel, "route.ts"));
}

function peticion(url: string, init?: RequestInit): any {
  return new NextRequest(new Request(url, init));
}

beforeEach(() => {
  llamadas.length = 0;
  getUserDeSupabase = 0;
  ctxActual = null;
});

/** El contexto de una sesión que SÍ pasó (o no necesita) el segundo factor. */
function ctxBueno() {
  return { userId: "usr_1", clinicId: CLINICA, role: "ADMIN", user: filaUsuario(), permissionsOverride: [] };
}

// ════════════════════════════════════════════════════════════════════
// 1 · CON EL SEGUNDO FACTOR PENDIENTE, NINGUNA DE LAS SEIS RESPONDE
// ════════════════════════════════════════════════════════════════════

test("PATCH /api/users/me con 2FA pendiente: 401, y NO entrega el totpSecret", async () => {
  const { PATCH } = ruta("users/me");
  // El cuerpo vacío del ataque: los cuatro campos quedan undefined, Prisma los
  // descarta y el update es un no-op. Daba igual: la respuesta era el premio.
  const res = await PATCH(peticion("http://x/api/users/me", { method: "PATCH", body: "{}" }));
  const cuerpo = await res.json();

  assert.equal(res.status, 401, "la ruta más grave de la auditoría sigue contestando con el 2FA pendiente");
  const texto = JSON.stringify(cuerpo);
  for (const s of SECRETOS) {
    assert.equal(texto.includes(String(filaUsuario()[s])), false, `${s} salió en la respuesta`);
  }
  assert.equal(llamadas.includes("user.update"), false, "escribió en la fila del usuario sin pasar el 2FA");
  assert.equal(getUserDeSupabase, 0, "resolvió al usuario con una copia local en vez de getAuthContext");
});

test("GET /api/clinic-layout/3d-state con 2FA pendiente: 401, sin nombres de pacientes", async () => {
  const { GET } = ruta("clinic-layout/3d-state");
  const res = await GET();
  const texto = JSON.stringify(await res.json());
  assert.equal(res.status, 401);
  assert.equal(texto.includes("Ana"), false, "salieron nombres de los pacientes del día");
  assert.equal(getUserDeSupabase, 0);
});

test("GET /api/clinic-layout/appointments con 2FA pendiente: 401, sin agenda del día", async () => {
  const { GET } = ruta("clinic-layout/appointments");
  const res = await GET(peticion("http://x/api/clinic-layout/appointments?date=2026-09-06"));
  const texto = JSON.stringify(await res.json());
  assert.equal(res.status, 401);
  assert.equal(texto.includes("Ana"), false, "salieron nombres de los pacientes del día");
  assert.equal(getUserDeSupabase, 0);
});

test("GET /api/reminders con 2FA pendiente: 401, sin recordatorios", async () => {
  const { GET } = ruta("reminders");
  const res = await GET(peticion("http://x/api/reminders"));
  const texto = JSON.stringify(await res.json());
  assert.equal(res.status, 401);
  assert.equal(texto.includes("Ana Ruiz"), false);
  assert.equal(llamadas.includes("reminder.findMany"), false, "leyó los recordatorios de la clínica");
});

test("POST /api/reminders con 2FA pendiente: 401 y NO crea nada", async () => {
  const { POST } = ruta("reminders");
  const res = await POST(
    peticion("http://x/api/reminders", {
      method: "POST",
      body: JSON.stringify({ title: "Metido por el ladrón", dueAt: new Date().toISOString(), assignedToId: "usr_1" }),
    }),
  );
  assert.equal(res.status, 401);
  assert.equal(llamadas.includes("reminder.create"), false, "creó un recordatorio con el 2FA pendiente");
});

test("PATCH /api/reminders/[id] con 2FA pendiente: 401 y NO edita nada", async () => {
  const { PATCH } = ruta("reminders/[id]");
  const res = await PATCH(
    peticion("http://x/api/reminders/rem_1", { method: "PATCH", body: JSON.stringify({ status: "DONE" }) }),
    { params: { id: "rem_1" } },
  );
  assert.equal(res.status, 401);
  assert.equal(llamadas.includes("reminder.update"), false, "editó un recordatorio con el 2FA pendiente");
});

test("DELETE /api/reminders/[id] con 2FA pendiente: 401 y NO borra nada", async () => {
  const { DELETE } = ruta("reminders/[id]");
  const res = await DELETE(peticion("http://x/api/reminders/rem_1", { method: "DELETE" }), {
    params: { id: "rem_1" },
  });
  assert.equal(res.status, 401);
  assert.equal(llamadas.includes("reminder.deleteMany"), false, "borró un recordatorio con el 2FA pendiente");
});

test("GET /api/dashboard/sidebar-counts con 2FA pendiente: ceros, no las cuentas reales", async () => {
  // Esta es la que figuraba en two-factor-gate.test.ts como "exige 2FA" y
  // servía igual. No devuelve 401 a propósito —el sidebar tolera la sesión
  // ausente con ceros y así estaba antes del arreglo— pero las cuentas de la
  // clínica no pueden salir.
  const { GET } = ruta("dashboard/sidebar-counts");
  const res = await GET();
  const cuerpo = await res.json();
  assert.deepEqual(cuerpo, { messagesUnread: 0, clinicalDrafts: 0, xraysUnanalyzed: 0, inboxUnread: 0 });
  assert.equal(llamadas.includes("inboxThread.count"), false, "contó los hilos de la clínica con el 2FA pendiente");
  assert.equal(getUserDeSupabase, 0);
});

// ════════════════════════════════════════════════════════════════════
// 2 · LA RESPUESTA DE /api/users/me, YA CON LA SESIÓN BUENA
// ════════════════════════════════════════════════════════════════════

test("PATCH /api/users/me: la respuesta sale por la lista blanca, sin un solo secreto", async () => {
  // Prisma falso: devuelve la fila ENTERA aunque el handler pida `select`.
  // Es a propósito — así lo que se comprueba es que el HANDLER proyecta, y no
  // que el `select` haya llegado bien. Las dos redes tienen que aguantar solas.
  ctxActual = ctxBueno();
  const { PATCH } = ruta("users/me");
  const res = await PATCH(
    peticion("http://x/api/users/me", {
      method: "PATCH",
      body: JSON.stringify({ firstName: "Laura", lastName: "Mena", phone: "5512345678", specialty: "Ortodoncia" }),
    }),
  );
  const cuerpo = await res.json();

  assert.equal(res.status, 200);
  for (const s of SECRETOS) {
    assert.equal(s in cuerpo, false, `${s} viajó al navegador en la respuesta de Ajustes`);
  }
  assert.equal("supabaseId" in cuerpo, false, "el id de la cuenta de auth tampoco tiene por qué circular");
  // Y lo que la pantalla de Ajustes sí necesita sigue llegando.
  assert.equal(cuerpo.firstName, "Laura");
  assert.equal(cuerpo.lastName, "Mena");
  assert.equal(cuerpo.email, "dueno@clinica.mx");
  assert.equal(cuerpo.totpEnabled, true, "el interruptor sí; el secreto con el que se generan los códigos, no");
});

// ════════════════════════════════════════════════════════════════════
// 3 · EL OTRO LADO: A QUIEN NO LE TOCA EL GATE, NO SE ENTERA
// ════════════════════════════════════════════════════════════════════

test("la recepcionista sin 2FA sigue viendo sus recordatorios igual que ayer", async () => {
  // El fallo simétrico, y el que rompe la clínica: cerrar de más. Si
  // getAuthContext devuelve contexto (no usa 2FA, o ya pasó el reto), estas
  // rutas tienen que funcionar exactamente como antes.
  ctxActual = ctxBueno();
  const { GET } = ruta("reminders");
  const res = await GET(peticion("http://x/api/reminders"));
  const cuerpo = await res.json();
  assert.equal(res.status, 200);
  assert.equal(cuerpo.reminders.length, 1);
  assert.equal(cuerpo.reminders[0].title, "Llamar a Ana Ruiz");
});

test("el sidebar de la sesión buena sigue trayendo sus cuentas", async () => {
  ctxActual = ctxBueno();
  const { GET } = ruta("dashboard/sidebar-counts");
  const res = await GET();
  const cuerpo = await res.json();
  assert.equal(res.status, 200);
  assert.equal(cuerpo.inboxUnread, 7);
  assert.equal(cuerpo.clinicalDrafts, 3);
});

// ════════════════════════════════════════════════════════════════════
// 4 · CANDADO: NINGUNA DE LAS SEIS PUEDE VOLVER A LA COPIA LOCAL
// ════════════════════════════════════════════════════════════════════

test("ninguna de las seis rutas resuelve al usuario por su cuenta", async () => {
  // El arreglo se deshace en una línea: alguien copia el getDbUser de otro
  // archivo y vuelve el agujero, con los tests de arriba en verde si además
  // llamara a getAuthContext. Esto mira el código: la copia local se reconoce
  // por createClient() + prisma.user.findFirst({ where: { supabaseId ... } }).
  const { readFileSync } = require("node:fs");
  const RUTAS = [
    "users/me",
    "clinic-layout/3d-state",
    "clinic-layout/appointments",
    "reminders",
    "reminders/[id]",
    "dashboard/sidebar-counts",
  ];
  const reincidentes: string[] = [];
  for (const r of RUTAS) {
    const src: string = readFileSync(join(process.cwd(), "src/app/api", r, "route.ts"), "utf8");
    const sinComentarios = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    if (/createClient\s*\(/.test(sinComentarios) || /supabaseId:\s*user\.id/.test(sinComentarios)) {
      reincidentes.push(r);
    }
    if (!/getAuthContext\s*\(/.test(sinComentarios)) reincidentes.push(`${r} (sin getAuthContext)`);
  }
  assert.deepEqual(
    reincidentes,
    [],
    "Volvió la copia local de getDbUser: resuelve la sesión sin pasar por el gate de 2FA.",
  );
});
