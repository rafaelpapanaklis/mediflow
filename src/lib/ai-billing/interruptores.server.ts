import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { funcionIaEncendida, mensajeFuncionIaApagada, type FuncionIaId } from "./interruptores";

// Sin `import "server-only"` a propósito, como agenda-comun.ts: el bot de
// WhatsApp y las rutas que lo usan se prueban con tsx, donde ese paquete no
// existe. Importa prisma, así que un componente cliente no puede traérselo.

/**
 * ¿La clínica apagó esta función de IA? Se llama en el SERVIDOR, ANTES de
 * llamar a la IA: es lo único que hace que el interruptor ahorre dinero.
 *
 * Una lectura por llamada, sin caché: el cron del resumen semanal pregunta
 * clínica por clínica y un administrador que apaga algo espera que valga ya,
 * no dentro de un minuto.
 *
 * Falla ABIERTO (devuelve false = encendida). Si la base no contesta o la
 * columna todavía no existe (SQL sin aplicar), la clínica sigue exactamente
 * como antes del interruptor. Lo contrario apagaría la IA de las quince
 * clínicas por un fallo que ninguna pidió.
 */
export async function funcionIaApagada(clinicId: string, id: FuncionIaId): Promise<boolean> {
  if (!clinicId) return false;
  try {
    const clinic = await prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { aiSettings: true },
    });
    return !funcionIaEncendida(clinic?.aiSettings, id);
  } catch (err) {
    console.error("[ai-interruptores] no se pudo leer aiSettings; se deja encendida (fail-open)", {
      clinicId,
      funcion: id,
      err: err instanceof Error ? err.message : err,
    });
    return false;
  }
}

/**
 * Respuesta de una ruta cuando la función está apagada: 403 con el motivo
 * escrito para una persona y `funcionApagada` para que la pantalla lo
 * distinga de un permiso que falta.
 */
export function respuestaFuncionIaApagada(id: FuncionIaId): NextResponse {
  return NextResponse.json(
    { error: mensajeFuncionIaApagada(id), funcionApagada: id },
    { status: 403 },
  );
}

/**
 * Atajo para las rutas: devuelve la respuesta 403 si la función está apagada,
 * o null si se puede seguir.
 */
export async function cortarSiIaApagada(clinicId: string, id: FuncionIaId): Promise<NextResponse | null> {
  return (await funcionIaApagada(clinicId, id)) ? respuestaFuncionIaApagada(id) : null;
}
