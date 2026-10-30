/* ============================================================
   BARRERAS DEL PANEL EN EL iPad: SIN BUCLE Y SIEMPRE CON SALIDA.

     npm run test:barreras-ipad

   Lo que encontró el repaso del arreglo del iPad (ws1-t1, 29-oct-2026) en
   panel.108, con WebKit y un miembro de prueba:
     · M2 — df_2fa_pending puesta y el 2FA ya no hace falta: /dashboard →
       /dashboard/2fa → /dashboard… 55 cargas en 30 s, 12 h, sin botón;
     · M3 — el reto 2FA y el enrolamiento obligatorio sin «Cerrar sesión»;
     · m1 «Te quedan 1 intentos», m3/m4 errores sin salida al login, m5 el
       login sin aviso tras el cambio forzado, m6 la píldora del login encima
       del texto, m7 recepción sin dónde cambiar su contraseña ni su 2FA, y los
       campos de menos de 16 px (iOS hace zoom al enfocar).
   Las pantallas son componentes de cliente y aquí no hay DOM: de esas se fija
   el cableado en la fuente. La salida del reto y la consulta del 2FA corren de
   verdad.
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "../../..");
const fuente = (rel: string) => readFileSync(join(SRC, rel), "utf8");

// ── Dobles: la base (que apunta qué se preguntó) y el `cache` de React ──
const consultas: Array<Record<string, unknown>> = [];
/** Lo que devuelve user.findMany: las fichas de la persona, con su clínica. */
let fichasFalsas: Array<Record<string, unknown>> = [];
const prismaFalso = {
  user: {
    findFirst: async (q: { where: Record<string, unknown> }) => { consultas.push(q.where); return null; },
    findMany: async (q: { where: Record<string, unknown> }) => {
      consultas.push(q.where);
      // Como la base: si la consulta filtrara las sedes archivadas, no llegarían.
      const filtraArchivadas = JSON.stringify(q.where).includes("archivedAt");
      return fichasFalsas.filter((f) => !filtraArchivadas || !(f.clinic as { archivedAt?: unknown })?.archivedAt);
    },
  },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...resto: unknown[]) {
  if (req === "@/lib/prisma") return { prisma: prismaFalso };
  if (req === "@/lib/auth/sesion-en-cache") return { marcarEscritura: () => undefined };
  if (req === "react") {
    const real = cargaOriginal.call(this, req, ...resto) as Record<string, unknown>;
    return { ...real, cache: <T,>(f: T) => f };
  }
  return cargaOriginal.call(this, req, ...resto);
};

/* ══════════════════ M2 · la salida del reto borra df_2fa_pending ══════════════════ */

async function salida(next?: string) {
  const { GET } = await import("@/app/api/auth/2fa/sin-reto/route");
  const { NextRequest } = await import("next/server");
  const url = `http://localhost/api/auth/2fa/sin-reto${next === undefined ? "" : `?next=${encodeURIComponent(next)}`}`;
  return GET(new NextRequest(url));
}

test("M2 · la salida del reto borra df_2fa_pending y manda al panel", async () => {
  const res = await salida();
  assert.equal(res.status, 307);
  assert.equal(res.headers.get("location"), "/dashboard");
  const pendiente = res.cookies.get("df_2fa_pending");
  assert.ok(pendiente, "no borra la cookie: el middleware volvería a mandar al reto");
  assert.equal(pendiente.value, "");
  assert.equal(pendiente.maxAge, 0);
});

test("M2 · la salida respeta un destino del panel y no abre redirecciones afuera", async () => {
  assert.equal((await salida("/dashboard/agenda")).headers.get("location"), "/dashboard/agenda");
  for (const malo of ["//evil.example", "https://evil.example", "/login", "/dashboard/sede-con-clave"]) {
    assert.equal((await salida(malo)).headers.get("location"), "/dashboard", malo);
  }
});

test("M2 · la salida se alcanza con la cookie puesta (exenta del corte del middleware)", async () => {
  const { RUTA_SIN_RETO } = await import("@/lib/auth/two-factor-constants");
  const { isTwoFactorGateAllowlistedPath } = await import("@/lib/auth/two-factor-gate");
  assert.equal(RUTA_SIN_RETO, "/api/auth/2fa/sin-reto");
  assert.equal(isTwoFactorGateAllowlistedPath(RUTA_SIN_RETO), true);
});

test("M2 · el reto y el enrolamiento salen al panel por la salida, nunca directo", () => {
  for (const pagina of ["app/dashboard/2fa/page.tsx", "app/dashboard/2fa/setup/page.tsx"]) {
    const src = fuente(pagina);
    assert.match(src, /redirect\(RUTA_SIN_RETO\)/, `${pagina}: no usa la salida`);
    assert.doesNotMatch(src, /redirect\("\/dashboard"\)/, `${pagina}: redirige directo al panel (el bucle)`);
  }
});

/* ── Revisión ws1-t9 · M1: el 2FA de una sede ARCHIVADA sigue contando (falla cerrado) ──
   Un doctor enrola su 2FA en la sede B; después le dan acceso a C (su ficha
   nace sin 2FA) y cierran B. Si el gate contara solo las sedes vivas, quien
   tuviera solo su contraseña entraría a C sin segundo factor, y con
   require2fa en C quedaría en un callejón (setup dice «ya está activo»). */
const SECRETO_B = "JBSWY3DPEHPK3PXP";
function fichasDelDoctor(require2faEnC = false) {
  return [
    { id: "u-b", clinicId: "cli-b", supabaseId: "sb-doc", totpEnabled: true, totpSecret: SECRETO_B, recoveryCodes: ["$2b$10$x"],
      clinic: { id: "cli-b", archivedAt: new Date("2026-10-20"), require2fa: false } },
    { id: "u-c", clinicId: "cli-c", supabaseId: "sb-doc", totpEnabled: false, totpSecret: null, recoveryCodes: [],
      clinic: { id: "cli-c", archivedAt: null, require2fa: require2faEnC } },
  ];
}

test("t9 M1 · personaTieneDosFactores cuenta también las sedes archivadas", async () => {
  const { personaTieneDosFactores } = await import("@/lib/auth/two-factor-identity");
  consultas.length = 0;
  await personaTieneDosFactores("sb-persona");
  assert.equal(consultas.length, 1);
  assert.deepEqual(consultas[0], { supabaseId: "sb-persona", isActive: true, totpEnabled: true });
});

test("t9 M1 · el gate: B archivada no se elige como sede, pero su 2FA cuenta → login a C pide el reto", async () => {
  const { resolverSesion } = await import("@/lib/auth/sesion-en-cache");
  const { decisionDosPasos } = await import("@/lib/auth/two-factor-gate");
  fichasFalsas = fichasDelDoctor();
  const r = await resolverSesion("sb-doc", "cli-c");
  assert.deepEqual(r.filas.map((f) => f.clinicId), ["cli-c"], "una sede archivada no existe para elegir");
  assert.equal(r.elegida?.clinicId, "cli-c");
  assert.equal(r.dosFactoresEnAlguna, true, "el 2FA de B se perdió al archivarla: entrada sin segundo factor");
  // Con la cookie apuntando a B (archivada) tampoco se elige B.
  assert.equal((await resolverSesion("sb-doc", "cli-b")).elegida?.clinicId, "cli-c");
  // La decisión del gate, con lo que le pasa el resolver (getCurrentUser y getAuthContext).
  assert.equal(decisionDosPasos({ totpEnabled: r.dosFactoresEnAlguna, require2fa: false, hasValidCookie: false }), "challenge");
  // Con require2fa en C: reto, NO «setup» (el setup diría «ya está activo»: callejón).
  fichasFalsas = fichasDelDoctor(true);
  const r2 = await resolverSesion("sb-doc", "cli-c");
  assert.equal(decisionDosPasos({ totpEnabled: r2.dosFactoresEnAlguna, require2fa: true, hasValidCookie: false }), "challenge");
});

test("t9 M1 · getCurrentUser y getAuthContext deciden con el 2FA de TODAS las fichas", () => {
  assert.match(fuente("lib/auth.ts"), /conDosFactoresDeLaPersona\(user, dosFactoresEnAlguna\)/);
  assert.match(fuente("lib/auth-context.ts"), /\.totpEnabled \|\| dosFactoresEnAlguna;/);
});

test("t9 M1 · verify valida en C con el secreto enrolado en B (archivada)", async () => {
  const { dosFactoresDeLaPersona } = await import("@/lib/auth/two-factor-identity");
  fichasFalsas = fichasDelDoctor();
  consultas.length = 0;
  const d = await dosFactoresDeLaPersona("sb-doc");
  assert.deepEqual(consultas[0], { supabaseId: "sb-doc", isActive: true });
  assert.equal(d.enrolado, true);
  assert.equal(d.totpSecret, SECRETO_B, "sin el secreto de B nadie podría contestar el reto en C");
});

/* ══════════════════ M3 · ninguna barrera del 2FA sin salida ══════════════════ */

test("M3 · el reto 2FA y el enrolamiento obligatorio tienen «Cerrar sesión»", () => {
  assert.match(fuente("components/dashboard/security/two-factor-challenge.tsx"), /<CerrarSesionBarrera\b/);
  assert.match(fuente("app/dashboard/2fa/setup/page.tsx"), /<CerrarSesionBarrera\b/);
  const boton = fuente("components/dashboard/security/cerrar-sesion-barrera.tsx");
  assert.match(boton, /cerrarSesionPanel\(/);
  assert.match(boton, /sedeClave\.pantalla\.cerrarSesion/);
});

/* ══════════════════ m3 · m4 · errores con el motivo real y salida al login ══════════════════ */

test("m3 · el reto enseña el motivo del servidor y ante un 401 manda a /login", () => {
  const src = fuente("components/dashboard/security/two-factor-challenge.tsx");
  assert.match(src, /res\.status === 401\)\s*\{\s*window\.location\.href = "\/login"/);
  assert.match(src, /data\?\.error/);
});

test("m4 · la clave de la sede con la sesión vencida (401) manda a /login", () => {
  const src = fuente("components/dashboard/sede-clave/pantalla-sede-con-clave.tsx");
  assert.match(src, /res\.status === 401\)\s*\{\s*window\.location\.href = "\/login"/);
});

/* ══════════════════ m1 · «Te queda 1 intento» ══════════════════ */

test("m1 · con un intento restante, singular (es y en)", () => {
  const es = JSON.parse(fuente("i18n/dictionaries/es.json"));
  const en = JSON.parse(fuente("i18n/dictionaries/en.json"));
  assert.equal(es.sedeClave.pantalla.incorrectaUna, "La clave no es correcta. Te queda 1 intento.");
  assert.equal(typeof en.sedeClave.pantalla.incorrectaUna, "string");
  assert.match(fuente("components/dashboard/sede-clave/pantalla-sede-con-clave.tsx"), /restantes === 1 \? t\("sedeClave\.pantalla\.incorrectaUna"\)/);
});

/* ══════════════════ m5 · aviso en /login tras el cambio forzado ══════════════════ */

test("m5 · tras el cambio forzado, /login dice «Listo. Entra con tu contraseña nueva.»", () => {
  assert.match(fuente("app/dashboard/cambiar-contrasena/change-password-client.tsx"), /window\.location\.href = "\/login\?cambiada=1"/);
  const pagina = fuente("app/login/page.tsx");
  assert.match(pagina, /cambiada: "Listo\. Entra con tu contraseña nueva\."/);
  assert.match(pagina, /<LoginForm aviso=\{aviso\} \/>/);
  assert.match(fuente("components/public/auth/login/login-form.tsx"), /\{aviso && !error && \(/);
});

/* ══════════════════ m6 · la píldora del login no tapa el texto ══════════════════ */

test("m6 · el texto del panel del login deja libre la franja de la píldora «Datos cifrados»", () => {
  const src = fuente("components/public/auth/login/login-visual.tsx");
  // La píldora: absoluta, abajo, ~32 px de alto a 18 px del borde.
  assert.match(src, /position: "absolute", zIndex: 4, right: 20, bottom: 18/);
  assert.match(src, /maxWidth: 460, paddingBottom: 40 \}/);
});

/* ══════════════════ m7 · contraseña y 2FA propios en Mi perfil, para todo rol ══════════════════ */

test("m7 · Mi perfil trae «Contraseña» y «Verificación en dos pasos», con lo mismo que Configuración", () => {
  const cliente = fuente("app/dashboard/mi-perfil/mi-perfil-client.tsx");
  assert.match(cliente, /useCambioDeContrasena\("mi-perfil"\)/);
  // Solo lo propio: la política de la clínica se queda en Configuración.
  assert.match(cliente, /<TwoFactorCard initialEnabled=\{totpEnabled\} initialRequire2fa=\{require2fa\} isAdmin=\{false\} \/>/);
  // Sin duplicar: Configuración usa el mismo hook y ya no llama a Supabase por su cuenta.
  const ajustes = fuente("app/dashboard/settings/settings-client.tsx");
  assert.match(ajustes, /useCambioDeContrasena\("settings"\)/);
  assert.doesNotMatch(ajustes, /updateUser\(/);
  // Mi perfil no pide permiso propio: la página resuelve la sesión con getCurrentUser
  // (2FA y clave de la sede incluidos) y no mira settings.view.
  const pagina = fuente("app/dashboard/mi-perfil/page.tsx");
  assert.match(pagina, /await getCurrentUser\(\)/);
  assert.doesNotMatch(pagina, /["']settings\.view["']|hasPermission\(|requirePermission\(/);
});

/* ══════════════════ iPad real · 16 px y el Llavero ══════════════════ */

test("iPad · los campos de las barreras van a 16 px y la clave no se ofrece como contraseña de la cuenta", () => {
  const clave = fuente("components/dashboard/sede-clave/pantalla-sede-con-clave.tsx");
  assert.match(clave, /autoComplete="one-time-code"/);
  assert.match(clave, /style=\{\{ height: 44, fontSize: 16 \}\}/);
  assert.doesNotMatch(clave, /inputMode=/, "la clave admite letras: sin teclado numérico");
  const cambio = fuente("app/dashboard/cambiar-contrasena/change-password-client.tsx");
  assert.equal((cambio.match(/fontSize=\{16\}/g) ?? []).length, 2);
  // El sitio público se queda como estaba.
  assert.match(fuente("components/public/auth/password-input.tsx"), /fontSize = 14,/);
});
