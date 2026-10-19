/**
 * COBRO RECHAZADO — reglas puras, textos, candado de suspendida, aviso por rol, correo, sedes y «nunca
 * borrar» (ws1-t1, 19-oct-2026).
 *
 * Run: npm run test:cobro-rechazado
 *
 * El webhook de verdad (primer rechazo, reintento, evento repetido, orden cambiado, pago y reactivación)
 * está en src/app/api/webhooks/stripe/__tests__/cobro-rechazado.test.ts. Aquí van las piezas que no
 * necesitan base ni Stripe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import {
  GRACIA_COBRO_RECHAZADO_HORAS,
  accesoTrasCobroRechazado,
  avisoDePagoRechazado,
  debeReintentarPorEstadoVivo,
  esperaAlRechazoDeFactura,
  fechaHoraDeLaClinica,
  finDeGracia,
  inicioDeNuevoPeriodo,
} from "../cobro-rechazado";
import {
  getPlanStatus,
  isAllowedWhileSuspended,
  isApiPathBlockedForExpiredPlan,
  isInTrial,
  isPlanExpired,
} from "../../plan-status";
import { planStatusLabel } from "../../plan-status-label";
import { datosDeSedeDesdeMadre } from "../sedes-incluidas-core";
import { fechaHoraPanel } from "../../formato-fecha-panel";
import { cobrarPendiente, formatoMonto, leerPagoPendiente, tarjetaRechazadaViva } from "../pago-pendiente-cliente";
import { buildPaymentFailedEmail } from "../../email";
import { I18nProvider } from "../../../i18n/i18n-provider";
import { getDict } from "../../../i18n/dictionaries";
import Module from "node:module";

// tsx no resuelve los CSS modules y fuera de la app de Next no hay router: se sustituyen por dobles ANTES de
// cargar los componentes de cliente. Los `import` estáticos se evalúan primero, por eso estos dos se cargan
// con require, ya con el doble puesto.
const Mod = Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req, parent, isMain) {
  // Fuera de la app de Next no hay router montado: un doble mínimo basta para pintar.
  if (req === "next/navigation") return { useRouter: () => ({ push() {}, replace() {}, refresh() {} }), usePathname: () => "/dashboard" };
  if (req.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_o, k) => String(k) }) };
  return cargaOriginal.call(this, req, parent, isMain);
};
/* eslint-disable @typescript-eslint/no-require-imports */
const { AccionesSuspendida } = require("../../../app/dashboard/suspended/acciones-suspendida");
const { AvisoPagoRechazado } = require("../../../components/dashboard/aviso-pago-rechazado");
const { PagoPendienteVista } = require("../../../components/dashboard/pago-pendiente");
/* eslint-enable @typescript-eslint/no-require-imports */
function Acciones() {
  return <AccionesSuspendida plan="PRO" clinicName="BEVADENT" managerWhatsapp="529990000000" />;
}

const HORA = 3_600_000;
const DIA = 24 * HORA;
const T0 = new Date("2026-10-19T18:00:00.000Z"); // el rechazo de BBVA
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ── La gracia ─────────────────────────────────────────────────────────── */

test("la gracia es de 24 horas, en UNA constante", () => {
  assert.equal(GRACIA_COBRO_RECHAZADO_HORAS, 24);
  assert.equal(finDeGracia(T0).getTime() - T0.getTime(), 24 * HORA);
});

test("primer rechazo (al corriente): acceso = rechazo + 24 h, sea cual sea la fecha que tenía", () => {
  const limite = finDeGracia(T0);
  for (const estado of ["active", "trialing", "paid"]) {
    for (const actual of [new Date(T0.getTime() + 30 * DIA), new Date(T0.getTime() - 2 * HORA), null]) {
      assert.deepEqual(accesoTrasCobroRechazado({ estadoActual: estado, accesoActual: actual, rechazoEn: T0 }), limite, `${estado} · ${actual?.toISOString()}`);
    }
  }
});

test("reintento (ya past_due / unpaid): nunca alarga ni reinicia; solo acorta si tenía de más", () => {
  const limite = finDeGracia(T0);
  for (const estado of ["past_due", "unpaid"]) {
    // 8 h y 3 días después: el nuevo límite sería mayor → no se toca.
    assert.equal(accesoTrasCobroRechazado({ estadoActual: estado, accesoActual: limite, rechazoEn: new Date(T0.getTime() + 8 * HORA) }), undefined);
    assert.equal(accesoTrasCobroRechazado({ estadoActual: estado, accesoActual: limite, rechazoEn: new Date(T0.getTime() + 3 * DIA) }), undefined);
    // El mismo evento otra vez: misma hora → no cambia.
    assert.equal(accesoTrasCobroRechazado({ estadoActual: estado, accesoActual: limite, rechazoEn: T0 }), undefined);
  }
  // Clínica ya rechazada con una fecha de más (BEVADENT hoy: 19-nov): el reintento la baja a su 24 h.
  const retry = new Date(T0.getTime() + 8 * HORA);
  assert.deepEqual(accesoTrasCobroRechazado({ estadoActual: "past_due", accesoActual: new Date(T0.getTime() + 30 * DIA), rechazoEn: retry }), finDeGracia(retry));
});

test("otros estados (pending_payment, incomplete, cancelled, sin estado): no se concede acceso que no tenía", () => {
  for (const estado of ["pending_payment", "incomplete", "cancelled", "canceled", "paused", null]) {
    assert.equal(accesoTrasCobroRechazado({ estadoActual: estado, accesoActual: null, rechazoEn: T0 }), undefined, String(estado));
  }
});

test("orden de eventos: solo el `payment_failed` baja a past_due; el estado vivo y el reintento por Stripe se respetan", () => {
  assert.equal(esperaAlRechazoDeFactura({ estadoActual: "active", estadoNuevo: "past_due" }), true);
  assert.equal(esperaAlRechazoDeFactura({ estadoActual: "past_due", estadoNuevo: "past_due" }), false);
  assert.equal(esperaAlRechazoDeFactura({ estadoActual: "active", estadoNuevo: "unpaid" }), false, "retries agotados: ya no hay gracia que fijar");
  assert.equal(esperaAlRechazoDeFactura({ estadoActual: "past_due", estadoNuevo: "active" }), false, "recuperación");
  assert.equal(debeReintentarPorEstadoVivo({ estadoActual: "past_due", eventoStatus: "active", vivo: null }), true);
  assert.equal(debeReintentarPorEstadoVivo({ estadoActual: "past_due", eventoStatus: "active", vivo: "active" }), false);
  assert.equal(debeReintentarPorEstadoVivo({ estadoActual: "active", eventoStatus: "active", vivo: null }), false, "sin rechazo no hay riesgo que contrastar");
});

/* ── Reactivar ─────────────────────────────────────────────────────────── */

test("inicio del periodo nuevo: con el cobro rechazado o cancelada NO cuenta el siguiente cobro sin pagar", () => {
  const hoy = new Date("2027-04-19T12:00:00.000Z");
  const noPagado = new Date("2026-11-19T00:00:00.000Z");
  const acceso = new Date("2026-10-20T18:00:00.000Z");
  for (const estado of ["past_due", "unpaid", "cancelled", "canceled"]) {
    assert.equal(inicioDeNuevoPeriodo({ ahora: hoy, estadoAntes: estado, trialEndsAt: acceso, nextBillingDate: noPagado }).getTime(), hoy.getTime(), estado);
  }
  // Rechazada pero con el periodo aún por delante (paga durante la gracia): se suma desde su acceso.
  const ahora = new Date("2026-10-19T20:00:00.000Z");
  assert.equal(inicioDeNuevoPeriodo({ ahora, estadoAntes: "past_due", trialEndsAt: acceso, nextBillingDate: noPagado }).getTime(), acceso.getTime());
  // Al corriente que renueva por adelantado: el máximo de las dos, como siempre.
  assert.equal(inicioDeNuevoPeriodo({ ahora, estadoAntes: "active", trialEndsAt: acceso, nextBillingDate: noPagado }).getTime(), noPagado.getTime());
  assert.equal(inicioDeNuevoPeriodo({ ahora, estadoAntes: null, trialEndsAt: null, nextBillingDate: null }).getTime(), ahora.getTime());
});

/* ── «Pago rechazado» ≠ «En prueba» ────────────────────────────────────── */

test("past_due / unpaid con acceso por delante NO está en prueba; /admin dice «Cobro fallido · acceso hasta …»", () => {
  const now = new Date("2026-10-19T20:00:00.000Z");
  for (const subscriptionStatus of ["past_due", "unpaid"]) {
    const clinic = { subscriptionStatus, trialEndsAt: finDeGracia(T0), nextBillingDate: new Date(T0.getTime() + 30 * DIA) };
    assert.equal(isInTrial(clinic, now), false, `${subscriptionStatus}: no es prueba`);
    assert.equal(isPlanExpired(clinic, now), false, "y entra durante la gracia");
    const estado = getPlanStatus(clinic, now);
    assert.equal(estado.kind, "past_due");
    assert.match(planStatusLabel(estado, now).label, /^Cobro fallido · acceso hasta /);
    assert.equal(isPlanExpired(clinic, new Date(T0.getTime() + 25 * HORA)), true, "pasadas las 24 h, suspendida");
  }
  // Una prueba de verdad (sin suscripción viva ni cobro rechazado) sigue siendo prueba.
  assert.equal(isInTrial({ subscriptionStatus: "pending_payment", trialEndsAt: new Date(now.getTime() + DIA) }, now), true);
});

test("los textos: es dice «Pago rechazado» en la pestaña, y en/es tienen las mismas claves nuevas", () => {
  const es = getDict("es") as any;
  const en = getDict("en") as any;
  assert.equal(es.shell.subscriptionTab.statusPaymentFailed, "Pago rechazado");
  assert.equal(es.pages.suspended.suspendedTitle, "Tu acceso está suspendido por falta de pago");
  assert.equal(es.pages.suspended.suspendedBody, "Tus datos están completos y a salvo: en cuanto pagues, todo vuelve como estaba.");
  assert.equal(es.pages.suspended.actions.payNow, "Pagar ahora");
  assert.equal(es.pages.suspended.actions.openTicket, "Abrir ticket de soporte");
  assert.equal(es.pages.suspended.actions.contactManager, "Contactar a mi manager");
  assert.equal(es.shell.pagoRechazado.mensajeOtros.includes("Avisa al dueño de la clínica"), true);
  const claves = (o: any, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? claves(v, `${p}${k}.`) : [`${p}${k}`]));
  for (const bloque of [["shell", "pagoRechazado"], ["pages", "suspended", "actions"]]) {
    const de = (d: any) => claves(bloque.reduce((x, k) => x[k], d)).sort();
    assert.deepEqual(de(en), de(es), bloque.join("."));
  }
  for (const k of ["statusPaymentFailed", "paymentFailedTitle", "paymentFailedNotice"]) {
    assert.ok(en.shell.subscriptionTab[k] && es.shell.subscriptionTab[k], k);
  }
  // Español neutro con «tú»: nada de voseo en lo nuevo.
  const nuevo = JSON.stringify([es.shell.pagoRechazado, es.pages.suspended.actions, es.pages.suspended.suspendedBody, es.shell.subscriptionTab.paymentFailedNotice]);
  assert.doesNotMatch(nuevo, /\b(vos|tenés|podés|querés|pagá|actualizá|avisá|elegí)\b/i);
});

test("Configuración › Suscripción: «Pago rechazado» sale antes que «En prueba» y el botón de pagar va destacado (los dos diseños)", () => {
  const tab = sinComentarios(leer("src/components/dashboard/subscription-tab.tsx"));
  assert.match(tab, /const pagoRechazado = isPaymentFailed\(clinic\.subscriptionStatus\) && !trialExpired/);
  assert.ok(tab.indexOf("statusPaymentFailed") < tab.indexOf("statusTrial"), "«Pago rechazado» se evalúa antes que «En prueba»");
  assert.match(tab, /<PagoPendiente puedePagar plan=\{clinic\.plan\}/);
  assert.match(tab, /\(!subscriptionActive \|\| manualPeriodExpired\) && !pagoRechazado/, "el «Activa tu plan» de siempre no se pinta encima");
  assert.match(tab, /mostrarActivar: \(!subscriptionActive \|\| manualPeriodExpired\) && !pagoRechazado/);
  const redis = sinComentarios(leer("src/components/dashboard/bloques-rediseno/suscripcion.tsx"));
  assert.match(redis, /m\.pagoRechazado && \(/);
  assert.match(redis, /\{m\.pagoRechazado\.panel\}/);
});

/* ── Aviso rojo por rol ────────────────────────────────────────────────── */

test("aviso rojo: solo con cobro rechazado y acceso vivo; el botón es solo del dueño y del administrador", () => {
  const ahora = new Date(T0.getTime() + HORA);
  const base = { subscriptionStatus: "past_due", trialEndsAt: finDeGracia(T0), ahora };
  for (const rol of ["SUPER_ADMIN", "ADMIN"]) {
    const a = avisoDePagoRechazado({ ...base, rol });
    assert.deepEqual([a.visible, a.visible && a.puedePagar], [true, true], rol);
  }
  for (const rol of ["DOCTOR", "RECEPTIONIST", "ASSISTANT", null]) {
    const a = avisoDePagoRechazado({ ...base, rol });
    assert.deepEqual([a.visible, a.visible && a.puedePagar], [true, false], String(rol));
  }
  assert.equal(avisoDePagoRechazado({ ...base, subscriptionStatus: "unpaid", rol: "ADMIN" }).visible, true);
  assert.equal(avisoDePagoRechazado({ ...base, subscriptionStatus: "active", rol: "ADMIN" }).visible, false);
  assert.equal(avisoDePagoRechazado({ ...base, subscriptionStatus: "pending_payment", rol: "ADMIN" }).visible, false);
  assert.equal(avisoDePagoRechazado({ ...base, ahora: new Date(T0.getTime() + 25 * HORA), rol: "ADMIN" }).visible, false, "pasada la hora ya está suspendida: no ve el panel");
  assert.equal(avisoDePagoRechazado({ ...base, trialEndsAt: null, rol: "ADMIN" }).visible, false);
});

function pintar(puedePagar: boolean, idioma: "es" | "en" = "es") {
  return renderToStaticMarkup(
    <I18nProvider locale={idioma} dict={getDict(idioma)}>
      <AvisoPagoRechazado accesoHasta="20 oct 2026, 12:00 p.m." puedePagar={puedePagar} plan="PRO" />
    </I18nProvider>,
  );
}

test("el aviso pintado: dueño ve fecha y botón; los demás ven «Avisa al dueño de la clínica» y ningún botón", () => {
  const dueno = pintar(true);
  assert.match(dueno, /role="alert"/);
  assert.match(dueno, /No pudimos cobrar tu plan\. Tu acceso se suspende el 20 oct 2026, 12:00 p.m.\./);
  assert.match(dueno, /<button[^>]*>.*Actualizar tarjeta \/ pagar/s);
  assert.doesNotMatch(dueno, /Avisa al dueño/);

  const otro = pintar(false);
  assert.match(otro, /20 oct 2026, 12:00 p.m./);
  assert.match(otro, /Avisa al dueño de la clínica/);
  assert.doesNotMatch(otro, /<button/, "sin botón");

  assert.match(pintar(true, "en"), /We couldn&#x27;t charge your plan\. Your access will be suspended on 20 oct 2026, 12:00 p.m.\./);
});

test("el layout monta el aviso en TODAS las pantallas del panel: una sola vez, fuera del ternario de los dos menús, y con móvil (la fila se parte)", () => {
  const layout = sinComentarios(leer("src/app/dashboard/layout.tsx"));
  const iAviso = layout.indexOf("<AvisoPagoRechazado");
  assert.ok(iAviso > 0 && layout.indexOf("<AvisoPagoRechazado", iAviso + 1) === -1, "una sola vez");
  assert.ok(iAviso > layout.indexOf("<AvisoSuplantacion"), "dentro de la columna principal");
  assert.ok(iAviso < layout.indexOf("<TopbarDosNiveles") && iAviso < layout.indexOf("<Topbar\n"), "arriba de la barra, de cualquiera de los dos menús");
  assert.match(layout, /avisoDePagoRechazado\(\{[\s\S]*?rol: user\.role/);
  const componente = leer("src/components/dashboard/aviso-pago-rechazado.tsx");
  assert.match(componente, /flex-wrap/, "en celular el botón baja a la línea de abajo");
});

/* ── Suspendida: tres caminos abiertos, lo demás cerrado ───────────────── */

test("el candado de suspendida deja abiertos pagar, ticket y manager, y cierra el resto del panel", () => {
  // Páginas
  for (const ok of ["/dashboard/suspended", "/dashboard/suspended/success", "/dashboard/soporte", "/dashboard/soporte/abc123"]) {
    assert.equal(isAllowedWhileSuspended(ok), true, ok);
  }
  for (const no of ["/dashboard", "/dashboard/patients", "/dashboard/settings", "/dashboard/agenda", "/dashboard/billing", "/dashboard/soporte-falso"]) {
    assert.equal(isAllowedWhileSuspended(no), false, no);
  }
  // APIs que usan los tres caminos
  for (const ok of [
    "/api/billing/checkout", "/api/billing/portal", "/api/billing/invoices", "/api/billing/spei-transferencia", // pagar
    "/api/billing/pago-pendiente", // los dos botones del cobro rechazado (ws1-t2): entra por el prefijo /api/billing
    "/api/support/tickets", "/api/support/tickets/t1", "/api/support/tickets/t1/messages", "/api/support/attachments", // ticket
    "/api/auth/logout", "/api/switch-clinic",
  ]) {
    assert.equal(isApiPathBlockedForExpiredPlan(ok), false, `${ok} debe pasar`);
  }
  for (const no of ["/api/patients", "/api/appointments", "/api/clinic/zona", "/api/invoices", "/api/billing-falso", "/api/supportive"]) {
    assert.equal(isApiPathBlockedForExpiredPlan(no), true, `${no} debe seguir bloqueada`);
  }
  // El middleware no filtra por plan: el candado vive en plan-status + layout + getAuthContext/getCurrentUser.
  assert.doesNotMatch(sinComentarios(leer("src/middleware.ts")), /isPlanExpired|subscriptionStatus|suspended/);
});

test("las pantallas de los tres caminos solo llaman a APIs exentas", () => {
  const archivos = [
    "src/app/dashboard/soporte/soporte-client.tsx",
    "src/app/dashboard/soporte/[id]/ticket-client.tsx",
    "src/app/dashboard/suspended/acciones-suspendida.tsx",
    "src/components/dashboard/pagar-ahora.tsx",
    "src/components/dashboard/pago-pendiente.tsx",
    "src/lib/billing/pago-pendiente-cliente.ts",
  ];
  for (const f of archivos) {
    const fuente = sinComentarios(leer(f));
    const rutas = Array.from(fuente.matchAll(/["'`](\/api\/[A-Za-z0-9_\-/${}.]+)/g)).map((m) => m[1].replace(/\$\{[^}]*\}/g, "x"));
    for (const r of rutas) assert.equal(isApiPathBlockedForExpiredPlan(r), false, `${f} llama a ${r}, que está bloqueada para una clínica suspendida`);
  }
});

test("la pantalla de suspendida: mensaje exacto, tres botones y manager asignado de LA clínica de la sesión", () => {
  const pagina = sinComentarios(leer("src/app/dashboard/suspended/page.tsx"));
  assert.match(pagina, /suspendidaPorFalta = isReactivation && isPlanExpired\(clinic\)/);
  assert.match(pagina, /t\("pages\.suspended\.suspendedTitle"\)/);
  assert.match(pagina, /t\("pages\.suspended\.suspendedBody"\)/);
  assert.match(pagina, /getAccountManagerForClinic\(user\.clinicId/, "el clinicId sale de la sesión");
  assert.equal((pagina.match(/\{acciones\}/g) ?? []).length, 2, "en el diseño nuevo y en el de siempre");
  const acciones = sinComentarios(leer("src/app/dashboard/suspended/acciones-suspendida.tsx"));
  assert.match(acciones, /href="\/dashboard\/soporte"/);
  assert.match(acciones, /wa\.me\//);
  const html = renderToStaticMarkup(
    <I18nProvider locale="es" dict={getDict("es")}>
      <Acciones />
    </I18nProvider>,
  );
  assert.match(html, /Pagar ahora/);
  assert.match(html, /Abrir ticket de soporte/);
  assert.match(html, /Contactar a mi manager/);
  assert.match(html, /href="https:\/\/wa\.me\/529990000000\?text=/);
});

/* ── Correo ────────────────────────────────────────────────────────────── */

test("el correo: dice la hora de suspensión, enlaza a Configuración › Suscripción, escapa el nombre y no usa voseo", () => {
  const c = buildPaymentFailedEmail({
    firstName: "Ana",
    clinicName: "Dental <b>Sur</b> & Co",
    planName: "Profesional",
    suspensionLabel: "20 oct 2026, 12:00 p.m.",
    payUrl: "https://www.dalecontrol.com/dashboard/settings?tab=subscription",
  });
  assert.equal(c.subject, "No pudimos cobrar tu plan · DaleControl");
  assert.match(c.html, /20 oct 2026, 12:00 p.m./);
  assert.match(c.html, /href="https:\/\/www\.dalecontrol\.com\/dashboard\/settings\?tab=subscription"/);
  assert.match(c.html, /datos quedan completos y a salvo/);
  assert.doesNotMatch(c.html, /<b>Sur<\/b>/, "el nombre de la clínica no inyecta HTML");
  assert.match(c.html, /Dental &lt;b&gt;Sur&lt;\/b&gt; &amp; Co/);
  assert.match(c.text, /Tu acceso se suspende el 20 oct 2026, 12:00 p.m.\./);
  assert.doesNotMatch(c.html + c.text, /\b(vos|tenés|podés|pagá|actualizá)\b/i);
});

test("la hora de suspensión usa el formato de Caja, con a.m./p.m., en la zona de la clínica (medianoche, mediodía y 23:30)", () => {
  const CDMX = "America/Mexico_City"; // UTC−6 en octubre de 2026
  assert.equal(fechaHoraDeLaClinica(new Date("2026-10-20T06:00:00.000Z"), CDMX), "20 oct 2026, 12:00 a.m.", "00:00 → medianoche, sin ambigüedad");
  assert.equal(fechaHoraDeLaClinica(new Date("2026-10-20T18:00:00.000Z"), CDMX), "20 oct 2026, 12:00 p.m.", "12:00 → mediodía");
  assert.equal(fechaHoraDeLaClinica(new Date("2026-10-21T05:30:00.000Z"), CDMX), "20 oct 2026, 11:30 p.m.", "23:30");
  // Es EXACTAMENTE el formato de Caja (fechaHoraPanel), no otro.
  const f = new Date("2026-10-07T05:49:00.000Z");
  assert.equal(fechaHoraDeLaClinica(f, CDMX), fechaHoraPanel(f, CDMX));
  assert.equal(fechaHoraDeLaClinica(f, CDMX), "6 oct 2026, 11:49 p.m.");
  // Otra zona: la hora de ESA zona; zona inválida o ausente → Ciudad de México.
  assert.equal(fechaHoraDeLaClinica(new Date("2026-10-20T18:00:00.000Z"), "America/Tijuana"), "20 oct 2026, 11:00 a.m.");
  assert.equal(fechaHoraDeLaClinica(new Date("2026-10-20T18:00:00.000Z"), "zona/inventada"), "20 oct 2026, 12:00 p.m.");
  assert.equal(fechaHoraDeLaClinica(new Date("2026-10-20T18:00:00.000Z"), null), "20 oct 2026, 12:00 p.m.");
  // Ningún sitio vuelve al formato largo sin a.m./p.m.
  assert.doesNotMatch(fechaHoraDeLaClinica(new Date("2026-10-20T06:00:00.000Z"), CDMX), /de octubre|^\d+ de /);
  assert.match(fechaHoraDeLaClinica(new Date("2026-10-20T06:00:00.000Z"), CDMX, "en"), /12:00 AM$/);
});

test("banner, Suscripción y correo dicen la hora con ese mismo formato (una sola función)", () => {
  for (const f of ["src/app/dashboard/layout.tsx", "src/components/dashboard/subscription-tab.tsx", "src/lib/billing/aviso-cobro-rechazado.server.ts"]) {
    assert.match(sinComentarios(leer(f)), /fechaHoraDeLaClinica\(/, f);
  }
  assert.doesNotMatch(sinComentarios(leer("src/lib/billing/cobro-rechazado.ts")), /hour12|dateStyle|month: "long"/);
  // /admin dice solo el día («Cobro fallido · acceso hasta 20 oct»): no muestra hora.
  assert.doesNotMatch(sinComentarios(leer("src/lib/plan-status-label.ts")), /hour|toLocaleTimeString/);
});

/* ── Sedes ─────────────────────────────────────────────────────────────── */

test("una sede incluida sigue al pagador: con la madre en past_due recibe el MISMO límite y se suspende con ella", () => {
  const limite = finDeGracia(T0);
  const sede = datosDeSedeDesdeMadre({ plan: "CLINIC", subscriptionStatus: "past_due", trialEndsAt: limite });
  assert.ok(sede);
  const madre = { subscriptionStatus: "past_due", trialEndsAt: limite };
  for (const ms of [T0.getTime() + HORA, T0.getTime() + 23 * HORA, T0.getTime() + 25 * HORA, T0.getTime() + 90 * DIA]) {
    const ahora = new Date(ms);
    assert.equal(isPlanExpired(sede, ahora), isPlanExpired(madre, ahora), `a +${(ms - T0.getTime()) / HORA} h`);
  }
  // Y al pagar, la sede vuelve activa con la madre.
  const pagada = datosDeSedeDesdeMadre({ plan: "CLINIC", subscriptionStatus: "active", trialEndsAt: new Date(T0.getTime() + 30 * DIA) });
  assert.equal(pagada?.subscriptionStatus, "active");
  assert.equal(isPlanExpired(pagada, new Date(T0.getTime() + 26 * HORA)), false);
  // Cada escritura de la madre en el webhook pasa por sincronizarSedesIncluidas.
  const webhook = sinComentarios(leer("src/app/api/webhooks/stripe/route.ts"));
  const caso = (nombre: string) => {
    const i = webhook.indexOf(`case "${nombre}"`);
    return webhook.slice(i, webhook.indexOf("\n      case ", i + 10));
  };
  for (const n of ["invoice.payment_failed", "customer.subscription.updated", "customer.subscription.deleted"]) {
    assert.match(caso(n), /sincronizarSedesIncluidas\(clinicId\)/, n);
  }
  assert.match(webhook, /async function activatePlatformSubscription[\s\S]*?sincronizarSedesIncluidas\(clinicId\)/);
});

/* ── Nunca borrar ──────────────────────────────────────────────────────── */

function archivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" || n === "node_modules" ? [] : archivosTs(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

test("NUNCA BORRAR: ni el webhook de Stripe ni los crons de cobro/vencimiento borran nada de una clínica", () => {
  const rutas = [
    "src/app/api/webhooks/stripe/route.ts",
    "src/app/api/cron/subscription-lapse/route.ts",
    "src/app/api/cron/cobro-automatico/route.ts",
    "src/app/api/cron/payment-reminders/route.ts",
    "src/lib/billing/manual-subscription-lapse.ts",
    "src/lib/billing/sedes-incluidas.ts",
    "src/lib/billing/cobro-rechazado.ts",
    "src/lib/billing/aviso-cobro-rechazado.server.ts",
  ];
  for (const r of rutas) {
    const f = sinComentarios(leer(r));
    assert.doesNotMatch(f, /\.(delete|deleteMany)\(/, `${r} borra filas`);
    assert.doesNotMatch(f, /\$executeRaw|\$queryRaw|DELETE FROM|TRUNCATE TABLE|DROP TABLE/, `${r} corre SQL crudo destructivo`);
  }
});

test("NUNCA BORRAR: ningún cron borra datos de clínicas por su estado de suscripción; la baja manual de /admin y de sedes solo ARCHIVA", () => {
  const crons = archivosTs(join(process.cwd(), "src/app/api/cron"));
  const conBorrado = crons.filter((f) => /\.(delete|deleteMany)\(/.test(sinComentarios(readFileSync(f, "utf8"))));
  // Único: la retención de analítica del sitio (eventos por antigüedad), sin relación con clínicas ni cobros.
  assert.deepEqual(conBorrado.map((f) => f.split("/src/")[1]), ["app/api/cron/analytics-retention/route.ts"]);
  assert.doesNotMatch(sinComentarios(leer("src/app/api/cron/analytics-retention/route.ts")), /subscriptionStatus|clinicId|clinic\./);
  // Los crons que miran el estado de suscripción no borran: el de vencimiento solo lo pasa a past_due.
  const miranSuscripcion = crons.filter((f) => /subscriptionStatus/.test(readFileSync(f, "utf8")));
  assert.deepEqual(miranSuscripcion.map((f) => f.split("/src/")[1]), ["app/api/cron/subscription-lapse/route.ts"]);
  // El DELETE de /admin/clinics/[id] y el cierre de sedes archivan (archivedAt), no borran.
  for (const r of ["src/app/api/admin/clinics/[id]/route.ts", "src/app/api/clinics/archivar/route.ts"]) {
    const f = sinComentarios(leer(r));
    assert.match(f, /archivedAt/, r);
    assert.doesNotMatch(f, /clinic\.(delete|deleteMany)\(/, r);
  }
  // Y ningún camino de src/ borra una clínica.
  const todo = archivosTs(join(process.cwd(), "src"));
  const borranClinica = todo.filter((f) => /\bclinic\.(delete|deleteMany)\(|\bclinics\.(delete|deleteMany)\(/.test(sinComentarios(readFileSync(f, "utf8"))));
  assert.deepEqual(borranClinica, []);
});

/* ── Los dos botones del cobro rechazado (agregado al punto 5) ─────────── */

const respuesta = (status: number, cuerpo: unknown) => async () =>
  ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo }) as unknown as Response;

const PENDIENTE = {
  estado: "pendiente",
  planActual: "PRO",
  montoPendiente: 689,
  moneda: "MXN",
  opcionesSubir: [{ plan: "CLINIC", nombre: "Clínica", monto: 1489, ivaIncluido: true }],
};

test("contrato GET: pendiente, sin pendiente, 404 (la ruta de ws1-t2 aún no está unida), error en español y respuesta rara", async () => {
  const ok = await leerPagoPendiente(respuesta(200, PENDIENTE));
  assert.deepEqual(ok, { tipo: "listo", datos: PENDIENTE });
  assert.deepEqual(await leerPagoPendiente(respuesta(200, { estado: "sin_pendiente" })), { tipo: "listo", datos: { estado: "sin_pendiente" } });
  assert.deepEqual(await leerPagoPendiente(respuesta(404, {})), { tipo: "no_disponible" }, "404 → «no disponible»");
  assert.deepEqual(await leerPagoPendiente(async () => { throw new Error("red"); }), { tipo: "no_disponible" });
  assert.deepEqual(await leerPagoPendiente(respuesta(403, { error: "Solo el dueño o un administrador puede ver esto." })), { tipo: "error", mensaje: "Solo el dueño o un administrador puede ver esto." });
  assert.deepEqual(await leerPagoPendiente(respuesta(200, { algo: "raro" })), { tipo: "error", mensaje: "" });
  // Una opción mal formada se descarta; la lista nunca revienta.
  const raro = await leerPagoPendiente(respuesta(200, { ...PENDIENTE, opcionesSubir: [null, { plan: "X" }, PENDIENTE.opcionesSubir[0]] }));
  assert.equal(raro.tipo === "listo" && raro.datos.estado === "pendiente" && raro.datos.opcionesSubir.length, 1);
});

test("contrato POST: pagar / subir, pagado, url de Stripe, errores tal cual y 404", async () => {
  const llamadas: Array<{ url: string; init: RequestInit }> = [];
  const f = (status: number, cuerpo: unknown) => async (url: string, init?: RequestInit) => {
    llamadas.push({ url, init: init ?? {} });
    return respuesta(status, cuerpo)();
  };
  assert.deepEqual(await cobrarPendiente({ accion: "pagar" }, f(200, { ok: true, pagado: true })), { tipo: "pagado" });
  assert.deepEqual(await cobrarPendiente({ accion: "subir", plan: "CLINIC" }, f(200, { ok: true, pagado: false, url: "https://checkout.stripe.com/c/pay/x" })), { tipo: "url", url: "https://checkout.stripe.com/c/pay/x" });
  assert.equal(llamadas[0].url, "/api/billing/pago-pendiente");
  assert.equal(llamadas[0].init.method, "POST");
  assert.equal(llamadas[0].init.body, JSON.stringify({ accion: "pagar" }));
  assert.equal(llamadas[1].init.body, JSON.stringify({ accion: "subir", plan: "CLINIC" }));
  for (const status of [400, 403, 409, 502, 503]) {
    assert.deepEqual(await cobrarPendiente({ accion: "pagar" }, f(status, { error: `Error ${status} en español` })), { tipo: "error", mensaje: `Error ${status} en español` }, String(status));
  }
  assert.deepEqual(await cobrarPendiente({ accion: "pagar" }, f(404, {})), { tipo: "no_disponible" });
  assert.deepEqual(await cobrarPendiente({ accion: "pagar" }, f(200, { ok: true, pagado: false })), { tipo: "error", mensaje: "" }, "sin url ni pagado: no se inventa nada");
});

test("monto exacto y cuándo aplican los dos botones", () => {
  assert.equal(formatoMonto(689, "MXN", "es"), "$689.00 MXN");
  assert.equal(formatoMonto(1489.5, "MXN", "es"), "$1,489.50 MXN");
  assert.equal(tarjetaRechazadaViva({ subscriptionStatus: "past_due", stripeSubscriptionId: "sub_1" }), true);
  assert.equal(tarjetaRechazadaViva({ subscriptionStatus: "unpaid", stripeSubscriptionId: "sub_1" }), true);
  assert.equal(tarjetaRechazadaViva({ subscriptionStatus: "past_due", stripeSubscriptionId: null }), false, "pagador a mano: sin suscripción de tarjeta");
  assert.equal(tarjetaRechazadaViva({ subscriptionStatus: "cancelled", stripeSubscriptionId: "sub_1" }), false, "cancelada: las tarjetas de siempre");
  assert.equal(tarjetaRechazadaViva({ subscriptionStatus: "pending_payment", stripeSubscriptionId: null }), false);
  assert.equal(tarjetaRechazadaViva({ subscriptionStatus: "active", stripeSubscriptionId: "sub_1" }), false);
});

const noop = () => {};
function vista(sobre: Record<string, unknown> = {}, idioma: "es" | "en" = "es") {
  return renderToStaticMarkup(
    <I18nProvider locale={idioma} dict={getDict(idioma)}>
      <PagoPendienteVista
        lectura={{ tipo: "listo", datos: PENDIENTE }}
        puedePagar
        eleccion={null}
        eligiendoPlan={false}
        cobrando={false}
        idioma={idioma}
        respaldo={<button data-accion="portal">Actualizar tarjeta / pagar</button>}
        onPagarPlan={noop} onVerPlanes={noop} onElegirPlan={noop} onConfirmar={noop} onCancelar={noop} onRecargar={noop}
        {...sobre}
      />
    </I18nProvider>,
  );
}

test("botones por rol: dueño/admin ven los dos; los demás no ven ninguno ni se les pide nada", () => {
  const admin = vista();
  assert.match(admin, /data-accion="pagar-plan"[^>]*>.*Pagar mi plan/s);
  assert.match(admin, /data-accion="subir-plan"[^>]*>.*Cambiar a un plan más grande y pagar/s);
  assert.match(admin, /\$689\.00 MXN/);
  const otro = vista({ puedePagar: false });
  assert.doesNotMatch(otro, /<button/);
  assert.match(otro, /Pídele al dueño o administrador de la clínica que pague el plan\./);
  // Sin un plan más grande al cual subir, solo «Pagar mi plan».
  const tope = vista({ lectura: { tipo: "listo", datos: { ...PENDIENTE, opcionesSubir: [] } } });
  assert.match(tope, /Pagar mi plan/);
  assert.doesNotMatch(tope, /plan más grande/);
  // La pantalla server solo monta el componente con el rol real de la sesión, y el componente no consulta si no puede pagar.
  const pagina = sinComentarios(leer("src/app/dashboard/suspended/page.tsx"));
  assert.match(pagina, /puedePagar=\{isClinicBillingAdmin\(user\.role\)\}/);
  assert.match(sinComentarios(leer("src/components/dashboard/pago-pendiente.tsx")), /if \(!puedePagar\) return;/);
});

test("antes de cobrar se dice el monto exacto: «Vas a pagar $X» (pagar y subir) y se pide confirmar", () => {
  const pagar = vista({ eleccion: { accion: "pagar" } });
  assert.match(pagar, /Vas a pagar \$689\.00 MXN/);
  assert.match(pagar, /data-accion="confirmar"[^>]*>.*Confirmar y pagar/s);
  assert.match(pagar, /data-accion="cancelar"/);
  const lista = vista({ eligiendoPlan: true });
  assert.match(lista, /Clínica/);
  assert.match(lista, /\$1,489\.00 MXN · IVA incluido/);
  assert.match(lista, /precio de lista \(sin la promoción del primer mes\)/);
  const subir = vista({ eligiendoPlan: true, eleccion: { accion: "subir", plan: "CLINIC" } });
  assert.match(subir, /Vas a pagar \$1,489\.00 MXN por el plan Clínica/);
  assert.match(vista({ eleccion: { accion: "pagar" }, cobrando: true }), /Procesando…/);
  assert.match(vista({ eleccion: { accion: "pagar" } }, "en"), /You will pay \$689\.00 MXN/);
});

test("404 / error / cargando / sin pendiente: aviso «no disponible» con el pago de siempre a la mano, nunca una pantalla muerta", () => {
  const nodisp = vista({ lectura: { tipo: "no_disponible" } });
  assert.match(nodisp, /El pago directo no está disponible por ahora/);
  assert.match(nodisp, /data-accion="portal"/, "queda «Actualizar tarjeta / pagar»");
  assert.doesNotMatch(nodisp, /Pagar mi plan/);
  const err = vista({ lectura: { tipo: "error", mensaje: "No hay un cobro pendiente para este plan." } });
  assert.match(err, /No hay un cobro pendiente para este plan\./, "el error del servidor, tal cual");
  assert.match(vista({ lectura: { tipo: "error", mensaje: "" } }), /No pudimos calcular lo pendiente/);
  assert.match(vista({ lectura: null }), /Calculando lo pendiente/);
  const sin = vista({ lectura: { tipo: "listo", datos: { estado: "sin_pendiente" } } });
  assert.match(sin, /No tenemos un pago pendiente/);
  assert.doesNotMatch(sin, /Pagar mi plan/);
});

test("pantallas: en suspendida con tarjeta viva las tarjetas de plan se esconden y entran los dos botones; en Suscripción van en el aviso rojo", () => {
  const pagina = sinComentarios(leer("src/app/dashboard/suspended/page.tsx"));
  assert.match(pagina, /conDosBotones = suspendidaPorFalta && tarjetaRechazadaViva\(clinic\)/);
  assert.equal((pagina.match(/\{!conDosBotones && \(|\{conDosBotones \? null : \(/g) ?? []).length, 2, "las tarjetas de plan, en los dos diseños");
  assert.match(pagina, /<PagoPendiente puedePagar=\{isClinicBillingAdmin\(user\.role\)\} plan=\{clinic\.plan\} suspendida \/>/);
  assert.match(pagina, /sinPagar=\{conDosBotones\}/);
  const tab = sinComentarios(leer("src/components/dashboard/subscription-tab.tsx"));
  assert.equal((tab.match(/<PagoPendiente puedePagar plan=\{clinic\.plan\} suspendida=\{false\} \/>/g) ?? []).length, 2, "diseño nuevo y de siempre");
  assert.match(sinComentarios(leer("src/components/dashboard/bloques-rediseno/suscripcion.tsx")), /\{m\.pagoRechazado\.panel\}/);
  // Y las tarjetas no se tocan: sin suscripción viva (nueva o cancelada) siguen mandando al checkout de siempre.
  assert.match(sinComentarios(leer("src/app/dashboard/suspended/suspended-client.tsx")), /"\/api\/billing\/checkout"/);
});

test("textos nuevos: es y en con las mismas claves, y el botón/aviso dicen lo pedido", () => {
  const es = getDict("es") as any;
  const en = getDict("en") as any;
  assert.deepEqual(Object.keys(en.shell.pagoPendiente).sort(), Object.keys(es.shell.pagoPendiente).sort());
  assert.equal(es.shell.pagoPendiente.pagarPlan, "Pagar mi plan");
  assert.equal(es.shell.pagoPendiente.subir, "Cambiar a un plan más grande y pagar");
  assert.equal(es.shell.pagoPendiente.vasAPagar, "Vas a pagar {monto}");
  assert.doesNotMatch(JSON.stringify(es.shell.pagoPendiente), /\b(vos|tenés|podés|pagá|elegí)\b/i);
});
