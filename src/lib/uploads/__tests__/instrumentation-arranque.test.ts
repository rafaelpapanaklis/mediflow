/**
 * ws1-t12 (auditoría de integraciones, 1-oct-2026): si el bloqueo de cargadores
 * de sharp fallara al arrancar, register() NO lanza — Next 14 relanza cualquier
 * error de register() y la función entera (webhooks incluidos) daría 500.
 *
 * Run: npm run test:seguridad-rapidos
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

(mock as any).module("@/lib/uploads/sharp-bloqueos", {
  namedExports: {
    bloquearCargadoresDeSharp: () => {
      throw new Error("Could not load the \"sharp\" module using the linux-x64 runtime");
    },
  },
});

test("register(): si sharp falla al bloquear, el arranque sigue y queda en el log", async () => {
  const { register } = await import("@/instrumentation");
  const antes = process.env.NEXT_RUNTIME;
  const consoleError = console.error;
  const errores: string[] = [];
  console.error = (...a: unknown[]) => { errores.push(a.map(String).join(" ")); };
  try {
    process.env.NEXT_RUNTIME = "nodejs";
    await assert.doesNotReject(register());
  } finally {
    console.error = consoleError;
    if (antes === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = antes;
  }
  const propios = errores.filter((l) => l.startsWith("[instrumentation]"));
  assert.equal(propios.length, 1);
  assert.match(propios[0], /sharp/);
});
