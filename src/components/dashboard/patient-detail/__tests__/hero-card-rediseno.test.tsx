/**
 * CANDADOS DE LA CABECERA DEL PACIENTE CON EL REDISEÑO (ws1-t4, segunda ola).
 *
 * Run: npx tsx --tsconfig tsconfig.test.json --test src/components/dashboard/patient-detail/__tests__/hero-card-rediseno.test.tsx
 *
 * Dos maneras de probar, como `layout-rediseno.test.tsx`:
 *  · leyendo el código — que la pintura nueva no invente colores ni letra de
 *    máquina, y que «Iniciar consulta» siga cableado igual;
 *  · PINTANDO la cabecera con React, con y sin la bandera — que con ella solo
 *    quede «Próxima cita» (y solo si hay cita), y que sin ella salgan las tres
 *    píldoras de siempre, con su «—» y su «Agendar →».
 */
import Module from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const hero = leer("components/dashboard/patient-detail/hero-card.tsx");
const css = leer("components/dashboard/patient-detail/patient-detail.module.css");

// La pintura del rediseño de la cabecera va de su rótulo al final del archivo.
const ROTULO = "REDISEÑO DE PACIENTES (WS1-T4) — la cabecera del paciente";
const cssRediseno = css.slice(css.indexOf(ROTULO));
// Y lo de esta tarea, de su propio rótulo al final.
const ROTULO_ANCHOS = "La cabecera de 1600 a 1024 px";
const cssAnchos = css.slice(css.indexOf(ROTULO_ANCHOS));

test("los dos bloques del rediseño existen y van al final de la hoja", () => {
  assert.ok(css.includes(ROTULO), "falta el bloque del rediseño de la cabecera");
  assert.ok(css.includes(ROTULO_ANCHOS), "falta el bloque de los anchos");
  assert.ok(css.indexOf(ROTULO_ANCHOS) > css.indexOf(ROTULO), "los anchos van DESPUÉS del resto del rediseño: ganan por orden");
  // Todo selector del bloque cuelga de la clase que solo pone la bandera.
  const selectores = [...cssAnchos.matchAll(/^\s*([.#a-zA-Z][^{}\n]*)\{/gm)].map((m) => m[1].trim());
  assert.ok(selectores.length >= 6, "se esperaban varias reglas");
  for (const s of selectores) {
    assert.ok(s.startsWith(".heroRediseno "), `«${s}» no cuelga de .heroRediseno: tocaría la cabecera de siempre`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en el camino nuevo
// ═══════════════════════════════════════════════════════════════════════════
// La palabra prohibida se arma en trozos, como en `hoy-rediseno.test.ts`.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en la pintura nueva; las cifras con tabular-nums", () => {
  assert.ok(!LETRA_DE_MAQUINA.test(cssRediseno), "la pintura del rediseño usa letra de máquina");
  // La cabecera de siempre SÍ la usa en dos sitios (.mono y .metricValue); el
  // rediseño tiene que pisar los dos.
  for (const clase of ["mono", "metricValue"]) {
    const regla = cssRediseno.match(new RegExp(`\\.heroRediseno \\.${clase} \\{([^}]*)\\}`));
    assert.ok(regla, `falta .heroRediseno .${clase}`);
    assert.match(regla![1], /font-family:\s*inherit/, `.heroRediseno .${clase} no hereda Instrument Sans`);
  }
  assert.match(cssAnchos, /font-variant-numeric:\s*tabular-nums/, "las cifras se alinean con tabular-nums");
});

test("el bloque de los anchos no declara tokens ni escribe colores a mano", () => {
  const declaraciones = cssAnchos.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  const sinComentarios = cssAnchos.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(sinComentarios), "hay un hex escrito a mano");
  assert.ok(!/\brgba?\(/.test(sinComentarios), "hay un rgb() escrito a mano");
});

test("nada se esconde por ancho: ni display:none, ni puntos suspensivos, ni umbrales", () => {
  const sinComentarios = cssAnchos.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/display:\s*none/.test(sinComentarios), "algo se esconde");
  assert.ok(!/text-overflow|overflow:\s*hidden/.test(sinComentarios), "algo se corta");
  // La maquetación la decide el contenido (flex-wrap), no un número de píxeles
  // calibrado a mano: justo lo que se rompía con el umbral de 1380px.
  assert.ok(!/@media|@container/.test(sinComentarios), "volvió un umbral por ancho");
  assert.match(sinComentarios, /\.heroRediseno \.heroMain \{[^}]*flex-wrap:\s*wrap/, "la cabecera ya no envuelve");
  assert.match(sinComentarios, /\.heroRediseno \.heroLado \{[^}]*flex-wrap:\s*wrap/, "la caja de cita + botones ya no envuelve");
});

// ═══════════════════════════════════════════════════════════════════════════
// ⛔ «Iniciar consulta» hace exactamente lo mismo, con y sin bandera
// ═══════════════════════════════════════════════════════════════════════════
test("«Iniciar consulta» es UN solo botón, con el cableado de siempre", () => {
  assert.equal((hero.match(/onClick=\{onStartConsult\}/g) ?? []).length, 1, "tiene que haber un único botón que llame a onStartConsult");
  const i = hero.indexOf("onClick={onStartConsult}");
  const boton = hero.slice(hero.lastIndexOf("<button", i), hero.indexOf("</button>", i));
  assert.ok(boton.includes("className={`${styles.btn} ${styles.btnPrimary}`}"), "cambió la clase del botón");
  assert.ok(boton.includes("disabled={!hasNextAppt}"), "cambió cuándo se apaga");
  assert.ok(boton.includes('t("patients.heroCard.startConsultTitle")') && boton.includes('t("patients.heroCard.startConsultDisabledTitle")'), "cambió el title");
  assert.ok(boton.includes('t("patients.heroCard.startConsult")'), "cambió el texto");
  assert.ok(!/rediseno/.test(boton), "el botón no debe saber nada de la bandera");
  // Y quien lo monta le sigue pasando el mismo manejador.
  const ficha = leer("app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.equal((ficha.match(/<HeroCard\b/g) ?? []).length, 1, "la ficha monta una sola cabecera");
  assert.match(ficha.slice(ficha.indexOf("<HeroCard")), /onStartConsult=\{/, "la ficha dejó de pasar onStartConsult");
});

// ═══════════════════════════════════════════════════════════════════════════
// Pintada de verdad, con y sin la bandera
// ═══════════════════════════════════════════════════════════════════════════
const dict = JSON.parse(leer("i18n/dictionaries/es.json")) as Record<string, unknown>;
function t(clave: string, vars?: Record<string, unknown>): string {
  let nodo: unknown = dict;
  for (const parte of clave.split(".")) nodo = (nodo as Record<string, unknown> | undefined)?.[parte];
  if (nodo && typeof nodo === "object") nodo = (nodo as Record<string, string>)[Number(vars?.count) === 1 ? "one" : "other"];
  if (typeof nodo !== "string") return clave;
  return nodo.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ""));
}

const M = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const cargarOriginal = M._load;
const clasesTalCual = new Proxy({}, { get: (_, k) => String(k) });
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request.endsWith(".module.css")) return { __esModule: true, default: clasesTalCual };
  if (request.endsWith("i18n/i18n-provider")) return { useT: () => t };
  if (request === "next/navigation") return { useRouter: () => ({ push() {} }) };
  if (request.endsWith("portales-rediseno/ropa")) return { ROPA_MENU_FICHA: { caja: "ropaMenuFicha" } };
  return cargarOriginal.call(this, request, parent, isMain);
};
const { HeroCard } = require("../hero-card") as typeof import("../hero-card");
type Props = import("../hero-card").HeroCardProps;

const nada = () => {};
const base: Props = {
  patient: {
    id: "p1", firstName: "Ana", lastName: "Poot", patientNumber: "00482", gender: "F", dob: "1988-03-14",
    phone: "999 222 3344", email: null, bloodType: "O+", status: "ACTIVE",
    allergies: [], chronicConditions: [], currentMedications: [],
  },
  nextAppointment: null,
  lastVisitDate: "2026-08-02",
  visitCount: 14,
  pendingBalance: 0,
  portalUrl: null,
  onEdit: nada, onStartConsult: nada, onReschedule: nada, onCharge: nada,
};
const cita = { id: "a1", date: "2026-09-24", startTime: "16:30", type: "Limpieza", doctorName: "Dra. Villanueva" };
const pintar = (props: Partial<Props>) => renderToStaticMarkup(<HeroCard {...base} {...props} />);

const PROXIMA = t("patients.heroCard.nextAppointment");
const ULTIMA = t("patients.heroCard.lastVisit");
const TOTALES = t("patients.heroCard.totalVisits");

test("con bandera y CON cita: solo «Próxima cita», pegada a los botones", () => {
  const html = pintar({ rediseno: true, nextAppointment: cita });
  assert.ok(html.includes(PROXIMA), "no pinta «Próxima cita»");
  assert.ok(html.includes("Dra. Villanueva") && html.includes("Limpieza") && html.includes("16:30"), "la cita perdió hora, doctor o tipo");
  assert.ok(!html.includes(ULTIMA), "sigue «Última visita»");
  assert.ok(!html.includes(TOTALES), "sigue «Visitas totales»");
  assert.equal((html.match(/class="metric"/g) ?? []).length, 1, "tiene que quedar una sola píldora");
  // Cita y botones, dentro de la misma caja y en ese orden.
  const lado = html.slice(html.indexOf('class="heroLado"'));
  assert.ok(lado.indexOf('class="heroMetrics"') !== -1 && lado.indexOf('class="heroMetrics"') < lado.indexOf('class="heroActions"'), "la cita va antes que los botones, en la misma caja");
});

test("con bandera y SIN cita: no se pinta nada — ni hueco, ni «—», ni «Sin cita»", () => {
  const html = pintar({ rediseno: true, nextAppointment: null });
  assert.ok(!html.includes(PROXIMA), "pinta «Próxima cita» sin haber cita");
  assert.ok(!html.includes("heroMetrics"), "queda el hueco de las métricas");
  assert.ok(!html.includes('class="metric'), "queda una píldora");
  assert.ok(!html.includes("—"), "queda una raya de relleno");
  assert.ok(!html.includes(t("patients.heroCard.noAppointment")), "dice «Sin cita»");
  assert.ok(!html.includes(ULTIMA) && !html.includes(TOTALES), "siguen las otras dos");
  // Ley 2: agendar sigue a UN clic, en el botón de al lado.
  assert.ok(html.includes(t("patients.heroCard.scheduleNext")), "se perdió «Agendar próxima»");
  // Y los cuatro botones siguen ahí, en su orden.
  const orden = ["startConsult", "scheduleNext", "charge"].map((k) => html.indexOf(t(`patients.heroCard.${k}`)));
  assert.ok(orden.every((i) => i !== -1) && orden[0] < orden[1] && orden[1] < orden[2], "cambió el orden de los botones");
  assert.ok(html.includes(t("patients.heroCard.moreActionsAria")), "se perdió el menú «…»");
});

test("SIN bandera: las tres píldoras de siempre, sin caja nueva", () => {
  for (const nextAppointment of [cita, null]) {
    const html = pintar({ rediseno: false, nextAppointment });
    for (const rotulo of [PROXIMA, ULTIMA, TOTALES]) assert.ok(html.includes(rotulo), `la cabecera de siempre perdió «${rotulo}»`);
    assert.equal((html.match(/class="metric"/g) ?? []).length, 3, "tienen que seguir las tres píldoras");
    assert.ok(!html.includes("heroLado"), "la caja nueva se coló en el camino de siempre");
    assert.ok(!html.includes("heroRediseno"), "la clase del rediseño se coló en el camino de siempre");
  }
  const sinCita = pintar({ rediseno: false, nextAppointment: null });
  assert.ok(sinCita.includes("—") && sinCita.includes(`${t("patients.heroCard.schedule")} →`), "sin cita, la de siempre sigue diciendo «—» y «Agendar →»");
});

test("los botones son los mismos con y sin bandera", () => {
  // El id que Radix le da al menú «…» sale de la POSICIÓN en el árbol de React,
  // y con la bandera los botones cuelgan de la caja nueva: se iguala antes de
  // comparar. (Sin bandera ese id es el de siempre: el árbol no cambió.)
  const botones = (html: string) =>
    html.slice(html.indexOf('class="heroActions"'), html.indexOf('class="heroAlerts"')).replace(/radix-:[^"]*:/g, "radix-id");
  for (const nextAppointment of [cita, null]) {
    for (const pendingBalance of [0, 1200]) {
      const con = botones(pintar({ rediseno: true, nextAppointment, pendingBalance }));
      const sin = botones(pintar({ rediseno: false, nextAppointment, pendingBalance }));
      // Con bandera la caja `heroLado` añade un </div> de cierre; el resto, idéntico.
      assert.equal(con.replace("</div></div></div>", "</div></div>"), sin, "los botones cambian con la bandera");
    }
  }
});
