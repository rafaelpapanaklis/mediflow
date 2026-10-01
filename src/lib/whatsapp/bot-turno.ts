// Un turno del bot a la vez por conversación (ws1-t3, auditoría del bot #11).
//
// Antes, dos mensajes seguidos del mismo paciente («hola» y «quiero cita» con
// un segundo de diferencia) entraban en dos webhooks paralelos: los dos leían
// el MISMO botState, los dos llamaban a Claude, salían dos respuestas y el
// estado que guardaba el último pisaba al del otro (el agendado a medias se
// perdía).
//
// Ahora el turno corre bajo un candado por hilo (Upstash si está; si no,
// memoria de la instancia — ver failban.acquireLock). El segundo webhook
// ESPERA a que el primero termine (hasta `esperaMaxMs`) y entonces corre con
// el estado ya guardado. Si no consigue el turno a tiempo, no contesta: el
// mensaje ya está en el Inbox para el equipo, que es mejor que dos respuestas.
//
// Dependencias inyectables: los tests lo conducen sin Redis ni relojes reales.

export interface DepsTurno {
  tomar(clave: string, ttlSec: number): Promise<boolean>;
  soltar(clave: string): Promise<void>;
  esperar(ms: number): Promise<void>;
  ahora(): number;
}

export interface OpcionesTurno {
  /** Cuánto espera el segundo webhook a que termine el primero. */
  esperaMaxMs?: number;
  /** Cada cuánto vuelve a intentar. */
  intervaloMs?: number;
  /**
   * Red de seguridad si el proceso muere con el candado tomado. Por encima de
   * lo que tarda un turno: Claude (12 s) + envío a Meta (15 s + reintento).
   */
  ttlSec?: number;
}

const POR_DEFECTO: Required<OpcionesTurno> = { esperaMaxMs: 20_000, intervaloMs: 300, ttlSec: 60 };

export function claveDelTurno(threadId: string): string {
  return `wa-bot-turno:${threadId}`;
}

const depsReales: DepsTurno = {
  tomar: async (clave, ttlSec) => {
    const { acquireLock } = await import("@/lib/failban");
    return acquireLock(clave, ttlSec);
  },
  soltar: async (clave) => {
    const { releaseLock } = await import("@/lib/failban");
    await releaseLock(clave);
  },
  esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
  ahora: () => Date.now(),
};

export type ResultadoTurno<T> = { corrio: true; valor: T } | { corrio: false };

/**
 * Corre `fn` con el turno del hilo tomado y lo suelta SIEMPRE (también si
 * `fn` lanza). `{ corrio: false }` = no se consiguió el turno a tiempo.
 */
export async function conTurnoDelHilo<T>(
  threadId: string,
  fn: () => Promise<T>,
  opciones?: OpcionesTurno,
  deps: DepsTurno = depsReales,
): Promise<ResultadoTurno<T>> {
  const o = { ...POR_DEFECTO, ...opciones };
  const clave = claveDelTurno(threadId);
  const limite = deps.ahora() + o.esperaMaxMs;
  let tomado = await deps.tomar(clave, o.ttlSec);
  while (!tomado && deps.ahora() < limite) {
    await deps.esperar(o.intervaloMs);
    tomado = await deps.tomar(clave, o.ttlSec);
  }
  if (!tomado) return { corrio: false };
  try {
    return { corrio: true, valor: await fn() };
  } finally {
    await deps.soltar(clave);
  }
}
