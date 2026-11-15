// CONTRASEÑA EN BARBER (ws6-t8; auditoría 14-nov M1, M4, M5).
//
// Las rutas se cargan ENTERAS con dobles de Supabase, del freno y de Prisma
// (_dobles-contrasena.ts): se prueba lo que contestan de verdad, no el texto
// del código. Lo estático (que nadie lleve al dental) va aparte y al final.
//
//   npx tsx --test src/lib/barber/__tests__/contrasena.test.ts
import { estado, llamadas, reiniciar, RAIZ } from "./_dobles-contrasena";
import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

type Ruta = (req: NextRequest) => Promise<Response>;

let recuperar: Ruta;
let confirmar: Ruta;
let cambiar: Ruta;
let C: typeof import("@/lib/barber/contrasena");
let MK: typeof import("@/lib/barber/marketing");

before(async () => {
  recuperar = (await import("@/app/api/barber/auth/recuperar/route")).POST as Ruta;
  confirmar = (await import("@/app/api/barber/auth/confirmar/route")).GET as Ruta;
  cambiar = (await import("@/app/api/barber/auth/contrasena/route")).POST as Ruta;
  C = await import("@/lib/barber/contrasena");
  MK = await import("@/lib/barber/marketing");
});

const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

function post(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://www.dalecontrol.com${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// ── 1. Recuperar ───────────────────────────────────────────────────────

describe("1 · recuperar la contraseña sin salir de Barber", () => {
  test("«Olvidé mi contraseña» apunta a la pantalla propia, y existe", () => {
    assert.equal(MK.BARBER_FORGOT_PASSWORD_PATH, C.BARBER_RECOVER_PATH);
    assert.equal(C.BARBER_RECOVER_PATH, "/barber/recuperar");
    for (const rel of ["src/app/barber/recuperar/page.tsx", "src/app/barber/restablecer/page.tsx"]) {
      assert.ok(existsSync(join(RAIZ, rel)), `${rel} no existe`);
    }
  });

  test("misma llamada de Supabase, y el enlace del correo regresa a Barber", async () => {
    reiniciar();
    const res = await recuperar(post("/api/barber/auth/recuperar", { email: "Ana@Barberia.MX" }, { origin: "https://www.dalecontrol.com" }));
    assert.equal(res.status, 200);
    const pedido = llamadas.find((l) => l.que === "resetPasswordForEmail");
    assert.ok(pedido, "no llamó a resetPasswordForEmail");
    assert.equal(pedido.args.email, "ana@barberia.mx");
    assert.equal(pedido.args.opts.redirectTo, "https://www.dalecontrol.com/api/barber/auth/confirmar");
  });

  test("el origen del enlace NO sale del header Origin (lista fija del servidor)", async () => {
    reiniciar();
    await recuperar(post("/api/barber/auth/recuperar", { email: "ana@barberia.mx" }, { origin: "https://malo.example" }));
    const pedido = llamadas.find((l) => l.que === "resetPasswordForEmail");
    assert.ok(!String(pedido?.args.opts.redirectTo).includes("malo.example"));
  });

  test("no revela si el correo existe: «no existe» contesta igual que «sí»", async () => {
    reiniciar();
    const si = await recuperar(post("/api/barber/auth/recuperar", { email: "ana@barberia.mx" }));
    reiniciar({ errorReset: { message: "User not found" } });
    const no = await recuperar(post("/api/barber/auth/recuperar", { email: "nadie@barberia.mx" }));
    assert.equal(si.status, no.status);
    assert.deepEqual(await si.json(), await no.json());
  });

  test("mismos frenos que el dental, con LA MISMA llave, antes de Supabase", async () => {
    reiniciar();
    await recuperar(post("/api/barber/auth/recuperar", { email: "ana@barberia.mx" }));
    const frenos = llamadas.filter((l) => l.que === "rateLimit").map((l) => l.args);
    assert.deepEqual(frenos, [
      { llave: "/api/auth/forgot-password:ip", limit: 5, windowSec: 60 },
      { llave: "/api/auth/forgot-password:acct:ana@barberia.mx", limit: 3, windowSec: 300 },
    ]);
    // El del dental usa por defecto su pathname como llave: es la misma cubeta.
    const dental = sinComentarios(leer("src/app/api/auth/forgot-password/route.ts"));
    assert.match(dental, /persistentRateLimit\(req, \{ limit: 5, windowSec: 60 \}\)/);
    assert.match(dental, /id: `acct:\$\{email\}`, limit: 3, windowSec: 300/);

    for (const llave of ["/api/auth/forgot-password:ip", "/api/auth/forgot-password:acct:ana@barberia.mx"]) {
      reiniciar({ frenar: (k) => k === llave });
      const res = await recuperar(post("/api/barber/auth/recuperar", { email: "ana@barberia.mx" }));
      assert.equal(res.status, 429, llave);
      assert.ok(!llamadas.some((l) => l.que === "resetPasswordForEmail"), "llegó a Supabase con el freno puesto");
    }
  });

  test("correo mal escrito: 400 y no toca Supabase", async () => {
    reiniciar();
    const res = await recuperar(post("/api/barber/auth/recuperar", { email: "no-es-correo" }));
    assert.equal(res.status, 400);
    assert.ok(!llamadas.some((l) => l.que === "resetPasswordForEmail"));
  });

  test("el enlace del correo: bien → /barber/restablecer; caducado → /barber/restablecer?error", async () => {
    const ir = (qs: string) => confirmar(new NextRequest(`https://www.dalecontrol.com/api/barber/auth/confirmar${qs}`));
    const destino = (r: Response) => new URL(r.headers.get("location") ?? "").pathname + new URL(r.headers.get("location") ?? "").search;

    reiniciar();
    assert.equal(destino(await ir("?code=abc")), "/barber/restablecer");
    assert.deepEqual(llamadas.find((l) => l.que === "exchangeCodeForSession")?.args, "abc");

    reiniciar();
    assert.equal(destino(await ir("?token_hash=th&type=recovery")), "/barber/restablecer");
    assert.deepEqual(llamadas.find((l) => l.que === "verifyOtp")?.args, { type: "recovery", token_hash: "th" });

    for (const qs of ["?error=access_denied&error_code=otp_expired", "", "?token_hash=th&type=email"]) {
      reiniciar();
      assert.equal(destino(await ir(qs)), "/barber/restablecer?error=link_invalido", qs);
    }
    reiniciar({ errorCanje: { message: "expired" } });
    assert.equal(destino(await ir("?code=viejo")), "/barber/restablecer?error=link_invalido");

    // Destino fijo: un `next` en la URL no lleva a ningún lado.
    reiniciar();
    assert.equal(destino(await ir("?code=abc&next=//malo.example")), "/barber/restablecer");
  });

  test("las pantallas nuevas no llevan al dental ni hablan de clínicas", () => {
    const archivos = [
      "src/app/barber/recuperar/page.tsx",
      "src/app/barber/recuperar/recuperar-form.tsx",
      "src/app/barber/restablecer/page.tsx",
      "src/app/barber/restablecer/restablecer-form.tsx",
      "src/app/barber/restablecer/piezas.tsx",
    ];
    for (const rel of archivos) {
      const codigo = sinComentarios(leer(rel));
      assert.doesNotMatch(codigo, /["'`]\/(login|forgot-password|reset-password)["'`?#]/, rel);
      const dental = /cl[ií]nica|dental|doctor|paciente|consultorio/i.exec(codigo);
      assert.equal(dental, null, `${rel} trae texto de clínicas: «${dental?.[0]}»`);
    }
    // La pantalla de recuperar llama a la ruta propia; la de restablecer
    // cambia la contraseña igual que el dental (updateUser con la sesión de
    // recuperación) y termina en la entrada de Barber con el aviso.
    assert.match(leer("src/app/barber/recuperar/page.tsx"), /apiUrl="\/api\/barber\/auth\/recuperar"/);
    const form = sinComentarios(leer("src/app/barber/restablecer/restablecer-form.tsx"));
    assert.match(form, /auth\.updateUser\(\{ password: nueva \}\)/);
    assert.match(form, /window\.location\.href = loginListoHref/);
  });

  test("/barber/entrar pinta «Listo, ya puedes entrar» solo con el valor fijo", () => {
    const pagina = sinComentarios(leer("src/app/barber/entrar/page.tsx"));
    assert.match(pagina, /sp\[BARBER_PASSWORD_READY_PARAM\.name\] === BARBER_PASSWORD_READY_PARAM\.value/);
    assert.match(pagina, /"Listo, ya puedes entrar con tu contraseña nueva\."/);
    assert.deepEqual(C.BARBER_PASSWORD_READY_PARAM, { name: "contrasena", value: "lista" });
  });
});

// ── 2. Cambiar mi contraseña dentro del panel ──────────────────────────

/** Una persona del panel con sesión abierta. `marca` = temporal pendiente. */
function conSesion(opts: { rol?: string; marca?: boolean; vigente?: string } = {}) {
  reiniciar({
    sesion: {
      id: "sb-1",
      email: "luis@barberia.mx",
      last_sign_in_at: null,
      app_metadata: opts.marca ? { barber_must_change_password: true } : {},
    },
    contrasenaVigente: opts.vigente ?? "Vieja-Clave-2026",
    filas: [
      {
        id: "bu-1",
        supabaseId: "sb-1",
        barbershopId: "shop-1",
        email: "luis@barberia.mx",
        role: opts.rol ?? "BARBER",
        isActive: true,
        permissionsOverride: [],
        lastLogin: null,
        createdAt: new Date("2026-11-01"),
      },
    ],
  });
}

const NUEVA = "Nueva-Clave-2026";

describe("2 · cambiar mi contraseña dentro del panel", () => {
  test("sin sesión: 401 y no toca nada", async () => {
    reiniciar();
    const res = await cambiar(post("/api/barber/auth/contrasena", { password: NUEVA, confirmacion: NUEVA, currentPassword: "x" }));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, "sin_sesion");
    assert.ok(!llamadas.some((l) => /updateUser/.test(l.que)));
  });

  test("con la actual correcta cambia CON LA SESIÓN de la persona y no la cierra", async () => {
    conSesion({ rol: "BARBER" });
    const res = await cambiar(
      post("/api/barber/auth/contrasena", { currentPassword: "Vieja-Clave-2026", password: NUEVA, confirmacion: NUEVA }),
    );
    assert.equal(res.status, 200);
    assert.equal(estado.contrasenaVigente, NUEVA);
    assert.ok(llamadas.some((l) => l.que === "sesion.updateUser"), "cambió por otra vía");
    assert.ok(!llamadas.some((l) => l.que === "admin.updateUserById"), "usó la service role en un cambio voluntario");
    assert.ok(!llamadas.some((l) => l.que === "sesion.signOut"), "cerró la sesión del navegador");
    // La sonda que comprobó la actual se cierra SOLO a sí misma.
    assert.deepEqual(llamadas.find((l) => l.que === "sonda.signOut")?.args, { scope: "local" });
  });

  test("cualquier rol puede (la ruta no pide permisos del panel)", async () => {
    for (const rol of ["OWNER", "MANAGER", "RECEPTION", "BARBER"]) {
      conSesion({ rol });
      const res = await cambiar(
        post("/api/barber/auth/contrasena", { currentPassword: "Vieja-Clave-2026", password: NUEVA, confirmacion: NUEVA }),
      );
      assert.equal(res.status, 200, rol);
    }
  });

  test("lo que se rechaza, con su código y sin cambiar nada", async () => {
    const casos: Array<[string, Record<string, string>, string]> = [
      ["sin actual", { password: NUEVA, confirmacion: NUEVA }, "falta_actual"],
      ["actual mala", { currentPassword: "otra", password: NUEVA, confirmacion: NUEVA }, "actual_incorrecta"],
      ["débil", { currentPassword: "Vieja-Clave-2026", password: "abcdefgh", confirmacion: "abcdefgh" }, "debil"],
      ["corta", { currentPassword: "Vieja-Clave-2026", password: "Ab1!", confirmacion: "Ab1!" }, "debil"],
      ["larga", { currentPassword: "Vieja-Clave-2026", password: "Aa1!" + "x".repeat(70), confirmacion: "Aa1!" + "x".repeat(70) }, "larga"],
      ["no coinciden", { currentPassword: "Vieja-Clave-2026", password: NUEVA, confirmacion: NUEVA + "x" }, "no_coinciden"],
      ["igual", { currentPassword: "Vieja-Clave-2026", password: "Vieja-Clave-2026", confirmacion: "Vieja-Clave-2026" }, "igual"],
    ];
    for (const [nombre, cuerpo, code] of casos) {
      conSesion();
      const res = await cambiar(post("/api/barber/auth/contrasena", cuerpo));
      assert.equal(res.status, 400, nombre);
      assert.equal((await res.json()).code, code, nombre);
      assert.equal(estado.contrasenaVigente, "Vieja-Clave-2026", `${nombre}: cambió la contraseña`);
    }
  });

  test("Supabase la rechaza por filtrada: código propio, 400", async () => {
    conSesion();
    estado.errorUpdate = { message: "Password is known to be weak and easy to guess", code: "weak_password", reasons: ["pwned"] } as never;
    const res = await cambiar(
      post("/api/barber/auth/contrasena", { currentPassword: "Vieja-Clave-2026", password: NUEVA, confirmacion: NUEVA }),
    );
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "filtrada");
  });

  test("freno a quien adivina la actual: el MISMO del dental (10 cada 15 min por persona)", async () => {
    conSesion();
    await cambiar(post("/api/barber/auth/contrasena", { currentPassword: "otra", password: NUEVA, confirmacion: NUEVA }));
    assert.deepEqual(
      llamadas.filter((l) => l.que === "rateLimit").map((l) => l.args),
      [{ llave: "cambio-contrasena:actual:sb-1", limit: 10, windowSec: 900 }],
    );
    const dental = sinComentarios(leer("src/app/api/auth/change-password/route.ts"));
    assert.match(dental, /scope: "cambio-contrasena:actual", limit: 10, windowSec: 15 \* 60/);

    conSesion();
    estado.frenar = () => true;
    const res = await cambiar(
      post("/api/barber/auth/contrasena", { currentPassword: "Vieja-Clave-2026", password: NUEVA, confirmacion: NUEVA }),
    );
    assert.equal(res.status, 429);
    assert.ok(!llamadas.some((l) => l.que === "sonda.signIn"), "probó la actual con el freno puesto");
  });

  test("el usuario es el de la sesión: un id en el cuerpo no cambia a nadie más", async () => {
    conSesion();
    await cambiar(
      post("/api/barber/auth/contrasena", {
        currentPassword: "Vieja-Clave-2026",
        password: NUEVA,
        confirmacion: NUEVA,
        supabaseId: "sb-otro",
        email: "otro@barberia.mx",
      }),
    );
    for (const l of llamadas.filter((x) => x.que === "sonda.signIn")) assert.equal(l.args.email, "luis@barberia.mx");
    assert.ok(!JSON.stringify(llamadas).includes("sb-otro"));
  });

  test("Configuración: menú para todos los roles; sin settings.edit, solo «Tu contraseña»", () => {
    const layout = sinComentarios(leer("src/app/barber/(panel)/layout.tsx"));
    const iConfig = layout.indexOf('if (item.key === "configuracion") return true;');
    assert.ok(iConfig > -1 && iConfig < layout.indexOf("item.permission &&"), "Configuración sigue filtrada por permiso");
    const pagina = sinComentarios(leer("src/app/barber/(panel)/configuracion/page.tsx"));
    assert.match(pagina, /if \(!hasBarberPermission\(permUser, "settings\.edit"\)\) \{\s*return <MiCuentaScreen dict=\{dict\} \/>;/);
    assert.match(leer("src/components/barber/configuracion/configuracion-screen.tsx"), /<MiContrasenaCard dict=\{dict\} \/>/);
  });

  test("textos es/en completos para cada código que puede llegar", () => {
    const card = leer("src/components/barber/configuracion/mi-contrasena-card.tsx");
    const codigos = [...card.slice(card.indexOf("const CODIGOS"), card.indexOf("]);")).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    const ruta = leer("src/app/api/barber/auth/contrasena/route.ts");
    const deRuta = [...ruta.slice(ruta.indexOf("const TEXTO"), ruta.indexOf("};", ruta.indexOf("const TEXTO"))).matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1]);
    for (const c of deRuta) assert.ok(codigos.includes(c), `la pantalla no conoce el código «${c}»`);
    for (const idioma of ["es", "en"]) {
      const d = JSON.parse(leer(`src/i18n/dictionaries/barber/ajustes.${idioma}.json`)).configuracion.password;
      for (const llave of ["title", "sub", "accountTitle", "accountSub", "current", "new", "newHint", "confirm", "save", "saved"]) {
        assert.ok(typeof d[llave] === "string" && d[llave], `${idioma}: falta ${llave}`);
      }
      for (const c of codigos) assert.ok(d.errors[c], `${idioma}: falta errors.${c}`);
    }
  });
});
