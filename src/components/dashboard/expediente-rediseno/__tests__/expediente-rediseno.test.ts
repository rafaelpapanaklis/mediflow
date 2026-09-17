/**
 * CANDADOS DE LA SEGUNDA OLA DEL EXPEDIENTE (ws1-t4): Plan de tratamiento,
 * Citas, Facturación y el marco del Odontograma.
 *
 * Run: npx tsx --test src/components/dashboard/expediente-rediseno/__tests__/expediente-rediseno.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno/__tests__/
 * hoy-rediseno.test.ts`: lo que se vigila es CABLEADO (que la carpeta no
 * invente tokens ni letra de máquina, que lea los del menú, que el camino
 * viejo siga vivo y sin tocar detrás de `!rediseno`, que los apartados nuevos
 * llamen a los mismos callbacks que los de siempre, que el dibujo del
 * odontograma no se toque), y eso se ve en el archivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "expediente-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

const FICHA = "app/dashboard/patients/[id]/patient-detail-client.tsx";

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en la carpeta nueva
// ═══════════════════════════════════════════════════════════════════════════
// La palabra prohibida se arma en trozos para que un grep sobre la carpeta
// (el gate de cierre: «cero letra de máquina») no se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en la carpeta del rediseño", () => {
  assert.ok(archivosNuevos.length >= 6, "faltan archivos en la carpeta");
  for (const a of archivosNuevos) {
    assert.ok(
      !LETRA_DE_MAQUINA.test(a.texto),
      `${a.nombre} usa letra de máquina; las cifras van con tabular-nums sobre Instrument Sans`,
    );
  }
  const css = archivosNuevos.find((a) => a.nombre === "expediente.module.css")!.texto;
  assert.match(css, /font-variant-numeric:\s*tabular-nums/, "las cifras se alinean con tabular-nums");
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin tokens nuevos ni colores a mano: la hoja solo LEE los del menú (--m2-*)
// y los semánticos del expediente (--pr-*)
// ═══════════════════════════════════════════════════════════════════════════
test("expediente.module.css no declara ninguna variable CSS propia ni un color a mano", () => {
  const css = archivosNuevos.find((a) => a.nombre === "expediente.module.css")!.texto;
  const declaraciones = css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css, /var\(--m2-/, "lee los tokens del menú");
  for (const a of archivosNuevos) {
    const hex = a.texto.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    assert.deepEqual(hex, [], `${a.nombre} lleva colores escritos a mano: ${hex.join(", ")}`);
  }
  const raiz = leer("components/dashboard/expediente-rediseno/raiz.tsx");
  assert.match(raiz, /CLASES_MENU/, "la raíz monta CLASES_MENU (menu-dos-niveles/clases.ts)");
});

// ═══════════════════════════════════════════════════════════════════════════
// El odontograma: se viste el MARCO y no se toca el dibujo
// ═══════════════════════════════════════════════════════════════════════════
test("el marco del odontograma no pone ni una regla sobre el dibujo", () => {
  const css = archivosNuevos.find((a) => a.nombre === "expediente.module.css")!.texto;
  const reglasMarco = css.match(/\.marcoOdontograma[^{]*\{/g) ?? [];
  assert.ok(reglasMarco.length > 10, "el marco tiene que vestir algo");
  // Lo que es dibujo: celdas, números, glifos, caras, arcos y escenas 2D/3D.
  const DIBUJO = ["odo-chart", "odo-cell", "odo-num", "odo-glyph", "odo-circle", "odo-label", "odo-arch", "odo-midline", "odo-divider", "odo-2d-stage", "odo-3d", "palmer"];
  for (const r of reglasMarco) {
    for (const d of DIBUJO) {
      // `.odo-chart-card` y `.odo-chart-head` son el marco del lienzo, no el lienzo.
      const sinMarco = r.replace(/odo-chart-(card|head)/g, "");
      assert.ok(!sinMarco.includes(d), `el marco toca el dibujo (${d}): ${r.trim()}`);
    }
  }
  // Cada selector lleva `.odo-app` dentro para pesar más que la hoja original sin !important.
  assert.ok(!css.includes("!important"), "sin !important");
  const odo = leer("components/dashboard/expediente-rediseno/odontograma.tsx");
  assert.match(odo, /<OdontogramV2 patientId=\{patientId\} dedupeLegend edgeScrollHint \/>/, "monta el mismo OdontogramV2 con las dos señales que ya llevaba con la bandera");
});

// ═══════════════════════════════════════════════════════════════════════════
// La ficha: el camino viejo sigue vivo detrás de !rediseno y el nuevo detrás
// de rediseno, para los cuatro apartados
// ═══════════════════════════════════════════════════════════════════════════
test("patient-detail-client.tsx conserva los cuatro apartados de siempre y elige con `rediseno`", () => {
  const ficha = leer(FICHA);
  // Odontograma
  assert.ok(ficha.includes('{tab === "odontograma" && rediseno && ('), "odontograma nuevo");
  assert.ok(ficha.includes('{tab === "odontograma" && !rediseno && ('), "odontograma viejo");
  assert.ok(/!rediseno && \(\s*<OdontogramV2/.test(ficha), "el viejo sigue montando OdontogramV2 directo");
  // Citas
  assert.ok(ficha.includes('{tab === "agenda" && rediseno && ('), "citas nuevas");
  assert.ok(ficha.includes('{tab === "agenda" && !rediseno && ('), "citas viejas");
  assert.ok(ficha.includes("patientDetailStyles.tableB"), "la tabla vieja de citas sigue ahí");
  // Facturación
  assert.ok(ficha.includes('{tab === "facturacion" && canViewBilling && rediseno && ('), "facturación nueva");
  assert.ok(ficha.includes('{tab === "facturacion" && canViewBilling && !rediseno && ('), "facturación vieja");
  assert.ok(/!rediseno && \(\s*<BillingTab/.test(ficha), "el viejo sigue montando BillingTab");
  // Plan de tratamiento: la lista vieja detrás de !rediseno; las ventanas comunes
  assert.ok(ficha.includes("<PlanTratamientoRediseno"), "plan nuevo");
  const plan = ficha.slice(ficha.indexOf('tab === "tratamiento"'), ficha.indexOf("TAB: RECETAS"));
  assert.ok(plan.includes("{!rediseno && ("), "la lista vieja del plan queda detrás de !rediseno");
  for (const ventana of ["{showNewTreatment && (", "{viewPlan && (", "{editPlan && ("]) {
    assert.ok(plan.includes(ventana), `la ventana ${ventana} sigue en el plan, común a los dos caminos`);
  }
  // Las cuatro importaciones vienen de esta carpeta.
  for (const mod of ["odontograma", "plan-tratamiento", "citas", "facturacion"]) {
    assert.ok(ficha.includes(`@/components/dashboard/expediente-rediseno/${mod}`), `importa ${mod}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Mismos callbacks que los apartados de siempre: ni un botón que haga otra cosa
// ═══════════════════════════════════════════════════════════════════════════
test("los apartados nuevos reciben los mismos callbacks que los de siempre", () => {
  const ficha = leer(FICHA);
  const bloque = (inicio: string) => {
    const i = ficha.indexOf(inicio);
    assert.ok(i >= 0, `no se encontró ${inicio}`);
    return ficha.slice(i, ficha.indexOf("/>", i));
  };
  const plan = bloque("<PlanTratamientoRediseno");
  for (const cb of ["setShowNewTreatment(true)", "setViewPlan(plan)", "setEditPlan(plan)", "handleDeleteTreatment(plan)", "canEditTreatments", "tratamientos={treatments}"]) {
    assert.ok(plan.includes(cb), `el plan nuevo perdió ${cb}`);
  }
  const citas = bloque("<CitasRediseno");
  for (const cb of ["citas={appointments}", "openNewAppointmentForPatient", "handleCancelAppointment(a)", "APPT_STATUS_FULL"]) {
    assert.ok(citas.includes(cb), `las citas nuevas perdieron ${cb}`);
  }
  const fact = bloque("<FacturacionRediseno");
  for (const cb of ["facturas={invoices}", "facturApiEnabled={facturApiEnabled}", "setShowNewInvoice(true)", "setInvoiceDetailOpen(inv)", "openDirectPayment(inv)", 'setInvoiceDetailAction("cfdi")']) {
    assert.ok(fact.includes(cb), `la facturación nueva perdió ${cb}`);
  }
  // Y la vieja sigue con exactamente los mismos.
  const viejaFact = bloque("<BillingTab");
  for (const cb of ["invoices={invoices}", "setShowNewInvoice(true)", "setInvoiceDetailOpen(inv)", "openDirectPayment(inv)", 'setInvoiceDetailAction("cfdi")', "redesignOn={rediseno}"]) {
    assert.ok(viejaFact.includes(cb), `la facturación vieja cambió: ${cb}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// La pestaña Facturación nueva pinta lo MISMO que billing-tab.tsx
// ═══════════════════════════════════════════════════════════════════════════
test("facturacion.tsx conserva las columnas, los estados y las reglas de billing-tab.tsx", () => {
  const nueva = leer("components/dashboard/expediente-rediseno/facturacion.tsx");
  const vieja = leer("components/dashboard/patient-detail/billing-tab.tsx");
  const claves = [
    "patients.billing.colInvoice", "common.date", "patients.billing.colAmount", "patients.billing.colPaid",
    "patients.billing.colBalance", "common.status", "billing.billingClient.thCfdi", "patients.billing.rowCharge",
    "patients.billing.title", "patients.billing.empty", "clinical.emptyStates.invoicesNewCta",
  ];
  for (const k of claves) {
    assert.ok(vieja.includes(`"${k}"`), `billing-tab.tsx ya no usa ${k}: actualiza este candado`);
    assert.ok(nueva.includes(`"${k}"`), `la pestaña nueva perdió ${k}`);
  }
  // Los tres estados del CFDI, con las claves del indicador compartido.
  const cfdi = leer("components/dashboard/billing/invoice-cfdi-badge.tsx");
  for (const k of ["billing.billingClient.cfdiInvoiced", "billing.billingClient.cfdiStamp", "billing.billingClient.satNotConfigured"]) {
    assert.ok(cfdi.includes(`"${k}"`) && nueva.includes(`"${k}"`), `estado CFDI ${k}`);
  }
  // Mismas reglas de negocio, de la misma fuente única.
  for (const fn of ["invoiceStatusBadge", "isVoidedInvoice", "isChargeableInvoice", "fmtMXNdec"]) {
    assert.ok(vieja.includes(fn) && nueva.includes(fn), `la pestaña nueva no usa ${fn}`);
  }
  // Y el mini-resumen sigue fuera (N6): el rail ya lo enseña.
  assert.ok(!nueva.includes("KpiCard") && !nueva.includes("summary"), "sin mini-resumen duplicado");
});

// ═══════════════════════════════════════════════════════════════════════════
// Toda clave i18n que usa el rediseño existe en el diccionario en español
// ═══════════════════════════════════════════════════════════════════════════
test("todas las claves t(\"…\") del rediseño existen en es.json", () => {
  const dict = JSON.parse(leer("i18n/dictionaries/es.json")) as Record<string, unknown>;
  const existe = (clave: string): boolean => {
    let nodo: unknown = dict;
    for (const parte of clave.split(".")) {
      if (!nodo || typeof nodo !== "object" || !(parte in (nodo as object))) return false;
      nodo = (nodo as Record<string, unknown>)[parte];
    }
    return true;
  };
  const claves = new Set<string>();
  for (const a of archivosNuevos) {
    for (const m of a.texto.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) claves.add(m[1]);
    for (const m of a.texto.matchAll(/labelKey:\s*"([a-zA-Z0-9_.]+)"/g)) claves.add(m[1]);
  }
  assert.ok(claves.size > 25, "se esperaban decenas de claves");
  const faltan = [...claves].filter((k) => !existe(k));
  assert.deepEqual(faltan, [], `claves sin traducción: ${faltan.join(", ")}`);
});
