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
import { provisionBarberTemplates } from "../whatsapp";
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

test("Meta rechaza la de AUTENTICACIÓN: las otras 4 entran y la pantalla recibe el motivo completo", { skip }, async () => {
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
  assert.equal(r.created.length, 4, JSON.stringify(r.created));
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
