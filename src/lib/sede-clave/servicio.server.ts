// ws1-t4 · «Clave de la sede» — comprobar una clave con su límite de intentos y
// dejar rastro en la bitácora. Lo comparten /api/sede-clave (cambiar y
// desactivar piden la clave actual) y /api/sede-clave/desbloquear.
//
// 🔴 La clave en claro solo existe en la petición: se compara con bcrypt y se
// olvida. No va a la bitácora, ni a los logs, ni a ninguna respuesta.
import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";
import { logMutation } from "@/lib/audit";
import { estadoDeIntentos, type EstadoIntentos } from "./core";
import { conCandadoDeIntentos, leerFilaClave, leerIntentos, purgarIntentosViejos, registrarIntento } from "./estado.server";

const BCRYPT_ROUNDS = 10;
/** Más largo que esto no es una clave de la sede: ni se compara (bcrypt cuesta). */
const LARGO_MAXIMO_A_COMPARAR = 256;

export async function hashClave(clave: string): Promise<string> {
  return bcrypt.hash(clave, BCRYPT_ROUNDS);
}

async function coincide(clave: unknown, hash: string): Promise<boolean> {
  if (typeof clave !== "string" || clave.length === 0 || clave.length > LARGO_MAXIMO_A_COMPARAR) return false;
  try {
    return await bcrypt.compare(clave, hash);
  } catch {
    return false;
  }
}

// Las dos formas declaran los mismos campos: con `strict: false` TypeScript no
// estrecha la unión por `ok`.
export type Verificacion =
  | { ok: true; version: number; motivo?: undefined; intentos?: undefined }
  | { ok: false; motivo: "sin_clave" | "en_curso"; version?: undefined; intentos?: undefined }
  | { ok: false; motivo: "bloqueado" | "incorrecta"; version: number; intentos: EstadoIntentos };

/**
 * ¿Es `clave` la clave vigente de la sede? Lleva la cuenta por persona+sede
 * (y versión): con el bloqueo puesto ni se compara ni se registra; cada
 * comparación queda en `sede_clave_intentos` (sin la clave).
 *
 * v2 (revisión de t8, A2): leer los intentos, comparar y registrar va bajo un
 * candado por persona + sede (`conCandadoDeIntentos`). Si ya hay un intento en
 * curso de esa persona en esa sede, este ni se compara ni se registra
 * (`en_curso`): una ráfaga de N peticiones compara una sola clave a la vez y el
 * tope de 5 fallos se cumple.
 */
export async function verificarClave(args: { clinicId: string; supabaseId: string; clave: unknown; ahora?: Date }): Promise<Verificacion> {
  const fila = await leerFilaClave(args.clinicId);
  if (!fila || !fila.claveHash) return { ok: false, motivo: "sin_clave" };
  const hash = fila.claveHash;

  const r = await conCandadoDeIntentos<Verificacion>(args.clinicId, args.supabaseId, async (db) => {
    const ahora = args.ahora ?? new Date();
    const previos = await leerIntentos(args.clinicId, args.supabaseId, fila.version, ahora, db);
    const antes = estadoDeIntentos(previos, ahora.getTime());
    if (antes.bloqueadoHasta !== null) return { ok: false, motivo: "bloqueado", version: fila.version, intentos: antes };

    const ok = await coincide(args.clave, hash);
    await registrarIntento(args.clinicId, args.supabaseId, fila.version, ok, db);
    if (ok) return { ok: true, version: fila.version };

    const despues = estadoDeIntentos([...previos, { ok: false, en: ahora.getTime() }], ahora.getTime());
    return { ok: false, motivo: "incorrecta", version: fila.version, intentos: despues };
  });
  // M5: de paso, las filas de intentos de más de 1 día (como mucho 1 vez por hora).
  void purgarIntentosViejos();
  return r ?? { ok: false, motivo: "en_curso" };
}

export type EventoClave =
  | "activar"
  | "cambiar"
  | "desactivar"
  | "desbloqueo"
  | "intento_fallido"
  | "bloqueo";

const TEXTO: Record<EventoClave, string> = {
  activar: "Activó la clave de la sede",
  cambiar: "Cambió la clave de la sede",
  desactivar: "Desactivó la clave de la sede",
  desbloqueo: "Entró a la sede con su clave",
  intento_fallido: "Escribió mal la clave de la sede",
  bloqueo: "Se bloquearon los intentos de clave de la sede por 15 minutos",
};

/**
 * Una fila de bitácora (AuditLog) por evento, sin la clave. `clinicId` y
 * `userId` son los de la ficha de la persona EN ESA SEDE (salen de la sesión).
 */
export async function bitacoraClave(args: {
  req: NextRequest;
  clinicId: string;
  userId: string;
  evento: EventoClave;
  activaAntes: boolean;
  activaDespues: boolean;
  version?: number;
}): Promise<void> {
  await logMutation({
    req: args.req,
    clinicId: args.clinicId,
    userId: args.userId,
    entityType: "clinic",
    entityId: args.clinicId,
    action: "update",
    before: { claveDeSede: args.activaAntes ? "activa" : "sin clave" },
    after: {
      claveDeSede: args.activaDespues ? "activa" : "sin clave",
      evento: args.evento,
      ...(typeof args.version === "number" ? { versionClave: args.version } : {}),
    },
    texto: TEXTO[args.evento],
  });
}
