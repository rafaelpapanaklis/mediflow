/**
 * AISLAMIENTO ENTRE CLÍNICAS — ws1-t10 (auditoría 30-sep-2026, punto 19).
 *
 * Run: npm run test:aislamiento-clinicas        (≈ 2 min, sin base ni red)
 *
 * Recorre TODAS las rutas de `src/app/api/**` (inventario automático: una ruta
 * nueva entra sola) y llama a cada handler real como una persona de la
 * clínica A —con el rol más alto, SUPER_ADMIN— pidiendo ids de la clínica B
 * (otro dueño) en la URL, la consulta y el cuerpo. La base es una copia en
 * memoria del esquema real (ver base-falsa.ts): si un handler LEE o ESCRIBE una
 * fila de B o de C —o la devuelve en la respuesta—, la prueba falla.
 *
 * ── SEDES ───────────────────────────────────────────────────────────────
 * Una sede es su PROPIA fila de `Clinic`; lo que une dos sedes es una PERSONA:
 * el mismo `supabaseId` con una fila `User` activa en cada una (ver
 * src/lib/sabina/sedes.ts). La clínica C es una sede hermana de A. Regla: ni
 * C ni B se tocan… salvo las rutas de `SEDES_DEL_MISMO_DUENO` (el switcher, el
 * 2FA de la persona, los vínculos entre sedes), y SOLO con C del mismo dueño:
 * esas rutas se corren otra vez con una C de OTRO dueño y ahí no pueden tocar
 * nada. La comparación entre sedes de Sabina se prueba con el mismo detector
 * (sabina-comparar-sedes.test.ts).
 *
 * ── LO QUE ESTA PRUEBA NO PUEDE DECIR ───────────────────────────────────
 * · Barbería, instituto, inmobiliaria, laboratorios, proveedores y afiliados
 *   tienen OTRA sesión y OTRA raíz de tenant: el arnés no entra (401) y las
 *   cuenta aparte (`OTRAS_RAICES`). No están verificadas por esta prueba.
 * · SQL crudo (`$queryRaw`): se cuenta, no se puede verificar.
 * · Una ruta que rechaza la petición universal por validación (400) sin llegar
 *   a la base no queda probada a fondo: el control con ids de A mide cuántas
 *   sí se dejan conducir (`ejercida`).
 *
 * ⛔ No toca ninguna base ni sale a la red: `@/lib/prisma` es la base falsa,
 * `fetch` está cortado y las variables de entorno son de mentira.
 */
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ── Entorno de mentira ──────────────────────────────────────────────────────
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://nadie:nada@127.0.0.1:1/ninguna",
  DIRECT_URL: "postgresql://nadie:nada@127.0.0.1:1/ninguna",
  NEXT_PUBLIC_SUPABASE_URL: "https://falso.supabase.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-falsa",
  SUPABASE_SERVICE_ROLE_KEY: "service-falsa",
  CRON_SECRET: "c".repeat(40),
  DATA_ENCRYPTION_KEY: "d".repeat(64),
  SIGNATURE_MASTER_KEY: "s".repeat(64),
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
});
const requireCjs = createRequire(import.meta.url ?? __filename);
// `server-only` no está instalado fuera de Next: se resuelve a un módulo vacío
// (carpeta `stubs/`, que entra en la ruta de búsqueda de módulos de CJS).
process.env.NODE_PATH = join(__dirname, "stubs");
requireCjs("node:module")._initPaths();
// Nada sale a la red.
(globalThis as any).fetch = async () => {
  throw new Error("fetch cortado por la prueba de aislamiento");
};

import { contexto, ejecutarRuta, inventarioDeRutas, puertaDe, RAIZ_API, type Metodo, type Resultado, type RutaApi } from "./arnes";
import { BaseFalsa, ID, SUPABASE_DE } from "./base-falsa";

const M = mock as any;
const React = requireCjs("react");
M.module("react", { defaultExport: React, namedExports: { ...React, cache: (f: any) => f } });
// Fuera de Next no hay almacén de generación estática ni caché incremental.
M.module("next/cache", {
  namedExports: {
    unstable_cache: (f: any) => f,
    revalidatePath: () => undefined,
    revalidateTag: () => undefined,
    unstable_noStore: () => undefined,
  },
});

// ── Base y sesión de mentira ────────────────────────────────────────────────
const prismaProxy = new Proxy({}, {
  get: (_t, p) => {
    if (p === "then") return undefined;
    return (contexto.base!.cliente() as any)[p as string];
  },
});
M.module("@/lib/prisma", { namedExports: { prisma: prismaProxy } });
M.module("@/lib/prisma-admin", { namedExports: { prismaAdmin: prismaProxy } });

const supabaseFalso = () => ({
  auth: {
    getUser: async () => ({ data: { user: { id: SUPABASE_DE.A, email: "a@prueba.test" } }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
    signOut: async () => ({ error: null }),
    signInWithPassword: async () => ({ data: { user: null, session: null }, error: new Error("falso") }),
    admin: new Proxy({}, { get: () => async () => ({ data: { user: null }, error: new Error("falso") }) }),
  },
  from: () => { throw new Error("supabase.from no está disponible en la prueba"); },
  storage: { from: () => new Proxy({}, { get: () => async () => ({ data: null, error: new Error("storage falso") }) }) },
});
M.module("@/lib/supabase/server", { namedExports: { createClient: supabaseFalso } });

const almacenCookies = {
  get: (nombre: string) => (nombre in contexto.cookies ? { name: nombre, value: contexto.cookies[nombre] } : undefined),
  getAll: () => Object.entries(contexto.cookies).map(([name, value]) => ({ name, value })),
  has: (nombre: string) => nombre in contexto.cookies,
  set: () => undefined,
  delete: () => undefined,
};
M.module("next/headers", {
  namedExports: { headers: () => contexto.cabeceras, cookies: () => almacenCookies, draftMode: () => ({ isEnabled: false }) },
});

// ── Carga de rutas ──────────────────────────────────────────────────────────
const cargados = new Map<string, any>();
async function cargar(archivo: string) {
  if (!cargados.has(archivo)) cargados.set(archivo, await import(join(RAIZ_API, archivo)));
  return cargados.get(archivo);
}
const clave = (metodo: string, patron: string) => `${metodo} ${patron}`;

// ═══════════════════════════════════════════════════════════════════════════
// LISTAS DOCUMENTADAS. Cada excepción lleva su porqué, y la prueba falla si una
// entrada ya no hace falta (así la lista solo puede encogerse).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rutas que, por diseño, tocan sedes del MISMO dueño (la persona tiene una
 * ficha `User` activa en ambas). Se corren con C como sede hermana (se permite
 * LEER C; B sigue prohibida) y otra vez con C de OTRO dueño (no se puede tocar
 * nada). `escribeEnC`: además modifican filas de la sede hermana.
 */
const SEDES_DEL_MISMO_DUENO: Record<string, { motivo: string; escribeEnC?: boolean }> = {
  "GET /api/my-clinics": { motivo: "el selector de sede lista las clínicas donde ESTA persona tiene ficha activa" },
  "GET /api/clinics/links": { motivo: "el dueño ve sus sedes y los vínculos de pacientes entre ellas (getOwnedBranches)" },
  "POST /api/auth/2fa/setup": { motivo: "el 2FA es de la PERSONA (EQ-02): se propaga a todas sus fichas", escribeEnC: true },
  // Solo van aquí las que el arnés DEMUESTRA que tocan la sede hermana (la
  // prueba falla si una entrada no hace falta). Las demás rutas del 2FA y de la
  // contraseña también propagan a las fichas de la persona, pero con la
  // petición universal se quedan en la validación (400) y no llegan a escribir:
  // si algún día se conducen y la prueba las marca, se añaden aquí con su motivo.
};

/**
 * Públicas POR DISEÑO: se abren con un id que hace de credencial (QR de la
 * receta, verificación de la firma). No usan la sesión de la clínica; devuelven
 * lo mismo a cualquiera que tenga el id. Que aparezcan aquí es una decisión de
 * producto documentada, no un descuido: una ruta pública NUEVA que devuelva
 * datos por id hace fallar la prueba hasta que alguien la decida.
 */
const PUBLICAS_POR_DISENO: Record<string, string> = {
  "GET /api/prescriptions/[id]/verify": "QR de la receta impresa: la farmacia verifica con el id (cuid) de la receta; paciente abreviado",
  "GET /api/prescriptions/[id]/verify/pdf": "misma verificación por QR, en PDF",
  "GET /api/signature/verify/[signatureId]": "verificación pública de la firma electrónica por su id (NOM-151)",
};

/**
 * Lecturas por id SIN filtro de clínica seguidas de una comprobación que
 * rechaza (la respuesta es 4xx: no se devuelve nada). No fuga datos, pero la
 * regla (c) de CLAUDE.md pide el filtro EN la consulta. Quedan aquí porque son
 * rutas públicas con token cuyo acceso se decide DESPUÉS de leer la cita; el
 * arreglo (acotar por token) toca el flujo de pago de teleconsulta (auditoría
 * hallazgo 13, M7), que es de otra tarea.
 */
const LECTURA_Y_COMPROBACION: Record<string, string> = {
  "POST /api/stripe/checkout": "pública con token de pago `t`: lee la cita por id y compara clínica/token después (M7, otra tarea)",
  "GET /api/teleconsulta/join/[appointmentId]": "pública con token de paciente: lee la cita por id y compara el token después",
};

/**
 * Rutas de sesión de clínica a las que el arnés no logra entrar (401): no son
 * un bloqueo, son un hueco de cobertura. Cualquier otra que dé 401 hace fallar
 * la prueba (señal de que se rompió el doble de la sesión).
 */
const SIN_SESION_CONOCIDAS = new Set<string>([
  "GET /api/admin/impersonate", // cookie propia del admin de plataforma
  "POST /api/admin/impersonate",
  "POST /api/instituto/ai/dictado", // sesión del instituto
  "POST /api/instituto/auth/cambiar-contrasena",
  "GET /api/instituto/auth/session",
]);

/** Verticales con OTRA sesión y OTRA raíz de tenant: fuera del alcance del arnés. */
const OTRAS_RAICES = ["realty", "instituto", "barber", "afiliados", "laboratorios", "proveedores"];
const raizDe = (patron: string) => patron.split("/")[2];

/** Rutas que el control con ids de A TIENE que poder conducir (si no, el doble de sesión está roto). */
const CANARIOS: string[] = [
  "GET /api/patients",
  "GET /api/patients/[id]",
  "GET /api/patients/search",
  "GET /api/appointments",
  "GET /api/invoices",
  "GET /api/invoices/[id]",
  "GET /api/prescriptions",
  "GET /api/xrays",
  "GET /api/records",
  "GET /api/clinical",
  "GET /api/cfdi",
];

// ═══════════════════════════════════════════════════════════════════════════
const filtro = process.env.AISLAMIENTO_FILTRO;
const rutas = inventarioDeRutas().filter((r) => !filtro || r.archivo.includes(filtro));
const fuentes = new Map(rutas.map((r) => [r.archivo, readFileSync(join(RAIZ_API, r.archivo), "utf8")]));
const resultados: Resultado[] = [];
const controles: Resultado[] = [];

async function sinRuido<T>(f: () => Promise<T>): Promise<T> {
  const previo = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  console.log = console.warn = console.error = console.info = () => undefined;
  try {
    return await f();
  } finally {
    Object.assign(console, previo);
  }
}

test("inventario: hay rutas y las listas documentadas apuntan a rutas que existen", () => {
  assert.ok(rutas.length > 0);
  if (filtro) return;
  assert.ok(rutas.length > 900, `el inventario se encogió a ${rutas.length} rutas: ¿cambió la carpeta?`);
  const existentes = new Set(rutas.flatMap((r) => r.metodos.map((m) => clave(m, r.patron))));
  for (const k of [...Object.keys(SEDES_DEL_MISMO_DUENO), ...Object.keys(PUBLICAS_POR_DISENO), ...Object.keys(LECTURA_Y_COMPROBACION), ...SIN_SESION_CONOCIDAS]) {
    assert.ok(existentes.has(k), `la lista documentada menciona «${k}», que ya no existe: bórrala`);
  }
});

// ── Controles positivos: el arnés tiene que ver una fuga cuando la hay ──────
test("control positivo: un handler escrito MAL (sin filtro de clínica) se marca; uno escrito BIEN no", async () => {
  const { NextResponse } = await import("next/server");
  const { getAuthContext } = await import("@/lib/auth-context");
  const { prisma } = await import("@/lib/prisma");
  const db = prisma as any;
  const mal = {
    GET: async (_r: any, { params }: any) => NextResponse.json(await db.patient.findUnique({ where: { id: params.id } })),
    PATCH: async (_r: any, { params }: any) => NextResponse.json(await db.patient.update({ where: { id: params.id }, data: { firstName: "x" } })),
    POST: async (r: any) => {
      const b = await r.json();
      return NextResponse.json(await db.appointment.create({ data: { clinicId: b.clinicId, patientId: b.patientId } }));
    },
  };
  const bien = {
    GET: async (_r: any, { params }: any) => {
      const ctx = await getAuthContext();
      if (!ctx) return NextResponse.json({ error: "no" }, { status: 401 });
      const p = await db.patient.findFirst({ where: { id: params.id, clinicId: ctx.clinicId } });
      return p ? NextResponse.json(p) : NextResponse.json({ error: "no" }, { status: 404 });
    },
    PATCH: async (_r: any, { params }: any) => {
      const ctx = await getAuthContext();
      const r = await db.patient.updateMany({ where: { id: params.id, clinicId: ctx!.clinicId }, data: { firstName: "x" } });
      return NextResponse.json(r, { status: r.count ? 200 : 404 });
    },
    POST: async (r: any) => {
      const ctx = await getAuthContext();
      const b = await r.json();
      const pac = await db.patient.findFirst({ where: { id: b.patientId, clinicId: ctx!.clinicId } });
      if (!pac) return NextResponse.json({ error: "no" }, { status: 404 });
      return NextResponse.json(await db.appointment.create({ data: { clinicId: ctx!.clinicId, patientId: pac.id } }));
    },
  };
  const ruta: RutaApi = { archivo: "control", url: `/api/control/${ID.B}`, patron: "/api/control/[id]", params: { id: ID.B }, metodos: ["GET", "PATCH", "POST"] };
  const fuente = "getAuthContext";
  const cargarControl = (que: any) => async () => que;
  await sinRuido(async () => {
    for (const m of ["GET", "PATCH", "POST"] as Metodo[]) {
      const r = await ejecutarRuta(ruta, m, fuente, cargarControl(mal));
      assert.equal(r.veredicto, "fuga", `${m} escrito mal NO se marcó: ${JSON.stringify(r)}`);
      const ok = await ejecutarRuta(ruta, m, fuente, cargarControl(bien));
      assert.notEqual(ok.veredicto, "fuga", `${m} escrito bien se marcó: ${JSON.stringify(ok.fugas)}`);
      assert.notEqual(ok.veredicto, "sin-sesion", `${m}: el arnés no pudo entrar con la sesión de A`);
    }
    // …y el handler bien escrito, con ids de A, SÍ funciona (el control no es solo «siempre 404»).
    const conA = await ejecutarRuta(ruta, "GET", fuente, cargarControl(bien), { objetivo: "A" });
    assert.equal(conA.estado, 200);
  });
});

// ── Sesión: la clínica activa solo puede ser una donde la persona tiene ficha ─
test("sesión: la cookie de clínica activa no deja entrar a una clínica ajena; a una sede hermana sí", async () => {
  const { packClinicCookie } = await import("@/lib/active-clinic-core");
  const { getAuthContext } = await import("@/lib/auth-context");
  const entrar = async (cookies: Record<string, string>, duenoDeC: "mismo" | "otro" = "mismo") => {
    contexto.base = new BaseFalsa({ duenoDeC });
    contexto.cookies = cookies;
    contexto.cabeceras = new Headers({ "x-pathname": "/api/patients", "x-method": "POST" });
    const ctx = await sinRuido(() => getAuthContext());
    return ctx?.clinicId ?? null;
  };
  assert.equal(await entrar({}), ID.A, "sin cookie: la primera ficha de la persona");
  assert.equal(await entrar({ activeClinicId: packClinicCookie(ID.B) }), ID.A, "cookie firmada de una clínica AJENA: se ignora");
  assert.equal(await entrar({ activeClinicId: packClinicCookie(ID.C) }), ID.C, "cookie de la sede hermana (mismo dueño): cambia de sede");
  assert.equal(await entrar({ activeClinicId: packClinicCookie(ID.C) }, "otro"), ID.A, "esa misma cookie con C de OTRO dueño: se ignora");
  assert.equal(await entrar({ activeClinicId: "idB.firma-falsa" }), ID.A, "cookie sin firma válida: se ignora");
  contexto.cookies = {};
});

// ── El barrido ──────────────────────────────────────────────────────────────
test("aislamiento: ninguna ruta toca ni devuelve datos de otra clínica", { timeout: 3_600_000 }, async () => {
  await sinRuido(async () => {
    for (const ruta of rutas) {
      const fuente = fuentes.get(ruta.archivo)!;
      for (const metodo of ruta.metodos) {
        const k = clave(metodo, ruta.patron);
        if (SEDES_DEL_MISMO_DUENO[k]) continue; // se prueban abajo, con sus dos variantes
        resultados.push(await ejecutarRuta(ruta, metodo, fuente, cargar));
        // Control positivo POR RUTA: la misma petición con ids de A. Sin él un
        // «404» no dice si la ruta bloqueó a B o simplemente no se deja conducir.
        if (puertaDe(fuente) === "sesion-clinica" && !OTRAS_RAICES.includes(raizDe(ruta.patron))) {
          controles.push(await ejecutarRuta(ruta, metodo, fuente, cargar, { objetivo: "A" }));
        }
      }
    }
  });
  if (process.env.AISLAMIENTO_SALIDA) writeFileSync(process.env.AISLAMIENTO_SALIDA, JSON.stringify({ resultados, controles }, null, 1));

  const fallos: string[] = [];
  const usadas = { publicas: new Set<string>(), lectura: new Set<string>() };
  for (const r of resultados) {
    const k = clave(r.metodo, r.ruta);
    if (r.veredicto === "fuga") {
      if (PUBLICAS_POR_DISENO[k]) { usadas.publicas.add(k); continue; }
      if (LECTURA_Y_COMPROBACION[k]) {
        // Tolerada SOLO si no devolvió nada: ni marcas en la respuesta ni escrituras.
        if (r.marcasEnRespuesta.length === 0 && r.fugas.every((f) => f.tipo === "lectura")) { usadas.lectura.add(k); continue; }
      }
      fallos.push(`${k} → ${r.estado}: ${r.fugas.slice(0, 3).map((f) => `${f.tipo} ${f.modelo}.${f.operacion} de ${f.dueno}`).join("; ")}${r.marcasEnRespuesta.length ? ` · la respuesta trae datos de ${r.marcasEnRespuesta}` : ""}`);
    }
    if (r.veredicto === "sin-sesion" && !SIN_SESION_CONOCIDAS.has(k)) {
      fallos.push(`${k} → 401 con sesión válida de A: el arnés no pudo entrar (¿se rompió el doble de la sesión?)`);
    }
  }
  if (!filtro) {
    for (const k of Object.keys(PUBLICAS_POR_DISENO)) if (!usadas.publicas.has(k)) fallos.push(`«${k}» ya no es pública por diseño (ya no devuelve datos por id): quítala de PUBLICAS_POR_DISENO`);
    for (const k of Object.keys(LECTURA_Y_COMPROBACION)) if (!usadas.lectura.has(k)) fallos.push(`«${k}» ya filtra por clínica en la consulta: quítala de LECTURA_Y_COMPROBACION`);
  }
  assert.equal(fallos.length, 0, `\n${fallos.join("\n")}`);
});

test("cobertura: el control con ids de A conduce a las rutas canario y a la mayoría de las de sesión", () => {
  if (filtro) return;
  const por = new Map(controles.map((c) => [clave(c.metodo, c.ruta), c]));
  for (const k of CANARIOS) {
    const c = por.get(k);
    assert.ok(c, `el canario «${k}» no está en el barrido`);
    assert.ok(c.estado !== null && c.estado >= 200 && c.estado < 300, `el canario «${k}» no se deja conducir con ids de A (estado ${c.estado}${c.error ? `, ${c.error}` : ""}): el arnés está roto y todo «404» de B sería ruido`);
  }
  const ejercidas = controles.filter((c) => c.estado !== null && c.estado >= 200 && c.estado < 400).length;
  const conBase = controles.filter((c) => c.consultas > 0).length;
  // Suelo medido el 1-oct-2026 (ver REPORTE-ws1-t10): si baja, se rompió algo del arnés.
  assert.ok(ejercidas >= 120, `solo ${ejercidas} rutas de sesión se dejan conducir con ids de A (suelo 120)`);
  assert.ok(conBase >= 400, `solo ${conBase} rutas de sesión llegaron a la base con ids de A (suelo 400)`);
});

// ── La excepción: sedes del mismo dueño, y SOLO ellas ───────────────────────
test("sedes: las rutas de «mismo dueño» tocan solo la sede hermana — y nada si C es de otro dueño", { timeout: 600_000 }, async () => {
  const fallos: string[] = [];
  const vistas: string[] = [];
  const porClave = new Map<string, { ruta: RutaApi; metodo: Metodo }>();
  for (const r of rutas) for (const m of r.metodos) if (SEDES_DEL_MISMO_DUENO[clave(m, r.patron)]) porClave.set(clave(m, r.patron), { ruta: r, metodo: m });
  await sinRuido(async () => {
    for (const [k, { ruta, metodo }] of porClave) {
      const def = SEDES_DEL_MISMO_DUENO[k];
      const fuente = fuentes.get(ruta.archivo)!;
      // (1) C es sede hermana: se permite leer C (y escribir si la ruta lo declara); B sigue prohibida.
      const mismo = await ejecutarRuta(ruta, metodo, fuente, cargar, { permitidos: ["C"], permitidosEscritura: def.escribeEnC ? ["C"] : [], duenoDeC: "mismo" });
      // (0) La entrada tiene que hacer falta: con C PROHIBIDA, la ruta sí la toca.
      const prohibida = await ejecutarRuta(ruta, metodo, fuente, cargar);
      if (prohibida.veredicto !== "fuga") fallos.push(`${k} ya no toca la sede hermana: quítala de SEDES_DEL_MISMO_DUENO`);
      // (2) C es de OTRO dueño: no se puede tocar NADA que no sea de A.
      const otro = await ejecutarRuta(ruta, metodo, fuente, cargar, { permitidos: [], permitidosEscritura: [], duenoDeC: "otro" });
      vistas.push(k);
      if (mismo.veredicto === "fuga") fallos.push(`${k} con C hermana: ${mismo.fugas.slice(0, 3).map((f) => `${f.tipo} ${f.modelo} de ${f.dueno}`)} ${mismo.marcasEnRespuesta}`);
      if (mismo.veredicto === "sin-sesion") fallos.push(`${k}: el arnés no pudo entrar con la sesión de A`);
      if (otro.veredicto === "fuga") fallos.push(`${k} con C de OTRO dueño tocó datos que no son suyos: ${otro.fugas.slice(0, 3).map((f) => `${f.tipo} ${f.modelo} de ${f.dueno}`)} ${otro.marcasEnRespuesta}`);
    }
  });
  if (!filtro) assert.equal(vistas.length, Object.keys(SEDES_DEL_MISMO_DUENO).length);
  assert.equal(fallos.length, 0, `\n${fallos.join("\n")}`);
});

after(() => {
  const todos = [...resultados];
  const por = (v: string) => todos.filter((r) => r.veredicto === v).length;
  const ejercidas = controles.filter((c) => c.estado !== null && c.estado >= 200 && c.estado < 400).length;
  const otras = todos.filter((r) => OTRAS_RAICES.includes(raizDe(r.ruta))).length;
  console.log(
    `\n[aislamiento] ${rutas.length} rutas, ${todos.length} llamadas con ids de B — fuga ${por("fuga")}, bloqueada ${por("bloqueada")}, validada ${por("validada")}, sin-acceso-ajeno ${por("sin-acceso-ajeno")}, sin-base ${por("sin-base")}, sin-sesion ${por("sin-sesion")}` +
      `\n[aislamiento] control con ids de A: ${controles.length} llamadas de sesión de clínica, ${ejercidas} conducidas (2xx/3xx), ${controles.filter((c) => c.consultas > 0).length} llegaron a la base` +
      `\n[aislamiento] fuera de alcance (otra sesión / otra raíz de tenant): ${otras} llamadas en ${OTRAS_RAICES.join(", ")}`,
  );
});
