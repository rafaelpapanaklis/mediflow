// LA ENTRADA PROPIA DEL VERTICAL (auditoría 14-nov, G5).
//
// Lo que pasó: «Entrar» de /barberias, el final del registro, el cierre de
// sesión y /barber sin sesión llevaban a /login, que es la pantalla de las
// clínicas dentales. Un barbero que volvía creía que se había equivocado de
// sitio, se registraba otra vez y acababa con dos barberías.
//
// Estas pruebas son ESTÁTICAS (leen el código fuente) más las funciones
// puras de rutas: no necesitan Postgres, ni navegador, ni sesión.
//
//   npx tsx --test src/lib/barber/__tests__/entrada-propia.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  BARBER_BILLING_PATH,
  BARBER_LOGIN_PATH,
  BARBER_REGISTER_PATH,
  barberPathWithPlan,
} from "@/lib/barber/marketing";

const RAIZ = join(__dirname, "..", "..", "..", ".."); // → raíz del repo

function leer(rel: string): string {
  return readFileSync(join(RAIZ, rel), "utf8");
}

/** Quita comentarios: lo que se prueba es el código que corre, no lo que se cuenta. */
function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function recorrer(dir: string, out: string[] = []): string[] {
  for (const entrada of readdirSync(dir).sort()) {
    const p = join(dir, entrada);
    if (statSync(p).isDirectory()) {
      if (entrada !== "__tests__") recorrer(p, out);
    } else if (/[.]tsx?$/.test(entrada)) out.push(p);
  }
  return out;
}

const PAGINA = "src/app/barber/entrar/page.tsx";
const FORMULARIO = "src/app/barber/entrar/entrar-form.tsx";
const REGISTRO = "src/app/barber/registro/page.tsx";
const REGISTRO_FORM = "src/components/barber/barber-registro-form.tsx";

// ── 1. La constante y el viaje del plan ────────────────────────────────

test("BARBER_LOGIN_PATH es la entrada del vertical, no el /login dental", () => {
  assert.equal(BARBER_LOGIN_PATH, "/barber/entrar");
  assert.ok(existsSync(join(RAIZ, PAGINA)), `${PAGINA} no existe: la constante apunta a un 404`);
});

test("barberPathWithPlan solo cuelga planes de la casa", () => {
  assert.equal(barberPathWithPlan(BARBER_REGISTER_PATH, "PROFESIONAL"), "/barber/registro?plan=PROFESIONAL");
  assert.equal(barberPathWithPlan(BARBER_BILLING_PATH, "BASICO"), "/barber/suscripcion?plan=BASICO");
  // Lo que venga de una URL y no sea un id conocido NO se pega a la ruta.
  for (const basura of [null, undefined, "", "profesional", "GRATIS", "BASICO&x=1", ["BASICO"], 3, "//evil.test"]) {
    assert.equal(barberPathWithPlan(BARBER_LOGIN_PATH, basura), BARBER_LOGIN_PATH, `se coló: ${String(basura)}`);
  }
});

// ── 2. Nadie del vertical vuelve a mandar a /login ─────────────────────

test("ningún archivo del vertical lleva a /login", () => {
  const carpetas = [
    "src/app/barber",
    "src/app/barberias",
    "src/components/barber",
    "src/components/public/barberias",
  ];
  const culpables: string[] = [];
  for (const carpeta of carpetas) {
    for (const archivo of recorrer(join(RAIZ, carpeta))) {
      const codigo = sinComentarios(readFileSync(archivo, "utf8"));
      if (/["'`]\/login["'`?#/]/.test(codigo)) culpables.push(relative(RAIZ, archivo));
    }
  }
  assert.deepEqual(
    culpables,
    [],
    `estos archivos mandan al /login de las clínicas; usa BARBER_LOGIN_PATH (${BARBER_LOGIN_PATH})`,
  );
});

test("cada página del panel, sin sesión, manda a la entrada del vertical", () => {
  const paginas = recorrer(join(RAIZ, "src/app/barber/(panel)")).filter((p) => p.endsWith("page.tsx"));
  assert.ok(paginas.length >= 26, `solo se encontraron ${paginas.length} páginas: ¿se movió el panel?`);
  const malas: string[] = [];
  for (const archivo of paginas) {
    const codigo = sinComentarios(readFileSync(archivo, "utf8"));
    // La literal va escrita a mano en las páginas (una línea, sin import, para
    // no chocar con las ramas que trabajan a la vez): por eso se vigila aquí.
    const guardia = /if \(!ctx\) redirect\((?:"([^"]+)"|BARBER_LOGIN_PATH)\)/.exec(codigo);
    if (!guardia || (guardia[1] !== undefined && guardia[1] !== BARBER_LOGIN_PATH)) {
      malas.push(relative(RAIZ, archivo));
    }
  }
  assert.deepEqual(malas, [], `sin guard de sesión hacia ${BARBER_LOGIN_PATH}`);

  for (const rel of ["src/app/barber/page.tsx", "src/app/barber/(panel)/layout.tsx"]) {
    assert.match(sinComentarios(leer(rel)), /if \(!ctx\) redirect\(BARBER_LOGIN_PATH\)/, rel);
  }
});

// ── 3. /barber/entrar: mismo inicio de sesión, cara de Barber ──────────

test("/barber/entrar usa el inicio de sesión de siempre y sale a /barber", () => {
  const form = sinComentarios(leer(FORMULARIO));
  assert.match(form, /fetch\("\/api\/auth\/login"/, "tiene que llamar al MISMO endpoint que /login");
  assert.match(form, /fetch\("\/api\/auth\/post-login"/);
  assert.match(form, /window\.location\.href = destino/);

  const pagina = sinComentarios(leer(PAGINA));
  assert.match(pagina, /: "\/barber"/, "sin plan elegido el destino es /barber");
  assert.match(pagina, /if \(ctx\) redirect\(destino\)/, "con sesión de barbería no se pide nada");
});

test("/barber/entrar NO es del panel: sin candado de pago y fuera de (panel)", () => {
  const pagina = sinComentarios(leer(PAGINA));
  assert.ok(!pagina.includes("requireBarberPaidAccess"), "por aquí entra también quien no ha pagado");
  assert.ok(!existsSync(join(RAIZ, "src/app/barber/(panel)/entrar")), "dentro de (panel) heredaría el menú y el guard");
});

test("/barber/entrar no habla de clínicas y ofrece registro y recuperar contraseña", () => {
  const form = sinComentarios(leer(FORMULARIO));
  const pagina = sinComentarios(leer(PAGINA));
  for (const [nombre, codigo] of [[FORMULARIO, form], [PAGINA, pagina]] as const) {
    const dental = /cl[ií]nica|dental|doctor|paciente|consultorio|NOM-024|CFDI/i.exec(codigo);
    assert.equal(dental, null, `${nombre} trae texto de clínicas: «${dental?.[0]}»`);
  }
  assert.match(form, /¿No tienes cuenta\?/);
  assert.match(form, /Registra tu barbería/);
  assert.match(form, /Olvidé mi contraseña/);
  assert.match(form, /href=\{registerHref\}/);
  assert.match(form, /href=\{forgotHref\}/);
});

// ── 4. El registro ─────────────────────────────────────────────────────

test("/barber/registro con sesión de barbería no registra otra", () => {
  const pagina = sinComentarios(leer(REGISTRO));
  assert.match(pagina, /const ctx = await getBarberContext\(\);\s*if \(ctx\) redirect\(/);
  assert.match(pagina, /: "\/barber"\)/);
  assert.match(pagina, /barberPathWithPlan\(BARBER_BILLING_PATH, plan\)/, "con plan elegido va directo a Suscripción");
});

test("el registro termina en la entrada del vertical y lleva el plan", () => {
  const pagina = sinComentarios(leer(REGISTRO));
  assert.match(pagina, /loginHref=\{barberPathWithPlan\(BARBER_LOGIN_PATH, plan\)\}/);
  const form = sinComentarios(leer(REGISTRO_FORM));
  assert.match(form, /window\.location\.href = loginHref/);
});

test("correo repetido: el servidor lo marca y el formulario da las dos salidas", () => {
  const ruta = sinComentarios(leer("src/app/api/barber/auth/register/route.ts"));
  assert.match(ruta, /code: "EMAIL_TAKEN"/);
  const form = sinComentarios(leer(REGISTRO_FORM));
  assert.match(form, /data\?\.code === "EMAIL_TAKEN"/);
  assert.match(form, /emailTaken && \([\s\S]*?href=\{loginHref\}[\s\S]*?Iniciar sesión[\s\S]*?href=\{forgotHref\}[\s\S]*?Recuperar contraseña/);
});

// ── 5. El plan de la portada llega a Suscripción ───────────────────────

test("los botones de plan de la portada llevan ?plan= y Suscripción lo recibe", () => {
  const precios = sinComentarios(leer("src/components/public/barberias/pricing.tsx"));
  assert.match(precios, /href=\{barberPathWithPlan\(BARBER_REGISTER_PATH, c\.id\)\}/);

  const entrar = sinComentarios(leer(PAGINA));
  assert.match(entrar, /barberPathWithPlan\(BARBER_BILLING_PATH, plan\)/);

  const suscripcion = sinComentarios(leer("src/app/barber/(panel)/suscripcion/page.tsx"));
  assert.match(suscripcion, /chosenPlanId=\{isBarberPlanId\(searchParams\?\.plan\) \? searchParams\.plan : null\}/);
  const pantalla = sinComentarios(leer("src/components/barber/billing/billing-screen.tsx"));
  assert.match(pantalla, /barber\.suscripcion\.chosen\.title/);
});
