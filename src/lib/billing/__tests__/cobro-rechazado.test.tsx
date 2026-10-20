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
import { describe, it, test } from "node:test";
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
  eraClinicaPagadora,
  esDeLaSuscripcionDelPlan,
  inicioDeNuevoPeriodo,
  METODOS_DE_PAGO_MANUAL_DEL_PLAN,
  METODO_ACTIVACION_ADMIN,
  esPagoManualDelPlan,
  motivoParaNoSuspender,
  pagoManualCubreLaFactura,
  trialEndsAtSinRetroceder,
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
import { chargeFailureMessage } from "../proration";
import { fechaHoraPanel } from "../../formato-fecha-panel";
import { cobrarPendiente, formatoMonto, leerPagoPendiente, tarjetaRechazadaViva } from "../pago-pendiente-cliente";
import { buildPaymentFailedEmail, buildPlanSuspendedEmail } from "../../email";
import { I18nProvider } from "../../../i18n/i18n-provider";
import { makeT } from "../../../i18n/t";
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
  assert.match(dueno, /No pudimos cobrar tu plan\. Tu acceso se suspende el 20 oct 2026, 12:00 p\.m\.: actualiza tu tarjeta o paga para no perderlo\./);
  assert.match(dueno, /<button[^>]*>.*Actualizar tarjeta \/ pagar/s);
  assert.doesNotMatch(dueno, /Avisa al dueño/);

  const otro = pintar(false);
  assert.match(otro, /20 oct 2026, 12:00 p\.m\./);
  assert.match(otro, /Avisa al dueño de la clínica/);
  assert.doesNotMatch(otro, /<button/, "sin botón");

  assert.match(pintar(true, "en"), /We couldn&#x27;t charge your plan\. Your access will be suspended on 20 oct 2026, 12:00 p\.m\.: update your card or pay to keep it\./);
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
  assert.match(c.text, /Fecha y hora de suspensión: 20 oct 2026, 12:00 p\.m\.\n/);
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
  assert.match(pagina, /<PagoPendiente puedePagar=\{isClinicBillingAdmin\(user\.role\)\} plan=\{clinic\.plan\} suspendida tarjetas=\{tarjetasDeRespaldo\} \/>/);
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

/* ── La fecha nunca va pegada a un punto («12:00 p.m..») ───────────────── */

test("ningún texto ya armado con la hora de suspensión lleva «m..» ni doble punto (es y en, todos los sitios)", () => {
  const horas = [
    new Date("2026-10-20T06:00:00.000Z"), // 12:00 a.m.
    new Date("2026-10-20T18:00:00.000Z"), // 12:00 p.m.
    new Date("2026-10-21T05:30:00.000Z"), // 11:30 p.m.
  ];
  const sinPunto = (texto: string, donde: string) => {
    assert.doesNotMatch(texto, /m\.\./, `${donde}: «m..»`);
    assert.doesNotMatch(texto, /(?<!\.)\.\.(?!\.)/, `${donde}: doble punto`);
    assert.doesNotMatch(texto, /\b[AP]M\.(?!\w)/, `${donde}: «AM.»/«PM.» pegado`);
  };
  for (const idioma of ["es", "en"] as const) {
    const dict = getDict(idioma) as any;
    // Los textos NUNCA ponen un punto justo después de {fecha}.
    for (const clave of [dict.shell.pagoRechazado.mensaje, dict.shell.pagoRechazado.mensajeOtros, dict.shell.subscriptionTab.paymentFailedNotice]) {
      assert.doesNotMatch(clave, /\{fecha\}\s*[.]/, `${idioma}: «{fecha}.» en «${clave}»`);
    }
    for (const h of horas) {
      const fecha = fechaHoraDeLaClinica(h, "America/Mexico_City", idioma);
      // Banner (dueño/admin y demás roles), tal como se pinta.
      for (const puede of [true, false]) {
        const html = renderToStaticMarkup(
          <I18nProvider locale={idioma} dict={getDict(idioma)}>
            <AvisoPagoRechazado accesoHasta={fecha} puedePagar={puede} plan="PRO" />
          </I18nProvider>,
        );
        sinPunto(html.replace(/<[^>]+>/g, " "), `banner ${idioma} ${puede ? "admin" : "otros"} ${fecha}`);
      }
      // Configuración › Suscripción (los dos diseños usan la misma clave).
      sinPunto(makeT(dict)("shell.subscriptionTab.paymentFailedNotice", { fecha }), `suscripción ${idioma} ${fecha}`);
    }
  }
  // Correo: html y texto plano (solo en español: es el idioma del correo).
  for (const h of horas) {
    const c = buildPaymentFailedEmail({
      firstName: "Ana", clinicName: "BEVADENT", planName: "Profesional",
      suspensionLabel: fechaHoraDeLaClinica(h, "America/Mexico_City"),
      payUrl: "https://www.dalecontrol.com/dashboard/settings?tab=subscription",
    });
    sinPunto(c.text, "correo (texto)");
    sinPunto(c.html.replace(/<[^>]+>/g, " "), "correo (html)");
  }
  // /admin dice solo el día, sin hora ni punto pegado.
  const admin = planStatusLabel(getPlanStatus({ subscriptionStatus: "past_due", trialEndsAt: new Date("2026-10-21T00:00:00.000Z") }, new Date("2026-10-20T00:00:00.000Z")), new Date("2026-10-20T00:00:00.000Z"));
  sinPunto(admin.label, "/admin etiqueta");
  sinPunto(admin.detail, "/admin detalle");
  // La pantalla de suspendida no interpola la fecha.
  assert.doesNotMatch(sinComentarios(leer("src/app/dashboard/suspended/page.tsx")), /fechaHoraDeLaClinica|\{fecha\}/);
});

/* ── Arreglos de la revisión (ws1-t4) ──────────────────────────────────── */

test("#1 reglas puras: pago manual posterior o periodo pagado más allá de la factura cubren; la renovación normal no", () => {
  const fin = new Date("2026-11-19T00:00:00.000Z");
  const dentroDe = (d: number) => new Date(fin.getTime() + d * DIA);
  assert.equal(pagoManualCubreLaFactura({ hayPagoManualPosterior: true, finPeriodoFacturado: null, accesoActual: null, proximoCobro: null }), true);
  assert.equal(pagoManualCubreLaFactura({ hayPagoManualPosterior: false, finPeriodoFacturado: fin, accesoActual: dentroDe(30), proximoCobro: dentroDe(30) }), true, "activación del admin: +1 mes");
  assert.equal(pagoManualCubreLaFactura({ hayPagoManualPosterior: false, finPeriodoFacturado: fin, accesoActual: fin, proximoCobro: fin }), false, "renovación normal: acceso = fin facturado");
  assert.equal(pagoManualCubreLaFactura({ hayPagoManualPosterior: false, finPeriodoFacturado: fin, accesoActual: dentroDe(0.5), proximoCobro: null }), false, "dentro de la tolerancia de 1 día");
  assert.equal(pagoManualCubreLaFactura({ hayPagoManualPosterior: false, finPeriodoFacturado: null, accesoActual: dentroDe(90), proximoCobro: dentroDe(90) }), false, "sin periodo de la factura no se adivina");
});

test("#2/#3/N1 por qué NO se suspende: otra suscripción, factura pagada o anulada (o sin id) o pago manual; open e incobrable sí suspenden", () => {
  assert.equal(motivoParaNoSuspender({ esDelPlan: true, estadoVivoFactura: "open", cubiertaPorPagoManual: false }), null);
  assert.equal(motivoParaNoSuspender({ esDelPlan: false, estadoVivoFactura: "open", cubiertaPorPagoManual: false }), "otra_suscripcion");
  // N1: incobrable ≠ pagada → suspende igual que «open».
  assert.equal(motivoParaNoSuspender({ esDelPlan: true, estadoVivoFactura: "uncollectible", cubiertaPorPagoManual: false }), null);
  for (const e of ["paid", "void", "draft", null]) {
    assert.equal(motivoParaNoSuspender({ esDelPlan: true, estadoVivoFactura: e, cubiertaPorPagoManual: false }), "factura_no_abierta", String(e));
  }
  assert.equal(motivoParaNoSuspender({ esDelPlan: true, estadoVivoFactura: "open", cubiertaPorPagoManual: true }), "pago_manual");
  assert.equal(esDeLaSuscripcionDelPlan("sub_a", "sub_a"), true);
  assert.equal(esDeLaSuscripcionDelPlan("sub_b", "sub_a"), false);
  assert.equal(esDeLaSuscripcionDelPlan(null, "sub_a"), true, "si no se conoce una de las dos, no se discute");
  assert.equal(eraClinicaPagadora("active"), true);
  assert.equal(eraClinicaPagadora("past_due"), true);
  assert.equal(eraClinicaPagadora("pending_payment"), false);
  assert.equal(eraClinicaPagadora(null), false);
});

test("#2 el webhook lanza si Stripe no contesta por la factura, y solo suspende con «open» (forma del código)", () => {
  const w = sinComentarios(leer("src/app/api/webhooks/stripe/route.ts"));
  const fn = w.slice(w.indexOf("async function estadoVivoDeFactura"), w.indexOf("async function cargarClinicaParaRechazo"));
  assert.doesNotMatch(fn, /catch/, "no se traga el error de Stripe");
  assert.match(w, /motivoParaNoSuspender\(\{ esDelPlan, estadoVivoFactura, cubiertaPorPagoManual: cubierta \}\)/);
  assert.match(w, /esDeLaSuscripcionDelPlan\(\s*referenciaDeFactura\(invoice/);
  assert.doesNotMatch(w, /facturaPagadaEnStripe|facturaYaPagada/);
});

test("#9 correo de «suspendido por falta de pago»: datos a salvo, cómo volver a entrar, sin voseo ni punto doble", () => {
  const c = buildPlanSuspendedEmail({ firstName: "Ana", clinicName: "Dental <b>Sur</b>", planName: "Profesional", payUrl: "https://www.dalecontrol.com/dashboard/suspended" });
  assert.equal(c.subject, "Tu acceso está suspendido por falta de pago · DaleControl");
  assert.match(c.html, /Tu acceso está suspendido por falta de pago/);
  assert.match(c.html, /Tus datos están completos y a salvo/);
  assert.match(c.html, /href="https:\/\/www\.dalecontrol\.com\/dashboard\/suspended"/);
  assert.match(c.html, /Pagar y volver a entrar/);
  assert.doesNotMatch(c.html, /<b>Sur<\/b>/);
  assert.match(c.text, /En cuanto pagues, todo vuelve como estaba\./);
  assert.doesNotMatch(c.html + c.text, /\b(vos|tenés|podés|pagá)\b|\.\./i);
});

test("#12 una sede incluida: el aviso rojo no ofrece pagar y dice que la clínica principal debe hacerlo", () => {
  const html = renderToStaticMarkup(
    <I18nProvider locale="es" dict={getDict("es")}>
      <AvisoPagoRechazado accesoHasta="20 oct 2026, 12:00 p.m." puedePagar sedeIncluida plan="CLINIC" />
    </I18nProvider>,
  );
  assert.match(html, /La clínica principal debe pagar el plan\./);
  assert.match(html, /20 oct 2026, 12:00 p\.m\./);
  assert.doesNotMatch(html, /<button/, "ni siquiera al dueño de la sede");
  const en = renderToStaticMarkup(
    <I18nProvider locale="en" dict={getDict("en")}>
      <AvisoPagoRechazado accesoHasta="Oct 20, 2026, 12:00 PM" puedePagar sedeIncluida plan="CLINIC" />
    </I18nProvider>,
  );
  assert.doesNotMatch(en, /<button/);
  assert.doesNotMatch(html + en, /m\.\.|(?<!\.)\.\.(?!\.)/);
  const layout = sinComentarios(leer("src/app/dashboard/layout.tsx"));
  assert.match(layout, /leerGrupoDePago\(clinic\.id\)\.then\(\(g\) => g\.esSedeIncluida\)/);
  assert.match(layout, /sedeIncluida=\{sedeIncluidaConCobroRechazado\}/);
});

test("#5 el cliente lee `cambioEnCurso` del GET y la vista cambia «Pagar mi plan» por «Terminar el cambio a <plan> y pagar»", async () => {
  const lectura = await leerPagoPendiente(respuesta(200, { ...PENDIENTE, cambioEnCurso: { plan: "CLINIC" } }));
  assert.equal(lectura.tipo === "listo" && lectura.datos.estado === "pendiente" && lectura.datos.cambioEnCurso?.plan, "CLINIC");
  const sin = await leerPagoPendiente(respuesta(200, PENDIENTE));
  assert.equal(sin.tipo === "listo" && sin.datos.estado === "pendiente" && "cambioEnCurso" in sin.datos, false, "sin el campo, nada cambia");
  assert.equal(((await leerPagoPendiente(respuesta(200, { ...PENDIENTE, cambioEnCurso: { plan: 3 } }))) as any).datos.cambioEnCurso, undefined, "forma rara: se ignora");

  const conCambio = vista({ lectura });
  assert.doesNotMatch(conCambio, /Pagar mi plan/, "no hay factura abierta que pagar (el servidor respondería 409)");
  assert.doesNotMatch(conCambio, /plan más grande y pagar/);
  assert.match(conCambio, /data-accion="terminar-cambio"[^>]*>.*Terminar el cambio a Clínica y pagar/s);
  // Al pulsarlo se confirma con el monto de ESE plan, y el cobro es el POST «subir».
  const confirmando = vista({ lectura, eleccion: { accion: "subir", plan: "CLINIC" } });
  assert.match(confirmando, /Vas a pagar \$1,489\.00 MXN por el plan Clínica/);
  // Si el plan del cambio ya no está entre las opciones: aviso y respaldo, nunca un botón que no sirve.
  const sinOpcion = vista({ lectura: { tipo: "listo", datos: { ...PENDIENTE, opcionesSubir: [], cambioEnCurso: { plan: "CLINIC" } } } });
  assert.doesNotMatch(sinOpcion, /Pagar mi plan|terminar-cambio/);
  assert.match(sinOpcion, /No pudimos preparar el cambio de plan/);
  assert.match(sinOpcion, /data-accion="portal"/);
  const es = getDict("es") as any;
  assert.equal(es.shell.pagoPendiente.terminarCambio, "Terminar el cambio a {plan} y pagar");
});

test("#4 con «sin pendiente» o error SIEMPRE queda cómo pagar: el respaldo (portal) y, en suspendida, las tarjetas de plan", () => {
  const sin = vista({ lectura: { tipo: "listo", datos: { estado: "sin_pendiente" } } });
  assert.match(sin, /data-accion="portal"/, "respaldo con «sin pendiente»");
  assert.match(vista({ lectura: { tipo: "error", mensaje: "" } }), /data-accion="portal"/);
  assert.match(vista({ lectura: { tipo: "no_disponible" } }), /data-accion="portal"/);
  // Con el pendiente a la vista, los dos botones; el respaldo no estorba.
  assert.doesNotMatch(vista(), /data-accion="portal"/);
  // Las tarjetas de plan las muestra el componente cuando la lectura NO es «pendiente», y la página se las pasa.
  const c = sinComentarios(leer("src/components/dashboard/pago-pendiente.tsx"));
  assert.match(c, /sinDosBotones = lectura !== null && !\(lectura\.tipo === "listo" && lectura\.datos\.estado === "pendiente"\)/);
  assert.match(c, /\{puedePagar && sinDosBotones && tarjetas\}/);
  const p = sinComentarios(leer("src/app/dashboard/suspended/page.tsx"));
  assert.match(p, /suspendida tarjetas=\{tarjetasDeRespaldo\}/);
  assert.match(p, /const tarjetasDeRespaldo = conDosBotones \? \(\s*<SuspendedPlanCards/);
  // Y la pestaña Suscripción nunca esconde su sección «Cambiar plan» ni el respaldo.
  assert.doesNotMatch(sinComentarios(leer("src/components/dashboard/subscription-tab.tsx")), /<PagoPendiente[^>]*tarjetas=/);
});

test("N2 la lista de métodos de pago manual del plan es explícita y sale de los valores que de verdad se escriben", () => {
  assert.deepEqual([...METODOS_DE_PAGO_MANUAL_DEL_PLAN].sort(), ["admin", "cash", "deposit", "oxxo", "paypal", "transfer"]);
  assert.equal(METODO_ACTIVACION_ADMIN, "admin");
  assert.ok((METODOS_DE_PAGO_MANUAL_DEL_PLAN as readonly string[]).includes(METODO_ACTIVACION_ADMIN));
  for (const no of ["stripe", "cfdi_overage"]) assert.equal((METODOS_DE_PAGO_MANUAL_DEL_PLAN as readonly string[]).includes(no), false, no);
  // Los valores de la lista existen de verdad: SPEI directo escribe «transfer» y /admin ofrece oxxo, paypal, cash.
  assert.match(sinComentarios(leer("src/lib/billing/spei-directo.ts")), /method: "transfer"/);
  const adminPagos = leer("src/app/admin/payments/payments-client.tsx");
  for (const m of ["transfer", "oxxo", "paypal", "cash"]) assert.match(adminPagos, new RegExp(`value: "${m}"`), m);
  // La consulta del webhook usa la lista, no «distinto de stripe».
  const w = sinComentarios(leer("src/app/api/webhooks/stripe/route.ts"));
  assert.match(w, /method: \{ in: \[\.\.\.METODOS_DE_PAGO_MANUAL_DEL_PLAN\] \}/);
  assert.doesNotMatch(w, /method: \{ not: "stripe" \}/);
  // La activación del admin deja su rastro en la misma transacción y sin inventar ingreso.
  const admin = sinComentarios(leer("src/app/api/admin/billing/route.ts"));
  assert.match(admin, /prisma\.\$transaction\(\[\s*prisma\.clinic\.update[\s\S]*?prisma\.subscriptionInvoice\.create[\s\S]*?amount: 0,[\s\S]*?status: "paid",[\s\S]*?method: METODO_ACTIVACION_ADMIN,/);
});

test("N3 con un cambio a medias la pantalla dice «Te falta terminar el cambio a <plan>: $X», no el pendiente viejo", () => {
  const html = vista({ lectura: { tipo: "listo", datos: { ...PENDIENTE, cambioEnCurso: { plan: "CLINIC" } } } });
  assert.match(html, /Te falta terminar el cambio a Clínica: \$1,489\.00 MXN/);
  assert.doesNotMatch(html, /Pendiente de tu plan/);
  assert.doesNotMatch(html, /\$689\.00/, "ni el monto de la factura vieja ya anulada");
  // Sin cambio a medias, como siempre.
  assert.match(vista(), /Pendiente de tu plan: <strong>\$689\.00 MXN<\/strong>/);
  // Si el plan del cambio ya no está entre las opciones: no se enseña ningún monto suelto.
  const sinOpcion = vista({ lectura: { tipo: "listo", datos: { ...PENDIENTE, opcionesSubir: [], cambioEnCurso: { plan: "CLINIC" } } } });
  assert.doesNotMatch(sinOpcion, /\$689\.00|Pendiente de tu plan/);
  const en = vista({ lectura: { tipo: "listo", datos: { ...PENDIENTE, cambioEnCurso: { plan: "CLINIC" } } } }, "en");
  assert.match(en, /You still need to finish the change to Clínica: \$1,489\.00 MXN/);
});

/* ── La clínica no lee «Stripe» ────────────────────────────────────────── */

test("ningún texto que lee la clínica en el diccionario (suscripción, pago, aviso de cobro rechazado, suspendida, pago pendiente) nombra a «Stripe»", () => {
  const BLOQUES: string[][] = [
    ["shell", "subscriptionTab"],
    ["shell", "paymentMethodModal"],
    ["shell", "pagoRechazado"],
    ["shell", "pagoPendiente"],
    ["pages", "suspended"],
  ];
  const textos = (o: unknown, ruta: string[]): Array<[string, string]> =>
    typeof o === "string" ? [[ruta.join("."), o]] : o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => textos(v, [...ruta, k])) : [];
  let revisados = 0;
  for (const idioma of ["es", "en"] as const) {
    const dict = getDict(idioma) as any;
    for (const bloque of BLOQUES) {
      const nodo = bloque.reduce((x, k) => x?.[k], dict);
      assert.ok(nodo, `${idioma}: falta el bloque ${bloque.join(".")}`);
      for (const [clave, texto] of textos(nodo, [idioma, ...bloque])) {
        revisados++;
        assert.doesNotMatch(texto, /stripe/i, `${clave}: «${texto}»`);
      }
    }
  }
  assert.ok(revisados > 150, `el test debería revisar todos los textos de los bloques (revisó ${revisados})`);
  // Y los mensajes que armó este trabajo en código (correos y avisos).
  const correo = buildPaymentFailedEmail({ firstName: "Ana", clinicName: "X", planName: "P", suspensionLabel: "20 oct 2026, 12:00 p.m.", payUrl: "https://x/y" });
  const suspendido = buildPlanSuspendedEmail({ firstName: "Ana", clinicName: "X", planName: "P", payUrl: "https://x/y" });
  for (const t of [correo.subject, correo.html, correo.text, suspendido.subject, suspendido.html, suspendido.text]) assert.doesNotMatch(t, /stripe/i);
  // La etiqueta del portal ya no se llama «Portal Stripe», y el aviso de proration.ts que la menciona dice lo mismo.
  assert.equal((getDict("es") as any).shell.subscriptionTab.stripePortal, "Portal de facturación");
  assert.match(leer("src/lib/billing/proration.ts"), /desde "Portal de facturación"/);
});

test("chargeFailureMessage (tras el merge con ws1-t2): un solo texto por caso, sin «Stripe» ni «upgrade», con tú, y siempre «Tu plan NO cambió»", () => {
  const casos = [
    { type: "StripeCardError", code: "card_declined" },
    { code: "insufficient_funds" },
    { decline_code: "insufficient_funds" },
    { code: "expired_card" },
    { code: "incorrect_cvc" },
    { code: "authentication_required" },
    { code: "payment_intent_authentication_failure" },
    { code: "subscription_payment_intent_requires_action" },
    { code: "invoice_payment_intent_requires_action" },
    {},
  ];
  for (const e of casos) {
    const m = chargeFailureMessage(e);
    assert.match(m, /Tu plan NO cambió/, JSON.stringify(e));
    assert.doesNotMatch(m, /stripe|upgrade/i, `${JSON.stringify(e)}: «${m}»`);
    assert.doesNotMatch(m, /\b(vos|tenés|podés|intentá|actualizá)\b|\.\./i, m);
  }
  // El caso del banco que pide autenticación manda al botón que de verdad existe en Suscripción.
  assert.match(chargeFailureMessage({ code: "authentication_required" }), /desde "Portal de facturación"/);
  assert.equal(((getDict("es") as any).shell.subscriptionTab.stripePortal), "Portal de facturación");
  const fuente = sinComentarios(leer("src/lib/billing/proration.ts"));
  assert.doesNotMatch(fuente, /<<<<<<<|>>>>>>>/);
  assert.equal((fuente.match(/Tu banco pidió autenticación del cargo/g) ?? []).length, 1, "un solo texto");
});

/* ── Decisión #1(a) de Rafael: aviso del admin cuando no se pudo marcar la factura de tarjeta ── */

test("el aviso del admin dice exactamente el mensaje pedido, con «Reintentar», y solo salta cuando FALLÓ el marcado", () => {
  const { AvisoFacturaTarjeta, MENSAJE_AVISO_FACTURA_TARJETA, fallóElMarcadoDeLaFacturaTarjeta } = require("../../../app/admin/payments/aviso-factura-tarjeta");
  assert.equal(MENSAJE_AVISO_FACTURA_TARJETA, "No pudimos marcar la factura de tarjeta como pagada; Stripe podría reintentar el cobro. Reintenta o márcala a mano en Stripe.");
  const html = renderToStaticMarkup(<AvisoFacturaTarjeta aviso={{ clinicId: "c1", clinicName: "BEVADENT" }} onResuelto={() => {}} onCerrar={() => {}} />);
  assert.match(html, /role="alert"/);
  assert.match(html, /BEVADENT: /);
  assert.match(html, /No pudimos marcar la factura de tarjeta como pagada; Stripe podría reintentar el cobro\. Reintenta o márcala a mano en Stripe\./);
  assert.match(html, /<button[^>]*>.*Reintentar/s);
  assert.equal(renderToStaticMarkup(<AvisoFacturaTarjeta aviso={null} onResuelto={() => {}} onCerrar={() => {}} />), "");
  assert.equal(fallóElMarcadoDeLaFacturaTarjeta({ facturaTarjeta: { tipo: "fallo" } }), true);
  for (const ok of [{ facturaTarjeta: { tipo: "marcadas" } }, { facturaTarjeta: { tipo: "nada" } }, { facturaTarjeta: { tipo: "sin_tarjeta" } }, { facturaTarjeta: null }, null, undefined]) {
    assert.equal(fallóElMarcadoDeLaFacturaTarjeta(ok as any), false);
  }
});

test("las cuatro confirmaciones de pago manual y el SPEI de Stripe llaman al marcado; el aviso sale en /admin › Pagos y en SPEI pendientes", () => {
  for (const [archivo, marca] of [
    ["src/app/api/admin/billing/route.ts", "marcarFacturasDeLaClinica(invoice.clinicId, { estabaSuspendida })"],
    ["src/app/api/admin/billing/route.ts", "const facturaTarjeta = await marcarFacturasDeLaClinica(clinicId, { estabaSuspendida });"],
    ["src/app/api/admin/subscriptions/route.ts", "marcarFacturasDeLaClinica(clinicId, { estabaSuspendida })"],
    ["src/lib/billing/spei-directo.ts", "marcarFacturasDeLaClinica(sol.clinicId, { estabaSuspendida })"],
    ["src/app/api/webhooks/stripe/route.ts", "facturaTarjeta = await marcarFacturasDeLaClinica(clinicId, { estabaSuspendida: clinicaEstabaSuspendida(before) });"],
  ] as const) {
    assert.ok(sinComentarios(leer(archivo)).includes(marca), `${archivo}: ${marca}`);
  }
  assert.match(sinComentarios(leer("src/app/admin/payments/payments-client.tsx")), /<AvisoFacturaTarjeta aviso=\{avisoTarjeta\}/);
  assert.match(sinComentarios(leer("src/app/admin/payments/spei-pendientes.tsx")), /<AvisoFacturaTarjeta aviso=\{avisoTarjeta\}/);
  assert.match(sinComentarios(leer("src/app/api/admin/spei-transferencias/[id]/confirmar/route.ts")), /facturaTarjeta: r\.facturaTarjeta/);
  // El marcado nunca deshace nada: el helper no lanza y el comentario del contrato lo dice.
  const h = sinComentarios(leer("src/lib/billing/factura-fuera-de-stripe.server.ts"));
  assert.match(h, /paid_out_of_band: true/);
  assert.match(h, /idempotencyKey: claveFueraDeStripe/);
  assert.doesNotMatch(h, /subscriptions\.(cancel|del)/, "la suscripción de tarjeta NUNCA se cancela");
  // Lo único que se le cambia a la suscripción es pausar el COBRO (Q1): nunca trial_end ni cancel_at.
  assert.match(h, /subscriptions\.update\(\s*sub\.id,\s*\{ pause_collection: \{ behavior: "void", resumes_at: hasta \} \}/);
  assert.doesNotMatch(h, /trial_end|cancel_at|cancel_at_period_end/);
});

/* ── Quinta vuelta (t4): puro y pantallas ──────────────────────────────── */

test("Q2/Q3 reglas puras: el acceso del `updated` nunca baja; solo un pago manual DEL PLAN marca la factura", () => {
  const a = new Date("2026-11-19T00:00:00.000Z");
  const b = new Date("2027-01-19T00:00:00.000Z");
  assert.equal(trialEndsAtSinRetroceder(a, b)?.getTime(), b.getTime(), "acceso manual mayor: se queda");
  assert.equal(trialEndsAtSinRetroceder(b, a)?.getTime(), b.getTime(), "periodo de Stripe mayor: manda");
  assert.equal(trialEndsAtSinRetroceder(a, null)?.getTime(), a.getTime());
  assert.equal(trialEndsAtSinRetroceder(undefined, b), undefined, "sin periodo no se toca nada");
  for (const m of [null, undefined, "transfer", "deposit", "oxxo", "paypal", "cash", "admin"]) assert.equal(esPagoManualDelPlan(m), true, String(m));
  for (const m of ["stripe", "cfdi_overage", "mercadopago", "otra"]) assert.equal(esPagoManualDelPlan(m), false, m);
  const w = sinComentarios(leer("src/app/api/webhooks/stripe/route.ts"));
  assert.match(w, /trialEndsAtSinRetroceder\(periodFields\.trialEndsAt, antes\?\.trialEndsAt\)/);
  const f = w.slice(w.indexOf("async function esFacturaFueraDeStripe"), w.indexOf("async function estadoVivoDeFactura"));
  assert.doesNotMatch(f, /catch/, "Q5: si Stripe no contesta, lanza (5xx → reintento)");
  assert.match(w, /where: \{ clinicId: clinic\.id, reference: invoiceId, status: \{ in: \["failed", "pending"\] \} \}/);
  const adm = sinComentarios(leer("src/app/api/admin/billing/route.ts"));
  assert.match(adm, /if \(invoice\.method === CFDI_OVERAGE_METHOD\) \{/);
  assert.match(adm, /esPagoManualDelPlan\(invoice\.method\) \? await marcarFacturasDeLaClinica/);
});

test("Q6 el aviso persistente de /admin › Pagos: título pedido, una fila por clínica con «Reintentar», nada si no hay", () => {
  const { FacturasTarjetaPendientes, TITULO_FACTURAS_TARJETA_PENDIENTES } = require("../../../app/admin/payments/facturas-tarjeta-pendientes");
  assert.equal(TITULO_FACTURAS_TARJETA_PENDIENTES, "Clínicas con la tarjeta viva y una factura del plan abierta después de un pago manual");
  const html = renderToStaticMarkup(<FacturasTarjetaPendientes items={[{ clinicId: "c1", clinicName: "BEVADENT", pagoManualEn: "2026-10-18T12:00:00.000Z", facturas: ["in_1"] }]} />);
  assert.match(html, /role="alert"/);
  assert.match(html, /Clínicas con la tarjeta viva y una factura del plan abierta después de un pago manual \(1\)/);
  assert.match(html, /BEVADENT/);
  assert.match(html, /in_1/);
  assert.match(html, /<button[^>]*>.*Reintentar/s);
  assert.equal(renderToStaticMarkup(<FacturasTarjetaPendientes items={[]} />), "");
  const p = sinComentarios(leer("src/app/admin/payments/page.tsx"));
  assert.match(p, /<FacturasTarjetaPendientes items=\{JSON\.parse\(JSON\.stringify\(facturasTarjetaPendientes\)\)\} \/>/);
  assert.match(p, /safe\(clinicasConFacturaPendienteTrasPagoManual\(\), \[\]\)/);
  // El cron diario de vencimiento lo reintenta solo.
  assert.match(sinComentarios(leer("src/app/api/cron/subscription-lapse/route.ts")), /const facturasTarjeta = await reintentarMarcadoPendiente\(\);/);
});

/* ── Q1 / Q4 (decisión de Rafael, opción A) ── */

import { clinicaEstabaSuspendida, esMesDeServicioSuspendido, finDeLoPagado, reanudarCobroTrasRealinear, pagadoHastaPorPrepago, reanudarCobroDespuesDelPrepago } from "../cobro-rechazado";

describe("octava vuelta: reglas puras de la suspensión", () => {
  const ahora = new Date("2026-11-20T12:00:00Z");
  it("clinicaEstabaSuspendida = isPlanExpired: past_due con la gracia vencida sí; dentro de la gracia no", () => {
    assert.equal(clinicaEstabaSuspendida({ subscriptionStatus: "past_due", trialEndsAt: new Date("2026-11-19T12:00:00Z") }, ahora), true);
    assert.equal(clinicaEstabaSuspendida({ subscriptionStatus: "past_due", trialEndsAt: new Date("2026-11-21T01:00:00Z") }, ahora), false, "dentro de las 24 h de gracia");
    assert.equal(clinicaEstabaSuspendida({ subscriptionStatus: "active", trialEndsAt: new Date("2026-12-20T00:00:00Z") }, ahora), false);
    assert.equal(clinicaEstabaSuspendida(null, ahora), false);
  });
  it("esMesDeServicioSuspendido: una factura creada hace más que la gracia (+1 h) antes del pago", () => {
    const pagoEn = ahora;
    assert.equal(esMesDeServicioSuspendido({ facturaCreadaEn: new Date(pagoEn.getTime() - 120 * 86_400_000), pagoEn }), true);
    assert.equal(esMesDeServicioSuspendido({ facturaCreadaEn: new Date(pagoEn.getTime() - 26 * 3_600_000), pagoEn }), true);
    assert.equal(esMesDeServicioSuspendido({ facturaCreadaEn: new Date(pagoEn.getTime() - 5 * 3_600_000), pagoEn }), false, "dentro de la gracia");
    assert.equal(esMesDeServicioSuspendido({ facturaCreadaEn: Math.floor((pagoEn.getTime() - 30 * 86_400_000) / 1000), pagoEn }), true, "segundos de Stripe");
  });
  it("finDeLoPagado: N meses desde el día y hora del pago; reanudarCobroTrasRealinear: unos días antes", () => {
    const p = new Date("2026-11-20T15:30:00Z");
    assert.equal(finDeLoPagado(p, 1).toISOString(), new Date(new Date(p).setMonth(p.getMonth() + 1)).toISOString());
    assert.equal(finDeLoPagado(p, 3).getMonth(), (p.getMonth() + 3) % 12);
    assert.equal(finDeLoPagado(p, 0).getTime(), finDeLoPagado(p, 1).getTime(), "mínimo 1");
    const fin = finDeLoPagado(p, 1);
    assert.ok(reanudarCobroTrasRealinear(fin).getTime() < fin.getTime() && reanudarCobroTrasRealinear(fin).getTime() > p.getTime());
  });
});

describe("Q1 reanudarCobroDespuesDelPrepago", () => {
  const d = (s: string) => new Date(`${s}T12:00:00Z`);
  it("1 mes pagado tarde (el ciclo ya cubre el pago): no pausa nada", () => {
    assert.equal(reanudarCobroDespuesDelPrepago({ finDelPeriodoStripe: d("2026-11-20"), finPrepago: d("2026-11-20"), intervalo: "month" }), null);
    assert.equal(reanudarCobroDespuesDelPrepago({ finDelPeriodoStripe: d("2026-11-20"), finPrepago: d("2026-11-25"), intervalo: "month" }), null);
  });
  it("3 meses desde hoy: salta 2 renovaciones y reanuda el día antes de la tercera", () => {
    const r = reanudarCobroDespuesDelPrepago({ finDelPeriodoStripe: d("2026-11-20"), finPrepago: d("2027-01-20"), intervalo: "month" })!;
    assert.equal(r.toISOString().slice(0, 10), "2027-01-19");
  });
  it("12 meses: pausa casi un año; suscripción anual de Stripe: no pausa", () => {
    const r = reanudarCobroDespuesDelPrepago({ finDelPeriodoStripe: d("2026-11-20"), finPrepago: d("2027-10-20"), intervalo: "month" })!;
    assert.equal(r.toISOString().slice(0, 10), "2027-10-19");
    assert.equal(reanudarCobroDespuesDelPrepago({ finDelPeriodoStripe: d("2026-11-20"), finPrepago: d("2029-10-20"), intervalo: "year" }), null);
  });
  it("fin de mes: no se salta de mes al sumar", () => {
    const r = reanudarCobroDespuesDelPrepago({ finDelPeriodoStripe: d("2026-12-31"), finPrepago: d("2027-03-31"), intervalo: "month" })!;
    assert.ok(r.getTime() > d("2027-02-20").getTime() && r.getTime() < d("2027-03-31").getTime());
  });
});

describe("Q1 pagadoHastaPorPrepago", () => {
  const ahora = Date.now();
  const dias = (n: number) => new Date(ahora + n * 86_400_000);
  it("solo enseña «Pagado hasta» si el acceso rebasa mucho el próximo cobro y la suscripción está activa", () => {
    assert.ok(pagadoHastaPorPrepago({ subscriptionStatus: "active", accesoHasta: dias(90), proximoCobro: dias(30) }));
    assert.equal(pagadoHastaPorPrepago({ subscriptionStatus: "active", accesoHasta: dias(35), proximoCobro: dias(30) }), null);
    assert.equal(pagadoHastaPorPrepago({ subscriptionStatus: "past_due", accesoHasta: dias(90), proximoCobro: dias(30) }), null);
    assert.equal(pagadoHastaPorPrepago({ subscriptionStatus: "active", accesoHasta: dias(90), proximoCobro: null }), null);
    assert.equal(pagadoHastaPorPrepago({ subscriptionStatus: null, accesoHasta: dias(90), proximoCobro: dias(30) }), null);
  });
});

test("Q1 el aviso de SPEI pendiente es verdad en los dos casos: 1 mes (la tarjeta se cobra el mes siguiente) y un año (el cobro se pausa)", () => {
  const { textoTarjetaViva } = require("../../../app/admin/payments/spei-pendientes");
  const mensual = textoTarjetaViva(false);
  assert.match(mensual, /la tarjeta se cobra en su fecha de siempre/);
  assert.doesNotMatch(mensual, /mes siguiente/);
  assert.doesNotMatch(mensual, /PAUSA/);
  const anual = textoTarjetaViva(true);
  assert.match(anual, /PAUSA hasta que termine lo prepagado/);
  assert.doesNotMatch(anual, /mes siguiente se cobra/);
  assert.match(anual, /puede diferir unos días/);
  // Octava vuelta: ya no existe «adeudo» de meses suspendidos; se dice que sus facturas se anulan.
  for (const t of [mensual, anual]) {
    assert.match(t, /NO se cancela/);
    assert.match(t, /suspendida por falta de pago, los meses sin servicio no se cobran: sus facturas se anulan/);
    assert.doesNotMatch(t, /adeudo/i);
  }
  // La clínica ve «Pagado hasta {fecha}» en los dos idiomas.
  for (const l of ["es", "en"]) {
    const d = JSON.parse(readFileSync(join(process.cwd(), `src/i18n/dictionaries/${l}.json`), "utf8"));
    assert.match(d.shell.subscriptionTab.paidUntil, /\{fecha\}/);
  }
});
