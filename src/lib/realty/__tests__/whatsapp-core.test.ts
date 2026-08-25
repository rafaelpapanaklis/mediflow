// ═══════════════════════════════════════════════════════════════════════
// Pruebas del núcleo PURO de WhatsApp de inmuebles.
//
// Sin base de datos y sin red: todo lo que se prueba aquí es lo que decide
// si un mensaje sale, cuándo sale y cómo se pinta. Correr con:
//   npx tsx --test src/lib/realty/__tests__/whatsapp-core.test.ts
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";

import waEs from "@/i18n/dictionaries/realty/whatsapp.es.json";
import waEn from "@/i18n/dictionaries/realty/whatsapp.en.json";

import {
  REALTY_WA_TEMPLATES,
  buildRealtyWaQuota,
  checkRealtyWaTemplate,
  claimFromExternalId,
  claimedExternalId,
  classifyRealtyReply,
  countRealtyWaVariables,
  formatRealtyWaLongDate,
  formatRealtyWaTime,
  startOfDayInTz,
  encodeRealtyWaMedia,
  isRealtyWaMetaMedia,
  nextRealtyWaStatus,
  parseRealtyWaMedia,
  realtyVisitClaimKey,
  realtyWaFits,
  realtyWaWindowOpen,
  renderRealtyWaTemplate,
  sentExternalId,
  wamidFromExternalId,
} from "@/lib/realty/whatsapp-core";

// ── Catálogo de plantillas ─────────────────────────────────────────────

test("las 7 plantillas del catálogo son válidas para Meta", () => {
  assert.equal(REALTY_WA_TEMPLATES.length, 7);
  for (const tpl of REALTY_WA_TEMPLATES) {
    assert.equal(checkRealtyWaTemplate(tpl), null, `plantilla inválida: ${tpl.name}`);
  }
});

test("la plantilla del código de acceso es AUTHENTICATION y va con el cuerpo VACÍO", () => {
  // En una AUTHENTICATION el texto lo redacta Meta y llega con botón de
  // "copiar código". Escribir un cuerpo propio es justo lo que la hace
  // rechazable.
  const tpl = REALTY_WA_TEMPLATES.find((t) => t.kind === "portalCode")!;
  assert.equal(tpl.category, "AUTHENTICATION");
  assert.equal(tpl.body, "");
  assert.equal(tpl.variables.length, 1);
});

test("una AUTHENTICATION con cuerpo escrito a mano se detecta", () => {
  const rota = {
    ...REALTY_WA_TEMPLATES.find((t) => t.kind === "portalCode")!,
    body: "Tu código es {{1}}",
  };
  assert.notEqual(checkRealtyWaTemplate(rota), null);
});

test("cada plantilla del catálogo tiene etiqueta en ES y en EN", () => {
  // La pantalla de ajustes pinta t(`kinds.${tpl.kind}`) por cada plantilla.
  // Agregar una al catálogo y olvidar el diccionario no rompe el build ni los
  // tipos: pinta la LLAVE CRUDA en producción. Esto lo caza antes.
  const es = (waEs as { kinds: Record<string, string> }).kinds;
  const en = (waEn as { kinds: Record<string, string> }).kinds;
  for (const tpl of REALTY_WA_TEMPLATES) {
    assert.ok(es[tpl.kind], `falta kinds.${tpl.kind} en español`);
    assert.ok(en[tpl.kind], `falta kinds.${tpl.kind} en inglés`);
  }
});

test("una plantilla con más {{n}} que variables declaradas se detecta", () => {
  const rota = {
    ...REALTY_WA_TEMPLATES[0],
    body: "Hola {{1}}, {{2}} y {{3}}",
    variables: ["a", "b"],
    sample: ["a", "b"],
  };
  assert.notEqual(checkRealtyWaTemplate(rota), null);
});

test("una plantilla con hueco en la numeración se detecta", () => {
  const rota = {
    ...REALTY_WA_TEMPLATES[0],
    body: "Hola {{1}} y {{3}}",
    variables: ["a", "b"],
    sample: ["a", "b"],
  };
  assert.notEqual(checkRealtyWaTemplate(rota), null);
});

test("solo la de coincidencias es MARKETING; el resto son de UTILIDAD", () => {
  const marketing = REALTY_WA_TEMPLATES.filter((t) => t.category === "MARKETING");
  assert.equal(marketing.length, 1);
  assert.equal(marketing[0].kind, "matchAlert");
  // Y es la ÚNICA opcional: una cuenta puede vivir sin mandar marketing.
  assert.deepEqual(
    REALTY_WA_TEMPLATES.filter((t) => t.optional).map((t) => t.kind),
    ["matchAlert"],
  );
});

test("la plantilla de marketing lleva la línea de baja que Meta exige", () => {
  const tpl = REALTY_WA_TEMPLATES.find((t) => t.kind === "matchAlert")!;
  assert.match(tpl.body, /BAJA/);
});

test("countRealtyWaVariables no cuenta dos veces el mismo {{n}}", () => {
  assert.equal(countRealtyWaVariables("Hola {{1}}, {{1}} otra vez y {{2}}"), 2);
});

test("renderRealtyWaTemplate sustituye por posición", () => {
  const tpl = REALTY_WA_TEMPLATES.find((t) => t.kind === "leadAck")!;
  const out = renderRealtyWaTemplate(tpl, ["Ana", "Casa X", "Jorge", "Del Valle"]);
  assert.match(out, /Hola Ana/);
  assert.match(out, /Casa X/);
  assert.doesNotMatch(out, /\{\{/);
});

// ── Cupo ───────────────────────────────────────────────────────────────

test("un cupo de 0 (plan PROPIETARIO) NUNCA deja mandar", () => {
  assert.equal(realtyWaFits(0, 0), false);
  assert.equal(realtyWaFits(0, 0, 1), false);
});

test("el cupo ilimitado (-1) siempre deja", () => {
  assert.equal(realtyWaFits(-1, 999_999), true);
});

test("el cupo se agota exactamente en el límite, no uno después", () => {
  assert.equal(realtyWaFits(500, 499), true);
  assert.equal(realtyWaFits(500, 500), false);
});

test("buildRealtyWaQuota marca nearLimit al 80 % y exhausted al 100 %", () => {
  const near = buildRealtyWaQuota({ limit: 500, used: 400, periodStart: null });
  assert.equal(near.nearLimit, true);
  assert.equal(near.exhausted, false);

  const done = buildRealtyWaQuota({ limit: 500, used: 500, periodStart: null });
  assert.equal(done.exhausted, true);
});

// ── Ventana de 24 h ────────────────────────────────────────────────────

test("sin mensaje entrante la ventana está CERRADA", () => {
  assert.equal(realtyWaWindowOpen(null), false);
});

test("la ventana se cierra a las 24 h exactas", () => {
  const now = new Date("2026-08-25T12:00:00Z");
  assert.equal(realtyWaWindowOpen(new Date("2026-08-24T12:00:01Z"), now), true);
  assert.equal(realtyWaWindowOpen(new Date("2026-08-24T12:00:00Z"), now), false);
});

// ── Estados de entrega ─────────────────────────────────────────────────

test("un FAILED NUNCA se pisa con un 'entregado' que llegue tarde", () => {
  // Este es EL bug del dental: un mensaje rechazado por Meta se pintaba
  // como entregado porque un status posterior lo sobreescribía.
  assert.equal(nextRealtyWaStatus("FAILED", "DELIVERED"), null);
  assert.equal(nextRealtyWaStatus("FAILED", "READ"), null);
  assert.equal(nextRealtyWaStatus("FAILED", "SENT"), null);
});

test("los estados solo avanzan: un 'sent' tardío no borra un 'read'", () => {
  assert.equal(nextRealtyWaStatus("READ", "SENT"), null);
  assert.equal(nextRealtyWaStatus("READ", "DELIVERED"), null);
  assert.equal(nextRealtyWaStatus("DELIVERED", "READ"), "READ");
  assert.equal(nextRealtyWaStatus("PENDING", "SENT"), "SENT");
});

test("un FAILED sí pisa cualquier estado anterior que no sea FAILED", () => {
  assert.equal(nextRealtyWaStatus("SENT", "FAILED"), "FAILED");
  assert.equal(nextRealtyWaStatus("DELIVERED", "FAILED"), "FAILED");
});

test("un estado desconocido no toca nada", () => {
  assert.equal(nextRealtyWaStatus("SENT", "PENDIENTE_DE_ALGO"), null);
  assert.equal(nextRealtyWaStatus("SENT", ""), null);
});

// ── Clasificación de respuestas ────────────────────────────────────────

test("BAJA gana a todo: es obligación de Meta", () => {
  assert.equal(classifyRealtyReply("baja"), "optOut");
  assert.equal(classifyRealtyReply("BAJA por favor"), "optOut");
  assert.equal(classifyRealtyReply("sí, pero baja"), "optOut");
});

test("cancelar gana a confirmar en una frase ambigua", () => {
  assert.equal(classifyRealtyReply("mejor no, sí cancélala"), "cancel");
});

test("'sí, pero otro día' es CAMBIAR y no confirmar", () => {
  assert.equal(classifyRealtyReply("sí, pero otro día"), "reschedule");
});

test("los dígitos solo cuentan por igualdad EXACTA", () => {
  assert.equal(classifyRealtyReply("2"), "cancel");
  // Un "2" dentro de una frase no puede cancelarle la visita a nadie.
  assert.equal(classifyRealtyReply("somos 2 personas"), "unclear");
});

test("una palabra dentro de otra no dispara nada", () => {
  // "sino" lleva un "si" dentro; sin límites de palabra confirmaría.
  assert.equal(classifyRealtyReply("sino avísame"), "unclear");
});

test("confirma con y sin acentos", () => {
  assert.equal(classifyRealtyReply("sí"), "confirm");
  assert.equal(classifyRealtyReply("si"), "confirm");
  assert.equal(classifyRealtyReply("Ahí estaré"), "confirm");
});

test("un texto vacío es unclear, no confirm", () => {
  assert.equal(classifyRealtyReply(""), "unclear");
  assert.equal(classifyRealtyReply("   "), "unclear");
});

const MX = "America/Mexico_City";

// ── Zona horaria: la hora que se le dice al prospecto ───────────────────

test("la hora sale en la zona de la CUENTA, no en la del servidor", () => {
  // 2026-08-26T17:00:00Z = 11:00 en Guadalajara. En Vercel el servidor corre
  // en UTC: sin zona, al prospecto se le anunciaba su visita a las 17:00.
  const visita = new Date("2026-08-26T17:00:00Z");
  assert.equal(formatRealtyWaTime(visita, MX), "11:00");
  assert.equal(formatRealtyWaTime(visita, "UTC"), "17:00");
});

test("una visita de noche no se corre al día siguiente", () => {
  // 2026-08-27T02:00:00Z = 26 de agosto, 20:00 en México.
  const visita = new Date("2026-08-27T02:00:00Z");
  assert.equal(formatRealtyWaLongDate(visita, MX), "miércoles 26 de agosto");
  // Con la zona del servidor (UTC) sería el 27 — un día entero de diferencia.
  assert.equal(formatRealtyWaLongDate(visita, "UTC"), "jueves 27 de agosto");
});

test("la medianoche del tope diario es la de la CUENTA, no la del servidor", () => {
  // El tope diario del match se cuenta desde la medianoche local. Con la del
  // servidor (UTC en Vercel) se reiniciaba a las 18:00 hora de México.
  const enMx = (d: Date) =>
    new Intl.DateTimeFormat("es-MX", { timeZone: MX, dateStyle: "short", timeStyle: "medium" }).format(d);

  // 25 de agosto, 20:00 en México (en UTC ya es el día 26).
  assert.equal(enMx(startOfDayInTz(new Date("2026-08-26T02:00:00Z"), MX)), "25/08/26, 12:00:00 a.m.");
  // Un minuto después de medianoche en México ya es el día siguiente.
  assert.equal(enMx(startOfDayInTz(new Date("2026-08-26T06:01:00Z"), MX)), "26/08/26, 12:00:00 a.m.");
  // Un minuto antes, todavía no.
  assert.equal(enMx(startOfDayInTz(new Date("2026-08-26T05:59:00Z"), MX)), "25/08/26, 12:00:00 a.m.");
});

test("una zona horaria inválida NO tumba el envío", () => {
  const visita = new Date("2026-08-26T17:00:00Z");
  // Cae a México en vez de lanzar: un dato malo en la cuenta no puede
  // impedir que salga el recordatorio.
  assert.equal(formatRealtyWaTime(visita, "Marte/Olympus"), "11:00");
});

// ── externalId: wamid + llave de reclamo ───────────────────────────────

test("la llave del recordatorio de visita CAMBIA si la visita se mueve", () => {
  // Este es el arreglo del M-22 por construcción: llave distinta = el aviso
  // viejo no bloquea al nuevo, y el nuevo lleva la hora nueva.
  const antes = realtyVisitClaimKey("v1", new Date("2026-08-26T11:00:00Z"));
  const despues = realtyVisitClaimKey("v1", new Date("2026-08-26T17:00:00Z"));
  assert.notEqual(antes, despues);
});

test("la misma visita a la misma hora da SIEMPRE la misma llave", () => {
  const a = realtyVisitClaimKey("v1", new Date("2026-08-26T11:00:00Z"));
  const b = realtyVisitClaimKey("v1", new Date("2026-08-26T11:00:00Z"));
  assert.equal(a, b);
});

test("el wamid se recupera del externalId de un envío automático", () => {
  const key = realtyVisitClaimKey("v1", new Date("2026-08-26T11:00:00Z"));
  const ext = sentExternalId("wamid.ABC123", key);
  assert.equal(wamidFromExternalId(ext), "wamid.ABC123");
  assert.equal(claimFromExternalId(ext), key);
  // Y el prefijo ancla por la IZQUIERDA, que es lo que hace que la búsqueda
  // del estado de entrega use el índice.
  assert.ok(ext.startsWith("wamid.ABC123|"));
});

test("una fila reclamada todavía no tiene wamid", () => {
  const key = realtyVisitClaimKey("v1", new Date("2026-08-26T11:00:00Z"));
  const ext = claimedExternalId(key);
  assert.equal(wamidFromExternalId(ext), null);
  assert.equal(claimFromExternalId(ext), key);
});

test("un externalId de envío a mano es el wamid a secas", () => {
  assert.equal(wamidFromExternalId("wamid.XYZ"), "wamid.XYZ");
  assert.equal(claimFromExternalId("wamid.XYZ"), null);
});

// ── Multimedia ─────────────────────────────────────────────────────────

test("el archivo entrante guarda el id de Meta, no una URL", () => {
  const encoded = encodeRealtyWaMedia({ kind: "image", mediaId: "123", mime: "image/jpeg" });
  assert.ok(isRealtyWaMetaMedia(encoded));
  const parsed = parseRealtyWaMedia(encoded);
  assert.equal(parsed?.mediaId, "123");
  assert.equal(parsed?.kind, "image");
});

test("una URL nuestra NO se confunde con un archivo de Meta", () => {
  assert.equal(isRealtyWaMetaMedia("https://cdn.example.com/foto.jpg"), false);
  assert.equal(parseRealtyWaMedia("https://cdn.example.com/foto.jpg"), null);
  assert.equal(parseRealtyWaMedia(null), null);
});

test("un mediaUrl corrupto no revienta", () => {
  assert.equal(parseRealtyWaMedia("wa:{no es json"), null);
  assert.equal(parseRealtyWaMedia("wa:{}"), null);
});

// ── Formato ────────────────────────────────────────────────────────────

