/**
 * Soporte — reglas puras de editar / retirar / adjuntar a una respuesta enviada.
 *
 * `npm run test:soporte-mensaje-edicion`
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SUPPORT_RETRACTED_NOTE_TEXT,
  SUPPORT_RETRACTED_TEXT,
  estadosDeEdicion,
  planearEdicion,
  planearRetiro,
  type MensajeParaCambio,
} from "../mensaje-edicion";
import { SupportError, type SupportAttachment } from "../types";

const adj = (n: string): SupportAttachment => ({ path: `support/cl1/${n}.png`, name: `${n}.png`, size: 100, type: "image/png" });

const soporte = (over: Partial<MensajeParaCambio> = {}): MensajeParaCambio => ({
  authorType: "support",
  internalNote: false,
  body: "Hola, ya lo revisamos.",
  attachments: [],
  ...over,
});

function falla(fn: () => unknown, status: number, texto?: RegExp) {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof SupportError, "debe ser SupportError");
    assert.equal((e as SupportError).status, status);
    if (texto) assert.match((e as SupportError).message, texto);
    return true;
  });
}

test("el texto de una respuesta retirada es exactamente «Respuesta retirada por soporte»", () => {
  assert.equal(SUPPORT_RETRACTED_TEXT, "Respuesta retirada por soporte");
  assert.equal(planearRetiro(soporte(), undefined).body, "Respuesta retirada por soporte");
});

test("una nota interna retirada dice «Nota interna retirada por soporte»", () => {
  assert.equal(planearRetiro(soporte({ internalNote: true }), undefined).body, SUPPORT_RETRACTED_NOTE_TEXT);
});

test("retirar quita los archivos del mensaje (el original vive en el historial)", () => {
  const plan = planearRetiro(soporte({ attachments: [adj("a")] }), undefined);
  assert.deepEqual(plan.attachments, []);
  assert.equal(plan.kind, "retract");
});

test("solo mensajes de SOPORTE: los de la clínica y los del sistema dan 403", () => {
  for (const authorType of ["clinic", "system"]) {
    falla(() => planearEdicion(soporte({ authorType }), undefined, { body: "x" }), 403);
    falla(() => planearRetiro(soporte({ authorType }), undefined), 403);
  }
});

test("una respuesta ya retirada no se edita ni se retira otra vez (409)", () => {
  const estado = { editedAt: null, retractedAt: new Date() };
  falla(() => planearEdicion(soporte(), estado, { body: "otra" }), 409);
  falla(() => planearRetiro(soporte(), estado), 409);
});

test("editar el texto es kind «edit» y conserva los archivos", () => {
  const plan = planearEdicion(soporte({ attachments: [adj("a")] }), undefined, { body: "  Texto nuevo  " });
  assert.equal(plan.kind, "edit");
  assert.equal(plan.body, "Texto nuevo");
  assert.equal(plan.attachments.length, 1);
});

test("solo agregar archivos es kind «attach» y respeta el texto", () => {
  const plan = planearEdicion(soporte(), undefined, { archivosNuevos: [adj("b")] });
  assert.equal(plan.kind, "attach");
  assert.equal(plan.body, "Hola, ya lo revisamos.");
  assert.equal(plan.archivosNuevos, 1);
});

test("texto nuevo + archivos = «edit» con los dos cambios", () => {
  const plan = planearEdicion(soporte(), undefined, { body: "Corregido", archivosNuevos: [adj("b")] });
  assert.equal(plan.kind, "edit");
  assert.equal(plan.attachments.length, 1);
});

test("guardar el mismo texto sin archivos es «sin cambios» (no marca «editado» en falso)", () => {
  falla(() => planearEdicion(soporte(), undefined, { body: "Hola, ya lo revisamos." }), 400, /No hay cambios/);
  falla(() => planearEdicion(soporte(), undefined, {}), 400, /No hay cambios/);
  // el espacio sobrante no cuenta como cambio
  falla(() => planearEdicion(soporte(), undefined, { body: "  Hola, ya lo revisamos.  " }), 400, /No hay cambios/);
});

test("no se puede dejar vacío… salvo que lleve archivos", () => {
  falla(() => planearEdicion(soporte(), undefined, { body: "   " }), 400, /vacío/);
  const conArchivo = planearEdicion(soporte({ attachments: [adj("a")] }), undefined, { body: "" });
  assert.equal(conArchivo.body, "");
  assert.equal(conArchivo.attachments.length, 1);
});

test("máximo 5 archivos por mensaje contando los que ya tenía", () => {
  const cuatro = [adj("1"), adj("2"), adj("3"), adj("4")];
  const ok = planearEdicion(soporte({ attachments: cuatro }), undefined, { archivosNuevos: [adj("5")] });
  assert.equal(ok.attachments.length, 5);
  falla(() => planearEdicion(soporte({ attachments: cuatro }), undefined, { archivosNuevos: [adj("5"), adj("6")] }), 400, /Máximo 5/);
});

test("el texto se sanea como al enviar (sin caracteres de control) y se recorta a 5000", () => {
  const plan = planearEdicion(soporte(), undefined, { body: "a\u0000b" + "x".repeat(6000) });
  assert.ok(!plan.body.includes("\u0000"));
  assert.equal(plan.body.length, 5000);
});

test("estadosDeEdicion: último edit/attach = editedAt, retract = retractedAt, por mensaje", () => {
  const t = (s: string) => new Date(`2026-09-30T${s}:00.000Z`);
  const mapa = estadosDeEdicion([
    { messageId: "m1", kind: "edit", createdAt: t("10:00") },
    { messageId: "m1", kind: "attach", createdAt: t("11:00") },
    { messageId: "m2", kind: "edit", createdAt: t("09:00") },
    { messageId: "m2", kind: "retract", createdAt: t("12:00") },
    { messageId: "m3", kind: "otra-cosa", createdAt: t("12:00") },
  ]);
  assert.deepEqual(mapa.get("m1"), { editedAt: t("11:00"), retractedAt: null });
  assert.deepEqual(mapa.get("m2"), { editedAt: t("09:00"), retractedAt: t("12:00") });
  assert.deepEqual(mapa.get("m3"), { editedAt: null, retractedAt: null });
  assert.equal(mapa.get("m4"), undefined);
});

test("estadosDeEdicion no depende del orden de llegada", () => {
  const a = new Date("2026-09-30T10:00:00Z");
  const b = new Date("2026-09-30T11:00:00Z");
  const mapa = estadosDeEdicion([
    { messageId: "m", kind: "edit", createdAt: b },
    { messageId: "m", kind: "edit", createdAt: a },
  ]);
  assert.equal(mapa.get("m")!.editedAt!.getTime(), b.getTime());
});

// ── Cómo lo ve quien lee el hilo ─────────────────────────────────────────────
import { cambioDelMensaje } from "../mensaje-edicion";

test("cambioDelMensaje: sin cambios → null; editada → fecha; retirada → aviso + fecha (y gana sobre editada)", () => {
  assert.equal(cambioDelMensaje({}), null);
  assert.equal(cambioDelMensaje({ editedAt: null, retractedAt: null }), null);
  assert.deepEqual(cambioDelMensaje({ editedAt: "2026-09-30T10:00:00.000Z" }), { tipo: "editada", fecha: "2026-09-30T10:00:00.000Z" });
  assert.deepEqual(
    cambioDelMensaje({ editedAt: "2026-09-30T10:00:00.000Z", retractedAt: "2026-09-30T11:00:00.000Z" }),
    { tipo: "retirada", fecha: "2026-09-30T11:00:00.000Z", texto: "Respuesta retirada por soporte" },
  );
  assert.equal(cambioDelMensaje({ retractedAt: "2026-09-30T11:00:00.000Z", internalNote: true })!.tipo, "retirada");
});

// ── Candados del cableado (la regla no sirve si las pantallas no la usan) ────
import { readFileSync } from "node:fs";
import { join } from "node:path";

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

test("la clínica ve «(editado · fecha)» y «Respuesta retirada por soporte» en sus dos pantallas de ticket", () => {
  for (const ruta of ["src/components/dashboard/soporte-rediseno/ticket.tsx", "src/app/dashboard/soporte/[id]/ticket-client.tsx"]) {
    const src = leer(ruta);
    assert.match(src, /cambioDelMensaje\(msg\)/, ruta);
    assert.match(src, /\(editado · /, ruta);
    assert.match(src, /cambio\.texto/, ruta);
  }
});

test("soporte ve sus acciones solo en mensajes de soporte y llama a PATCH/DELETE del mensaje", () => {
  const cliente = leer("src/app/admin/soporte/[id]/ticket-admin-client.tsx");
  assert.match(cliente, /isSupport \?\s*\(\s*<CuerpoDeRespuesta/);
  const acciones = leer("src/app/admin/soporte/[id]/acciones-mensaje.tsx");
  assert.match(acciones, /method: "PATCH"/);
  assert.match(acciones, /method: "DELETE"/);
  assert.match(acciones, /messages\/\$\{message\.id\}/);
  // nunca importa nada que llegue a Prisma (rompe el build de un componente de cliente)
  assert.doesNotMatch(acciones, /@\/lib\/prisma|support\/service/);
});

test("el SQL crea SOLO la tabla nueva, con RLS, y no toca support_messages", () => {
  const sql = leer("sql/soporte-mensajes-edicion.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "support_message_revisions"/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /ALTER TABLE "support_messages"/);
  assert.doesNotMatch(sql, /DROP |DELETE FROM|TRUNCATE/i);
});
