// Clinical-shared — tests del shape de linkSessionToPlan args/result.
// El helper hace queries a Prisma; aquí solo testeamos el contrato de
// tipos públicos para que el módulo cliente sepa qué args/result esperar.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  LinkSessionArgs,
  LinkSessionResult,
} from "../link";

describe("LinkSessionArgs / LinkSessionResult contract", () => {
  it("acepta un args con todos los campos requeridos", () => {
    const args: LinkSessionArgs = {
      clinicId: "c1",
      module: "pediatrics",
      moduleEntityType: "ped-sealant",
      moduleSessionId: "s1",
      treatmentSessionId: "ts1",
      linkedBy: "u1",
      notes: null,
    };
    assert.equal(args.module, "pediatrics");
    assert.equal(args.moduleEntityType, "ped-sealant");
  });

  it("permite armar un result coherente", () => {
    const r: LinkSessionResult = {
      linkId: "l1",
      treatmentSessionId: "ts1",
      alreadyLinked: false,
    };
    assert.equal(r.alreadyLinked, false);
  });
});
