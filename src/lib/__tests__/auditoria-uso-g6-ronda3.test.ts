/**
 * Segunda auditoría de uso, grupo G6 (ws1-t8, tercera ronda, 4-oct-2026).
 * Una prueba por punto del CONSOLIDADO-2 (C-xx a medias y N-56…N-66).
 *
 * Run: npm run test:auditoria-uso-g6-ronda3
 *
 * Lógica → función pura; cableado de pantalla → lectura del fuente (aquí no
 * se renderizan componentes de cliente). Fallan con el código de antes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mensajeDeRebote, direccionDeRebotePorRol } from "../auth/aviso-denegado";
import { ALL_PERMISSIONS } from "../auth/permissions";
import { actionMeta, resumenDeAlta, resumenDeCambio, fechaLegible } from "../admin/audit-core";
import { desgloseConsumo, modeloLegible } from "../ai-billing/consumo-legible";
import { fechaPanel, fechaHoraPanel } from "../formato-fecha-panel";
import { desfaseDeZona, etiquetaDeZona, ZONAS_HORARIAS } from "../clinic/zonas-horarias";
import { causaSinEnvio } from "../reviews/causa-sin-envio";
import { TOPE_POR_PERSONA_POR_MINUTO } from "../dashboard/actividad-tope";

const SRC = join(__dirname, "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const ES = JSON.parse(leer("i18n/dictionaries/es.json"));
const valor = (dic: any, ruta: string) => ruta.split(".").reduce((o, k) => (o ? o[k] : undefined), dic);
const TEXTO_ES = leer("i18n/dictionaries/es.json");

// ── C-114 (texto sin interruptor) ───────────────────────────────────────────
test("C-114: sin el SQL de la reserva, «privada» no promete un interruptor que no existe", () => {
  const ajustes = leer("app/dashboard/settings/settings-client.tsx");
  assert.match(ajustes, /const descPrivada = !reservaDisponible \? txReserva\.privadaSinInterruptor/);
  assert.match(ajustes, /privadaSinInterruptor: "No apareces en el directorio \/clinicas\. Tu reserva web sigue abierta para quien tenga el enlace\."/);
});

// ── C-118 · Página web a 390 ────────────────────────────────────────────────
test("C-118: la Página web apilada se estira al ancho y la vista previa deja sus 420 px", () => {
  const css = leer("components/dashboard/pagina-web-rediseno/pagina-web.module.css");
  assert.match(css, /\.shell \{\s*flex-direction: column;\s*align-items: stretch;/);
  assert.match(css, /\.shell \.previa \{\s*width: 100%;/);
  const insignia = css.slice(css.indexOf(".insignia {"), css.indexOf("}", css.indexOf(".insignia {")));
  assert.doesNotMatch(insignia, /white-space: nowrap/);
});

// ── C-122 · «IA asistente» ──────────────────────────────────────────────────
test("C-122: el asistente no enseña el modelo ni «IA Claude», y habla con el nombre de quien escribe", () => {
  const asistente = leer("app/dashboard/ai-assistant/ai-assistant-client.tsx");
  assert.doesNotMatch(asistente, /AI_CHAT_MODEL/);
  assert.match(asistente, /usuario\?\.nombre \|\| t\("pages\.aiAssistant\.doctor"\)/);
  assert.match(asistente, /label: "\/soap", labelKey: null, texto: "Nota de evolución"/);
  assert.equal(valor(ES, "pages.aiAssistant.activeSession"), "Sesión activa");
  assert.doesNotMatch(valor(ES, "pages.aiAssistant.quickAskXray"), /xray/);
  assert.match(leer("lib/command-palette/actions.ts"), /label: "IA asistente"/);
});

// ── N-56 · tres «IA» y dos medidores ────────────────────────────────────────
test("N-56: Configuración › Asistente IA explica que Sabina y el bot se pagan con el Saldo IA y quita el costo en USD", () => {
  const ajustes = leer("app/dashboard/settings/settings-client.tsx");
  assert.doesNotMatch(ajustes, /USD`/);
  assert.match(ajustes, /<Enlace href="\/dashboard\/whatsapp\/bot\/saldo">\{txIa\.saldoEnlace\}<\/Enlace>/);
  assert.match(valor(ES, "settings.client.aiSubtitle"), /Saldo IA/);
  assert.match(valor(ES, "pages.aiAssistant.quotaTitle"), /Cupo de IA del plan/);
});

// ── N-57 · costo de Saldo IA ────────────────────────────────────────────────
test("N-57: cada consumo dice el modelo y cuánto leyó y escribió (incluido lo releído)", () => {
  assert.equal(modeloLegible("claude-haiku-4-5-20251001"), "modelo rápido");
  assert.equal(modeloLegible("claude-sonnet-4-6"), "modelo estándar");
  assert.equal(modeloLegible("claude-opus-5"), "modelo avanzado");
  // Ronda final: además separa lo guardado en memoria (sin reparto, todo cuenta como leído).
  assert.deepEqual(desgloseConsumo({ model: "x", inputTokens: 300, outputTokens: 57, cacheTokens: 4000 }), { leidos: 4300, guardados: 0, escritos: 57, total: 4357 });
  assert.deepEqual(desgloseConsumo({ model: "x", inputTokens: 300, outputTokens: 57 }), { leidos: 300, guardados: 0, escritos: 57, total: 357 });
  assert.match(leer("app/api/ai-wallet/route.ts"), /cacheTokens: e\.cacheTokens,/);
  for (const f of ["components/dashboard/whatsapp-rediseno/saldo.tsx", "app/dashboard/whatsapp/bot/saldo/saldo-client.tsx"]) {
    const s = leer(f);
    assert.match(s, /modeloLegible\(u\.model\)/, f);
    assert.match(s, /desgloseConsumo\(u\)\.escritos/, f);
  }
});

// ── C-109 · rebotes por rol y un solo «sin acceso» ──────────────────────────
test("C-109: Bitácora, Firma, Sucursales y Mi Clínica Visual rebotan diciendo por qué", () => {
  assert.match(mensajeDeRebote("rol:admin")!, /solo para el dueño\/a y los administradores/);
  assert.match(mensajeDeRebote("rol:dueno")!, /solo para el dueño\/a de la cuenta/);
  assert.equal(direccionDeRebotePorRol("admin"), "/dashboard?denied=rol%3Aadmin");
  const casos: Array<[string, string]> = [
    ["app/dashboard/auditoria/page.tsx", "admin"], ["app/dashboard/settings/signature/page.tsx", "clinico"],
    ["app/dashboard/settings/sucursales/page.tsx", "dueno"], ["app/dashboard/clinic-layout/page.tsx", "admin"],
    ["app/dashboard/clinic-layout/3d/page.tsx", "admin"],
  ];
  for (const [f, quien] of casos) assert.match(leer(f), new RegExp(`redirect\\(direccionDeRebotePorRol\\("${quien}"\\)\\)`), f);
});

test("C-109: el nombre del permiso ya no asusta y Analítica/Reseñas usan el «sin acceso» común", () => {
  assert.equal(ALL_PERMISSIONS["medicalRecord.edit"], "Editar el expediente clínico (notas, firmas, radiografías y modelos)");
  assert.equal(ALL_PERMISSIONS["analytics.view"], "Ver Analítica y Finanzas");
  for (const d of ["occupancy", "journey", "doctors", "procedures", "costs", "no-shows", "waiting-room"]) {
    assert.match(leer(`app/dashboard/analytics/${d}/page.tsx`), /return <SinAcceso /, d);
  }
  assert.match(leer("app/dashboard/analytics/page.tsx"), /return <SinAcceso /);
  assert.match(leer("app/dashboard/resenas/ResenasClient.tsx"), /if \(sinAcceso\) \{\s*return <SinAcceso /);
});

// ── C-113 ───────────────────────────────────────────────────────────────────
test("C-113: «Mi perfil» dice dónde está de verdad el menú y Equipo usa los mismos nombres", () => {
  const ajustes = leer("app/dashboard/settings/settings-client.tsx");
  assert.doesNotMatch(ajustes, /menú de tu foto, arriba a la derecha/);
  // ws1-t9 (#3): ya no hay texto que mande a «Mi perfil» desde la pestaña que se llama así; la cédula se edita ahí mismo.
  assert.doesNotMatch(ajustes, /abajo a la izquierda del menú lateral/);
  assert.match(ajustes, /cedulaProfesional/);
  assert.equal(valor(ES, "settings.team.specialtyLabel"), "Área en la clínica (agenda y equipo)");
  assert.equal(valor(ES, "settings.team.especialidadOficialLabel"), "Especialidad como dice su cédula (NOM-024)");
});

// ── C-115 ───────────────────────────────────────────────────────────────────
test("C-115: altas con frase y sin «Borrado lógico»", () => {
  assert.equal(actionMeta("soft_delete").label, "Borrado (se guarda copia)");
  assert.equal(resumenDeAlta({ entityType: "user", changes: { _created: { before: null, after: { firstName: "Sexta", lastName: "Auditora Cifras", role: "DOCTOR" } } } }), "Alta de Usuario: Sexta Auditora Cifras");
  assert.equal(resumenDeAlta({ entityType: "cash-register", changes: { _created: { before: null, after: { openingBalance: 1900 } } } }), "Apertura de Caja con $1,900");
  assert.equal(resumenDeAlta({ entityType: "patient", changes: { _created: { before: null, after: { firstName: "Zzaudit", lastName: "Telefono Prueba", patientNumber: "P0215" } } } }), "Alta de Paciente: P0215 Zzaudit Telefono Prueba");
  assert.equal(resumenDeCambio({ entityType: "patient", changes: { _created: { before: null, after: { riskFlags: ["X"] } } } }), null);
  assert.match(leer("components/dashboard/pequenas-rediseno/auditoria.tsx"), /\{!resumenDeCambio\(r\) && <span className=\{s\.identificador\}>/);
  assert.equal(fechaLegible("2026-10-03T17:12:00.000Z").replace(/\s+/g, " "), "3 oct 2026, 11:12 a.m.");
});

// ── C-124 ───────────────────────────────────────────────────────────────────
test("C-124: Esc cierra también «Horario de…» y «Sabina en nombre de…»", () => {
  const equipo = leer("app/dashboard/team/team-client.tsx");
  assert.match(equipo, /if \(horarioMember\) setHorarioMember\(null\);\s*else if \(sabinaMember\) setSabinaMember\(null\);/);
});

// ── C-126 ───────────────────────────────────────────────────────────────────
test("C-126: tamaño táctil mínimo en el botón común y en las pantallas que lo pisaban", () => {
  const glob = leer("app/globals.css");
  assert.match(glob, /@media \(pointer: coarse\) \{\s*main :where\(button, \[role="button"\], \[role="tab"\], select, summary/);
  assert.match(glob, /main :where\(input\[type="checkbox"\], input\[type="radio"\]\) \{\s*width: 22px;/);
  assert.match(leer("app/dashboard/patients/patients.module.css"), /@media \(pointer: coarse\) \{\s*\.actionBtn \{\s*width: 36px !important;/);
  assert.match(leer("components/dashboard/configuracion-rediseno/configuracion.module.css"), /\.horaRango \{\s*display: inline-flex;[\s\S]*flex-wrap: nowrap;/);
  assert.match(leer("app/dashboard/settings/settings-client.tsx"), /<span className=\{cr\.horaRango\}>/);
});

// ── C-127 ───────────────────────────────────────────────────────────────────
test("C-127: Página web, WhatsApp/Saldo IA, Soporte y Mi perfil en el contenedor de 1400 px con relleno", () => {
  for (const f of ["components/dashboard/pagina-web-rediseno/pagina-web.module.css", "components/dashboard/whatsapp-rediseno/whatsapp-rediseno.module.css", "components/dashboard/soporte-rediseno/soporte.module.css", "components/dashboard/piezas-rediseno/piezas.module.css"]) {
    const css = leer(f); const raiz = css.slice(css.indexOf(".raiz {"), css.indexOf("}", css.indexOf(".raiz {")));
    assert.match(raiz, /max-width: 1400px;/, f);
    assert.match(raiz, /clamp\(14px, 1\.6vw, 28px\)/, f);
  }
});

// ── N-58 ────────────────────────────────────────────────────────────────────
test("N-58: «Octubre de 2026», no «Octubre De 2026»", () => {
  assert.doesNotMatch(leer("components/dashboard/cfdi-usage-card.tsx"), /textTransform: "capitalize"/);
  const css = leer("components/dashboard/bloques-rediseno/bloques.module.css");
  const mes = css.slice(css.indexOf(".cfdiMes {"), css.indexOf("}", css.indexOf(".cfdiMes {")));
  assert.doesNotMatch(mes, /capitalize/);
  assert.match(leer("components/dashboard/cfdi-usage-card.tsx"), /texto\.charAt\(0\)\.toUpperCase\(\) \+ texto\.slice\(1\)/);
});

// ── N-59 ────────────────────────────────────────────────────────────────────
test("N-59: sin jerga en los textos que lee la clínica", () => {
  for (const mal of ["Resources tipo CHAIR", "Costos & Margen", "WhatsApp Cloud API", "variables de entorno de Vercel", "AES-256-GCM", "Slogan / Tagline", "embed URL", "configúrala en Vercel", "audio-to-SOAP"]) {
    assert.ok(!TEXTO_ES.includes(mal), mal);
  }
  assert.equal(valor(ES, "settings.arco.colStatus"), "Estado");
  assert.doesNotMatch(leer("app/dashboard/settings/integrations/integrations-client.tsx"), />ANTHROPIC_API_KEY<|>OPENAI_API_KEY</);
  assert.match(leer("app/dashboard/landing/manifest-editor.tsx"), /`Sale si tienes: \$\{meta\.consume\.map\(\(d\) => DATO_LEGIBLE\[d\] \?\? d\)/);
  assert.doesNotMatch(leer("lib/plan-shared.ts"), /Analytics \+ reportes/);
});

// ── N-61 ────────────────────────────────────────────────────────────────────
test("N-61: un solo formato de fecha y hora en el panel", () => {
  const tz = "America/Mexico_City";
  assert.equal(fechaPanel("2026-10-04T05:45:00Z", tz), "3 oct 2026");
  assert.equal(fechaHoraPanel("2026-10-04T05:45:00Z", tz).replace(/\s+/g, " "), "3 oct 2026, 11:45 p.m.");
  assert.match(leer("components/dashboard/soporte-rediseno/formato.ts"), /return fechaHoraPanel\(d\);/);
  assert.match(leer("app/dashboard/resenas/invitaciones.tsx"), /fechaPanel\(i\.createdAt, null, locale\)/);
});

// ── N-62 ────────────────────────────────────────────────────────────────────
test("N-62: las tarjetas de Equipo suman y el avatar del dueño sale «CD»", () => {
  const equipo = leer("app/dashboard/team/team-client.tsx");
  assert.match(equipo, /value=\{String\(active - doctors - admins\)\}/);
  assert.match(leer("app/dashboard/settings/settings-client.tsx"), /`\$\{member\.firstName\[0\] \?\? ""\}\$\{member\.lastName\[0\] \?\? ""\}`\.toUpperCase\(\)/);
});

// ── N-63 ────────────────────────────────────────────────────────────────────
test("N-63: el desfase de cada zona sale de la fecha (horario de verano)", () => {
  assert.equal(desfaseDeZona("Europe/Madrid", new Date("2026-10-04T12:00:00Z")), "GMT+2");
  assert.equal(desfaseDeZona("Europe/Madrid", new Date("2026-01-15T12:00:00Z")), "GMT+1");
  assert.equal(desfaseDeZona("America/New_York", new Date("2026-10-04T12:00:00Z")), "GMT-4");
  assert.equal(desfaseDeZona("America/Mexico_City", new Date("2026-10-04T12:00:00Z")), "GMT-6");
  assert.equal(etiquetaDeZona("America/Merida", "Mérida, Yucatán", new Date("2026-10-04T12:00:00Z")), "Mérida, Yucatán (GMT-6)");
  for (const z of ZONAS_HORARIAS) assert.doesNotMatch(z.nombre, / - | \/ /, z.nombre);
});

// ── N-64 ────────────────────────────────────────────────────────────────────
test("N-64: el plan actual dice por qué no lleva IVA y la prueba se entiende", () => {
  const sus = leer("components/dashboard/subscription-tab.tsx");
  assert.match(sus, /sufijoIva\(id\) \|\| " · sin IVA \(lo conservas desde tu alta\)"/);
  assert.equal((sus.match(/\{lineaPlanActual\(\)\}|lineaPlan: lineaPlanActual\(\)/g) ?? []).length, 2);
  // Sin la lista de planes no se inventa «Plan CLINIC — $0 MXN/mes».
  assert.match(sus, /: `Plan \$\{PLAN_MARKETING\[currentPlanId as keyof typeof PLAN_MARKETING\]\?\.name \?\? currentPlanId\}`/);
  assert.equal(valor(ES, "shell.subscriptionTab.trialNoNearEnd"), "Tu prueba sigue activa y no vence pronto");
});

// ── N-65 ────────────────────────────────────────────────────────────────────
test("N-65: «No se envió» dice la causa probable y da el botón que la arregla", () => {
  assert.deepEqual(causaSinEnvio(false).accion, { texto: "Conectar WhatsApp", href: "/dashboard/whatsapp" });
  assert.match(causaSinEnvio(false).texto, /no tiene WhatsApp conectado/);
  assert.deepEqual(causaSinEnvio(true).accion.href, "/dashboard/whatsapp/plantillas");
  assert.match(leer("app/api/reviews/route.ts"), /select: \{ waConnected: true \}/);
});

// ── N-66 ────────────────────────────────────────────────────────────────────
test("N-66: la campana se limita por persona, no por IP compartida", () => {
  const ruta = leer("app/api/dashboard/activity/route.ts");
  assert.match(ruta, /rateLimit\(req, 240\)/);
  assert.match(ruta, /rateLimitKey\(`dashboard-activity:\$\{ctx\.userId\}`, TOPE_POR_PERSONA_POR_MINUTO\)/);
  assert.ok(TOPE_POR_PERSONA_POR_MINUTO >= 60);
});
