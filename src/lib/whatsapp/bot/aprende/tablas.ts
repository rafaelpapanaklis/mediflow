import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * ¿Ya se pegó sql/ws1-t11-bot-aprende.sql? (ws1-t11). Módulo aparte y ligero
 * (solo prisma) para que lo use también el prompt del bot sin arrastrar el
 * motor: servicio.ts importa el motor y el motor no debe importar servicio.ts.
 */

const RECORDAR_AUSENCIA_MS = 60 * 1000;

export class ErrorAprende extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

// ── ¿Ya se pegó el SQL? ───────────────────────────────────────────────────────

export function esTablaAusente(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === "P2021") return true;
  const msg = String(e?.message ?? "");
  return (
    (/whatsapp_bot_(sugerencias|valoraciones|ejemplos_tono)/i.test(msg) && /does not exist|no existe/i.test(msg)) ||
    // Cliente de Prisma generado antes de este cambio (servidor sin reiniciar).
    /reading 'find(Many|First|Unique)'|reading 'count'|reading 'create(Many)?'|reading 'update(Many)?'|reading 'upsert'/.test(msg)
  );
}

let ausenteHasta = 0;

/** ¿Existen las tablas? Una consulta mínima; la ausencia se recuerda un minuto. */
export async function tablasDisponibles(): Promise<boolean> {
  if (Date.now() < ausenteHasta) return false;
  try {
    // Las tres tablas salen del mismo SQL: con sondear una basta.
    await prisma.whatsAppBotSugerencia.findFirst({ where: { clinicId: "__sonda__" }, select: { id: true } });
    return true;
  } catch (e) {
    if (esTablaAusente(e)) {
      ausenteHasta = Date.now() + RECORDAR_AUSENCIA_MS;
      return false;
    }
    throw e;
  }
}

/** Para las escrituras: si falta el SQL, un 503 con el nombre del archivo. */
export async function exigirTablas(): Promise<void> {
  ausenteHasta = 0; // las escrituras siempre preguntan
  if (!(await tablasDisponibles())) {
    // El nombre del SQL va al log, no a la pantalla de la clínica.
    console.warn("[bot/aprende] falta aplicar sql/ws1-t11-bot-aprende.sql");
    throw new ErrorAprende("Esta función todavía no está activa en tu clínica.", 503, "sql_pendiente");
  }
}

/** Solo para tests. */
export function __olvidarAusencia(): void {
  ausenteHasta = 0;
}
