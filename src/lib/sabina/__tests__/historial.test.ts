/**
 * El historial de Sabina no se mezcla con el del Asistente IA.
 *
 *   npm run test:sabina-historial
 *
 * Las dos viven en `ai_conversations`. Sin la marca `legacyId = "sabina:…"`, la
 * barra de Sabina listaba las conversaciones CLÍNICAS del Asistente IA, y
 * seguir preguntando en una le mandaba ese hilo al modelo como contexto.
 *
 * `prisma.aiConversation` es un doble que EVALÚA el where (id, clinicId,
 * userId y `legacyId.startsWith`), así que olvidar la marca o el tenant hace
 * fallar la prueba por el motivo correcto. `getConversation`/`appendMessages`
 * del Asistente IA son registradores: aquí se prueba a quién se le deja llegar.
 */
import "../engine-sin-server-only";
import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

interface Fila {
  id: string;
  clinicId: string;
  userId: string;
  legacyId: string | null;
  title: string;
  groupKey: string;
  updatedAt: Date;
  messages?: unknown[];
}

const estado = {
  filas: [] as Fila[],
  llegaronAlAsistente: [] as Array<{ op: string; id: string; scope: unknown }>,
};

function cumple(fila: Fila, where: Record<string, any>): boolean {
  for (const [clave, valor] of Object.entries(where)) {
    if (valor && typeof valor === "object" && "startsWith" in valor) {
      if (typeof (fila as any)[clave] !== "string" || !(fila as any)[clave].startsWith(valor.startsWith)) return false;
    } else if ((fila as any)[clave] !== valor) {
      return false;
    }
  }
  return true;
}

let historial: typeof import("../engine-historial");

before(async () => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        aiConversation: {
          findFirst: async ({ where }: any) => estado.filas.find((f) => cumple(f, where)) ?? null,
          findMany: async ({ where }: any) =>
            estado.filas
              .filter((f) => cumple(f, where))
              .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
          create: async ({ data }: any) => {
            const fila: Fila = { ...data, id: `conv-${estado.filas.length + 1}`, updatedAt: new Date() };
            estado.filas.push(fila);
            return { id: fila.id };
          },
        },
      },
    },
  });
  mock.module("@/lib/ai-assistant/conversations", {
    namedExports: {
      getConversation: async (scope: unknown, id: string) => {
        estado.llegaronAlAsistente.push({ op: "get", id, scope });
        return { conversation: { id }, messages: [] };
      },
      appendMessages: async (scope: unknown, id: string) => {
        estado.llegaronAlAsistente.push({ op: "append", id, scope });
        return { id };
      },
    },
  });
  historial = await import("../engine-historial");
});

const YO = { clinicId: "cl-norte", userId: "u-rita" };

beforeEach(() => {
  estado.llegaronAlAsistente = [];
  estado.filas = [
    // Del Asistente IA: nacida en la base (legacyId null) y migrada de localStorage.
    { id: "asis-1", ...YO, legacyId: null, title: "Nota SOAP de Ana", groupKey: "clinico", updatedAt: new Date(3000) },
    { id: "asis-2", ...YO, legacyId: "1726000000000", title: "Receta", groupKey: "clinico", updatedAt: new Date(2000) },
    // De Sabina: la mía, la de un compañero y la de otra clínica.
    { id: "sab-1", ...YO, legacyId: "sabina:aaa", title: "¿Quién me debe?", groupKey: "admin", updatedAt: new Date(1000) },
    { id: "sab-otro", clinicId: "cl-norte", userId: "u-hugo", legacyId: "sabina:bbb", title: "De Hugo", groupKey: "admin", updatedAt: new Date(4000) },
    { id: "sab-sur", clinicId: "cl-sur", userId: "u-rita", legacyId: "sabina:ccc", title: "Del sur", groupKey: "admin", updatedAt: new Date(5000) },
  ];
});

test("la barra de Sabina lista SOLO las de Sabina de esta persona en esta clínica", async () => {
  const filas = await historial.listarConversacionesSabina(YO);
  assert.deepEqual(filas, [{ id: "sab-1", title: "¿Quién me debe?", updatedAt: 1000 }]);
});

test("abrir una conversación del Asistente IA desde Sabina da null y no la lee", async () => {
  assert.equal(await historial.leerConversacionSabina(YO, "asis-1"), null);
  assert.equal(await historial.leerConversacionSabina(YO, "asis-2"), null);
  assert.equal(await historial.leerConversacionSabina(YO, "sab-otro"), null);
  assert.equal(await historial.leerConversacionSabina(YO, "sab-sur"), null);
  assert.deepEqual(estado.llegaronAlAsistente, []);

  assert.ok(await historial.leerConversacionSabina(YO, "sab-1"));
  assert.deepEqual(estado.llegaronAlAsistente.map((l) => l.id), ["sab-1"]);
});

test("Sabina no anexa turnos a una conversación del Asistente IA", async () => {
  const turnos = [{ role: "user" as const, content: "hola" }];
  assert.equal(await historial.anexarTurnosSabina(YO, "asis-1", turnos), false);
  assert.equal(await historial.anexarTurnosSabina(YO, "sab-sur", turnos), false);
  assert.deepEqual(estado.llegaronAlAsistente, []);

  assert.equal(await historial.anexarTurnosSabina(YO, "sab-1", turnos), true);
});

test("una conversación nueva nace marcada, con el scope de la sesión y en una sola escritura", async () => {
  const id = await historial.crearConversacionSabina(YO, [
    { role: "user", content: "¿Cuántas citas tengo hoy?" },
    { role: "assistant", content: "Tienes 3." },
  ]);
  const fila = estado.filas.find((f) => f.id === id)!;
  assert.match(fila.legacyId ?? "", /^sabina:[0-9a-f-]{36}$/);
  assert.equal(fila.clinicId, "cl-norte");
  assert.equal(fila.userId, "u-rita");
  assert.equal(fila.title, "¿Cuántas citas tengo hoy?");
  assert.equal((fila.messages as any).create.length, 2);

  // Y aparece en la barra de Sabina.
  const ids = (await historial.listarConversacionesSabina(YO)).map((f) => f.id);
  assert.ok(ids.includes(id));
});

test("sin clinicId no se consulta", async () => {
  await assert.rejects(() => historial.listarConversacionesSabina({ clinicId: undefined as any, userId: "u-rita" }));
});
