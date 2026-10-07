import test from "node:test";
import assert from "node:assert/strict";
import {
  agruparActividad, etiquetaActor, masReciente, ultimoAccesoPorClinica, ultimoAccesoPorUsuario,
} from "../ultimo-acceso";

test("último acceso: sesión de panel aunque lastLogin esté vacío", () => {
  const r = ultimoAccesoPorUsuario(
    [{ id: "a", lastLogin: null }, { id: "b", lastLogin: null }],
    [
      { userId: "a", lastSeenAt: "2026-10-05T10:00:00Z" },
      { userId: "a", lastSeenAt: "2026-10-06T10:00:00Z" },
      { userId: null, lastSeenAt: "2026-10-07T10:00:00Z" },
    ],
  );
  assert.equal(r[0].id, "a");
  assert.equal(r[0].ultimoAcceso, "2026-10-06T10:00:00.000Z");
  assert.equal(r[1].ultimoAcceso, null);
});

test("último acceso: gana la más reciente entre sesión y lastLogin", () => {
  const r = ultimoAccesoPorUsuario(
    [{ id: "a", lastLogin: new Date("2026-10-07T00:00:00Z") }],
    [{ userId: "a", lastSeenAt: "2026-10-01T00:00:00Z" }],
  );
  assert.equal(r[0].ultimoAcceso, "2026-10-07T00:00:00.000Z");
  assert.equal(masReciente(null, undefined, "basura"), null);
});

test("barra sin nombre: cada actor sin usuario lleva etiqueta", () => {
  assert.equal(etiquetaActor({ userId: null, actorType: "bot" }).etiqueta, "Bot de WhatsApp");
  assert.equal(etiquetaActor({ userId: null, actorType: "patient" }).etiqueta, "Paciente (portal)");
  assert.equal(etiquetaActor({ userId: null, actorType: "public" }).etiqueta, "Reserva web pública");
  assert.equal(etiquetaActor({ userId: null, actorType: "staff" }).etiqueta, "Sistema");
  assert.equal(etiquetaActor({ userId: null }).etiqueta, "Sistema");
  assert.equal(etiquetaActor({ userId: "x", actorType: "admin" }).etiqueta, "Soporte DaleControl");
  assert.equal(etiquetaActor({ userId: "x", usuario: null }).etiqueta, "Usuario eliminado");
  assert.equal(etiquetaActor({ userId: "x", usuario: { firstName: "", lastName: "", email: "a@b.mx" } }).etiqueta, "a@b.mx");
});

test("agrupar: junta eliminados y no deja ninguna fila sin etiqueta", () => {
  const r = agruparActividad(
    [
      { userId: null, actorType: null, count: 17 },
      { userId: "u1", actorType: "staff", count: 1220 },
      { userId: "g1", actorType: "staff", count: 2 },
      { userId: "g2", actorType: "staff", count: 3 },
    ],
    { u1: { firstName: "Johnnifer", lastName: "R" } },
  );
  assert.deepEqual(r.map((x) => [x.etiqueta, x.count]), [
    ["Johnnifer R", 1220], ["Sistema", 17], ["Usuario eliminado", 5],
  ]);
  assert.ok(r.every((x) => x.etiqueta.trim().length > 0));
});

test("por clínica: lee solo surface dashboard y tolera que falle la tabla", async () => {
  let visto: any;
  const ok = await ultimoAccesoPorClinica({
    analyticsSession: { groupBy: async (a: any) => { visto = a; return [{ clinicId: "c1", _max: { lastSeenAt: new Date("2026-10-06T00:00:00Z") } }]; } },
  }, ["c1", "c2"]);
  assert.equal(visto.where.surface, "dashboard");
  assert.equal(ok.get("c1")?.toISOString(), "2026-10-06T00:00:00.000Z");
  const roto = await ultimoAccesoPorClinica({ analyticsSession: { groupBy: async () => { throw new Error("42P01"); } } }, ["c1"]);
  assert.equal(roto.size, 0);
});
