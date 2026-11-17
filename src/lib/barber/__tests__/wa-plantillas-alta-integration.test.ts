// ═══════════════════════════════════════════════════════════════════════
// Alta de plantillas con Postgres REAL y Meta simulado (_wa-arnes.ts): si
// Meta rechaza la de código de acceso, el motivo COMPLETO llega a quien
// llama (la pantalla), y las demás se dan de alta igual.
//
// 🔴 Solo con DATABASE_URL local (crea y borra barberías).
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/wa-plantillas-alta-integration.test.ts
// ═══════════════════════════════════════════════════════════════════════
import {
  borrarTodo,
  crearTienda,
  graph,
  instalarFetch,
  limpiar,
  onGraph,
  restaurarFetch,
  skip,
  BASE_LOCAL,
} from "./_wa-arnes";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { listBarberTemplates, provisionBarberTemplates } from "../whatsapp";
import { explainBarberTemplateFailure } from "../wa-plantillas-core";

before(() => {
  if (BASE_LOCAL) instalarFetch();
});
after(async () => {
  onGraph(null);
  restaurarFetch();
  if (BASE_LOCAL) await borrarTodo();
});
beforeEach(() => {
  limpiar();
  onGraph(null);
});

const altas = () =>
  graph.filter((c) => c.method === "POST" && c.url.endsWith("/message_templates")).map((c) => c.body);

test("Meta rechaza la de AUTENTICACIÓN: las otras 6 entran y la pantalla recibe el motivo completo", { skip }, async () => {
  const t = await crearTienda();
  onGraph((call) => {
    if (call.method === "GET" && call.url.includes("/message_templates")) return { status: 200, json: { data: [] } };
    if (call.method === "POST" && call.url.endsWith("/message_templates") && call.body?.category === "AUTHENTICATION") {
      return {
        status: 400,
        json: {
          error: {
            message: "Invalid parameter",
            code: 100,
            error_subcode: 2388042,
            error_user_title: "Plantilla no válida",
            error_user_msg: "Este tipo de plantilla no está disponible para esta cuenta.",
          },
        },
      };
    }
    if (call.method === "POST" && call.url.endsWith("/message_templates")) return { status: 200, json: { id: "1", status: "PENDING" } };
    return null;
  });

  const r = await provisionBarberTemplates(t.id);
  assert.equal(r.ok, true);
  // 6 de utilidad: las 4 de siempre + la tarjeta de estrellas tras el cobro (ws6-t1, 16-nov)
  // + el aviso «pedido nuevo» al dueño (ws6-t6, feat/barber-pedidos-aviso). Unión pase 26 (ws6-t4):
  // cada rama contaba solo la suya; pedidos-aviso no había tocado esta prueba.
  assert.equal(r.created.length, 6, JSON.stringify(r.created));
  assert.equal(r.failed.length, 1);
  const f = r.failed[0];
  assert.equal(f.name, "dc_barber_codigo_acceso");
  assert.equal(f.kind, "portalCode");
  assert.equal(f.userMsg, "Este tipo de plantilla no está disponible para esta cuenta.");
  assert.equal(f.error, "Este tipo de plantilla no está disponible para esta cuenta.", "el texto de siempre ya no es «Invalid parameter»");
  assert.equal(f.code, 100);
  assert.equal(f.subcode, 2388042);
  assert.equal(explainBarberTemplateFailure(f).key, "authNotAccepted");

  // Lo que se le pidió a Meta para la de autenticación (la forma documentada).
  const auth = altas().find((b) => b?.category === "AUTHENTICATION");
  assert.deepEqual(auth, {
    name: "dc_barber_codigo_acceso",
    language: "es_MX",
    category: "AUTHENTICATION",
    components: [
      { type: "BODY", add_security_recommendation: true },
      { type: "FOOTER", code_expiration_minutes: 10 },
      { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copiar código" }] },
    ],
  });
});

test("sin respuesta de Meta en el alta: queda como fallo de red, no se pierde", { skip }, async () => {
  const t = await crearTienda();
  onGraph((call) => {
    if (call.method === "GET" && call.url.includes("/message_templates")) return { status: 200, json: { data: [] } };
    if (call.method === "POST" && call.url.endsWith("/message_templates") && call.body?.category === "AUTHENTICATION") {
      throw new TypeError("fetch failed");
    }
    if (call.method === "POST" && call.url.endsWith("/message_templates")) return { status: 200, json: { id: "1" } };
    return null;
  });
  const r = await provisionBarberTemplates(t.id);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].network, true);
  assert.equal(explainBarberTemplateFailure(r.failed[0]).key, "network");
});

/* ═══════ «Ya existe» en el alta, «Sin dar de alta» en la lista (15-nov) ═══════ */

const G = "https://graph.facebook.com/v19.0";
const CODIGO = "dc_barber_codigo_acceso";
const UTILES = ["dc_barber_recordatorio_cita_botones", "dc_barber_recordatorio_cita", "dc_barber_turno_fila", "dc_barber_reserva_confirmada", "dc_barber_tarjeta_estrellas", "dc_barber_pedido_nuevo_dueno"];
const tpl = (name: string, status = "APPROVED", language = "es_MX") => ({ name, status, language, category: "UTILITY", rejected_reason: "NONE" });

/**
 * Meta simulado: la lista general devuelve `general` (en páginas de `porPagina`);
 * la búsqueda por nombre (`name=`) devuelve `porNombre`; el alta de la de
 * código contesta `altaCodigo`. Las útiles ya existen.
 */
function meta(o: { general: any[]; porPagina?: number; porNombre?: any[]; altaCodigo?: { status: number; json: unknown } }) {
  const por = o.porPagina ?? 1000;
  onGraph((call) => {
    const u = new URL(call.url);
    if (call.method === "GET" && u.pathname.endsWith("/message_templates")) {
      if (u.searchParams.get("name")) return { status: 200, json: { data: o.porNombre ?? [] } };
      const desde = Number(u.searchParams.get("after") ?? "0");
      const data = o.general.slice(desde, desde + por);
      const next = desde + por < o.general.length ? `${u.origin}${u.pathname}?limit=200&after=${desde + por}` : undefined;
      return { status: 200, json: { data, ...(next ? { paging: { next } } : {}) } };
    }
    if (call.method === "POST" && u.pathname.endsWith("/message_templates")) {
      if (call.body?.name === CODIGO && o.altaCodigo) return o.altaCodigo;
      return { status: 200, json: { id: "1", status: "PENDING" } };
    }
    return null;
  });
}

test("la lista sigue la PAGINACIÓN: la de código en la página 3 ya no sale «Sin dar de alta»", { skip }, async () => {
  const t = await crearTienda();
  const relleno = Array.from({ length: 250 }, (_, i) => tpl(`otra_plantilla_${i}`));
  meta({ general: [...relleno, ...UTILES.map((n) => tpl(n)), tpl(CODIGO, "PENDING")], porPagina: 100 });
  const r = await listBarberTemplates(t.id);
  assert.equal(r.ok, true);
  const codigo = r.templates.find((x) => x.name === CODIGO)!;
  assert.equal(codigo.status, "PENDING");
  assert.equal(codigo.reason, null, "nunca «NONE»");
});

test("«ya existe» y Meta NO la lista (se está borrando): se avisa, nunca en silencio", { skip }, async () => {
  const t = await crearTienda();
  meta({
    general: UTILES.map((n) => tpl(n)),
    porNombre: [],
    altaCodigo: {
      status: 400,
      json: { error: { message: "Invalid parameter", code: 100, error_subcode: 2388023,
        error_user_title: "Message template language is being deleted",
        error_user_msg: "New Spanish (MEX) content can't be added while the existing Spanish (MEX) content is being deleted. Try again in 4 weeks or consider creating a new message template." } },
    },
  });
  const r = await provisionBarberTemplates(t.id);
  assert.equal(r.failed.length, 1, "antes: 0 y la pantalla no decía nada");
  assert.equal(r.failed[0].taken, "hidden");
  assert.equal(explainBarberTemplateFailure(r.failed[0]).key, "nameHidden");
  assert.match(explainBarberTemplateFailure(r.failed[0]).raw, /being deleted/);
});

test("«ya existe» y Meta la tiene SE ESTÁ BORRANDO: se avisa con su estado", { skip }, async () => {
  const t = await crearTienda();
  meta({
    general: UTILES.map((n) => tpl(n)),
    porNombre: [tpl(CODIGO, "PENDING_DELETION")],
    altaCodigo: { status: 400, json: { error: { message: "Invalid parameter", code: 100, error_subcode: 2388024, error_user_msg: "Content in this language already exists" } } },
  });
  const r = await provisionBarberTemplates(t.id);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].taken, "notUsable");
  assert.equal(r.failed[0].foundStatus, "PENDING_DELETION");
  assert.equal(explainBarberTemplateFailure(r.failed[0]).key, "notUsable");
});

test("«ya existe» y Meta la tiene APROBADA en es_MX: no hay nada que avisar", { skip }, async () => {
  const t = await crearTienda();
  meta({
    general: UTILES.map((n) => tpl(n)),
    porNombre: [tpl(CODIGO, "APPROVED")],
    altaCodigo: { status: 400, json: { error: { message: "Invalid parameter", code: 100, error_subcode: 2388024 } } },
  });
  const r = await provisionBarberTemplates(t.id);
  assert.deepEqual(r.failed, []);
});

test("la de código SOLO en otro idioma: la lista lo dice y el alta pide la versión es_MX", { skip }, async () => {
  const t = await crearTienda();
  meta({ general: [...UTILES.map((n) => tpl(n)), tpl(CODIGO, "APPROVED", "es")] });
  const lista = await listBarberTemplates(t.id);
  const codigo = lista.templates.find((x) => x.name === CODIGO)!;
  assert.equal(codigo.status, "APPROVED");
  assert.equal(codigo.otherLanguage, true);
  assert.equal(codigo.language, "es");
  const r = await provisionBarberTemplates(t.id);
  assert.deepEqual(r.created, [CODIGO]);
  const pedida = altas().find((b) => b?.name === CODIGO);
  assert.equal(pedida.language, "es_MX");
});
