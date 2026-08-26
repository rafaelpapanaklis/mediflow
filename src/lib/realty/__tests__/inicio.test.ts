// ═══════════════════════════════════════════════════════════════════════
// EL INICIO — el semáforo, qué tarjeta ve quién, y el aislamiento.
//
//   npx tsx --test src/lib/realty/__tests__/inicio.test.ts
//
// Dos mitades, y la segunda es la que de verdad protege:
//
//   1. PURO. Las bandas del semáforo y el reparto de tarjetas por modo. Un
//      rentista no puede ver embudo ni comisiones: no es una preferencia,
//      es que ese no es su negocio.
//
//   2. ESTÁTICO. Se lee src/lib/realty/inicio.ts COMO TEXTO y se comprueba
//      que TODA consulta lleva `accountId: ctx.accountId`.
//      🔴 POR QUÉ ASÍ Y NO CON UNA BASE: en Prisma un `accountId: undefined`
//      no filtra por undefined — BORRA el filtro. Una consulta a la que se
//      le olvide el accountId no truena, no avisa y no se ve rara: devuelve
//      los datos de TODAS las inmobiliarias y el tablero simplemente
//      enseña números más grandes. Es el peor modo de falla que hay en un
//      multi-tenant y no hay prueba de integración barata que lo atrape.
//      Leerlo del código sí lo atrapa, y corre en medio segundo.
//
// Sin Postgres, sin navegador, sin sesión.
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INICIO_ROJO_MIN,
  INICIO_VERDE_MIN,
  REALTY_INICIO_TARJETAS,
  duracionCorta,
  minutosDesde,
  pesosDeCentavos,
  tarjetaAdmiteModo,
  tarjetasDeModo,
  urgenciaPrimerContacto,
} from "@/lib/realty/inicio-shared";
import { REALTY_NAV_ITEMS } from "@/lib/realty/types";
import type { RealtyMode } from "@/lib/realty/types";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const FUENTE_INICIO = "src/lib/realty/inicio.ts";

function leer(rel: string): string {
  return readFileSync(join(RAIZ, rel), "utf8");
}

/** El código sin comentarios: la prosa menciona cosas que no son código. */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/* ══════════════════════════════════════════════════════════════════
   1 · EL SEMÁFORO DEL PRIMER CONTACTO
   ══════════════════════════════════════════════════════════════════ */

test("las bandas son las de los DIEZ minutos, no las de la hora", () => {
  // Si alguien las alinea con contactHeat (1 h / 24 h), un prospecto que
  // lleva 45 minutos sin respuesta saldría EN VERDE — que es exactamente la
  // mentira que esta pantalla existe para no decir.
  assert.equal(INICIO_VERDE_MIN, 5);
  assert.equal(INICIO_ROJO_MIN, 10);
  assert.ok(INICIO_ROJO_MIN <= 10, "pasados 10 minutos el prospecto ya está frío");
});

test("cada minuto cae en su color", () => {
  assert.equal(urgenciaPrimerContacto(0), "VERDE");
  assert.equal(urgenciaPrimerContacto(4), "VERDE");
  assert.equal(urgenciaPrimerContacto(5), "AMARILLO");
  assert.equal(urgenciaPrimerContacto(9), "AMARILLO");
  assert.equal(urgenciaPrimerContacto(10), "ROJO");
  assert.equal(urgenciaPrimerContacto(60 * 24 * 3), "ROJO");
});

test("un reloj torcido no pinta un color inventado", () => {
  // Un createdAt en el futuro (reloj del servidor, importación de portal)
  // daría minutos negativos: ni se pinta rojo ni se rompe.
  assert.equal(urgenciaPrimerContacto(-30), "VERDE");
  assert.equal(urgenciaPrimerContacto(NaN), "VERDE");
  assert.equal(minutosDesde("no-es-una-fecha", Date.now()), 0);
  const enElFuturo = new Date(Date.now() + 60 * 60_000);
  assert.equal(minutosDesde(enElFuturo, Date.now()), 0);
});

test("minutosDesde cuenta minutos enteros", () => {
  const ahora = Date.UTC(2026, 7, 25, 12, 0, 0);
  assert.equal(minutosDesde(new Date(ahora - 90_000), ahora), 1);
  assert.equal(minutosDesde(new Date(ahora - 3 * 60_000), ahora), 3);
  assert.equal(minutosDesde(new Date(ahora - 26 * 60 * 60_000), ahora), 1560);
});

test("la duración se dice con la unidad más grande que ya se alcanzó", () => {
  assert.equal(duracionCorta(0), "0 min");
  assert.equal(duracionCorta(59), "59 min");
  assert.equal(duracionCorta(60), "1 h");
  assert.equal(duracionCorta(60 * 47), "47 h");
  assert.equal(duracionCorta(60 * 48), "2 d");
});

test("el dinero se pinta sin centavos y sin reventar con basura", () => {
  assert.ok(pesosDeCentavos(12_845_000).includes("128,450"));
  assert.ok(pesosDeCentavos(0).includes("0"));
  assert.equal(typeof pesosDeCentavos(NaN), "string");
});

/* ══════════════════════════════════════════════════════════════════
   2 · QUÉ TARJETA VE QUIÉN — el eje del producto
   ══════════════════════════════════════════════════════════════════ */

test("un RENTISTA no ve embudo, ni ranking, ni comisiones", () => {
  const suyas = tarjetasDeModo("OWNER");
  for (const prohibida of ["prospectos", "visitas", "tareas", "ranking", "comisiones", "exclusivas"] as const) {
    assert.equal(
      suyas.includes(prohibida),
      false,
      `"${prohibida}" no es del negocio de un rentista: administra lo suyo, no comercializa para terceros`,
    );
  }
  // Y sí ve lo que SÍ es suyo.
  for (const propia of ["cobranza", "deudores", "contratos", "mantenimientos", "vacias"] as const) {
    assert.equal(suyas.includes(propia), true, `a un rentista le falta "${propia}"`);
  }
});

test("un ASESOR SOLO no ve nada de equipo", () => {
  const suyas = tarjetasDeModo("AGENT");
  assert.equal(suyas.includes("ranking"), false, "un asesor solo no tiene contra quién compararse");
  assert.equal(suyas.includes("vacias"), false, "«vacías» es del rentista");
  assert.equal(suyas.includes("comisiones"), true, "sí ve LO SUYO del mes");
  assert.equal(suyas.includes("prospectos"), true);
});

test("una INMOBILIARIA ve el equipo, y no la tarjeta del asesor solo", () => {
  const suyas = tarjetasDeModo("AGENCY");
  assert.equal(suyas.includes("ranking"), true);
  assert.equal(
    suyas.includes("comisiones"),
    false,
    "en AGENCY el equivalente es el ranking; las dos juntas dicen lo mismo dos veces",
  );
  assert.equal(suyas.includes("prospectos"), true);
});

test("ningún modo se queda sin tarjetas (sería la pantalla en blanco otra vez)", () => {
  for (const modo of ["AGENCY", "AGENT", "OWNER"] as RealtyMode[]) {
    assert.ok(tarjetasDeModo(modo).length >= 4, `el modo ${modo} casi no tiene tablero`);
  }
});

test("toda tarjeta lleva a una pantalla que EXISTE en el menú", () => {
  // 🔴 Una tarjeta que apunta a una ruta inventada es un clic hasta un 404,
  // y una que apunta a una pantalla que ese modo no tiene es un clic hasta
  // un redirect. Las dos se ven igual de mal y ninguna truena el build.
  for (const tarjeta of REALTY_INICIO_TARJETAS) {
    const item = REALTY_NAV_ITEMS.find((i) => i.key === tarjeta.navKey);
    assert.ok(item, `la tarjeta "${tarjeta.key}" apunta a un item de menú que no existe`);
    assert.equal(
      tarjeta.href,
      item!.href,
      `la tarjeta "${tarjeta.key}" tiene una ruta distinta a la de su item de menú`,
    );
    for (const modo of tarjeta.modos) {
      assert.ok(
        item!.modes.includes(modo),
        `"${tarjeta.key}" se ofrece en modo ${modo}, pero esa pantalla no existe en ese modo`,
      );
    }
  }
});

test("tarjetaAdmiteModo y tarjetasDeModo dicen lo mismo", () => {
  for (const modo of ["AGENCY", "AGENT", "OWNER"] as RealtyMode[]) {
    for (const tarjeta of REALTY_INICIO_TARJETAS) {
      assert.equal(
        tarjetaAdmiteModo(tarjeta.key, modo),
        tarjetasDeModo(modo).includes(tarjeta.key),
        `${tarjeta.key} / ${modo}`,
      );
    }
  }
});

/* ══════════════════════════════════════════════════════════════════
   3 · AISLAMIENTO — se lee del código, que es donde vive el riesgo
   ══════════════════════════════════════════════════════════════════ */

test("TODA consulta del Inicio filtra por accountId", () => {
  const codigo = soloCodigo(leer(FUENTE_INICIO));
  // Cada trozo empieza en una llamada a prisma y termina donde empieza la
  // siguiente: dentro tiene que estar el filtro de cuenta.
  const trozos = codigo.split(/prisma\.realty/);
  assert.ok(trozos.length > 6, "¿se dejaron de hacer consultas en el Inicio?");

  // Se acepta el filtro escrito a la vista (`accountId: ctx.accountId`) o
  // heredado de `alcanceProp`, que es lo que devuelve `alcanceInmuebles` —
  // y que la prueba de aquí abajo comprueba que TAMBIÉN lleva el accountId.
  // Son las dos únicas formas: cualquier otra cosa es una consulta suelta.
  const sinFiltro: string[] = [];
  for (let i = 1; i < trozos.length; i++) {
    const modelo = (/^([A-Za-z]+)\.([a-zA-Z]+)/.exec(trozos[i]) ?? [])[0] ?? `#${i}`;
    const cuerpo = trozos[i];
    const directo = cuerpo.includes("accountId: ctx.accountId");
    const heredado = /where:\s*(\.\.\.)?alcanceProp|where:\s*\{\s*\.\.\.alcanceProp/.test(cuerpo);
    if (!directo && !heredado) sinFiltro.push(modelo);
  }
  assert.deepEqual(
    sinFiltro,
    [],
    "consultas del Inicio SIN accountId: " +
      sinFiltro.join(", ") +
      ". En Prisma un accountId ausente no filtra: devuelve la tabla de TODAS " +
      "las inmobiliarias y el tablero solo enseña números más grandes.",
  );
});

test("el accountId sale del contexto y nunca de un parámetro", () => {
  const codigo = soloCodigo(leer(FUENTE_INICIO));
  // Una firma con accountId suelto es como se cuela el del inquilino
  // equivocado: quien llame se equivoca una vez y nadie lo ve.
  assert.equal(
    /function\s+\w+\s*\([^)]*accountId\s*:/.test(codigo),
    false,
    "ninguna función del Inicio debe recibir un accountId suelto: reciben el ctx",
  );
  assert.equal(
    /accountId:\s*(?!ctx\.accountId)[a-z]/.test(codigo),
    false,
    "hay un accountId que no viene de ctx.accountId",
  );
});

test("el alcance de cartera heredado TAMBIÉN lleva el accountId", () => {
  // Tres consultas del Inicio se apoyan en `alcanceProp` en vez de escribir
  // el filtro a la vista. Eso solo vale si el objeto que devuelve
  // `alcanceInmuebles` trae el accountId dentro — si un día alguien lo
  // quitara, esas tres consultas se volverían cross-tenant EN SILENCIO y la
  // prueba de arriba las seguiría dando por buenas.
  const codigo = soloCodigo(leer(FUENTE_INICIO));
  const i = codigo.indexOf("async function alcanceInmuebles");
  assert.ok(i > 0, "alcanceInmuebles cambió de nombre; revisa esta prueba");
  const cuerpo = codigo.slice(i, codigo.indexOf("\n}", i));
  assert.ok(
    cuerpo.includes("accountId: ctx.accountId"),
    "alcanceInmuebles tiene que devolver el accountId: es el filtro que heredan las consultas de cartera",
  );
});

test("el recorte por oficina NO descarta la cartera sin oficina", () => {
  const codigo = soloCodigo(leer(FUENTE_INICIO));
  // `{ officeId: { in: ids } }` a secas deja fuera los inmuebles con
  // officeId NULL —cartera "de la casa"— y el tablero se queda corto sin
  // que nadie lo note.
  assert.ok(
    /OR:\s*\[\{\s*officeId:\s*\{\s*in:\s*officeIds\s*\}\s*\},\s*\{\s*officeId:\s*null\s*\}\s*\]/.test(
      codigo,
    ),
    "el alcance de cartera tiene que incluir la rama officeId: null",
  );
});

test("la pantalla de Inicio no se cierra a sí misma (sería un bucle de redirects)", () => {
  // Todas las demás pantallas del panel rebotan A ESTA con
  // redirect("/inmobiliaria/inicio"). Si esta también rebotara, el rebote
  // sería infinito y la cuenta se quedaría sin panel.
  const pagina = soloCodigo(leer("src/app/inmobiliaria/(panel)/inicio/page.tsx"));
  assert.equal(
    pagina.includes('redirect("/inmobiliaria/inicio")'),
    false,
    "el Inicio no puede redirigir a sí mismo",
  );
  assert.ok(pagina.includes("getRealtyContext"), "sigue necesitando la sesión");
  assert.ok(
    pagina.includes('redirect("/login")'),
    "sin sesión se va al login, no se pinta un tablero vacío",
  );
});

test("el Inicio ya NO es el placeholder de la Ola 0", () => {
  const pagina = leer("src/app/inmobiliaria/(panel)/inicio/page.tsx");
  assert.equal(
    pagina.includes("RealtyPlaceholder"),
    false,
    "la pantalla de aterrizaje del vertical no puede seguir diciendo «en construcción»",
  );
  assert.ok(pagina.includes("getRealtyInicio"), "la pantalla tiene que traer sus datos");
});

test("ningún Promise.all del Inicio pasa de siete lecturas", () => {
  const codigo = soloCodigo(leer(FUENTE_INICIO));
  const lotes = codigo.split(/Promise\.all\(\[/).slice(1);
  assert.ok(lotes.length >= 1, "¿ya no se leen los datos en paralelo?");
  for (const lote of lotes) {
    // Cada entrada del lote es una llamada a prisma o a un servicio del
    // vertical; se cuentan hasta el cierre del arreglo.
    const cuerpo = lote.slice(0, lote.indexOf("]);"));
    const consultas = (cuerpo.match(/prisma\.realty|getCollectionsBoard\(/g) ?? []).length;
    assert.ok(
      consultas <= 7,
      `un Promise.all del Inicio hace ${consultas} lecturas; el tope de esta pantalla es 7`,
    );
  }
});
