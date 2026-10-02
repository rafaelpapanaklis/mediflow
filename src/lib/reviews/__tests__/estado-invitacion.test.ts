// ws1-t4 (11.4) — la reseña refleja la entrega REAL, no «la API la aceptó».
// Correr: npm run test:resenas-entrega
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estadoDeInvitacion } from "../estado-invitacion";
import { marcaDeWamid, wamidDeCanales } from "../types";

describe("estadoDeInvitacion", () => {
  it("WhatsApp aceptado y Meta lo rechazó (131026): «fallo» con motivo «undeliverable»", () => {
    const r = estadoDeInvitacion({
      canales: ["whatsapp", marcaDeWamid("wamid.X")],
      entrega: { deliveryStatus: "FAILED", errorCode: 131026 },
    });
    assert.deepEqual(r, { estado: "fallo", motivo: "undeliverable", porCorreo: false });
  });
  it("fallo con código desconocido: motivo genérico", () => {
    const r = estadoDeInvitacion({ canales: ["whatsapp"], entrega: { deliveryStatus: "FAILED", errorCode: 99999 } });
    assert.equal(r.estado, "fallo");
    assert.equal(r.motivo, "generic");
  });
  it("falló WhatsApp pero salió por correo: sigue siendo fallo de WhatsApp y lo dice", () => {
    const r = estadoDeInvitacion({ canales: ["whatsapp", "email"], entrega: { deliveryStatus: "FAILED", errorCode: 131026 } });
    assert.equal(r.estado, "fallo");
    assert.equal(r.porCorreo, true);
  });
  it("entregada / vista / aún sin reporte", () => {
    assert.equal(estadoDeInvitacion({ canales: ["whatsapp"], entrega: { deliveryStatus: "DELIVERED", errorCode: null } }).estado, "entregada");
    assert.equal(estadoDeInvitacion({ canales: ["whatsapp"], entrega: { deliveryStatus: "READ", errorCode: null } }).estado, "vista");
    assert.equal(estadoDeInvitacion({ canales: ["whatsapp"], entrega: { deliveryStatus: null, errorCode: null } }).estado, "enviada");
    assert.equal(estadoDeInvitacion({ canales: ["whatsapp"], entrega: null }).estado, "enviada");
  });
  it("ningún canal la aceptó: «sin_enviar»", () => {
    assert.equal(estadoDeInvitacion({ canales: [], entrega: null }).estado, "sin_enviar");
    assert.equal(estadoDeInvitacion({ canales: undefined, entrega: null }).estado, "sin_enviar");
  });
  it("solo correo: enviada, aunque haya un fallo ajeno", () => {
    const r = estadoDeInvitacion({ canales: ["email"], entrega: { deliveryStatus: "FAILED", errorCode: 131026 } });
    assert.equal(r.estado, "enviada");
  });
});

describe("marca del wamid en invitedChannels", () => {
  it("ida y vuelta, y los canales de siempre no se confunden con ella", () => {
    const canales = ["whatsapp", marcaDeWamid("wamid.ABC=="), "email"];
    assert.equal(wamidDeCanales(canales), "wamid.ABC==");
    assert.equal(wamidDeCanales(["whatsapp", "email"]), null);
    assert.equal(wamidDeCanales(null), null);
  });
});
