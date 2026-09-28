// ws1-t5 — la zona de la clínica para las reglas de Inventario por día de
// calendario. Correr: npm run test:inventario-arreglos

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { zonaDeClinica } from "../zona-clinica.server";

const doble = (fila: unknown, registro: unknown[] = []) => ({
  clinic: {
    findUnique: async (args: unknown) => { registro.push(args); return fila; },
  },
}) as any;

describe("zonaDeClinica", () => {
  it("devuelve la zona de ESA clínica, y solo pide ese campo", async () => {
    const pedidos: unknown[] = [];
    assert.equal(await zonaDeClinica("clinica-1", doble({ timezone: "America/Tijuana" }, pedidos)), "America/Tijuana");
    assert.deepEqual(pedidos, [{ where: { id: "clinica-1" }, select: { timezone: true } }]);
  });

  it("sin clinicId NO consulta nada (un `where: { id: undefined }` no filtra)", async () => {
    const pedidos: unknown[] = [];
    assert.equal(await zonaDeClinica(undefined, doble({ timezone: "America/Tijuana" }, pedidos)), "America/Mexico_City");
    assert.equal(await zonaDeClinica("", doble({ timezone: "America/Tijuana" }, pedidos)), "America/Mexico_City");
    assert.equal(await zonaDeClinica(null, doble({ timezone: "America/Tijuana" }, pedidos)), "America/Mexico_City");
    assert.equal(pedidos.length, 0);
  });

  it("clínica sin zona, con zona vacía o que no existe: la de por defecto", async () => {
    assert.equal(await zonaDeClinica("c", doble({ timezone: null })), "America/Mexico_City");
    assert.equal(await zonaDeClinica("c", doble({ timezone: "  " })), "America/Mexico_City");
    assert.equal(await zonaDeClinica("c", doble(null)), "America/Mexico_City");
  });

  it("si la base no contesta (o el doble no tiene clínicas), la de por defecto y no revienta", async () => {
    const silencio = console.error;
    console.error = () => {};
    try {
      const rota = { clinic: { findUnique: async () => { throw new Error("timeout del pooler"); } } } as any;
      assert.equal(await zonaDeClinica("c", rota), "America/Mexico_City");
      assert.equal(await zonaDeClinica("c", {} as any), "America/Mexico_City");
    } finally {
      console.error = silencio;
    }
  });
});
