/**
 * Contratar Ortodoncia — candados (ws1-t3, 28-sep-2026).
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/contratar.test.ts
 *
 * Lo que fija:
 *  1. La REDIRECCIÓN de los dos guardias: sin módulo, el del módulo manda a
 *     la página de contratar (no a /dashboard ni a un error); con módulo, el
 *     de contratar manda al módulo; sin permiso o fuera de dental, los dos a
 *     /dashboard.
 *  2. La página de contratar vive FUERA de /dashboard/orthodontics, para que
 *     el layout del módulo (donde está su guardia) no se monte nunca para una
 *     clínica que no lo tiene. El 28-sep-2026 estuvo dentro unos minutos y
 *     desde ella se podía saltar al Tablero sin pasar por el guardia.
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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COOKIE_VISTA_PREVIA_SIN_MODULO,
  RUTA_CONTRATAR_ORTODONCIA,
  RUTA_MODULO_ORTODONCIA,
  cicloInicial,
  decidirEntradaAContratar,
  decidirEntradaAlModulo,
  leerEstadoCompra,
  moduloActivoALaVista,
  modulosConCandado,
  pesos,
  puedeContratarModulos,
  resumirPrecios,
  vistaPreviaSinModulo,
} from "../contratar";
import { CONTENIDO_ORTODONCIA, PENDIENTE_DE_LISTAR } from "../contratar-contenido";
import { resolveModuleCheckoutReturnUrls } from "@/lib/marketplace/module-purchase-core";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const sinComentarios = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const LAYOUT = "src/app/dashboard/orthodontics/layout.tsx";
const PAGINA = "src/app/dashboard/contratar/ortodoncia/page.tsx";
const INTERRUPTOR = "src/app/dashboard/contratar/ortodoncia/vista-previa/route.ts";
const VISTA = "src/components/specialties/orthodontics/contratar/vista-contratar.tsx";
const TARJETA = "src/components/specialties/orthodontics/contratar/TarjetaPrecio.tsx";
const HOJA = "src/components/specialties/orthodontics/contratar/contratar.module.css";

// ── 1. La redirección de los dos guardias ────────────────────────────

const quien = { esDental: true, tienePermiso: true, moduloActivo: false };

test("guardia del módulo: sin el módulo manda a la página de contratar", () => {
  assert.deepEqual(decidirEntradaAlModulo(quien), { tipo: "redirigir", a: RUTA_CONTRATAR_ORTODONCIA });
  assert.equal(RUTA_CONTRATAR_ORTODONCIA, "/dashboard/contratar/ortodoncia");
});

test("guardia del módulo: con el módulo, todo como hoy", () => {
  assert.deepEqual(decidirEntradaAlModulo({ ...quien, moduloActivo: true }), { tipo: "modulo" });
});

test("guardia de contratar: sin módulo pinta la página; con módulo no hay nada que vender y entra al módulo", () => {
  for (const compra of [null, "cancelada", "pendiente", "ok"] as const) {
    assert.deepEqual(decidirEntradaAContratar({ ...quien, compra }), { tipo: "contratar" }, `sin módulo, compra=${compra}`);
  }
  for (const compra of [null, "cancelada", "pendiente"] as const) {
    assert.deepEqual(
      decidirEntradaAContratar({ ...quien, moduloActivo: true, compra }),
      { tipo: "redirigir", a: RUTA_MODULO_ORTODONCIA },
      `con módulo, compra=${compra}`,
    );
  }
  // La vuelta de pagar: la página avisa y entra con carga completa.
  assert.deepEqual(decidirEntradaAContratar({ ...quien, moduloActivo: true, compra: "ok" }), { tipo: "contratar" });
  assert.equal(RUTA_MODULO_ORTODONCIA, "/dashboard/orthodontics");
});

test("los dos guardias: sin permiso o fuera de dental, a /dashboard — tenga o no el módulo", () => {
  for (const moduloActivo of [true, false]) {
    for (const otro of [{ esDental: true, tienePermiso: false }, { esDental: false, tienePermiso: true }, { esDental: false, tienePermiso: false }]) {
      assert.deepEqual(decidirEntradaAlModulo({ ...otro, moduloActivo }), { tipo: "redirigir", a: "/dashboard" });
      assert.deepEqual(
        decidirEntradaAContratar({ ...otro, moduloActivo, compra: "ok" }),
        { tipo: "redirigir", a: "/dashboard" },
        "a quien no puede ver Ortodoncia no se le enseña ni el precio",
      );
    }
  }
});

test("los dos guardias no se mandan el uno al otro en círculo", () => {
  for (const moduloActivo of [true, false]) {
    const alModulo = decidirEntradaAlModulo({ ...quien, moduloActivo });
    const aContratar = decidirEntradaAContratar({ ...quien, moduloActivo, compra: null });
    const rebotaAlModulo = aContratar.tipo === "redirigir" && aContratar.a === RUTA_MODULO_ORTODONCIA;
    const rebotaAContratar = alModulo.tipo === "redirigir" && alModulo.a === RUTA_CONTRATAR_ORTODONCIA;
    assert.ok(!(rebotaAlModulo && rebotaAContratar), `módulo ${moduloActivo ? "activo" : "inactivo"}: uno de los dos pinta`);
  }
});

// ── 2. Dónde vive la página, y que cada guardia esté donde corre ─────

test("la página de contratar NO cuelga de /dashboard/orthodontics (su layout no se vuelve a ejecutar al navegar)", () => {
  assert.ok(!RUTA_CONTRATAR_ORTODONCIA.startsWith(`${RUTA_MODULO_ORTODONCIA}/`));
  assert.ok(!RUTA_CONTRATAR_ORTODONCIA.startsWith(RUTA_MODULO_ORTODONCIA));
  assert.ok(existsSync(join(RAIZ, PAGINA)), "la página está donde dice la ruta");
  assert.ok(existsSync(join(RAIZ, INTERRUPTOR)));
  assert.ok(
    !existsSync(join(RAIZ, "src/app/dashboard/orthodontics/contratar")),
    "nada de contratar dentro de la ruta del módulo",
  );
  // La URL que vuelve de Stripe es esa misma página.
  const vuelta = resolveModuleCheckoutReturnUrls({ baseUrl: "https://x", moduleKey: "orthodontics", method: "card", origin: "contratar" });
  assert.ok(vuelta.successUrl.startsWith(`https://x${RUTA_CONTRATAR_ORTODONCIA}?`));
  assert.ok(vuelta.cancelUrl.startsWith(`https://x${RUTA_CONTRATAR_ORTODONCIA}?`));
});

test("el guardia del módulo corre en el layout Y en cada una de sus páginas", () => {
  const guardia = sinComentarios(leer("src/lib/orthodontics/exigir-modulo.ts"));
  assert.match(guardia, /^import "server-only";/);
  assert.match(guardia, /const real = await hasActiveOrthodonticsModule\(user\.clinicId\);/, "el clinicId sale de la sesión");
  assert.match(guardia, /esDental: user\.clinic\.category === "DENTAL",/);
  assert.match(guardia, /"specialties\.orthodontics",/);
  assert.match(guardia, /const entrada = decidirEntradaAlModulo\(\{/);
  assert.match(guardia, /if \(entrada\.tipo === "redirigir"\) redirect\(entrada\.a\);/);
  assert.equal((guardia.match(/redirect\(/g) ?? []).length, 1, "un solo redirect: el de la decisión");
  assert.ok(!/x-pathname|headers\(\)/.test(guardia), "no decide por la ruta pedida");

  const layout = sinComentarios(leer(LAYOUT));
  assert.match(layout, /await exigirModuloOrtodoncia\(\);/);
  assert.ok(layout.indexOf("await exigirModuloOrtodoncia()") < layout.indexOf("<RaizModulo>"), "se decide ANTES de pintar");
  assert.ok(!/x-pathname|headers\(\)/.test(layout), "un layout que decide por ruta se queda con la decisión vieja al navegar");

  // Un layout no se vuelve a ejecutar al navegar entre sus páginas: cada una
  // se guarda sola, antes de cargar un solo dato.
  for (const pagina of ["tablero", "pacientes", "alertas", "cobranza", "controles", "configuracion"]) {
    const codigo = sinComentarios(leer(`src/app/dashboard/orthodontics/${pagina}/page.tsx`));
    const cuerpo = codigo.slice(codigo.indexOf("export default async function"));
    assert.ok(cuerpo.length > 0, `${pagina}: es async`);
    const primera = cuerpo.slice(cuerpo.indexOf("{") + 1).trimStart();
    assert.ok(primera.startsWith("await exigirModuloOrtodoncia();"), `${pagina}: el guardia es lo PRIMERO que hace`);
  }
  // La raíz solo redirige al Tablero, que se guarda solo.
  assert.match(leer("src/app/dashboard/orthodontics/page.tsx"), /redirect\("\/dashboard\/orthodontics\/tablero"\);/);
});

test("la página: se guarda a sí misma, y los precios salen de la tabla modules", () => {
  const pagina = sinComentarios(leer(PAGINA));
  assert.match(pagina, /const entrada = decidirEntradaAContratar\(\{/);
  assert.match(pagina, /esDental: user\.clinic\.category === "DENTAL",/);
  assert.match(pagina, /"specialties\.orthodontics",/);
  assert.match(pagina, /if \(entrada\.tipo === "redirigir"\) redirect\(entrada\.a\);/);
  assert.ok(pagina.indexOf("redirect(entrada.a)") < pagina.indexOf("<VistaContratar"), "se decide ANTES de pintar");
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
  assert.match(tarjeta, /\) : puedeContratar \? \(/, "sin permiso no hay botón");
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

test("«pago recibido» no se cree porque lo diga la URL: se confirma con Stripe, para esta clínica", () => {
  const pagina = sinComentarios(leer(PAGINA));
  assert.match(pagina, /pedida === "ok" &&\s*!\(await pagoDeModuloConfirmado\(\{ sessionId, clinicId: user\.clinicId, moduleKey: ORTHODONTICS_MODULE_KEY \}\)\)\s*\? null/);
  assert.ok(pagina.indexOf("pagoDeModuloConfirmado(") < pagina.indexOf("decidirEntradaAContratar("), "se confirma ANTES de decidir");
  const confirmar = sinComentarios(leer("src/lib/marketplace/module-checkout-session.ts"));
  assert.match(confirmar, /sesion\.status === "complete"/);
  assert.match(confirmar, /sesion\.metadata\?\.clinicId === clinicId/, "una sesión de otra clínica no vale");
  assert.match(confirmar, /sesion\.metadata\?\.moduleKey === moduleKey/);
  assert.match(confirmar, /sesion\.metadata\?\.kind === MODULE_SUBSCRIPTION_KIND/);
  assert.match(confirmar, /catch \{\s*return false;\s*\}/, "falla cerrado");
  assert.ok(!/\.update\(|\.create\(|\.del\(|\.cancel\(/.test(confirmar), "solo lee");
});

test("con un pago hecho o pendiente no se ofrece pagar otra vez", () => {
  const vista = sinComentarios(leer(VISTA));
  assert.match(vista, /pagoEnCurso=\{compra === "ok" \|\| compra === "pendiente"\}/);
  const tarjeta = sinComentarios(leer(TARJETA));
  assert.match(tarjeta, /if \(enviando \|\| pagoEnCurso \|\| ciclo === null\) return;/);
  assert.match(tarjeta, /\{pagoEnCurso \? \(/);
  assert.ok(tarjeta.indexOf("{pagoEnCurso ? (") < tarjeta.indexOf("<ButtonNew"), "el aviso va en lugar del botón");
});

test("un ahorro que no llega al uno por ciento no se anuncia", () => {
  const r = resumirPrecios({ mensualMxn: 129, anualMxn: 1547 });
  assert.equal(r.ahorroAnualMxn, 1);
  assert.equal(r.ahorroPct, 0);
  assert.match(sinComentarios(leer(TARJETA)), /const hayAhorro = precios\.ahorroAnualMxn > 0 && precios\.ahorroPct >= 1;/);
});

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
    assert.ok(c.puntos.length >= 3 && c.puntos.length <= 7, `${c.id}: entre 3 y 7 puntos`);
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

test("lo pendiente no se pinta nunca; y «fotos con líneas» se lista porque la imagen ya se ve", () => {
  const listado = CONTENIDO_ORTODONCIA.flatMap((c) => c.puntos);
  for (const p of PENDIENTE_DE_LISTAR) {
    assert.ok(!listado.includes(p.linea), `«${p.linea}» no se promete todavía`);
    assert.ok(p.porQue.length > 20, "con su porqué");
  }
  const vista = sinComentarios(leer(VISTA));
  assert.match(vista, /CONTENIDO_ORTODONCIA\.map\(/);
  assert.ok(!/PENDIENTE_DE_LISTAR/.test(vista));

  assert.ok(listado.some((p) => /Fotos con líneas/.test(p)));
  // La promesa va atada a la pantalla: la foto sale del enlace firmado que
  // devuelve la subida, no de /api/files/<id> (que no existe y daba 404).
  const tarjeta = sinComentarios(leer("src/components/specialties/orthodontics/imagen/ImagenYAnalisisCard.tsx"));
  assert.match(tarjeta, /setImageUrl\(json\.signedUrl\);/);
  assert.ok(!/\/api\/files\//.test(tarjeta), "ya no pide la imagen a una ruta que no existe");
});

test("«a plazos o por control» se lista porque hay una pantalla donde elegirlo", () => {
  const cobro = CONTENIDO_ORTODONCIA.find((c) => c.id === "cobro")!;
  assert.ok(cobro.puntos.some((p) => /a plazos o por control/.test(p)));
  // La promesa va atada a la pantalla: si el selector desaparece de
  // Configuración, esta línea tiene que salir de la lista.
  const configuracion = leer("src/components/specialties/orthodontics/configuracion/OrthoConfiguracionClient.tsx");
  assert.match(configuracion, /name="billingMode"/, "el selector del modo de cobro existe en Configuración");
  assert.match(configuracion, /PAGO_POR_CONTROL/);
  assert.match(configuracion, /billingMode,/, "y se guarda");
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
  const ruta = sinComentarios(leer(INTERRUPTOR));
  assert.match(ruta, /if \(process\.env\.NODE_ENV === "production"\) \{\s*return new NextResponse\("Not found", \{ status: 404 \}\);/);
  assert.ok(!/prisma|@\/lib\/auth/.test(ruta), "solo pone o quita una cookie");
});
