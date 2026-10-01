import "server-only";
import { prisma } from "@/lib/prisma";
import { tablasDisponibles } from "./tablas";
import { bloqueEjemplosDeTono, MAX_EJEMPLOS_TONO } from "./tono";

/**
 * Para el prompt del bot (ws1-t11). El ENGANCHE en `buildSystemPrompt`
 * (bot/ai-prompt.ts) lo hace la pantalla de la IA: este módulo solo importa
 * prisma y tono.ts, así que el motor puede importarlo sin ciclos.
 *
 * Devuelve el bloque de ejemplos de tono de la clínica, o "" si no hay, si el
 * SQL no se ha pegado o si algo falla. Nunca lanza: el bot contesta igual.
 */
export async function bloqueDeTonoDeLaClinica(clinicId: string | null | undefined): Promise<string> {
  // Regla dura (c): sin clínica no se consulta (undefined no filtraría nada).
  if (!clinicId) return "";
  try {
    if (!(await tablasDisponibles())) return "";
    const filas = await prisma.whatsAppBotEjemploTono.findMany({
      where: { clinicId, activo: true },
      orderBy: { createdAt: "asc" },
      take: MAX_EJEMPLOS_TONO,
      select: { texto: true },
    });
    return bloqueEjemplosDeTono(filas.map((f) => f.texto));
  } catch (e) {
    console.error("[bot/aprende] no se pudieron leer los ejemplos de tono:", e);
    return "";
  }
}
