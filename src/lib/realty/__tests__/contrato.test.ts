// ═══════════════════════════════════════════════════════════════════════
// EL CONTRATO DEL VERTICAL — lo que las diez terminales de la Ola 1 dan por
// cierto sin volver a comprobarlo.
//
// src/lib/realty/types.ts, permissions.ts, plan-shared.ts y tours.ts son
// PUNTO ÚNICO: nadie más los reimplementa. Eso solo es seguro si están
// probados, porque el día que alguien "arregle" una de estas funciones, diez
// pantallas cambian de comportamiento a la vez y nada más se entera.
//
// Todo es PURO: sin Postgres, sin navegador, sin sesión. Corre en un segundo.
//
//   npx tsx --test src/lib/realty/__tests__/contrato.test.ts
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  nextStages,
  isTerminalLeadStage,
  leadStageIndex,
  makeRealtySlug,
  makeRealtyFolio,
  REALTY_NAV_ITEMS,
  navItemAllowsMode,
  isAgency,
  isAgent,
  isOwner,
  isRealtyMode,
  sellsThirdPartyProperties,
  type RealtyMode,
} from "@/lib/realty/types";
import {
  detectRealtyTourProvider,
  isRealtyTourUrl,
  realtyTourKindFor,
  realtyTourFrameSrc,
} from "@/lib/realty/tours";
import {
  resolveRealtyPermissions,
  hasRealtyPermission,
  RealtyForbiddenError,
} from "@/lib/realty/permissions";
import {
  FALLBACK_REALTY_PLAN_CONFIG,
  realtyPlanHasFeature,
  formatRealtyStorage,
  formatRealtyLimit,
  isRealtySubscriptionActive,
  realtyNavItemsWhileUnpaid,
  isRealtyPlanAtLeast,
} from "@/lib/realty/plan-shared";

// ── El embudo del prospecto ─────────────────────────────────────────────
test("el prospecto avanza de una en una y puede retroceder UNA etapa", () => {
  assert.equal(canTransition("NUEVO", "CONTACTADO"), true);
  assert.equal(canTransition("CALIFICADO", "VISITA"), true);
  // Retroceder está PERMITIDO a propósito: en bienes raíces un prospecto que
  // ya visitó y se enfrió vuelve a CONTACTADO, no se pierde.
  assert.equal(canTransition("VISITA", "CALIFICADO"), true);
});

test("no se puede saltar el embudo hacia adelante (ensuciaría todo el reporte)", () => {
  assert.equal(canTransition("NUEVO", "OFERTA"), false);
  assert.equal(canTransition("NUEVO", "CIERRE"), false);
  assert.equal(canTransition("CONTACTADO", "CIERRE"), false);
});

test("PERDIDO se alcanza desde cualquier etapa no terminal, y CIERRE/PERDIDO no tienen salida", () => {
  for (const etapa of ["NUEVO", "CONTACTADO", "CALIFICADO", "VISITA", "OFERTA"] as const) {
    assert.equal(canTransition(etapa, "PERDIDO"), true, `${etapa} → PERDIDO`);
  }
  assert.equal(canTransition("CIERRE", "PERDIDO"), false);
  assert.equal(canTransition("PERDIDO", "NUEVO"), false);
  assert.equal(isTerminalLeadStage("CIERRE"), true);
  assert.equal(isTerminalLeadStage("PERDIDO"), true);
  assert.equal(isTerminalLeadStage("VISITA"), false);
  assert.equal(leadStageIndex("PERDIDO"), -1, "PERDIDO no está en el embudo lineal");
  assert.equal(leadStageIndex("NUEVO"), 0);
});

test("nextStages devuelve una COPIA (mutarla no puede tocar el mapa interno)", () => {
  const copia = nextStages("NUEVO");
  copia.push("CIERRE");
  assert.equal(nextStages("NUEVO").includes("CIERRE"), false);
});

// ── Slug y folio ────────────────────────────────────────────────────────
test("makeRealtySlug limpia acentos, símbolos y espacios", () => {
  assert.equal(makeRealtySlug("Inmobiliaria Peña & Asociados"), "inmobiliaria-pena-asociados");
  assert.equal(makeRealtySlug("  Bienes Raíces del Bajío  "), "bienes-raices-del-bajio");
});

test("makeRealtySlug nunca devuelve vacío ni deja un guion colgando", () => {
  assert.equal(makeRealtySlug("!!!"), "inmobiliaria");
  assert.equal(makeRealtySlug(""), "inmobiliaria");
  // El corte a 40 caracteres puede caer justo sobre un separador.
  const largo = makeRealtySlug("Grupo Inmobiliario Metropolitano del Occidente Mexicano");
  assert.equal(largo.endsWith("-"), false, `terminó en guion: ${largo}`);
  assert.ok(largo.length <= 40);
});

test("el folio no usa I, O, 0 ni 1 (se confunden al dictarlo por teléfono)", () => {
  let n = 0;
  const folio = makeRealtyFolio(() => (n++ % 32) / 32);
  assert.match(folio, /^INM-[A-HJ-NP-Z2-9]{4}$/, folio);
});

// ── Los tres modos ──────────────────────────────────────────────────────
test("los helpers de modo distinguen quién comercializa para terceros", () => {
  assert.equal(isAgency("AGENCY"), true);
  assert.equal(isAgent("AGENT"), true);
  assert.equal(isOwner("OWNER"), true);
  assert.equal(sellsThirdPartyProperties("OWNER"), false);
  assert.equal(sellsThirdPartyProperties("AGENT"), true);
  assert.equal(sellsThirdPartyProperties("AGENCY"), true);
  assert.equal(isRealtyMode("AGENCY"), true);
  assert.equal(isRealtyMode("CUALQUIERA"), false);
  assert.equal(isRealtyMode(null), false);
});

const menuDe = (modo: RealtyMode) =>
  REALTY_NAV_ITEMS.filter((i) => navItemAllowsMode(i, modo)).map((i) => i.key);

test("el menú del rentista (OWNER) no enseña Prospectos ni Comisiones", () => {
  const owner = menuDe("OWNER");
  assert.equal(owner.includes("prospectos"), false);
  assert.equal(owner.includes("comisiones"), false);
  // Pero SÍ lo suyo: sus inmuebles, sus contratos y su cobranza.
  assert.equal(owner.includes("inmuebles"), true);
  assert.equal(owner.includes("rentas"), true);
  assert.equal(owner.includes("cobranza"), true);
});

test("el menú del asesor independiente (AGENT) no enseña Equipo", () => {
  const agent = menuDe("AGENT");
  assert.equal(agent.includes("equipo"), false);
  assert.equal(agent.includes("prospectos"), true);
  assert.equal(agent.includes("comisiones"), true);
});

test("la inmobiliaria (AGENCY) ve el menú completo", () => {
  assert.equal(menuDe("AGENCY").length, REALTY_NAV_ITEMS.length);
});

test("ningún item del menú se queda sin modos (sería invisible para todos)", () => {
  const huerfanos = REALTY_NAV_ITEMS.filter((i) => i.modes.length === 0).map((i) => i.key);
  assert.deepEqual(huerfanos, []);
});

// ── Recorridos 3D / 360 / video ─────────────────────────────────────────
test("la allowlist de recorridos acepta a los proveedores reales y su subdominio", () => {
  assert.equal(isRealtyTourUrl("https://my.matterport.com/show/?m=abc123"), true);
  assert.equal(isRealtyTourUrl("https://matterport.com/show/?m=abc"), true);
  assert.equal(isRealtyTourUrl("https://kuula.co/share/collection/x"), true);
  assert.equal(isRealtyTourUrl("https://player.vimeo.com/video/1234"), true);
  assert.equal(isRealtyTourUrl("https://www.youtube-nocookie.com/embed/x"), true);
  assert.equal(detectRealtyTourProvider("https://kuula.co/x")?.key, "kuula");
});

test("la allowlist rechaza http, dominios parecidos y esquemas raros", () => {
  // http: en un iframe de una página https lo bloquea el navegador por
  // contenido mixto — y ahí también sale el marco EN BLANCO.
  assert.equal(isRealtyTourUrl("http://my.matterport.com/show/?m=abc"), false);
  assert.equal(isRealtyTourUrl("https://notmatterport.com/x"), false);
  assert.equal(isRealtyTourUrl("https://evil.test/matterport.com"), false);
  assert.equal(isRealtyTourUrl("javascript:alert(1)"), false);
  assert.equal(isRealtyTourUrl("no soy una url"), false);
  assert.equal(isRealtyTourUrl(""), false);
});

test("el tipo de recorrido sale del proveedor, no se le pregunta al asesor", () => {
  assert.equal(realtyTourKindFor("https://my.matterport.com/show/?m=abc"), "TOUR_3D");
  assert.equal(realtyTourKindFor("https://kuula.co/share/x"), "TOUR_360");
  assert.equal(realtyTourKindFor("https://player.vimeo.com/video/1"), "VIDEO");
  assert.equal(realtyTourKindFor("https://evil.test/x"), null);
});

test("el frame-src derivado cubre cada dominio y su comodín", () => {
  const frameSrc = realtyTourFrameSrc();
  for (const d of ["matterport.com", "kuula.co", "vimeo.com", "youtube-nocookie.com"]) {
    assert.ok(frameSrc.includes(`https://${d}`), `falta https://${d}`);
    assert.ok(frameSrc.includes(`https://*.${d}`), `falta https://*.${d}`);
  }
});

// ── Permisos ────────────────────────────────────────────────────────────
test("OWNER tiene todo; MANAGER todo menos la suscripción", () => {
  assert.equal(hasRealtyPermission({ role: "OWNER" }, "billing.manage"), true);
  assert.equal(hasRealtyPermission({ role: "MANAGER" }, "billing.manage"), false);
  assert.equal(hasRealtyPermission({ role: "MANAGER" }, "commissions.manage"), true);
});

test("el asesor trabaja su cartera pero no reparte prospectos ajenos ni toca la renta", () => {
  assert.equal(hasRealtyPermission({ role: "AGENT" }, "leads.view"), true);
  assert.equal(hasRealtyPermission({ role: "AGENT" }, "leads.edit"), true);
  assert.equal(hasRealtyPermission({ role: "AGENT" }, "leads.assign"), false);
  assert.equal(hasRealtyPermission({ role: "AGENT" }, "payments.manage"), false);
  assert.equal(hasRealtyPermission({ role: "AGENT" }, "commissions.manage"), false);
  assert.equal(hasRealtyPermission({ role: "AGENT" }, "commissions.view"), true);
});

test("el asistente registra cobros pero no cambia precios ni el reparto", () => {
  assert.equal(hasRealtyPermission({ role: "ASSISTANT" }, "payments.manage"), true);
  assert.equal(hasRealtyPermission({ role: "ASSISTANT" }, "properties.edit"), false);
  assert.equal(hasRealtyPermission({ role: "ASSISTANT" }, "commissions.manage"), false);
});

test("permissionsOverride REEMPLAZA al default del rol — no se suma", () => {
  // Esta es LA regla que se olvida: un permiso nuevo agregado a un rol NO le
  // llega a un usuario que tenga override. Hay que agregarlo a su override.
  assert.equal(
    hasRealtyPermission({ role: "OWNER", permissionsOverride: ["leads.view"] }, "billing.manage"),
    false,
  );
  assert.equal(
    hasRealtyPermission({ role: "OWNER", permissionsOverride: ["leads.view"] }, "leads.view"),
    true,
  );
});

test("un override vacío o con solo llaves desconocidas cae al default del rol", () => {
  assert.equal(resolveRealtyPermissions("OWNER", []).has("billing.manage"), true);
  assert.equal(resolveRealtyPermissions("OWNER", null).has("billing.manage"), true);
  assert.equal(
    hasRealtyPermission({ role: "OWNER", permissionsOverride: ["basura.inventada"] }, "billing.manage"),
    true,
  );
});

test("RealtyForbiddenError lleva la llave que faltó (la API la mapea a 403)", () => {
  const e = new RealtyForbiddenError("web.edit");
  assert.equal(e.permission, "web.edit");
  assert.equal(e.name, "RealtyForbiddenError");
  assert.ok(e instanceof Error);
});

// ── Planes ──────────────────────────────────────────────────────────────
const PROP = FALLBACK_REALTY_PLAN_CONFIG.PROPIETARIO;
const ASES = FALLBACK_REALTY_PLAN_CONFIG.ASESOR;
const INMO = FALLBACK_REALTY_PLAN_CONFIG.INMOBILIARIA;

test("el fallback tiene los precios del seed: 199 / 349 / 649", () => {
  assert.equal(PROP.priceMonthly, 199);
  assert.equal(ASES.priceMonthly, 349);
  assert.equal(INMO.priceMonthly, 649);
});

test("WhatsApp arranca en ASESOR: el plan de $199 NO lo trae", () => {
  assert.equal(realtyPlanHasFeature(PROP, "whatsapp"), false);
  assert.equal(PROP.messageQuota, 0, "cupo 0 = sin WhatsApp, no 'con cupo cero'");
  assert.equal(realtyPlanHasFeature(ASES, "whatsapp"), true);
  assert.equal(realtyPlanHasFeature(INMO, "whatsapp"), true);
});

test("3D/360 va en los TRES planes; lo que cambia es el cupo de archivos", () => {
  for (const [nombre, p] of [["PROPIETARIO", PROP], ["ASESOR", ASES], ["INMOBILIARIA", INMO]] as const) {
    assert.equal(realtyPlanHasFeature(p, "tours3d"), true, `${nombre} sin tours3d`);
    assert.equal(p.maxProperties, -1, `${nombre} debería tener inmuebles ilimitados`);
  }
  assert.equal(PROP.storageQuotaMb, 2048);
  assert.equal(ASES.storageQuotaMb, 10240);
  assert.equal(INMO.storageQuotaMb, 40960);
});

test("usuarios y oficinas: 1 / 6 / ilimitados", () => {
  assert.equal(PROP.maxUsers, 1);
  assert.equal(ASES.maxUsers, 6);
  assert.equal(INMO.maxUsers, -1);
  assert.equal(PROP.maxOffices, 1);
  assert.equal(ASES.maxOffices, 1);
  assert.equal(INMO.maxOffices, -1);
});

test("las features son acumulativas: lo del plan de abajo está en el de arriba", () => {
  const activas = (p: typeof PROP) =>
    Object.entries(p.features).filter(([, v]) => v).map(([k]) => k);
  for (const f of activas(PROP)) assert.ok(ASES.features[f], `ASESOR perdió ${f}`);
  for (const f of activas(ASES)) assert.ok(INMO.features[f], `INMOBILIARIA perdió ${f}`);
});

test("isRealtyPlanAtLeast ordena PROPIETARIO < ASESOR < INMOBILIARIA", () => {
  assert.equal(isRealtyPlanAtLeast("ASESOR", "PROPIETARIO"), true);
  assert.equal(isRealtyPlanAtLeast("PROPIETARIO", "ASESOR"), false);
  assert.equal(isRealtyPlanAtLeast("INMOBILIARIA", "INMOBILIARIA"), true);
});

test("el formato de cupos y espacio se lee en español, no en números crudos", () => {
  assert.equal(formatRealtyStorage(2048), "2 GB");
  assert.equal(formatRealtyStorage(10240), "10 GB");
  assert.equal(formatRealtyStorage(512), "512 MB");
  assert.equal(formatRealtyStorage(-1), "Espacio ilimitado");
  assert.equal(formatRealtyLimit(-1, "usuario", "usuarios"), "Usuarios ilimitados");
  assert.equal(formatRealtyLimit(1, "usuario", "usuarios"), "1 usuario");
  assert.equal(formatRealtyLimit(6, "usuario", "usuarios"), "6 usuarios");
});

test("la cuenta nace SIN acceso: pending_payment no es una suscripción activa", () => {
  assert.equal(isRealtySubscriptionActive({ subscriptionStatus: "pending_payment" }), false);
  assert.equal(isRealtySubscriptionActive({ subscriptionStatus: "past_due" }), false);
  assert.equal(isRealtySubscriptionActive({ subscriptionStatus: "canceled" }), false);
  assert.equal(isRealtySubscriptionActive({ subscriptionStatus: "active" }), true);
  assert.equal(isRealtySubscriptionActive({ subscriptionStatus: "trialing" }), true);
  assert.equal(isRealtySubscriptionActive(null), false);
  assert.equal(isRealtySubscriptionActive(undefined), false);
});

test("con la suscripción impaga el menú deja solo pagar y pedir ayuda", () => {
  const keys = realtyNavItemsWhileUnpaid(REALTY_NAV_ITEMS).map((i) => i.key).sort();
  assert.deepEqual(keys, ["soporte", "suscripcion"]);
});
