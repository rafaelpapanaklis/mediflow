/* ═══════════════════════════════════════════════════════════════════════
   EL HORARIO NO PUEDE TUMBAR LA PÁGINA.

     npx tsx --tsconfig tsconfig.test.json \
       "src/components/barber/templates/__tests__/horario.test.tsx"

   (Sin `--test`: node:test corre igual al importar el módulo, y hace falta
   el tsconfig de pruebas porque esto pinta JSX en node — el de la app deja
   `jsx: "preserve"` para que lo compile Next.)

   Nació de un reporte: en /barber/mi-web, encender un día del horario
   dejaba la pantalla en blanco —hasta el sidebar— sin un solo error en la
   consola. Esta prueba fija el contrato que impide que vuelva a pasar:

     1. TODAS las plantillas pintan con el horario en CUALQUIER estado
        (ninguno, uno solo, todos, salteados), en el editor y en público,
        con la barbería llena y con la barbería recién dada de alta. Se
        recorre BARBER_WEB_TEMPLATE_IDS contra el registro REAL de
        ../index.tsx (con el stub de ./_sin-css), así que una plantilla
        nueva queda cubierta sola, sin tocar esta prueba.
     2. `normalizarConfigBarberWeb` deja SIEMPRE un horario bien formado,
        le metas lo que le metas. Es la única puerta por la que el Json de
        la base llega a las plantillas, así que si aquí no entra basura,
        las plantillas nunca la ven.
     3. Los formateadores (`horaBarberWeb`, `horarioAgrupado`) no revientan
        con entradas que no son cadenas — que es lo que llega si alguien
        escribe en la columna Json sin pasar por la API.
     4. El cortafuegos de la vista previa reintenta cuando cambian los
        datos y NO se reintenta a sí mismo en bucle.

   Sin base de datos y sin navegador: son componentes puros.
   ═══════════════════════════════════════════════════════════════════════ */

import "./_sin-css"; // ← PRIMERO: ../index arrastra skins.css
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import {
  BARBER_WEB_TEMPLATE_IDS,
  configBarberWebVacia,
  horaBarberWeb,
  horarioAgrupado,
  horarioBarberWeb,
  normalizarConfigBarberWeb,
  tieneHorario,
  type BarberWebConfig,
} from "@/lib/barber/landing";
import { LimiteVistaPrevia } from "@/components/barber/landing/limite-error";
import { BARBER_WEB_MANIFESTS, BARBER_WEB_TEMPLATES } from "../index";
import type { BarberWebData, BarberWebTemplateComponent } from "../types";

/** El registro real: la plantilla trece entra aquí sola. */
const PLANTILLAS: Record<string, BarberWebTemplateComponent> = BARBER_WEB_TEMPLATES;

/* ── Las dos barberías extremas ──────────────────────────────────── */

const LLENA = {
  shop: {
    id: "b1",
    name: "Barbería El Corte",
    slug: "el-corte",
    phone: "+52 55 1111 2222",
    address: "Av. Juárez 10",
    city: "CDMX",
    state: "CDMX",
    logoUrl: "https://ejemplo.test/logo.png",
  },
  servicios: [
    { id: "s1", nombre: "Corte clásico", descripcion: "Tijera y máquina", duracionMin: 30, precio: 200, categoria: "general" },
    { id: "s2", nombre: "Barba", descripcion: null, duracionMin: 20, precio: 150, categoria: "barba" },
  ],
  barberos: [{ id: "ba1", nombre: "Luis", apodo: "El Zurdo", fotoUrl: null, bio: "12 años de oficio." }],
};

/** La barbería recién dada de alta: nombre y nada más. */
const PELADA = {
  shop: { id: "b2", name: "Nueva", slug: "nueva", phone: null, address: null, city: null, state: null, logoUrl: null },
  servicios: [] as typeof LLENA.servicios,
  barberos: [] as typeof LLENA.barberos,
};

/** El horario con los siete días, abiertos los que se digan. */
function horarioDe(abiertos: number[]): BarberWebConfig["horario"] {
  return [0, 1, 2, 3, 4, 5, 6].map((dia) => ({
    dia,
    abierto: abiertos.includes(dia),
    desde: "09:00",
    hasta: "20:00",
  }));
}

/**
 * Los estados del horario que importan.
 *
 * `un-solo-dia` y `todos` son los dos que pidió el reporte; los demás son
 * los bordes del agrupador (`horarioAgrupado` junta días consecutivos, así
 * que el primero, el último y los salteados son casos distintos).
 */
const ESTADOS: Array<[string, BarberWebConfig["horario"]]> = [
  ["lista vacía (nunca tocó el horario)", []],
  ["los siete cerrados", horarioDe([])],
  ["sólo lunes", horarioDe([0])],
  ["sólo domingo", horarioDe([6])],
  ["lunes y miércoles (salteados)", horarioDe([0, 2])],
  ["de martes a viernes", horarioDe([1, 2, 3, 4])],
  ["los siete abiertos", horarioDe([0, 1, 2, 3, 4, 5, 6])],
  ["sólo tres días en la lista", [{ dia: 2, abierto: true, desde: "10:00", hasta: "19:30" }, { dia: 3, abierto: false, desde: "09:00", hasta: "20:00" }, { dia: 5, abierto: true, desde: "08:00", hasta: "22:00" }]],
];

function datos(tpl: string, horario: BarberWebConfig["horario"], base: typeof LLENA, editando: boolean): BarberWebData {
  const config = configBarberWebVacia();
  config.horario = horario;
  return {
    shop: base.shop,
    config,
    manifest: BARBER_WEB_MANIFESTS[tpl as keyof typeof BARBER_WEB_MANIFESTS],
    servicios: base.servicios,
    barberos: base.barberos,
    editando,
  };
}

/* ══════════════════════════════════════════════════════════════
   1 · Todas las plantillas, en todos los estados del horario
   ══════════════════════════════════════════════════════════════ */

test("todas las plantillas pintan con el horario en cualquier estado", () => {
  let pintadas = 0;
  for (const tpl of BARBER_WEB_TEMPLATE_IDS) {
    const Plantilla = PLANTILLAS[tpl];
    assert.ok(Plantilla, `falta la plantilla ${tpl} en la tabla de la prueba`);
    for (const [nombre, horario] of ESTADOS) {
      for (const base of [LLENA, PELADA]) {
        for (const editando of [true, false]) {
          const data = datos(tpl, horario, base, editando);
          assert.doesNotThrow(
            () => renderToStaticMarkup(<Plantilla data={data} />),
            `${tpl} reventó con «${nombre}» (editando=${editando})`,
          );
          pintadas++;
        }
      }
    }
  }
  // N plantillas × 8 estados × 2 barberías × 2 modos.
  assert.equal(pintadas, BARBER_WEB_TEMPLATE_IDS.length * ESTADOS.length * 2 * 2);
});

test("encender un día hace aparecer el horario en la plantilla, y apagarlo lo quita", () => {
  for (const tpl of BARBER_WEB_TEMPLATE_IDS) {
    const Plantilla = PLANTILLAS[tpl];
    const cerrado = renderToStaticMarkup(<Plantilla data={datos(tpl, horarioDe([]), LLENA, true)} />);
    const lunes = renderToStaticMarkup(<Plantilla data={datos(tpl, horarioDe([0]), LLENA, true)} />);
    // El rango sólo puede salir si hay un día abierto: es EL cambio que
    // dispara el bug del reporte.
    assert.ok(!cerrado.includes("9:00 am"), `${tpl} enseña horas con todo cerrado`);
    assert.ok(lunes.includes("9:00 am"), `${tpl} no enseña el horario con el lunes abierto`);
  }
});

/* ══════════════════════════════════════════════════════════════
   2 · Nada mal formado llega a las plantillas
   ══════════════════════════════════════════════════════════════ */

const BASURA: unknown[] = [
  { horario: "lunes a viernes" },
  { horario: [null, undefined, 0, "x", []] },
  { horario: [{ dia: "1", abierto: "sí", desde: 900, hasta: null }] },
  { horario: [{ dia: 1.5 }, { dia: -1 }, { dia: 7 }, { dia: NaN }, { dia: Infinity }] },
  { horario: [{ dia: 0, desde: "25:00", hasta: "09:61" }] },
  { horario: [{ dia: 0, desde: "09:00:00", hasta: "8" }] },
  { horario: [{ dia: 3 }, { dia: 3 }, { dia: 3 }] },
  { horario: [{ dia: 6, abierto: true }, { dia: 0, abierto: true }] },
  { horario: Array.from({ length: 500 }, (_, i) => ({ dia: i % 7, abierto: true })) },
];

test("normalizarConfigBarberWeb deja SIEMPRE un horario bien formado", () => {
  for (const raw of BASURA) {
    const c = normalizarConfigBarberWeb(raw);
    const vistos = new Set<number>();
    let previo = -1;
    for (const d of c.horario) {
      assert.ok(Number.isInteger(d.dia) && d.dia >= 0 && d.dia <= 6, `día inválido: ${d.dia}`);
      assert.ok(!vistos.has(d.dia), `día repetido: ${d.dia}`);
      vistos.add(d.dia);
      assert.ok(d.dia > previo, "el horario tiene que salir ordenado por día");
      previo = d.dia;
      assert.equal(typeof d.abierto, "boolean");
      assert.match(d.desde, /^\d{2}:\d{2}$/, `«desde» mal formado: ${JSON.stringify(d.desde)}`);
      assert.match(d.hasta, /^\d{2}:\d{2}$/, `«hasta» mal formado: ${JSON.stringify(d.hasta)}`);
    }
  }
});

test("todas las plantillas pintan con el horario que sale de normalizar basura", () => {
  for (const raw of BASURA) {
    const config = normalizarConfigBarberWeb(raw);
    for (const tpl of BARBER_WEB_TEMPLATE_IDS) {
      const Plantilla = PLANTILLAS[tpl];
      const data: BarberWebData = {
        shop: LLENA.shop,
        config,
        manifest: BARBER_WEB_MANIFESTS[tpl as keyof typeof BARBER_WEB_MANIFESTS],
        servicios: LLENA.servicios,
        barberos: LLENA.barberos,
        editando: false,
      };
      assert.doesNotThrow(
        () => renderToStaticMarkup(<Plantilla data={data} />),
        `${tpl} reventó con ${JSON.stringify(raw).slice(0, 80)}`,
      );
    }
  }
});

/* ══════════════════════════════════════════════════════════════
   3 · Los formateadores, con lo que NO debería llegarles

   Segundo cinturón: si algún día alguien escribe en la columna Json sin
   pasar por normalizarConfigBarberWeb, esto tiene que doblarse, no
   romperse. Una hora fea es un renglón feo; nunca una pantalla en blanco.
   ══════════════════════════════════════════════════════════════ */

test("horaBarberWeb no revienta con lo que no es una cadena", () => {
  const entradas: unknown[] = [null, undefined, 900, NaN, {}, [], true, "", ":", "abc", "09:00:00"];
  for (const v of entradas) {
    assert.doesNotThrow(() => horaBarberWeb(v as string), `horaBarberWeb reventó con ${String(v)}`);
    assert.equal(typeof horaBarberWeb(v as string), "string");
  }
});

test("horarioBarberWeb y horarioAgrupado aguantan un horario crudo", () => {
  const c = configBarberWebVacia();
  // A propósito con la forma equivocada: es lo que habría en la base si
  // alguien escribiera el Json a mano.
  (c as { horario: unknown }).horario = [
    { dia: 0, abierto: true, desde: null, hasta: 2000 },
    { dia: 1, abierto: true },
    "basura",
    null,
  ];
  assert.doesNotThrow(() => horarioBarberWeb(c));
  assert.doesNotThrow(() => horarioAgrupado(c));
  assert.doesNotThrow(() => tieneHorario(c));
  // Siempre los siete días, pase lo que pase.
  assert.equal(horarioBarberWeb(c).length, 7);
  assert.ok(horarioAgrupado(c).length >= 1);
});

/* ══════════════════════════════════════════════════════════════
   4 · El cortafuegos de la vista previa

   Lo que se prueba es la regla de reintento, que es donde está el
   peligro: un límite de error que se limpia solo en cuanto recibe las
   mismas props vuelve a montar al hijo que acaba de reventar y se queda
   en un bucle infinito de render.
   ══════════════════════════════════════════════════════════════ */

const derivar = LimiteVistaPrevia.getDerivedStateFromProps as unknown as (
  p: { reintentarCon: unknown },
  s: { error: Error | null; clave: unknown },
) => { error?: Error | null; clave?: unknown } | null;

test("el cortafuegos NO se reintenta con los mismos datos (nada de bucle)", () => {
  const datosA = { id: "a" };
  const fallo = new Error("plantilla rota");
  // Estado justo después de atrapar: `clave` ya vale datosA porque se
  // sincronizó en el render que reventó.
  assert.equal(derivar({ reintentarCon: datosA }, { error: fallo, clave: datosA }), null);
});

test("el cortafuegos SÍ reintenta en cuanto la barbería cambia algo", () => {
  const datosA = { id: "a" };
  const datosB = { id: "b" };
  const fallo = new Error("plantilla rota");
  const siguiente = derivar({ reintentarCon: datosB }, { error: fallo, clave: datosA });
  assert.deepEqual(siguiente, { error: null, clave: datosB });
});

test("el cortafuegos apunta la clave del primer render, sin error de por medio", () => {
  const datosA = { id: "a" };
  assert.deepEqual(derivar({ reintentarCon: datosA }, { error: null, clave: undefined }), {
    error: null,
    clave: datosA,
  });
});
