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
let guardarRestablecer: Ruta;
let RC: typeof import("@/lib/barber/recuperacion-cookie");
let C: typeof import("@/lib/barber/contrasena");
let MK: typeof import("@/lib/barber/marketing");

before(async () => {
  recuperar = (await import("@/app/api/barber/auth/recuperar/route")).POST as Ruta;
  confirmar = (await import("@/app/api/barber/auth/confirmar/route")).GET as Ruta;
  cambiar = (await import("@/app/api/barber/auth/contrasena/route")).POST as Ruta;
  guardarRestablecer = (await import("@/app/barber/restablecer/guardar/route")).POST as Ruta;
  RC = await import("@/lib/barber/recuperacion-cookie");
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
    // manda la nueva al SERVIDOR (ronda 2: nunca updateUser desde el
    // navegador) y termina en la entrada de Barber con el aviso.
    assert.match(leer("src/app/barber/recuperar/page.tsx"), /apiUrl="\/api\/barber\/auth\/recuperar"/);
    const form = sinComentarios(leer("src/app/barber/restablecer/restablecer-form.tsx"));
    assert.match(form, /await fetch\(guardarUrl,/);
    assert.ok(!/updateUser|supabase\/client/.test(form), "el navegador vuelve a cambiar la contraseña por su cuenta");
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

// ── 3. Contraseña temporal del equipo ──────────────────────────────────

describe("3 · contraseña temporal: criptográfica y obligatorio cambiarla", () => {
  test("la temporal sale de los bytes: forma fija, sin ambiguos y pasa la regla del dental", () => {
    const ceros = C.barberTempPasswordFromBytes(new Uint8Array(9));
    assert.equal(ceros, "Barber-AAAAAA222!");
    const altos = C.barberTempPasswordFromBytes(new Uint8Array(9).fill(255));
    assert.equal(altos, "Barber-999999999!");
    const forma = /^Barber-[A-HJ-NP-Z2-9]{6}[2-9]{3}!$/;
    for (let i = 0; i < 200; i++) {
      const bytes = Uint8Array.from({ length: 9 }, (_, j) => (i * 37 + j * 101) % 256);
      const p = C.barberTempPasswordFromBytes(bytes);
      assert.match(p, forma);
      assert.equal(C.problemaContrasenaNueva(p), null, `la temporal ${p} no pasa la regla de fuerza`);
    }
    assert.throws(() => C.barberTempPasswordFromBytes(new Uint8Array(8)));
    // 32 y 8 símbolos: byte % n reparte parejo (sin sesgo de módulo).
    const fuente = leer("src/lib/barber/contrasena.ts");
    assert.equal(/ALFABETO_TEMPORAL = "([^"]+)"/.exec(fuente)?.[1].length, 32);
    assert.equal(/DIGITOS_TEMPORAL = "([^"]+)"/.exec(fuente)?.[1].length, 8);
  });

  test("Equipo ya no usa Math.random: usa randomBytes", () => {
    const team = sinComentarios(leer("src/lib/barber/team.ts"));
    assert.ok(!/Math\.random/.test(team), "volvió Math.random a team.ts");
    assert.match(team, /barberTempPasswordFromBytes\(randomBytes\(BARBER_TEMP_PASSWORD_BYTES\)\)/);
    assert.match(team, /import \{ randomBytes \} from "node:crypto"/);
  });

  test("dar de alta crea la cuenta con la temporal y la marca de cambio en app_metadata", async () => {
    const { inviteMember } = await import("@/lib/barber/team");
    reiniciar();
    const ctx = {
      barberUserId: "bu-dueno",
      barbershopId: "shop-1",
      barbershop: { id: "shop-1", name: "La Navaja", parentId: null },
      user: { id: "bu-dueno", role: "OWNER", permissionsOverride: [] },
      barber: null,
      role: "OWNER",
    } as never;
    const r1 = await inviteMember(ctx, { email: "Pepe@Barberia.mx", firstName: "Pepe", lastName: "López", role: "BARBER" });
    const alta = llamadas.find((l) => l.que === "admin.createUser")?.args;
    assert.ok(alta, "no creó la cuenta");
    assert.deepEqual(alta.app_metadata, { barber_must_change_password: true });
    assert.equal(alta.user_metadata.barber_must_change_password, undefined, "la marca no va donde el usuario la puede borrar");
    assert.equal(alta.password, r1.tempPassword);
    assert.match(r1.tempPassword, /^Barber-[A-HJ-NP-Z2-9]{6}[2-9]{3}!$/);

    reiniciar();
    const r2 = await inviteMember(ctx, { email: "otro@barberia.mx", firstName: "Otro", lastName: "Más", role: "BARBER" });
    assert.notEqual(r1.tempPassword, r2.tempPassword);
  });

  test("getBarberContext lee la marca de app_metadata (user_metadata no cuenta)", async () => {
    const { getBarberContext } = await import("@/lib/barber-auth");
    conSesion({ marca: true });
    assert.equal((await getBarberContext())?.mustChangePassword, true);
    conSesion();
    assert.equal((await getBarberContext())?.mustChangePassword, false);
    conSesion();
    (estado.sesion as any).user_metadata = { barber_must_change_password: true };
    (estado.sesion as any).app_metadata = { barber_must_change_password: "true" };
    assert.equal((await getBarberContext())?.mustChangePassword, false, "solo un true literal en app_metadata cuenta");
  });

  test("cambio obligatorio: sin la actual, cambia contraseña Y marca juntas, y la persona sigue dentro", async () => {
    conSesion({ marca: true, vigente: "Barber-AAAAAA222!" });
    const res = await cambiar(post("/api/barber/auth/contrasena", { password: NUEVA, confirmacion: NUEVA }));
    assert.equal(res.status, 200);
    const admin = llamadas.filter((l) => l.que === "admin.updateUserById");
    assert.equal(admin.length, 1, "contraseña y marca en UNA sola llamada");
    assert.deepEqual(admin[0].args, {
      id: "sb-1",
      attrs: { password: NUEVA, app_metadata: { barber_must_change_password: false } },
    });
    assert.equal(estado.contrasenaVigente, NUEVA);
    assert.ok(!llamadas.some((l) => l.que === "sesion.signOut"));

    // Y ya sin marca, el contexto deja pasar al panel.
    const { getBarberContext } = await import("@/lib/barber-auth");
    assert.equal((await getBarberContext())?.mustChangePassword, false);
  });

  test("cambio obligatorio: quedarse con la temporal no vale, y la marca sigue", async () => {
    conSesion({ marca: true, vigente: "Barber-AAAAAA222!" });
    const res = await cambiar(post("/api/barber/auth/contrasena", { password: "Barber-AAAAAA222!", confirmacion: "Barber-AAAAAA222!" }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "igual");
    assert.ok(!llamadas.some((l) => l.que === "admin.updateUserById"));
    assert.equal((estado.sesion?.app_metadata as any).barber_must_change_password, true);
  });

  test("cambio obligatorio: si Supabase falla, la marca NO se quita", async () => {
    conSesion({ marca: true, vigente: "Barber-AAAAAA222!" });
    estado.errorUpdate = { message: "boom" };
    const res = await cambiar(post("/api/barber/auth/contrasena", { password: NUEVA, confirmacion: NUEVA }));
    assert.equal(res.status, 500);
    assert.equal((estado.sesion?.app_metadata as any).barber_must_change_password, true);
    assert.equal(estado.contrasenaVigente, "Barber-AAAAAA222!");
  });

  test("la marca sale de la CUENTA: pedir el camino obligatorio desde el cuerpo no salta la actual", async () => {
    conSesion();
    const res = await cambiar(
      post("/api/barber/auth/contrasena", { password: NUEVA, confirmacion: NUEVA, mustChangePassword: true, barber_must_change_password: true }),
    );
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "falta_actual");
    assert.ok(!llamadas.some((l) => l.que === "admin.updateUserById"));
  });

  test("el panel manda a cambiarla, y la pantalla del cambio vive fuera de (panel)", () => {
    const layout = sinComentarios(leer("src/app/barber/(panel)/layout.tsx"));
    const iSesion = layout.indexOf("if (!ctx) redirect(BARBER_LOGIN_PATH);");
    const iMarca = layout.indexOf("if (ctx.mustChangePassword) redirect(BARBER_CHANGE_PASSWORD_PATH);");
    assert.ok(iSesion > -1 && iMarca > iSesion, "el layout no manda a cambiar la temporal");
    assert.ok(iMarca < layout.indexOf("getBarberPlan("), "la marca va antes de cargar nada");
    assert.equal(C.BARBER_CHANGE_PASSWORD_PATH, "/barber/cambiar-contrasena");
    assert.ok(existsSync(join(RAIZ, "src/app/barber/cambiar-contrasena/page.tsx")));
    assert.ok(!existsSync(join(RAIZ, "src/app/barber/(panel)/cambiar-contrasena")), "dentro de (panel) sería un bucle");

    const pagina = sinComentarios(leer("src/app/barber/cambiar-contrasena/page.tsx"));
    assert.match(pagina, /if \(!ctx\) redirect\(BARBER_LOGIN_PATH\)/);
    assert.match(pagina, /if \(!ctx\.mustChangePassword\) redirect\("\/barber"\)/);
    const form = sinComentarios(leer("src/app/barber/cambiar-contrasena/cambio-obligatorio-form.tsx"));
    assert.match(form, /Cerrar sesión/, "sin salida, quien no es dueño de la cuenta se queda atrapado");
    const dental = /cl[ií]nica|dental|doctor|paciente|consultorio/i.exec(form + pagina);
    assert.equal(dental, null, `trae texto de clínicas: «${dental?.[0]}»`);
  });
});

// ── 4. Último acceso ───────────────────────────────────────────────────

describe("4 · «Último acceso» se escribe al entrar", () => {
  test("qué se escribe: solo un inicio de sesión más nuevo que lo guardado", () => {
    const t = "2026-11-17T15:00:00.000Z";
    assert.equal(C.ultimoAccesoPorEscribir(null, t)?.toISOString(), t);
    assert.equal(C.ultimoAccesoPorEscribir(new Date("2026-11-16T10:00:00Z"), t)?.toISOString(), t);
    assert.equal(C.ultimoAccesoPorEscribir(new Date(t), t), null, "mismo inicio de sesión: no se reescribe");
    assert.equal(C.ultimoAccesoPorEscribir(new Date("2026-11-18T00:00:00Z"), t), null, "nunca hacia atrás");
    assert.equal(C.ultimoAccesoPorEscribir(null, null), null);
    assert.equal(C.ultimoAccesoPorEscribir(null, undefined), null);
    assert.equal(C.ultimoAccesoPorEscribir(null, "no-es-fecha"), null);
  });

  test("al entrar se anota UNA vez por inicio de sesión, no en cada página", async () => {
    const { getBarberContext } = await import("@/lib/barber-auth");
    conSesion();
    estado.sesion!.last_sign_in_at = "2026-11-17T15:00:00.000Z";

    const ctx = await getBarberContext();
    assert.ok(ctx);
    assert.equal(estado.filas[0].lastLogin?.toISOString(), "2026-11-17T15:00:00.000Z");
    assert.equal(llamadas.filter((l) => l.que === "barberUser.updateMany").length, 1);

    // Más páginas con la misma sesión: nada que escribir.
    await getBarberContext();
    await getBarberContext();
    assert.equal(llamadas.filter((l) => l.que === "barberUser.updateMany").length, 1);

    // Vuelve a entrar al día siguiente: se anota otra vez.
    estado.sesion!.last_sign_in_at = "2026-11-18T09:30:00.000Z";
    await getBarberContext();
    assert.equal(estado.filas[0].lastLogin?.toISOString(), "2026-11-18T09:30:00.000Z");
  });

  test("va a todas las filas de ESA cuenta (una por sede) y a ninguna otra", async () => {
    const { getBarberContext } = await import("@/lib/barber-auth");
    conSesion();
    estado.sesion!.last_sign_in_at = "2026-11-17T15:00:00.000Z";
    estado.filas.push(
      { id: "bu-1b", supabaseId: "sb-1", barbershopId: "shop-2", isActive: true, role: "BARBER", permissionsOverride: [], lastLogin: null, createdAt: new Date("2026-11-05") },
      { id: "bu-2", supabaseId: "sb-2", barbershopId: "shop-1", isActive: true, role: "BARBER", permissionsOverride: [], lastLogin: null, createdAt: new Date("2026-11-02") },
    );
    await getBarberContext();
    const por = Object.fromEntries(estado.filas.map((f) => [f.id, f.lastLogin?.toISOString() ?? null]));
    assert.deepEqual(por, { "bu-1": "2026-11-17T15:00:00.000Z", "bu-1b": "2026-11-17T15:00:00.000Z", "bu-2": null });
    const where = llamadas.find((l) => l.que === "barberUser.updateMany")?.args.where;
    assert.equal(where.supabaseId, "sb-1", "el filtro sale de la sesión");
  });

  test("si la base falla al anotar, la entrada NO se frena", async () => {
    const { getBarberContext } = await import("@/lib/barber-auth");
    conSesion();
    estado.sesion!.last_sign_in_at = "2026-11-17T15:00:00.000Z";
    estado.updateManyRevienta = true;
    const errores: unknown[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => void errores.push(a);
    try {
      const ctx = await getBarberContext();
      assert.ok(ctx, "sin lastLogin se quedó fuera del panel");
      assert.equal(ctx.barberUserId, "bu-1");
    } finally {
      console.error = original;
    }
    assert.equal(errores.length, 1, "el fallo tiene que quedar en el log");
  });
});

// ── RONDA 2 · /barber/restablecer solo viniendo de un enlace ───────────

/** POST a /barber/restablecer/guardar, con o sin la cookie de recuperación. */
function guardar(body: unknown, cookie?: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = `${RC.BARBER_RECOVERY_COOKIE}=${cookie}`;
  return post("/barber/restablecer/guardar", body, headers);
}

describe("RONDA 2 · el restablecer exige el enlace (M1) y quita la marca (M3)", () => {
  test("la constancia: firmada, de ESE usuario, con caducidad, sin secreto no hay", () => {
    const env = { COOKIE_SECRET: "secreto-de-prueba" };
    const t0 = Date.UTC(2026, 10, 17, 15, 0, 0);
    const v = RC.firmarRecuperacion("sb-1", t0, env)!;
    assert.ok(v);
    assert.equal(RC.recuperacionValidaPara(v, "sb-1", t0, env), true);
    assert.equal(RC.recuperacionValidaPara(v, "sb-1", t0 + 9 * 60_000, env), true);
    assert.equal(RC.recuperacionValidaPara(v, "sb-1", t0 + 10 * 60_000, env), false, "a los 10 min ya no vale");
    assert.equal(RC.recuperacionValidaPara(v, "sb-2", t0, env), false, "es de otro usuario");
    assert.equal(RC.recuperacionValidaPara(v, "sb-1", t0, { COOKIE_SECRET: "otro" }), false, "otra llave");
    const [id, exp, firma] = v.split(".");
    assert.equal(RC.recuperacionValidaPara(`sb-2.${exp}.${firma}`, "sb-2", t0, env), false, "firma ajena");
    assert.equal(RC.recuperacionValidaPara(`${id}.${Number(exp) + 3600}.${firma}`, "sb-1", t0, env), false, "caducidad alargada");
    assert.equal(RC.recuperacionValidaPara(`${id}.${exp}.${firma.slice(0, -2)}xx`, "sb-1", t0, env), false);
    for (const basura of ["", "a.b", "a.b.c.d", null, undefined]) assert.equal(RC.recuperacionValidaPara(basura, "sb-1", t0, env), false);
    assert.equal(RC.firmarRecuperacion("sb-1", t0, {}), null, "sin secreto no se firma (falla cerrado)");
    assert.equal(RC.recuperacionValidaPara(v, "sb-1", t0, {}), false);
  });

  test("el enlace bueno deja la cookie: httpOnly, Secure, SameSite=Lax, de pocos minutos y ligada al usuario", async () => {
    reiniciar({ usuarioDelEnlace: { id: "sb-1" } });
    const res = await confirmar(new NextRequest("https://www.dalecontrol.com/api/barber/auth/confirmar?code=abc"));
    const sc = res.headers.get("set-cookie") ?? "";
    const m = new RegExp(`${RC.BARBER_RECOVERY_COOKIE}=([^;]+)`).exec(sc);
    assert.ok(m, `no dejó la cookie: ${sc}`);
    assert.equal(RC.recuperacionValidaPara(decodeURIComponent(m[1]), "sb-1"), true);
    assert.equal(RC.recuperacionValidaPara(decodeURIComponent(m[1]), "sb-otro"), false);
    assert.match(sc, /HttpOnly/i);
    assert.match(sc, /Secure/i);
    assert.match(sc, /SameSite=lax/i);
    assert.match(sc, /Path=\/barber\/restablecer/);
    assert.match(sc, /Max-Age=600/);
  });

  test("el enlace malo no deja constancia (y borra una anterior)", async () => {
    reiniciar({ errorCanje: { message: "expired" } });
    const res = await confirmar(new NextRequest("https://www.dalecontrol.com/api/barber/auth/confirmar?code=viejo"));
    const sc = res.headers.get("set-cookie") ?? "";
    assert.match(sc, new RegExp(`${RC.BARBER_RECOVERY_COOKIE}=;`));
    assert.match(sc, /Max-Age=0/);
  });

  test("M1: con una sesión NORMAL y sin cookie, no cambia nada", async () => {
    conSesion({ rol: "OWNER" });
    const res = await guardarRestablecer(guardar({ password: NUEVA, confirmacion: NUEVA }));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, "enlace_invalido");
    assert.equal(estado.contrasenaVigente, "Vieja-Clave-2026");
    assert.ok(!llamadas.some((l) => /updateUser|signOut/.test(l.que)), "tocó la cuenta sin enlace");
  });

  test("M1: cookie de OTRO usuario, caducada o alterada → no cambia nada", async () => {
    const t = Date.now();
    const casos: Array<[string, string]> = [
      ["de otro", RC.firmarRecuperacion("sb-otro")!],
      ["caducada", RC.firmarRecuperacion("sb-1", t - 11 * 60_000)!],
      ["alterada", RC.firmarRecuperacion("sb-1")!.replace(/.$/, (c) => (c === "A" ? "B" : "A"))],
      ["inventada", "sb-1.9999999999.abc"],
    ];
    for (const [nombre, cookie] of casos) {
      conSesion();
      const res = await guardarRestablecer(guardar({ password: NUEVA, confirmacion: NUEVA }, cookie));
      assert.equal(res.status, 401, nombre);
      assert.equal(estado.contrasenaVigente, "Vieja-Clave-2026", nombre);
      assert.ok(!llamadas.some((l) => l.que === "sesion.updateUser"), nombre);
    }
  });

  test("con la cookie buena: cambia la de ESE usuario, cierra la sesión y la cookie no sirve dos veces", async () => {
    conSesion();
    const cookie = RC.firmarRecuperacion("sb-1")!;
    const res = await guardarRestablecer(guardar({ password: NUEVA, confirmacion: NUEVA, supabaseId: "sb-otro" }, cookie));
    assert.equal(res.status, 200);
    assert.equal(estado.contrasenaVigente, NUEVA);
    assert.deepEqual(llamadas.find((l) => l.que === "sesion.updateUser")?.args, { password: NUEVA });
    assert.ok(llamadas.some((l) => l.que === "sesion.signOut"), "no cerró la sesión de recuperación");
    assert.ok(!llamadas.some((l) => l.que === "admin.updateUserById"), "sin marca no hace falta la service role");
    const sc = res.headers.get("set-cookie") ?? "";
    assert.match(sc, new RegExp(`${RC.BARBER_RECOVERY_COOKIE}=;`), "no borró la cookie");
    assert.match(sc, /Max-Age=0/);
    assert.match(sc, /Path=\/barber\/restablecer/);

    // La sesión de recuperación ya se cerró: la misma cookie, sin sesión, no abre nada.
    estado.sesion = null;
    const otra = await guardarRestablecer(guardar({ password: "Otra-Clave-2026", confirmacion: "Otra-Clave-2026" }, cookie));
    assert.equal(otra.status, 401);
    assert.equal(estado.contrasenaVigente, NUEVA);
  });

  test("con la cookie buena valen las mismas reglas: débil, no coinciden, igual → 400 y la cookie sigue", async () => {
    const cookie = () => RC.firmarRecuperacion("sb-1")!;
    for (const [cuerpo, code] of [
      [{ password: "abcdefgh", confirmacion: "abcdefgh" }, "debil"],
      [{ password: NUEVA, confirmacion: NUEVA + "x" }, "no_coinciden"],
    ] as const) {
      conSesion();
      const res = await guardarRestablecer(guardar(cuerpo, cookie()));
      assert.equal(res.status, 400);
      assert.equal((await res.json()).code, code);
      assert.equal(res.headers.get("set-cookie"), null, "un error de captura no gasta el enlace");
    }
    conSesion();
    estado.errorUpdate = { message: "New password should be different from the old password.", code: "same_password" };
    const res = await guardarRestablecer(guardar({ password: NUEVA, confirmacion: NUEVA }, cookie()));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "igual");
  });

  test("M3: quien recupera con la marca puesta ya no tiene que poner otra al entrar", async () => {
    conSesion({ marca: true });
    const res = await guardarRestablecer(guardar({ password: NUEVA, confirmacion: NUEVA }, RC.firmarRecuperacion("sb-1")!));
    assert.equal(res.status, 200);
    assert.deepEqual(llamadas.find((l) => l.que === "admin.updateUserById")?.args, {
      id: "sb-1",
      attrs: { app_metadata: { barber_must_change_password: false } },
    });
    const { getBarberContext } = await import("@/lib/barber-auth");
    assert.equal((await getBarberContext())?.mustChangePassword, false);
  });

  test("M3: si quitar la marca falla, la contraseña ya quedó y se avisa en el log", async () => {
    conSesion({ marca: true });
    estado.errorAdmin = { message: "boom" };
    const errores: unknown[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => void errores.push(a);
    try {
      const res = await guardarRestablecer(guardar({ password: NUEVA, confirmacion: NUEVA }, RC.firmarRecuperacion("sb-1")!));
      assert.equal(res.status, 200);
    } finally {
      console.error = original;
    }
    assert.equal(estado.contrasenaVigente, NUEVA);
    assert.equal(errores.length, 1);
  });

  test("la pantalla exige la cookie del usuario de la sesión; sin ella, a pedir el enlace", () => {
    const pagina = sinComentarios(leer("src/app/barber/restablecer/page.tsx"));
    assert.match(pagina, /valida = !!user && recuperacionValidaPara\(constancia, user\.id\)/);
    assert.match(pagina, /if \(!valida\) redirect\(BARBER_RECOVER_PATH\)/);
    assert.match(pagina, /guardarUrl=\{`\$\{BARBER_RESET_PATH\}\/guardar`\}/);
    // La cookie solo viaja a la pantalla y a su ruta de guardar.
    assert.equal(RC.BARBER_RECOVERY_COOKIE_PATH, C.BARBER_RESET_PATH);
    assert.ok(existsSync(join(RAIZ, "src/app/barber/restablecer/guardar/route.ts")));
    // Sin respaldo fijo para firmar.
    assert.doesNotMatch(sinComentarios(leer("src/lib/barber/recuperacion-cookie.ts")), /fallback|\|\| "/);
  });
});
