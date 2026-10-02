/**
 * ws1-t2 (ticket BEVADENT 3, 12h) — la cabecera de la ficha no dice «✓ Sin alergias registradas» en verde
 * de un paciente al que nunca se le capturó la salud.
 *
 * Run: npx tsx --tsconfig tsconfig.test.json --test src/components/dashboard/patient-detail/__tests__/hero-salud-capturada.test.tsx
 *
 * Se PINTA la cabecera de verdad, con y sin el rediseño, y se lee el cableado de la ficha y de la cabecera de
 * Ortodoncia. Con el código viejo el primer caso (sin cuestionario) salía verde: la prueba lo detecta.
 */
import Module from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

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
  // Sin `useLocale`: los textos nuevos se quedan en español, como fuera del proveedor.
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
  lastVisitDate: null,
  visitCount: 0,
  pendingBalance: 0,
  portalUrl: null,
  onEdit: nada, onStartConsult: nada, onReschedule: nada, onCharge: nada,
};
const pintar = (props: Partial<Props>) => renderToStaticMarkup(<HeroCard {...base} {...props} />);

const VERDE = t("patients.heroCard.noAllergies");
const SIN_CAPTURAR = "Salud sin capturar";
const VENCIDO = "Cuestionario de salud vencido";

for (const rediseno of [true, false]) {
  const modo = rediseno ? "con el rediseño" : "sin el rediseño";

  test(`${modo}: sin cuestionario sale «Salud sin capturar» y NO el verde`, () => {
    const html = pintar({ rediseno, questionnaireStatus: "none" });
    assert.ok(html.includes(SIN_CAPTURAR), "no avisa que la salud no está capturada");
    assert.ok(!html.includes(VERDE), "sigue diciendo «Sin alergias registradas» sin haber cuestionario");
    assert.ok(!html.includes("alertChip success"), "queda un chip verde");
  });

  test(`${modo}: cuestionario vencido sale ámbar y NO el verde`, () => {
    const html = pintar({ rediseno, questionnaireStatus: "stale" });
    assert.ok(html.includes(VENCIDO), "no avisa que el cuestionario venció");
    assert.ok(!html.includes(VERDE), "pinta el verde con el cuestionario vencido");
  });

  test(`${modo}: con cuestionario vigente y sin alergias sale el verde, sin aviso`, () => {
    const html = pintar({ rediseno, questionnaireStatus: "ok" });
    assert.ok(html.includes(VERDE), "se perdió el verde de «Sin alergias registradas»");
    assert.ok(!html.includes(SIN_CAPTURAR) && !html.includes(VENCIDO), "avisa de salud pendiente con la salud capturada");
  });

  test(`${modo}: con alergias reales el aviso de salud pendiente convive con ellas`, () => {
    const html = pintar({
      rediseno,
      questionnaireStatus: "none",
      patient: { ...base.patient, allergies: ["Penicilina"] },
    });
    assert.ok(html.includes("Penicilina"), "se perdió la alergia");
    assert.ok(html.includes(SIN_CAPTURAR), "la alergia escondió el aviso de salud pendiente");
    assert.ok(!html.includes(VERDE), "pinta el verde teniendo una alergia");
  });

  test(`${modo}: «N/A» en alergias sin cuestionario NO cuenta como salud capturada`, () => {
    const html = pintar({ rediseno, questionnaireStatus: "none", patient: { ...base.patient, allergies: ["N/A"] } });
    assert.ok(html.includes(SIN_CAPTURAR));
    assert.ok(!html.includes(VERDE));
  });

  test(`${modo}: sin el dato la cabecera se pinta como siempre`, () => {
    const html = pintar({ rediseno });
    assert.ok(html.includes(VERDE));
    assert.ok(!html.includes(SIN_CAPTURAR));
  });
}

test("el aviso es un botón que abre el cuestionario si la sesión puede; si no, un texto", () => {
  const tipoDelAviso = (html: string) => {
    const antes = html.slice(0, html.indexOf(SIN_CAPTURAR));
    return antes.slice(Math.max(antes.lastIndexOf("<button"), antes.lastIndexOf("<span"))).startsWith("<button") ? "boton" : "texto";
  };
  assert.equal(tipoDelAviso(pintar({ rediseno: true, questionnaireStatus: "none", onAbrirCuestionario: nada })), "boton");
  assert.equal(tipoDelAviso(pintar({ rediseno: true, questionnaireStatus: "none" })), "texto");
  // Sin permiso el texto explica por qué nadie puede pulsarlo.
  assert.ok(pintar({ rediseno: true, questionnaireStatus: "none" }).includes("lo llena quien tenga acceso al expediente"));
});

test("la ficha le pasa a la cabecera el estado del cuestionario, y el botón solo con permiso del expediente", () => {
  const ficha = leer("app/dashboard/patients/[id]/patient-detail-client.tsx");
  const desde = ficha.slice(ficha.indexOf("<HeroCard"));
  assert.match(desde, /questionnaireStatus=\{questionnaireStatus\}/, "la ficha no pasa el estado del cuestionario");
  assert.match(desde, /onAbrirCuestionario=\{canViewRecords \?/, "el botón no depende del permiso del expediente");
  assert.match(ficha, /<OrthodonticsPatientTab[\s\S]*?questionnaireStatus=\{questionnaireStatus\}/, "Ortodoncia no recibe el estado");
});

test("la cabecera de Ortodoncia avisa lo mismo y con los mismos criterios", () => {
  const tab = leer("components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx");
  assert.match(tab, /estadoSalud: estadoSalud\(questionnaireStatus\)/);
  const cab = leer("components/specialties/orthodontics/redesign/PatientHeaderG16.tsx");
  assert.match(cab, /saludPendiente\(p\.estadoSalud\)/);
  assert.match(cab, /<Pill color="amber">\{avisoSalud\}<\/Pill>/);
});

test("el chip nuevo no trae colores a mano", () => {
  const hero = leer("components/dashboard/patient-detail/hero-card.tsx");
  const desde = hero.indexOf("saludPendiente(salud) &&");
  const bloque = hero.slice(desde, hero.indexOf("{rediseno && !hayRiesgo(alertas)", desde));
  assert.ok(bloque.length > 0);
  assert.doesNotMatch(bloque, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
});
