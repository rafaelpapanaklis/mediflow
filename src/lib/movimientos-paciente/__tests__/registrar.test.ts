/**
 * Movimientos del paciente — la ESCRITURA.
 *
 * Lo que tiene que ser verdad:
 *  1. `registrarMovimientoDelPaciente` deja una fila con `patientId` (columna) y
 *     la frase en `changes._mov`;
 *  2. sin la columna (sin correr el SQL) la fila se guarda igual por el camino de
 *     siempre, con el paciente dentro de `changes._mov.after.patientId`, y no se
 *     vuelve a probar la columna a cada escritura;
 *  3. un fallo del registro NO rompe la acción principal: no tira;
 *  4. sin clínica, usuario o paciente no se escribe nada (regla dura (c));
 *  5. `logAudit` / `logMutation` deducen el paciente y aceptan `texto`;
 *  6. los helpers de módulo (ortodoncia, etc.) pasan por el mismo lugar.
 *
 * Corre con: npm run test:movimientos-paciente
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type Creada = { data: Record<string, any>; select?: unknown };
let creadas: Creada[] = [];
let crudas: Array<{ sql: string; values: unknown[] }> = [];
let modoCrudo: "ok" | "sin-columna" | "falla" | "usuario-no-nulo" = "ok";
let modoCreate: "ok" | "falla" | "usuario-no-nulo" = "ok";

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auditLog: {
        create: (args: Creada) => {
          if (modoCreate === "falla") return Promise.reject(new Error("pooler saturado"));
          if (modoCreate === "usuario-no-nulo" && (args.data.userId ?? null) === null) {
            return Promise.reject(Object.assign(new Error("Null constraint violation on the fields: (`userId`)"), { code: "P2011" }));
          }
          creadas.push(args);
          return Promise.resolve({ id: "log_1" });
        },
      },
      $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (modoCrudo === "sin-columna") {
          return Promise.reject(
            Object.assign(new Error('Raw query failed. Code: `42703`. Message: `column "patientId" of relation "audit_logs" does not exist`'), {
              code: "P2010",
              meta: { code: "42703", message: 'column "patientId" of relation "audit_logs" does not exist' },
            }),
          );
        }
        if (modoCrudo === "falla") return Promise.reject(new Error("connection terminated"));
        if (modoCrudo === "usuario-no-nulo" && values[2] === null) {
          return Promise.reject(
            Object.assign(new Error('null value in column "userId" of relation "audit_logs" violates not-null constraint'), {
              code: "P2010",
              meta: { code: "23502", message: 'null value in column "userId" of relation "audit_logs" violates not-null constraint' },
            }),
          );
        }
        crudas.push({ sql: strings.join("?"), values });
        return Promise.resolve(1);
      },
    },
  },
});
mock.module("@/lib/pediatrics/audit", { namedExports: { PEDIATRIC_AUDIT_ACTIONS: [] } });

const BASE = {
  clinicId: "cli_1",
  userId: "usr_1",
  patientId: "pat_1",
  entityType: "appointment" as const,
  entityId: "apt_1",
  action: "create" as const,
};

async function cargar() {
  const fila = await import("../fila");
  fila._reiniciarEstadoDeUsuarioNulo();
  const registrar = await import("../registrar");
  const audit = await import("@/lib/audit");
  return { fila, registrar, audit };
}

describe("registrarMovimientoDelPaciente", () => {
  beforeEach(async () => {
    creadas = [];
    crudas = [];
    modoCrudo = "ok";
    modoCreate = "ok";
    const { fila } = await cargar();
    fila._reiniciarEstadoDeColumna();
  });

  it("con la columna: una fila con patientId y la frase, por SQL crudo", async () => {
    const { registrar } = await cargar();
    await registrar.registrarMovimientoDelPaciente({ ...BASE, texto: "Agendó una cita para el 3 oct 2026 10:00" });

    assert.equal(crudas.length, 1);
    assert.equal(creadas.length, 0, "no se duplica por Prisma");
    const { sql, values } = crudas[0];
    assert.match(sql, /INSERT INTO "audit_logs"/);
    assert.match(sql, /"patientId"/);
    assert.ok(values.includes("pat_1"));
    assert.ok(values.includes("cli_1"));
    assert.ok(values.includes("usr_1"));
    const cambios = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("{")) as string);
    assert.equal(cambios._mov.after.texto, "Agendó una cita para el 3 oct 2026 10:00");
  });

  it("sin la columna: la fila se guarda igual por Prisma, con el paciente dentro de _mov", async () => {
    modoCrudo = "sin-columna";
    const { registrar } = await cargar();
    await registrar.registrarMovimientoDelPaciente({ ...BASE, texto: "Agendó una cita" });

    assert.equal(creadas.length, 1);
    const d = creadas[0].data;
    assert.equal(d.clinicId, "cli_1");
    assert.equal(d.entityType, "appointment");
    assert.equal(d.changes._mov.after.patientId, "pat_1");
    assert.equal(d.changes._mov.after.texto, "Agendó una cita");
    // Solo el id de vuelta: el día que la columna entre al modelo, el RETURNING no la pide.
    assert.deepEqual(creadas[0].select, { id: true });
  });

  it("sin la columna se recuerda un rato: la siguiente escritura no vuelve a probar el SQL crudo", async () => {
    modoCrudo = "sin-columna";
    const { registrar } = await cargar();
    await registrar.registrarMovimientoDelPaciente({ ...BASE });
    modoCrudo = "ok"; // aunque ya funcionara, mientras dure el recuerdo no se intenta
    await registrar.registrarMovimientoDelPaciente({ ...BASE, entityId: "apt_2" });
    assert.equal(crudas.length, 0);
    assert.equal(creadas.length, 2);
  });

  it("pasado el recuerdo, vuelve a probar la columna (por si Rafael ya corrió el SQL)", async () => {
    modoCrudo = "sin-columna";
    const { registrar, fila } = await cargar();
    await registrar.registrarMovimientoDelPaciente({ ...BASE });
    assert.equal(fila.columnaProbablementeAusente(Date.now() + fila.REINTENTO_COLUMNA_MS - 1), true);
    assert.equal(fila.columnaProbablementeAusente(Date.now() + fila.REINTENTO_COLUMNA_MS + 1), false);
  });

  it("un fallo del registro NO rompe la acción: no tira", async () => {
    modoCrudo = "falla";
    modoCreate = "falla";
    const { registrar } = await cargar();
    const errores = mock.method(console, "error", () => {});
    try {
      await assert.doesNotReject(registrar.registrarMovimientoDelPaciente({ ...BASE, texto: "x" }));
      assert.ok(errores.mock.callCount() >= 1, "el error se anota");
    } finally {
      errores.mock.restore();
    }
  });

  it("un error de la base que NO es la columna ausente no se confunde con ella", async () => {
    modoCrudo = "falla";
    const { registrar, fila } = await cargar();
    const errores = mock.method(console, "error", () => {});
    try {
      await registrar.registrarMovimientoDelPaciente({ ...BASE });
    } finally {
      errores.mock.restore();
    }
    assert.equal(fila.columnaProbablementeAusente(), false);
    assert.equal(creadas.length, 0);
  });

  it("sin clínica, usuario, paciente o entidad NO se escribe nada (regla (c))", async () => {
    const { registrar } = await cargar();
    for (const roto of [
      { clinicId: "" },
      { clinicId: undefined as unknown as string },
      { userId: "" },
      { patientId: "" },
      { patientId: undefined as unknown as string },
      { entityId: "" },
    ]) {
      await registrar.registrarMovimientoDelPaciente({ ...BASE, ...roto });
    }
    assert.equal(crudas.length + creadas.length, 0);
  });

  it("los campos se guardan como nombres, sin los `_algo` internos", async () => {
    const { registrar } = await cargar();
    await registrar.registrarMovimientoDelPaciente({ ...BASE, action: "update", campos: ["phone", "_interno", "email"] });
    const cambios = JSON.parse(crudas[0].values.find((v) => typeof v === "string" && v.startsWith("{")) as string);
    assert.deepEqual(cambios._mov.after.campos, ["phone", "email"]);
  });

  it("el diff crudo (`cambios`) se conserva junto a la frase, para el rastro legal", async () => {
    const { registrar } = await cargar();
    await registrar.registrarMovimientoDelPaciente({
      ...BASE,
      action: "update",
      texto: "Cambió la cita",
      cambios: { status: { before: "SCHEDULED", after: "CONFIRMED" } },
    });
    const cambios = JSON.parse(crudas[0].values.find((v) => typeof v === "string" && v.startsWith("{")) as string);
    assert.deepEqual(cambios.status, { before: "SCHEDULED", after: "CONFIRMED" });
    assert.equal(cambios._mov.after.texto, "Cambió la cita");
  });
});

describe("logAudit / logMutation", () => {
  beforeEach(async () => {
    creadas = [];
    crudas = [];
    modoCrudo = "ok";
    modoCreate = "ok";
    (await cargar()).fila._reiniciarEstadoDeColumna();
  });

  it("una fila del propio paciente se atribuye a él sin que nadie lo diga", async () => {
    const { audit } = await cargar();
    await audit.logAudit({ clinicId: "cli_1", userId: "usr_1", entityType: "patient", entityId: "pat_7", action: "update" });
    assert.equal(crudas.length, 1);
    assert.ok(crudas[0].values.includes("pat_7"));
  });

  it("logMutation deduce el paciente de `after.patientId` y lleva la frase", async () => {
    const { audit } = await cargar();
    await audit.logMutation({
      req: { headers: new Headers({ "user-agent": "UA", "x-forwarded-for": "1.2.3.4" }) } as any,
      clinicId: "cli_1",
      userId: "usr_1",
      entityType: "appointment",
      entityId: "apt_9",
      action: "create",
      after: { patientId: "pat_8", status: "SCHEDULED" },
      texto: "Agendó una cita",
    });
    assert.equal(crudas.length, 1);
    assert.ok(crudas[0].values.includes("pat_8"));
    assert.ok(crudas[0].values.includes("1.2.3.4"));
    const cambios = JSON.parse(crudas[0].values.find((v) => typeof v === "string" && v.startsWith("{")) as string);
    assert.equal(cambios._mov.after.texto, "Agendó una cita");
    assert.equal(cambios._created.after.patientId, "pat_8");
  });

  it("una fila sin paciente conocido sigue por el camino de siempre (Prisma), sin tocar SQL crudo", async () => {
    const { audit } = await cargar();
    await audit.logAudit({ clinicId: "cli_1", userId: "usr_1", entityType: "clinic", entityId: "cli_1", action: "update" });
    assert.equal(crudas.length, 0);
    assert.equal(creadas.length, 1);
    assert.equal(creadas[0].data.entityType, "clinic");
  });

  it("si el registro falla, logAudit no tira", async () => {
    modoCreate = "falla";
    const { audit } = await cargar();
    const errores = mock.method(console, "error", () => {});
    try {
      await assert.doesNotReject(
        audit.logAudit({ clinicId: "cli_1", userId: "usr_1", entityType: "clinic", entityId: "cli_1", action: "update" }),
      );
    } finally {
      errores.mock.restore();
    }
  });

  it("un update sin cambios reales no deja fila (como antes)", async () => {
    const { audit } = await cargar();
    await audit.logMutation({
      req: { headers: new Headers() } as any,
      clinicId: "cli_1",
      userId: "usr_1",
      entityType: "patient",
      entityId: "pat_1",
      action: "update",
      before: { phone: "1" },
      after: { phone: "1" },
    });
    assert.equal(crudas.length + creadas.length, 0);
  });
});

describe("helpers de módulo", () => {
  beforeEach(async () => {
    creadas = [];
    crudas = [];
    modoCrudo = "ok";
    (await cargar()).fila._reiniciarEstadoDeColumna();
  });

  it("anotarFilaDeModulo: patientId explícito manda; si falta, se busca en el cambio", async () => {
    const { anotarFilaDeModulo } = await import("../modulos");
    await anotarFilaDeModulo({ clinicId: "c", userId: "u", entityType: "OrthoPhotoSet", entityId: "s1", action: "ortho.photoSet.created", changes: null, patientId: "pat_x" });
    await anotarFilaDeModulo({
      clinicId: "c", userId: "u", entityType: "OrthodonticDiagnosis", entityId: "d1", action: "ortho.diagnosis.created",
      changes: { _created: { before: null, after: { patientId: "pat_y" } } },
    });
    await anotarFilaDeModulo({ clinicId: "c", userId: "u", entityType: "OrthodonticsClinicSettings", entityId: "k", action: "ortho.clinicSettings.updated", changes: null });
    assert.ok(crudas[0].values.includes("pat_x"));
    assert.ok(crudas[1].values.includes("pat_y"));
    assert.equal(crudas.length, 2, "sin paciente no usa la columna");
    assert.equal(creadas.length, 1);
  });
});

describe("registrarMovimientoExterno (paciente, reserva web, bot)", () => {
  const EXT = {
    actor: "patient" as const,
    clinicId: "cli_1",
    patientId: "pat_1",
    entityType: "appointment" as const,
    entityId: "apt_1",
    action: "update" as const,
    texto: "Pidió cancelar su cita",
  };
  beforeEach(async () => {
    creadas = [];
    crudas = [];
    modoCrudo = "ok";
    modoCreate = "ok";
    const { fila } = await cargar();
    fila._reiniciarEstadoDeColumna();
    fila._reiniciarEstadoDeUsuarioNulo();
  });

  it("escribe la fila con userId NULL, el actor y el paciente", async () => {
    const { registrar } = await cargar();
    await registrar.registrarMovimientoExterno(EXT);
    assert.equal(crudas.length, 1);
    const v = crudas[0].values;
    assert.equal(v[2], null, "userId NULL");
    assert.ok(v.includes("patient"), "actorType");
    assert.ok(v.includes("pat_1") && v.includes("cli_1"));
    const cambios = JSON.parse(v.find((x) => typeof x === "string" && x.startsWith("{")) as string);
    assert.equal(cambios._mov.after.texto, "Pidió cancelar su cita");
  });

  it("puede precisar el origen que se ve en pantalla", async () => {
    const { registrar } = await cargar();
    await registrar.registrarMovimientoExterno({ ...EXT, origen: "El paciente (firma en línea)" });
    const cambios = JSON.parse(crudas[0].values.find((x) => typeof x === "string" && x.startsWith("{")) as string);
    assert.equal(cambios._mov.after.actor, "El paciente (firma en línea)");
  });

  it("SIN el SQL (userId sigue NOT NULL): no escribe, no falla, y deja de intentar un rato", async () => {
    modoCrudo = "usuario-no-nulo";
    modoCreate = "usuario-no-nulo";
    const { registrar, fila } = await cargar();
    const avisos = mock.method(console, "warn", () => {});
    try {
      await assert.doesNotReject(registrar.registrarMovimientoExterno(EXT));
      assert.equal(crudas.length + creadas.length, 0, "no quedó ninguna fila");
      assert.equal(fila.usuarioNuloProbablementeNoPermitido(), true);
      assert.equal(avisos.mock.callCount(), 1, "un solo aviso");
      // la siguiente ni siquiera toca la base
      modoCrudo = "ok";
      await registrar.registrarMovimientoExterno({ ...EXT, entityId: "apt_2" });
      assert.equal(crudas.length + creadas.length, 0);
      assert.equal(avisos.mock.callCount(), 1);
    } finally {
      avisos.mock.restore();
    }
  });

  it("pasado el plazo vuelve a intentar (por si Rafael ya corrió el SQL)", async () => {
    const { fila } = await cargar();
    modoCrudo = "usuario-no-nulo";
    modoCreate = "usuario-no-nulo";
    const { registrar } = await cargar();
    const avisos = mock.method(console, "warn", () => {});
    try {
      await registrar.registrarMovimientoExterno(EXT);
    } finally {
      avisos.mock.restore();
    }
    assert.equal(fila.usuarioNuloProbablementeNoPermitido(Date.now() + fila.REINTENTO_USUARIO_NULO_MS - 1), true);
    assert.equal(fila.usuarioNuloProbablementeNoPermitido(Date.now() + fila.REINTENTO_USUARIO_NULO_MS + 1), false);
  });

  it("solo con la columna patientId sin el SQL de userId cae a Prisma y tampoco falla", async () => {
    modoCrudo = "sin-columna";
    modoCreate = "usuario-no-nulo";
    const { registrar } = await cargar();
    const avisos = mock.method(console, "warn", () => {});
    try {
      await assert.doesNotReject(registrar.registrarMovimientoExterno(EXT));
    } finally {
      avisos.mock.restore();
    }
    assert.equal(creadas.length, 0);
  });

  it("con los dos SQL pero sin patientId: Prisma con userId null y el paciente en _mov", async () => {
    modoCrudo = "sin-columna";
    const { registrar } = await cargar();
    await registrar.registrarMovimientoExterno({ ...EXT, actor: "bot" });
    assert.equal(creadas.length, 1);
    assert.equal(creadas[0].data.userId, null);
    assert.equal(creadas[0].data.actorType, "bot");
    assert.equal(creadas[0].data.changes._mov.after.patientId, "pat_1");
  });

  it("un error de la base que no es del userId no se traga en silencio, pero tampoco tira", async () => {
    modoCrudo = "falla";
    modoCreate = "falla";
    const { registrar, fila } = await cargar();
    const errores = mock.method(console, "error", () => {});
    try {
      await assert.doesNotReject(registrar.registrarMovimientoExterno(EXT));
      assert.ok(errores.mock.callCount() >= 1);
    } finally {
      errores.mock.restore();
    }
    assert.equal(fila.usuarioNuloProbablementeNoPermitido(), false);
  });

  it("sin clínica, paciente o entidad no escribe nada (regla (c))", async () => {
    const { registrar } = await cargar();
    for (const roto of [{ clinicId: "" }, { patientId: "" }, { entityId: "" }, { clinicId: undefined as unknown as string }]) {
      await registrar.registrarMovimientoExterno({ ...EXT, ...roto });
    }
    assert.equal(crudas.length + creadas.length, 0);
  });
});
