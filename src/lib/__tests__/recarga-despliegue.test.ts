import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLAVE_RECARGA,
  ESPERA_RECARGA_MS,
  VENTANA_MS,
  asegurarRecarga,
  esErrorDeFragmento,
  hayRecargaEnCurso,
  puedeRecargar,
  recargarSiEsDeFragmento,
  recargarUnaVez,
  seVaARecargar,
  type Entorno,
} from "../recarga-despliegue";

/**
 * Tras un despliegue, la pestaña que ya estaba abierta pide fragmentos de JS
 * con el nombre viejo, recibe 404 y se queda en blanco. La recarga automática
 * lo arregla, pero SOLO puede pasar una vez: si el fragmento sigue faltando
 * después de recargar, un segundo intento es un bucle.
 */

function almacenDePrueba(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    datos,
    getItem: (k: string) => (datos.has(k) ? datos.get(k)! : null),
    setItem: (k: string, v: string) => void datos.set(k, v),
  };
}

function entornoDePrueba(parcial: Partial<Entorno> = {}) {
  const almacen = almacenDePrueba();
  let recargas = 0;
  const entorno: Entorno = {
    almacen,
    ahora: 1_000_000,
    enLinea: true,
    recargar: () => void recargas++,
    ...parcial,
  };
  return { entorno, almacen, recargas: () => recargas };
}

const deFragmento = () =>
  Object.assign(new Error("Loading chunk 4821 failed.\n(error: https://x/_next/static/chunks/4821.js)"), {
    name: "ChunkLoadError",
  });

// ── Recarga en curso (va PRIMERO: la marca vive lo que vive el módulo) ────

test("antes de pedir ninguna recarga no hay recarga en curso", () => {
  assert.equal(hayRecargaEnCurso(), false);
});

test("un intento que NO recarga no deja la marca de recarga en curso", () => {
  const sinAlmacen = entornoDePrueba({ almacen: null });
  assert.equal(recargarSiEsDeFragmento(deFragmento(), sinAlmacen.entorno), false);
  const otroError = entornoDePrueba();
  assert.equal(recargarSiEsDeFragmento(new TypeError("Failed to fetch"), otroError.entorno), false);
  assert.equal(hayRecargaEnCurso(), false);
});

test("en el servidor (sin window) ni se anuncia ni se pide una recarga", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(puedeRecargar(), false);
  assert.equal(seVaARecargar(deFragmento()), false);
  assert.equal(asegurarRecarga(deFragmento()), false);
  assert.equal(recargarSiEsDeFragmento(deFragmento()), false);
  assert.equal(hayRecargaEnCurso(), false);
});

// ── Reconocer el error ────────────────────────────────────────────────────

test("reconoce ChunkLoadError por el nombre, diga lo que diga el mensaje", () => {
  assert.equal(esErrorDeFragmento(Object.assign(new Error("x"), { name: "ChunkLoadError" })), true);
});

test("reconoce las redacciones de webpack, turbopack y los tres navegadores", () => {
  for (const mensaje of [
    "Loading chunk 123 failed.",
    "Loading chunk app/dashboard/page failed.\n(timeout: https://x/_next/static/chunks/a.js)",
    "Loading CSS chunk 77 failed.",
    "Failed to load chunk /_next/static/chunks/abc.js",
    "Failed to fetch dynamically imported module: https://x/_next/static/chunks/a.js",
    "error loading dynamically imported module: https://x/a.js",
    "Importing a module script failed.",
  ]) {
    assert.equal(esErrorDeFragmento(new Error(mensaje)), true, mensaje);
    assert.equal(esErrorDeFragmento(mensaje), true, `string: ${mensaje}`);
    assert.equal(esErrorDeFragmento({ message: mensaje }), true, `objeto: ${mensaje}`);
  }
});

test("lo encuentra envuelto en cause", () => {
  const envuelto = new Error("No se pudo pintar", { cause: deFragmento() });
  assert.equal(esErrorDeFragmento(envuelto), true);
  assert.equal(esErrorDeFragmento(new Error("fuera", { cause: envuelto })), true);
});

test("no se pierde en una cadena de cause que se muerde la cola", () => {
  const a: { message: string; cause?: unknown } = { message: "a" };
  a.cause = a;
  assert.equal(esErrorDeFragmento(a), false);
});

test("NO confunde un fallo de red de la API con un fragmento", () => {
  for (const caso of [
    new TypeError("Failed to fetch"),
    new Error("fetch failed"),
    new Error("NetworkError when attempting to fetch resource."),
    new Error("Cannot read properties of undefined (reading 'map')"),
    new Error("Minified React error #418"),
    "Load failed",
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(esErrorDeFragmento(caso), false, String(caso));
  }
});

// ── El guardia ────────────────────────────────────────────────────────────

test("la primera vez recarga y deja el apunte con la hora", () => {
  const { entorno, almacen, recargas } = entornoDePrueba();
  assert.equal(recargarUnaVez(entorno), true);
  assert.equal(recargas(), 1);
  assert.equal(almacen.datos.get(CLAVE_RECARGA), "1000000");
});

test("EL BUCLE: si tras recargar vuelve a fallar, no recarga otra vez", () => {
  const { entorno, recargas } = entornoDePrueba();
  assert.equal(recargarSiEsDeFragmento(deFragmento(), entorno), true);
  // La página recargó (el sessionStorage sobrevive) y el fragmento sigue faltando.
  for (let i = 1; i <= 20; i++) {
    const despues = { ...entorno, ahora: entorno.ahora + i * 1000 };
    assert.equal(recargarSiEsDeFragmento(deFragmento(), despues), false);
  }
  assert.equal(recargas(), 1);
});

test("el apunte caduca: un despliegue posterior en la misma pestaña también se recupera", () => {
  const { entorno, almacen, recargas } = entornoDePrueba();
  recargarUnaVez(entorno);
  const justoAntes = { ...entorno, ahora: entorno.ahora + VENTANA_MS - 1 };
  assert.equal(recargarUnaVez(justoAntes), false);
  const cumplida = { ...entorno, ahora: entorno.ahora + VENTANA_MS };
  assert.equal(recargarUnaVez(cumplida), true);
  assert.equal(recargas(), 2);
  assert.equal(almacen.datos.get(CLAVE_RECARGA), String(cumplida.ahora));
});

test("puedeRecargar solo lee: no deja apunte ni recarga", () => {
  const { entorno, almacen, recargas } = entornoDePrueba();
  assert.equal(puedeRecargar(entorno), true);
  assert.equal(puedeRecargar(entorno), true);
  assert.equal(almacen.datos.size, 0);
  assert.equal(recargas(), 0);
});

test("sin sessionStorage no hay guardia, así que no recarga", () => {
  const { entorno, recargas } = entornoDePrueba({ almacen: null });
  assert.equal(puedeRecargar(entorno), false);
  assert.equal(recargarUnaVez(entorno), false);
  assert.equal(recargas(), 0);
});

test("si sessionStorage lanza al leer o al escribir, no recarga", () => {
  const alLeer = entornoDePrueba({
    almacen: {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    },
  });
  assert.equal(recargarUnaVez(alLeer.entorno), false);
  assert.equal(alLeer.recargas(), 0);

  const alEscribir = entornoDePrueba({
    almacen: {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    },
  });
  assert.equal(recargarUnaVez(alEscribir.entorno), false);
  assert.equal(alEscribir.recargas(), 0);
});

test("un apunte ilegible se toma por reciente: no recarga", () => {
  const { entorno, recargas } = entornoDePrueba({
    almacen: almacenDePrueba({ [CLAVE_RECARGA]: "ayer" }),
  });
  assert.equal(recargarUnaVez(entorno), false);
  assert.equal(recargas(), 0);
});

test("sin conexión no recarga (cambiaría el error por la pantalla de «sin red»)", () => {
  const { entorno, almacen, recargas } = entornoDePrueba({ enLinea: false });
  assert.equal(recargarSiEsDeFragmento(deFragmento(), entorno), false);
  assert.equal(recargas(), 0);
  assert.equal(almacen.datos.size, 0);
});

test("un error que no es de fragmento no recarga ni gasta el guardia", () => {
  const { entorno, almacen, recargas } = entornoDePrueba();
  assert.equal(recargarSiEsDeFragmento(new TypeError("Failed to fetch"), entorno), false);
  assert.equal(recargas(), 0);
  assert.equal(almacen.datos.size, 0);
  // …y el guardia sigue entero para cuando sí haga falta.
  assert.equal(recargarSiEsDeFragmento(deFragmento(), entorno), true);
  assert.equal(recargas(), 1);
});

test("tras recargar queda la marca: quien vea el MISMO fallo sabe que ya va en camino", () => {
  const { entorno, recargas } = entornoDePrueba();
  assert.equal(recargarUnaVez(entorno), true);
  assert.equal(hayRecargaEnCurso(), true);
  // El oyente global y un límite de error ven el mismo fallo: el segundo no
  // debe pintar la tarjeta ni el aviso, y tampoco recargar otra vez.
  assert.equal(seVaARecargar(deFragmento()), true);
  assert.equal(asegurarRecarga(deFragmento()), true);
  assert.equal(recargas(), 1);
  // …pero solo para errores de fragmento.
  assert.equal(seVaARecargar(new TypeError("Failed to fetch")), false);
  assert.equal(asegurarRecarga(new TypeError("Failed to fetch")), false);
});

test("la espera antes de rendirse es corta y mucho menor que la ventana del guardia", () => {
  assert.ok(ESPERA_RECARGA_MS >= 3000 && ESPERA_RECARGA_MS <= 15000);
  assert.ok(ESPERA_RECARGA_MS < VENTANA_MS);
});

// ── Cableado ──────────────────────────────────────────────────────────────

const RAIZ = join(__dirname, "..", "..", "..");
const fuente = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

for (const ruta of ["src/app/error.tsx", "src/app/global-error.tsx"]) {
  test(`cableado: ${ruta} es de cliente y recarga ante un error de fragmento`, () => {
    const codigo = fuente(ruta);
    assert.match(codigo, /^"use client";/);
    assert.match(codigo, /@\/lib\/recarga-despliegue/);
    assert.match(codigo, /useState\(\(\) => seVaARecargar\(error\)\)/);
    assert.match(codigo, /asegurarRecarga\(error\)/);
  });

  // 🔴 «Se puede recargar» se decide LEYENDO el guardia; escribirlo puede fallar
  // aparte. Si el límite no vuelve a la tarjeta, la pantalla se queda en
  // «Actualizando…» para siempre: sin recarga y sin un solo botón.
  test(`cableado: ${ruta} vuelve a la tarjeta de error si la recarga no ocurre`, () => {
    const codigo = fuente(ruta);
    const efecto = codigo.slice(codigo.indexOf("useEffect(() => {"));
    const cuerpo = efecto.slice(0, efecto.indexOf("}, [error]);"));
    assert.match(cuerpo, /if \(asegurarRecarga\(error\)\) \{/);
    assert.match(cuerpo, /\} else \{[\s\S]*setSeRecarga\(false\);/, "sin salida si no recarga");
    assert.match(cuerpo, /setTimeout\(\(\) => setSeRecarga\(false\), ESPERA_RECARGA_MS\)/);
    // Los botones siguen existiendo en la rama de la tarjeta.
    assert.match(codigo, /Volver a intentarlo/);
    assert.match(codigo, /Ir al inicio/);
  });
}

test("setItem lanza aunque getItem funcione: puedeRecargar dice sí, pero NO se recarga", () => {
  // El caso exacto que dejaba la pantalla muerta: cuota llena o Safari en privado.
  const { entorno, recargas } = entornoDePrueba({
    almacen: {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    },
  });
  assert.equal(puedeRecargar(entorno), true);
  assert.equal(recargarSiEsDeFragmento(deFragmento(), entorno), false);
  assert.equal(recargas(), 0);
});

test("cableado: global-error trae su propio <html> y <body> (sustituye al layout raíz)", () => {
  const codigo = fuente("src/app/global-error.tsx");
  assert.match(codigo, /<html lang="es">/);
  assert.match(codigo, /<body/);
});

test("cableado: el layout raíz monta el oyente global", () => {
  const codigo = fuente("src/app/layout.tsx");
  assert.match(codigo, /<RecargaPorDespliegue \/>/);
  const oyente = fuente("src/components/recarga-por-despliegue.tsx");
  assert.match(oyente, /^"use client";/);
  assert.match(oyente, /unhandledrejection/);
  assert.match(oyente, /esErrorDeFragmento\(/);
  // No avisa si la recarga ya va en camino, y no recarga si hay algo tecleado.
  assert.match(oyente, /if \(hayRecargaEnCurso\(\)\) return;/);
  assert.match(oyente, /if \(tecleo\) \{\s*avisar\(\);\s*return;/);
});
