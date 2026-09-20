// ═══════════════════════════════════════════════════════════════════════════
// «¿Cuánto debo?» — shell del flujo de saldo (ws1-t3).
//
// La máquina de estados y TODAS las reglas de seguridad viven en `saldo-core.ts`,
// pura y testeable. Aquí solo se cablean las dependencias reales y se inyectan,
// exactamente como hace `booking.ts` con `booking-core.ts`.
//
// ── El rastro ─────────────────────────────────────────────────────────────
// Contestar un saldo por WhatsApp es un acceso a datos del paciente, y tiene
// que dejar constancia de QUIÉN preguntó y QUÉ se contestó.
//
// Va como NOTA INTERNA en el propio hilo del Inbox (`isInternal: true`): queda
// pegada a la conversación y al paciente, la clínica la ve donde ya mira, y no
// se le manda al paciente.
//
// ⚠️ NO va a `AuditLog` vía `logRead`, y no por olvido: `AuditLog.userId` es
// una FK NOT NULL a `User` y el bot no es un usuario de la clínica. Escribir
// ahí exigiría o inventarse un usuario —dejando en la bitácora que «lo leyó»
// alguien que estaba dormido— o cambiar el schema, que queda fuera de esta
// tarea. `registrarConsultaDeSaldo` es el único punto por el que pasa el
// rastro: el día que exista un actor «bot» en la bitácora formal, se enchufa
// aquí y ni el núcleo ni las pruebas se enteran. Queda anotado en el reporte.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import { SYSTEM_EXTERNAL_ID_PREFIX, buildSystemExternalId } from "@/lib/whatsapp/system-message";
import { findPatientsByWhatsAppPhone } from "@/lib/whatsapp/inbox-log";
import { dinero } from "@/lib/quotes/condiciones-pago";
import { resumenDeSaldoDePaciente } from "@/lib/whatsapp/cobranza/datos";
import { fechaLarga, hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import { getCobranzaSettings } from "@/lib/reminders/config";
import {
  MAX_INTENTOS,
  VENTANA_FALLOS_MS,
  runSaldoTurn,
  type PacienteSaldo,
  type RastroConsulta,
  type SaldoDeps,
} from "./saldo-core";
import type { BotConfigDTO, BotTurnInput, BotTurnResult } from "./types";

export { isSaldoInProgress } from "./saldo-core";

/** Cómo se lee cada resultado en la nota interna, en cristiano. */
const COMO_SE_CUENTA: Record<RastroConsulta["resultado"], string> = {
  verificacionPedida: "preguntó por su saldo; se le pidió la fecha de nacimiento",
  verificacionFallida: "la fecha de nacimiento no coincidió",
  verificacionAgotada: "no acertó la fecha de nacimiento; se derivó a la clínica",
  saldoEntregado: "verificó su identidad y el bot le dijo su próxima mensualidad y su saldo",
  sinPlan: "verificó su identidad; no tiene mensualidades pendientes",
  pacienteNoEncontrado: "preguntó por su saldo desde un número sin paciente; se derivó",
  telefonoCompartido: "ese número es de más de un paciente; NO se dijo nada y se derivó",
  sinFechaDeNacimiento: "no hay fecha de nacimiento en su expediente; se derivó",
};

/**
 * Deja constancia de la consulta. NUNCA lanza: que no se pueda escribir la
 * nota no puede tumbar la respuesta al paciente ni el webhook de Meta.
 */
export async function registrarConsultaDeSaldo(datos: RastroConsulta): Promise<void> {
  try {
    if (!datos.clinicId || !datos.threadId) return;
    // Últimos 4 dígitos y no el teléfono entero: la nota ya cuelga del hilo de
    // ese número, repetirlo completo solo esparce el dato personal.
    const cola = datos.telefono.replace(/\D/g, "").slice(-4);
    const cuerpo =
      `🔒 Consulta de saldo por WhatsApp — ${COMO_SE_CUENTA[datos.resultado]}` +
      (cola ? ` (número ···${cola})` : "");

    const ahora = new Date();
    await prisma.inboxMessage.create({
      data: {
        threadId: datos.threadId,
        direction: "OUT",
        body: cuerpo,
        // Nota del sistema: no se envía al canal, solo la ve la clínica.
        isInternal: true,
        sentAt: ahora,
        // ⚠️ El `sys:` NO es decorativo. El tope diario del bot cuenta los OUT
        // con `sentById` null y sin ese prefijo (ver el `count` del webhook):
        // sin él, cada consulta de saldo gastaría DOS unidades del cupo de
        // Claude de toda la clínica, y un puñado de ellas dejaría al bot sin
        // contestar FAQ ni agendar a nadie. El resultado va dentro del id para
        // poder CONTAR los fallos sin parsear el texto de la nota.
        externalId: `${buildSystemExternalId("system")}:saldo-${datos.resultado}`,
      },
    });
    // Que la nota suba el hilo en el Inbox: un rastro que nadie ve no es un
    // rastro. (No es un mensaje del paciente, pero sí algo que la clínica
    // tiene que poder encontrar.)
    await prisma.inboxThread
      .update({ where: { id: datos.threadId }, data: { lastMessageAt: ahora } })
      .catch(() => {});
  } catch (e) {
    console.error("[whatsapp/saldo] no se pudo registrar la consulta:", e);
  }
}

/**
 * Cuántas verificaciones han fallado ya en este hilo en las últimas 24 h.
 *
 * Se cuenta sobre las notas que deja `registrarConsultaDeSaldo`, no sobre el
 * `botState`: ese caduca a los 10 minutos y esperar once sería un modo gratis
 * de reiniciar el contador y seguir probando fechas de nacimiento. El resultado
 * viaja en el `externalId` justamente para poder contarlo con un `count` y no
 * leyendo el texto.
 */
export async function fallosRecientesDeSaldo(
  clinicId: string,
  threadId: string,
): Promise<number> {
  try {
    if (!clinicId || !threadId) return MAX_INTENTOS; // ante la duda, no se contesta
    return await prisma.inboxMessage.count({
      where: {
        threadId,
        // El hilo tiene que ser de esta clínica: el threadId no basta por sí solo.
        thread: { clinicId },
        isInternal: true,
        sentAt: { gte: new Date(Date.now() - VENTANA_FALLOS_MS) },
        OR: [
          { externalId: { contains: `${SYSTEM_EXTERNAL_ID_PREFIX}system:` } },
        ],
        AND: [
          {
            OR: [
              { externalId: { endsWith: "saldo-verificacionFallida" } },
              { externalId: { endsWith: "saldo-telefonoCompartido" } },
              { externalId: { endsWith: "saldo-pacienteNoEncontrado" } },
              { externalId: { endsWith: "saldo-sinFechaDeNacimiento" } },
            ],
          },
        ],
      },
    });
  } catch (e) {
    console.error("[whatsapp/saldo] no se pudieron contar los fallos:", e);
    // Si no se puede contar, se corta: mejor derivar de más que convertir el
    // bot en un oráculo por un fallo de la base.
    return MAX_INTENTOS;
  }
}

/** Las dependencias reales. Las pruebas pasan dobles en su lugar. */
export function realSaldoDeps(timezone: string): SaldoDeps {
  return {
    async buscarPacientesPorTelefono(clinicId, phone): Promise<PacienteSaldo[]> {
      if (!clinicId || !phone) return [];
      // La misma búsqueda que usa el Inbox para enlazar hilos: compara los
      // últimos 10 dígitos NORMALIZADOS en los dos lados. Devuelve a TODOS los
      // que tengan el número, que es justo lo que el núcleo necesita para
      // negarse a adivinar cuando hay dos.
      const encontrados = await findPatientsByWhatsAppPhone(clinicId, phone);
      if (encontrados.length === 0) return [];

      const filas = await prisma.patient.findMany({
        where: {
          clinicId,
          id: { in: encontrados.map((p) => p.id) },
          deletedAt: null,
          // Coherencia con el aviso (`cobranza/core.ts` descarta al paciente
          // dado de baja): si la clínica decidió que a esta persona no se le
          // cobra por WhatsApp, el bot tampoco le habla de dinero.
          status: "ACTIVE",
        },
        select: { id: true, firstName: true, dob: true, status: true },
      });
      return filas.map((p) => ({
        id: p.id,
        firstName: p.firstName,
        // La columna es `date`: se lee en UTC para que el 1 de octubre no se
        // vuelva el 30 de septiembre en México (mismo criterio que
        // condiciones-pago-db.ts).
        dob: p.dob ? p.dob.toISOString().slice(0, 10) : null,
      }));
    },

    resumenDeSaldo(clinicId, patientId) {
      return resumenDeSaldoDePaciente(clinicId, patientId, hoyEnZona(new Date(), timezone));
    },

    registrarConsulta: registrarConsultaDeSaldo,
    fallosRecientes: fallosRecientesDeSaldo,
    formatearImporte: dinero,
    formatearFecha: fechaLarga,
  };
}

/**
 * Entrypoint que consume el motor (engine.ts). `deps` inyectable para pruebas.
 *
 * El interruptor `canAnswerBalance` lo resuelve `loadBotConfig` desde
 * `Clinic.reminderSettings.cobranza.bot`, y el núcleo lo comprueba lo primero.
 */
export function handleSaldoTurn(
  input: BotTurnInput,
  config: BotConfigDTO,
  deps?: SaldoDeps,
): Promise<BotTurnResult | null> {
  return runSaldoTurn(input, config, deps ?? realSaldoDeps(config.timezone ?? "America/Mexico_City"));
}

/** ¿Esta clínica deja que el bot hable de dinero? (lee el Json de la clínica) */
export function botPuedeDecirSaldo(clinic: { reminderSettings?: unknown }): boolean {
  return getCobranzaSettings(clinic).bot;
}
