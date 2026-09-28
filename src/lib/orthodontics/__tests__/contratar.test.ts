/**
 * Contratar Ortodoncia — candados (ws1-t3, 28-sep-2026).
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/contratar.test.ts
 *
 * Lo que fija:
 *  1. La REDIRECCIÓN del guardia: sin módulo se va a la página de contratar
 *     (no a /dashboard ni a un error); esa página nunca se redirige a sí
 *     misma; sin permiso o fuera de dental, a /dashboard como siempre.
 *  2. El layout del módulo y la página usan esa decisión y no otra.
 *  3. El CANDADO: qué clínicas lo ven.
 *  4. El PRECIO sale de la base: con $129 y $1,316 el ahorro es el 15 %, y
 *     ningún archivo de la página lleva esos números escritos.
 *  5. Lo que se lista como incluido: siete categorías, cortas, sin lo
 *     cancelado (hacer la cefalometría en el panel, análisis automático) y
 *     sin lo que todavía no funciona en pantalla.
 *  6. La vista previa «sin módulo» solo puede quitar, nunca dar, y en
 *     producción no existe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COOKIE_VISTA_PREVIA_SIN_MODULO,
  RUTA_CONTRATAR_ORTODONCIA,
  RUTA_MODULO_ORTODONCIA,
  cicloInicial,
  decidirEntradaAlModulo,
  esRutaContratar,
  leerEstadoCompra,
  moduloActivoALaVista,
  modulosConCandado,
  pesos,
  puedeContratarModulos,
  resumirPrecios,
  vistaPreviaSinModulo,
} from "../contratar";
import { CONTENIDO_ORTODONCIA, PENDIENTE_DE_LISTAR } from "../contratar-contenido";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const sinComentarios = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const LAYOUT = "src/app/dashboard/orthodontics/layout.tsx";
const PAGINA = "src/app/dashboard/orthodontics/contratar/page.tsx";
const VISTA = "src/components/specialties/orthodontics/contratar/vista-contratar.tsx";
const TARJETA = "src/components/specialties/orthodontics/contratar/TarjetaPrecio.tsx";
const HOJA = "src/components/specialties/orthodontics/contratar/contratar.module.css";

// ── 1. La redirección del guardia ────────────────────────────────────

const base = { esDental: true, tienePermiso: true, moduloActivo: false, pathname: "/dashboard/orthodontics/tablero" };

test("sin el módulo, cualquier pantalla del módulo manda a la página de contratar", () => {
  for (const p of ["", "/tablero", "/pacientes", "/cobranza", "/controles", "/alertas", "/configuracion"]) {
    assert.deepEqual(
      decidirEntradaAlModulo({ ...base, pathname: `/dashboard/orthodontics${p}` }),
      { tipo: "redirigir", a: RUTA_CONTRATAR_ORTODONCIA },
      `/dashboard/orthodontics${p}`,
    );
  }
  assert.equal(RUTA_CONTRATAR_ORTODONCIA, "/dashboard/orthodontics/contratar");
});

test("la página de contratar se pinta y NUNCA se redirige a sí misma (sin vueltas)", () => {
  for (const p of [RUTA_CONTRATAR_ORTODONCIA, `${RUTA_CONTRATAR_ORTODONCIA}/`, `${RUTA_CONTRATAR_ORTODONCIA}?compra=ok`]) {
    assert.deepEqual(decidirEntradaAlModulo({ ...base, pathname: p }), { tipo: "contratar" }, p);
    assert.deepEqual(decidirEntradaAlModulo({ ...base, moduloActivo: true, pathname: p }), { tipo: "contratar" }, `${p} con módulo`);
  }
  assert.equal(esRutaContratar("/dashboard/orthodontics/contratarx"), false);
  assert.equal(esRutaContratar("/dashboard/orthodontics/tablero"), false);
  assert.equal(esRutaContratar("/dashboard/orthodontics"), false);
  assert.equal(esRutaContratar(null), false);
});

test("con el módulo, todo como hoy: se pinta el módulo", () => {
  assert.deepEqual(decidirEntradaAlModulo({ ...base, moduloActivo: true }), { tipo: "modulo" });
  assert.deepEqual(
    decidirEntradaAlModulo({ ...base, moduloActivo: true, pathname: "/dashboard/orthodontics" }),
    { tipo: "modulo" },
  );
});

test("sin permiso o fuera de dental, a /dashboard — tenga o no el módulo, y también en contratar", () => {
  for (const moduloActivo of [true, false]) {
    for (const pathname of ["/dashboard/orthodontics/tablero", RUTA_CONTRATAR_ORTODONCIA]) {
      assert.deepEqual(
        decidirEntradaAlModulo({ esDental: true, tienePermiso: false, moduloActivo, pathname }),
        { tipo: "redirigir", a: "/dashboard" },
        "a quien no puede ver Ortodoncia no se le enseña ni el precio",
      );
      assert.deepEqual(
        decidirEntradaAlModulo({ esDental: false, tienePermiso: true, moduloActivo, pathname }),
        { tipo: "redirigir", a: "/dashboard" },
      );
    }
  }
});

test("si no se sabe qué ruta se pidió y no hay módulo, a /dashboard (nunca a dar vueltas)", () => {
  for (const pathname of [null, undefined, ""]) {
    assert.deepEqual(decidirEntradaAlModulo({ ...base, pathname }), { tipo: "redirigir", a: "/dashboard" });
    assert.deepEqual(decidirEntradaAlModulo({ ...base, moduloActivo: true, pathname }), { tipo: "modulo" });
  }
});

// ── 2. El layout y la página usan esa decisión ───────────────────────

test("el layout del módulo decide con decidirEntradaAlModulo y conserva sus tres comprobaciones", () => {
  const layout = sinComentarios(leer(LAYOUT));
  assert.match(layout, /const active = await hasActiveOrthodonticsModule\(user\.clinicId\);/);
  assert.match(layout, /esDental: user\.clinic\.category === "DENTAL",/);
  assert.match(layout, /"specialties\.orthodontics",/);
  assert.match(layout, /pathname: headers\(\)\.get\("x-pathname"\),/);
  assert.match(layout, /if \(entrada\.tipo === "redirigir"\) redirect\(entrada\.a\);/);
  assert.equal((layout.match(/redirect\(/g) ?? []).length, 1, "un solo redirect: el de la decisión");
  assert.match(layout, /\{entrada\.tipo === "modulo" && <SubmenuOrtodoncia apartados=\{SUBMENU\} \/>\}/, "sin módulo no hay submenú");
  assert.ok(layout.indexOf("redirect(entrada.a)") < layout.indexOf("<RaizModulo>"), "se decide ANTES de pintar");
});

test("la página: con el módulo activo entra al módulo; los precios salen de la tabla modules", () => {
  const pagina = sinComentarios(leer(PAGINA));
  assert.match(pagina, /if \(moduloActivo && compra !== "ok"\) redirect\(RUTA_MODULO_ORTODONCIA\);/);
  assert.equal(RUTA_MODULO_ORTODONCIA, "/dashboard/orthodontics");
  assert.match(pagina, /prisma\.module\.findUnique\(\{\s*where: \{ key: ORTHODONTICS_MODULE_KEY \}/);
  assert.match(pagina, /getModuleAnnualPriceMxn\(prisma, modulo\.id\)/);
  assert.match(pagina, /hasActiveOrthodonticsModule\(user\.clinicId\)/, "el clinicId sale de la sesión");
  assert.match(pagina, /puedeContratar=\{puedeContratarModulos\(user\.role\)\}/);
  assert.ok(!/searchParams\.clinic|clinicId\s*=\s*searchParams/.test(pagina));
});

test("ningún precio va escrito en la página, la vista, la tarjeta ni la hoja", () => {
  for (const rel of [PAGINA, VISTA, TARJETA, HOJA, "src/lib/orthodontics/contratar.ts", "src/lib/orthodontics/contratar-contenido.ts"]) {
    const codigo = sinComentarios(leer(rel));
    assert.ok(!/\b129\b/.test(codigo), `${rel}: 129 escrito a mano`);
    assert.ok(!/1[,.]?316\b/.test(codigo), `${rel}: 1,316 escrito a mano`);
    assert.ok(!/\b(?:0\.85|0\.15)\b/.test(codigo), `${rel}: el descuento escrito a mano`);
    assert.ok(!/\b15\s*%/.test(codigo), `${rel}: «15 %» escrito a mano`);
  }
});

test("el botón llama al checkout de ws1-t2 con el ciclo elegido y vuelve a esta página", () => {
  const tarjeta = sinComentarios(leer(TARJETA));
  assert.match(tarjeta, /^"use client";/);
  assert.match(tarjeta, /fetch\("\/api\/marketplace\/module-checkout"/);
  assert.match(tarjeta, /moduleKey: ORTHODONTICS_MODULE_KEY,\s*billing: ciclo,\s*method: "card",\s*origin: "contratar",/);
  assert.match(tarjeta, /\{puedeContratar \? \(/, "sin permiso no hay botón");
  assert.match(tarjeta, /Pídeselo al administrador/);
});

// ── 3. El candado ────────────────────────────────────────────────────

test("candado: clínica dental, con plan vigente y sin el módulo", () => {
  const c = { esDental: true, planVencido: false, ortodonciaActiva: false, llaveOrtodoncia: "orthodontics" };
  assert.deepEqual(modulosConCandado(c), ["orthodontics"]);
  assert.deepEqual(modulosConCandado({ ...c, ortodonciaActiva: true }), [], "con el módulo, sin candado");
  assert.deepEqual(modulosConCandado({ ...c, esDental: false }), [], "fuera de dental no sale");
  assert.deepEqual(modulosConCandado({ ...c, planVencido: true }), [], "suspendida: su menú es el reducido");
});

test("contrata el dueño o un administrador; los demás ven el precio pero no el botón", () => {
  assert.equal(puedeContratarModulos("SUPER_ADMIN"), true);
  assert.equal(puedeContratarModulos("ADMIN"), true);
  for (const r of ["DOCTOR", "RECEPTIONIST", "READONLY", "ACCOUNTANT", "", null, undefined]) {
    assert.equal(puedeContratarModulos(r), false, String(r));
  }
});

// ── 4. El precio ─────────────────────────────────────────────────────

test("con los precios de la base ($129 y $1,316): ahorro del 15 %, $232 al año, $110 al mes", () => {
  const r = resumirPrecios({ mensualMxn: 129, anualMxn: 1316 });
  assert.deepEqual(r.ciclos, ["monthly", "annual"]);
  assert.equal(r.ahorroAnualMxn, 232);
  assert.equal(r.ahorroPct, 15);
  assert.equal(r.anualPorMesMxn, 110);
  assert.equal(pesos(129), "$129");
  assert.equal(pesos(1316), "$1,316");
});

test("si cambian en la base, la página cambia sola", () => {
  const r = resumirPrecios({ mensualMxn: 200, anualMxn: 1800 });
  assert.equal(r.ahorroAnualMxn, 600);
  assert.equal(r.ahorroPct, 25);
  assert.equal(r.anualPorMesMxn, 150);
});

test("no se inventa ningún precio: sin anual no hay ciclo anual; sin nada, no se vende", () => {
  const soloMensual = resumirPrecios({ mensualMxn: 129, anualMxn: null });
  assert.deepEqual(soloMensual.ciclos, ["monthly"]);
  assert.equal(soloMensual.anualMxn, null);
  assert.equal(soloMensual.ahorroAnualMxn, 0);
  assert.equal(soloMensual.anualPorMesMxn, null);

  assert.deepEqual(resumirPrecios(null).ciclos, []);
  assert.deepEqual(resumirPrecios({ mensualMxn: 0, anualMxn: 0 }).ciclos, []);
  assert.deepEqual(resumirPrecios({ mensualMxn: Number.NaN, anualMxn: -5 }).ciclos, []);

  const masCaro = resumirPrecios({ mensualMxn: 100, anualMxn: 1300 });
  assert.equal(masCaro.ahorroAnualMxn, 0, "un anual más caro que doce meses no es ahorro");
  assert.equal(masCaro.ahorroPct, 0);
});

test("el ciclo con el que abre: el de la URL si existe; si no, el primero que haya", () => {
  assert.equal(cicloInicial(undefined, ["monthly", "annual"]), "monthly");
  assert.equal(cicloInicial("anual", ["monthly", "annual"]), "annual");
  assert.equal(cicloInicial("annual", ["monthly", "annual"]), "annual");
  assert.equal(cicloInicial("anual", ["monthly"]), "monthly", "si el anual no existe, no se ofrece");
  assert.equal(cicloInicial("loquesea", ["monthly", "annual"]), "monthly");
  assert.equal(cicloInicial("anual", []), null);
});

test("la vuelta de Stripe: solo tres estados conocidos", () => {
  assert.equal(leerEstadoCompra("ok"), "ok");
  assert.equal(leerEstadoCompra("pendiente"), "pendiente");
  assert.equal(leerEstadoCompra("cancelada"), "cancelada");
  assert.equal(leerEstadoCompra(["ok", "x"]), "ok");
  for (const v of ["", "orthodontics", "<script>", null, undefined]) assert.equal(leerEstadoCompra(v), null);
});

// ── 5. Lo que se lista como incluido ─────────────────────────────────

test("siete categorías, en el orden pedido, con líneas cortas", () => {
  assert.deepEqual(
    CONTENIDO_ORTODONCIA.map((c) => c.id),
    ["casos", "cobro", "controles", "recepcion", "tablero", "imagen", "paciente"],
  );
  for (const c of CONTENIDO_ORTODONCIA) {
    assert.ok(c.titulo.length <= 34, `${c.id}: título corto`);
    assert.ok(c.resumen.length <= 95, `${c.id}: resumen de una línea`);
    assert.ok(c.puntos.length >= 3 && c.puntos.length <= 6, `${c.id}: entre 3 y 6 puntos`);
    for (const p of c.puntos) {
      assert.ok(p.length <= 110, `${c.id}: «${p}» es largo`);
      assert.ok(!/[.]$/.test(p), `${c.id}: «${p}» sin punto final`);
    }
    assert.equal(new Set(c.puntos).size, c.puntos.length, `${c.id}: sin líneas repetidas`);
  }
});

test("no se promete lo cancelado: ni hacer la cefalometría en el panel ni análisis automático", () => {
  const texto = CONTENIDO_ORTODONCIA.flatMap((c) => [c.titulo, c.resumen, ...c.puntos]).join("\n");
  assert.ok(!/\bIA\b/.test(texto), "sin «IA»");
  assert.ok(!/inteligencia artificial|autom[aá]tic/i.test(texto), "sin análisis automático");
  assert.ok(!/traz/i.test(texto), "sin «trazado»");
  assert.ok(!/cargo autom|cobro autom|CFDI/i.test(texto), "ni cobro a tarjeta ni CFDI por mensualidad: no existen");
  assert.match(texto, /PDF de la cefalometría/, "lo que sí hay: guardar el PDF");
});

test("lo que todavía no funciona en pantalla está anotado, y NO se lista", () => {
  const listado = CONTENIDO_ORTODONCIA.flatMap((c) => c.puntos);
  assert.ok(PENDIENTE_DE_LISTAR.length > 0);
  for (const p of PENDIENTE_DE_LISTAR) {
    assert.ok(!listado.includes(p.linea), `«${p.linea}» no se promete todavía`);
    assert.ok(p.porQue.length > 20, "con su porqué");
  }
  assert.ok(!/por control|línea E|nasolabial/i.test(listado.join("\n")));
  // La vista solo pinta lo listado.
  const vista = sinComentarios(leer(VISTA));
  assert.match(vista, /CONTENIDO_ORTODONCIA\.map\(/);
  assert.ok(!/PENDIENTE_DE_LISTAR/.test(vista));
});

// ── 6. La vista previa «sin módulo» ──────────────────────────────────

test("vista previa: en producción no existe, ni con la cookie puesta", () => {
  assert.equal(vistaPreviaSinModulo({ nodeEnv: "production", cookie: "1" }), false);
  assert.equal(vistaPreviaSinModulo({ nodeEnv: "development", cookie: "1" }), true);
  assert.equal(vistaPreviaSinModulo({ nodeEnv: "development", cookie: undefined }), false);
  assert.equal(vistaPreviaSinModulo({ nodeEnv: "development", cookie: "0" }), false);
  assert.equal(vistaPreviaSinModulo({ nodeEnv: "development", cookie: "true" }), false);
  assert.equal(COOKIE_VISTA_PREVIA_SIN_MODULO, "dc-vista-previa-sin-ortodoncia");
});

test("vista previa: solo puede QUITAR el módulo a la vista, nunca darlo", () => {
  assert.equal(moduloActivoALaVista(true, false), true);
  assert.equal(moduloActivoALaVista(true, true), false);
  assert.equal(moduloActivoALaVista(false, true), false);
  assert.equal(moduloActivoALaVista(false, false), false, "sin módulo de verdad, no hay forma de verlo activo");
});

test("el interruptor de la vista previa responde 404 en producción y no toca la base", () => {
  const ruta = sinComentarios(leer("src/app/dashboard/orthodontics/contratar/vista-previa/route.ts"));
  assert.match(ruta, /if \(process\.env\.NODE_ENV === "production"\) \{\s*return new NextResponse\("Not found", \{ status: 404 \}\);/);
  assert.ok(!/prisma|@\/lib\/auth/.test(ruta), "solo pone o quita una cookie");
});
