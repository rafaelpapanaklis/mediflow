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
let C: typeof import("@/lib/barber/contrasena");
let MK: typeof import("@/lib/barber/marketing");

before(async () => {
  recuperar = (await import("@/app/api/barber/auth/recuperar/route")).POST as Ruta;
  confirmar = (await import("@/app/api/barber/auth/confirmar/route")).GET as Ruta;
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

void estado;
