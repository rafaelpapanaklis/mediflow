/**
 * El rediseño es el panel POR DEFECTO, y las dos formas de apagarlo.
 *
 * Run: npm run test:rediseno-por-defecto
 *
 * Esto es lo más arriesgado del rediseño: desde este cambio, TODA clínica que
 * paga ve el panel nuevo mañana por la mañana. Lo que de verdad hace falta no es
 * encenderlo, es poder apagarlo en segundos, y por eso lo que esta suite fija
 * son los cuatro casos de los que depende esa vuelta atrás:
 *
 *   1. SIN FILA        → encendido. La clínica que existe hoy y la que se dé de
 *                        alta mañana ven el rediseño sin que nadie toque nada.
 *   2. FILA true       → encendido. Las filas que YA existen (Altabrisa tiene
 *                        una) siguen queriendo decir lo mismo que decían: este
 *                        cambio no invierte ninguna.
 *   3. FILA false      → panel de siempre para ESA clínica y solo para ella, sin
 *                        desplegar nada. Es el apagador de la clínica que llama
 *                        quejándose.
 *   4. REDISENO_APAGADO → panel de siempre para TODAS, sin mirar la base. Es el
 *                        freno de emergencia: se pone en Vercel, se redespliega,
 *                        y en dos minutos todo el mundo vuelve atrás.
 *
 * Y los bordes que hacen que un apagado NO se quede a medias: que el freno
 * global se compruebe antes que la caché y que la base, que no envenene lo
 * guardado, y que un fallo de la base no apague ni encienda a nadie por su
 * cuenta (solo un `false` explícito apaga).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crearInterruptor,
  apagadoGlobalmente,
  ENV_APAGADO_GLOBAL,
  REDISENO_POR_DEFECTO,
} from "@/lib/menu-dos-niveles/interruptor-core";

/** Base de mentira: cuenta lo que se le pregunta y deja mover el reloj. */
function interruptorDePrueba(opts: {
  tabla?: boolean;
  fila?: (id: string) => Promise<{ enabled: boolean } | null>;
  apagadoGlobal?: () => boolean;
} = {}) {
  const cuenta = { tabla: 0, filas: [] as string[] };
  let reloj = 1_000_000;
  const encendido = crearInterruptor({
    tablaExiste: async () => {
      cuenta.tabla++;
      return opts.tabla ?? true;
    },
    leer: async (id) => {
      cuenta.filas.push(id);
      return opts.fila ? opts.fila(id) : null;
    },
    ahora: () => reloj,
    ttlMs: 60_000,
    ...(opts.apagadoGlobal ? { apagadoGlobal: opts.apagadoGlobal } : {}),
  });
  return { encendido, cuenta, avanzar: (ms: number) => { reloj += ms; } };
}

/** Corre `fn` con la variable de entorno puesta a `valor`, y la deja como estaba. */
async function conEntorno(valor: string | undefined, fn: () => Promise<void>) {
  const antes = process.env[ENV_APAGADO_GLOBAL];
  if (valor === undefined) delete process.env[ENV_APAGADO_GLOBAL];
  else process.env[ENV_APAGADO_GLOBAL] = valor;
  try {
    await fn();
  } finally {
    if (antes === undefined) delete process.env[ENV_APAGADO_GLOBAL];
    else process.env[ENV_APAGADO_GLOBAL] = antes;
  }
}

async function sinAvisos<T>(fn: (avisos: unknown[]) => Promise<T>): Promise<T> {
  const avisos: unknown[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => { avisos.push(a); };
  try { return await fn(avisos); } finally { console.warn = warn; }
}

// ── 1 · SIN FILA → encendido ─────────────────────────────────────────

test("sin fila: una clínica que nunca se tocó ve el rediseño", async () => {
  const { encendido, cuenta } = interruptorDePrueba({ fila: async () => null });
  assert.equal(await encendido("clinica-cualquiera"), true);
  assert.deepEqual(cuenta.filas, ["clinica-cualquiera"], "sí se pregunta por su fila");
});

test("sin fila: una clínica NUEVA lo ve sin que nadie escriba en la base", async () => {
  const { encendido } = interruptorDePrueba({ fila: async () => null });
  for (const nueva of ["clinica-alta-de-hoy", "clinica-alta-de-manana", "sede-2"]) {
    assert.equal(await encendido(nueva), true, nueva);
  }
});

test("el valor por defecto es encendido, y está escrito en un solo sitio", () => {
  assert.equal(REDISENO_POR_DEFECTO, true);
});

// ── 2 · FILA true → encendido (las filas de hoy no se invierten) ─────

test("fila enabled=true: la fila que ya existe (Altabrisa) sigue significando encendido", async () => {
  const { encendido } = interruptorDePrueba({ fila: async () => ({ enabled: true }) });
  assert.equal(await encendido("clinica-altabrisa"), true);
});

// ── 3 · FILA false → apagado, y SOLO esa clínica ─────────────────────

test("fila enabled=false: esa clínica vuelve al panel de siempre", async () => {
  const { encendido } = interruptorDePrueba({ fila: async () => ({ enabled: false }) });
  assert.equal(await encendido("clinica-que-se-quejo"), false);
});

test("fila enabled=false: apaga esa clínica y NO toca a las demás", async () => {
  const { encendido } = interruptorDePrueba({
    fila: async (id) => (id === "clinica-que-se-quejo" ? { enabled: false } : null),
  });
  assert.equal(await encendido("clinica-que-se-quejo"), false);
  assert.equal(await encendido("otra-clinica"), true, "la de al lado sigue con el rediseño");
  assert.equal(await encendido("una-tercera"), true);
});

test("apagar una clínica se nota en menos de un minuto, sin desplegar", async () => {
  let fila: { enabled: boolean } | null = null;
  const { encendido, avanzar } = interruptorDePrueba({ fila: async () => fila });
  assert.equal(await encendido("clinica-que-se-quejo"), true);
  fila = { enabled: false }; // Rafael corre el UPDATE en Supabase
  avanzar(60_000);
  assert.equal(await encendido("clinica-que-se-quejo"), false);
});

// ── 4 · APAGADOR GLOBAL → todas, sin mirar la base ───────────────────

test("REDISENO_APAGADO: todas las clínicas vuelven al panel de siempre sin tocar la base", async () => {
  await conEntorno("1", async () => {
    const { encendido, cuenta } = interruptorDePrueba({ fila: async () => ({ enabled: true }) });
    for (const id of ["clinica-altabrisa", "otra-clinica", "sede-nueva"]) {
      assert.equal(await encendido(id), false, id);
    }
    assert.equal(cuenta.tabla, 0, "ni siquiera pregunta si la tabla existe");
    assert.deepEqual(cuenta.filas, [], "ninguna consulta: no depende de que la base conteste");
  });
});

test("REDISENO_APAGADO manda sobre la caché: apaga una clínica que ya se sabía encendida", async () => {
  const { encendido } = interruptorDePrueba({ fila: async () => ({ enabled: true }) });
  assert.equal(await encendido("clinica-altabrisa"), true);
  await conEntorno("1", async () => {
    assert.equal(await encendido("clinica-altabrisa"), false, "el freno se comprueba ANTES que la caché");
  });
});

test("quitar REDISENO_APAGADO devuelve a cada clínica a donde estaba (no envenena la caché)", async () => {
  const { encendido } = interruptorDePrueba({
    fila: async (id) => (id === "apagada" ? { enabled: false } : null),
  });
  assert.equal(await encendido("encendida"), true);
  assert.equal(await encendido("apagada"), false);
  await conEntorno("1", async () => {
    assert.equal(await encendido("encendida"), false);
    assert.equal(await encendido("apagada"), false);
  });
  assert.equal(await encendido("encendida"), true, "vuelve el rediseño");
  assert.equal(await encendido("apagada"), false, "y la que estaba apagada sigue apagada");
});

test("el freno se lee en cada llamada, no al cargar el módulo", async () => {
  const { encendido } = interruptorDePrueba({ fila: async () => null });
  assert.equal(await encendido("c1"), true);
  await conEntorno("1", async () => { assert.equal(await encendido("c1"), false); });
  assert.equal(await encendido("c1"), true);
});

test("apagadoGlobalmente: cualquier valor apaga menos los que dicen que no", () => {
  for (const v of ["1", "true", "si", "sí", "yes", "on", "x", " 1 ", "TRUE"]) {
    assert.equal(apagadoGlobalmente({ [ENV_APAGADO_GLOBAL]: v }), true, `«${v}» tiene que apagar`);
  }
  for (const v of ["", "0", "false", "no", "off", " FALSE "]) {
    assert.equal(apagadoGlobalmente({ [ENV_APAGADO_GLOBAL]: v }), false, `«${v}» no apaga`);
  }
  assert.equal(apagadoGlobalmente({}), false, "sin la variable, el rediseño");
});

// ── Bordes: nada apaga solo ──────────────────────────────────────────

test("sin la tabla (SQL sin aplicar): rediseño, y sin leer ninguna fila", async () => {
  const { encendido, cuenta } = interruptorDePrueba({ tabla: false });
  await sinAvisos(async (avisos) => {
    for (let i = 0; i < 3; i++) assert.equal(await encendido(`c${i}`), true, `c${i}`);
    assert.deepEqual(cuenta.filas, [], "sin tabla no se consulta (Prisma no ensucia el log)");
    assert.equal(avisos.length, 0, "que falte la tabla no es un error: es lo normal");
  });
});

test("la base caída sin respuesta previa NO apaga a nadie: rediseño, y sin lanzar", async () => {
  await sinAvisos(async () => {
    const { encendido } = interruptorDePrueba({
      fila: async () => { throw Object.assign(new Error("x"), { code: "P1001" }); },
    });
    assert.equal(await encendido("clinica-cualquiera"), true);
  });
});

test("un fallo de la base NO reenciende una clínica que estaba apagada a propósito", async () => {
  await sinAvisos(async () => {
    let falla = false;
    const { encendido, avanzar } = interruptorDePrueba({
      fila: async () => {
        if (falla) throw Object.assign(new Error("pool"), { code: "P2024" });
        return { enabled: false };
      },
    });
    assert.equal(await encendido("clinica-que-se-quejo"), false);
    avanzar(60_000);
    falla = true;
    assert.equal(await encendido("clinica-que-se-quejo"), false, "se mantiene la última respuesta buena");
  });
});

test("sin clínica no se consulta nada (un clinicId undefined en Prisma no filtra)", async () => {
  const { encendido, cuenta } = interruptorDePrueba();
  for (const id of [undefined, null, "", "   "]) {
    assert.equal(await encendido(id), true, "nadie ha dicho que se apague");
  }
  assert.equal(cuenta.tabla, 0);
  assert.deepEqual(cuenta.filas, []);
});

// ── El camino viejo sigue entero ─────────────────────────────────────

test("el interruptor sigue pudiendo devolver false: el panel de siempre no se ha ido", async () => {
  const porFila = interruptorDePrueba({ fila: async () => ({ enabled: false }) });
  assert.equal(await porFila.encendido("c"), false);
  const porFreno = interruptorDePrueba({ fila: async () => null, apagadoGlobal: () => true });
  assert.equal(await porFreno.encendido("c"), false);
});
