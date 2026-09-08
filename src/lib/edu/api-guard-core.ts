/**
 * DaleControl INSTITUCIONAL — lo PURO de la puerta de la API.
 *
 * Sin prisma, sin next/server, sin "server-only": aquí vive lo que se puede
 * ejecutar en una prueba sin base de datos. `api-guard.ts` lo importa y lo
 * aplica; este archivo no importa nada.
 *
 * Son dos cosas, y las dos nacieron de un hallazgo de la auditoría:
 *
 *  1. La ALLOWLIST de la contraseña temporal (H-03). `eduApiGuard` corta con
 *     403 mientras `mustChangePassword` esté encendida, así que hace falta
 *     decir —en un solo sitio y por escrito— qué rutas quedan fuera y por
 *     qué. La prueba recorre `src/app/api/instituto` entera y exige que toda
 *     ruta que NO pase por el guardia esté aquí, con su motivo.
 *
 *  2. La traducción del P2002 de Prisma (H-107). Dos personas de dirección
 *     dando de alta a la vez chocaban contra el índice único y recibían
 *     «No se pudo completar la operación» — un 500 que no dice nada.
 */

/**
 * Rutas de `src/app/api/instituto` que NO llaman a `eduApiGuard`, con el
 * motivo. Cualquier otra que no lo llame es un error, y la prueba
 * `edu-api-guard.test.ts` lo dice con el nombre del archivo.
 *
 * 🔴 Las de `auth/` son EXACTAMENTE la allowlist mínima de la PUERTA: la
 * puerta de salida (cerrar sesión), la de arreglo (cambiar la contraseña),
 * la que solo contesta sí/no, y —desde la Ola C·2b— el contador de intentos
 * fallidos. Una persona con la temporal puesta tiene que poder cambiarla y
 * salir; todo lo demás está cerrado hasta entonces. Y las cuatro comparten
 * el mismo motivo de fondo: **corren cuando todavía no hay panel al que
 * exigirle permiso**. Ninguna otra ruta del vertical puede decir eso.
 *
 * La clave es la ruta relativa a `src/app/api/instituto`, con barras y sin
 * el `route.ts` final.
 */
export const EDU_API_RUTAS_SIN_GUARD: Record<string, string> = {
  "auth/cambiar-contrasena":
    "H-03 · es la salida de la contraseña temporal. Resuelve la sesión con getEduContext y solo puede tocar la cuenta de quien llama; si pasara por el guardia, quien llega con la temporal no podría cambiarla nunca.",
  "auth/logout":
    "H-03 · cerrar sesión. No lee ni escribe nada del instituto: llama a supabase.auth.signOut(). Cerrarle la puerta de salida a alguien con la temporal puesta lo dejaría encerrado.",
  "auth/intento":
    "H-153 · el contador de intentos fallidos del login (src/lib/failban.ts). Corre ANTES de que exista sesión de instituto —el login autentica en el navegador, así que no hay otro punto de servidor previo a validar credenciales—, y exigirle sesión sería exigir haber entrado para poder intentar entrar. No lee ni escribe una sola fila del instituto: solo suma y borra contadores de fallos por IP y por cuenta, y contesta siempre lo mismo (ok o un 429 genérico), sin decir si la cuenta existe.",
  "auth/session":
    "El login pregunta «¿esta sesión es de un instituto?» ANTES de tener panel. Contesta un booleano y nada más — no hay permiso que exigir porque no devuelve ningún dato.",
  "consentimientos/publico/[token]":
    "La carta que firma el PACIENTE desde su WhatsApp. No hay sesión de instituto: el candado es el token de la liga y su caducidad (src/lib/edu/consentimientos.ts).",
  "cron/recordatorios":
    "Lo llama el cron de Vercel, no una persona. Se autentica con CRON_SECRET, que es otro candado distinto del de la sesión.",
  "presupuestos/publico/[token]":
    "El presupuesto que el PACIENTE abre y acepta desde la liga que le mandaron, sin sesión de instituto: el candado es el token de 32 bytes de randomBytes (src/lib/edu/presupuestos.ts), igual que la carta de consentimiento de arriba. Añadida al INTEGRAR la Ola C: la ruta llega en #225 y el guardia en #222, así que ninguna de las dos ramas por separado podía declararla.",
};

/** ¿Esta ruta está exenta del guardia, y por qué? `null` = no lo está. */
export function eduRutaSinGuardMotivo(ruta: string): string | null {
  return EDU_API_RUTAS_SIN_GUARD[ruta] ?? null;
}

/**
 * El mensaje que ve una persona cuando `mustChangePassword` está encendida
 * y llama a cualquier otra ruta.
 *
 * Dice QUÉ hacer, no qué falló: quien lo lee es un alumno con la temporal
 * que la dirección le dictó, y lo único que necesita saber es que primero
 * define la suya.
 */
export const EDU_TEMP_PASSWORD_ERROR =
  "Todavía tienes una contraseña temporal. Defínela en Cambiar contraseña antes de usar el instituto.";

/**
 * Traducción de un choque de índice único (P2002) a algo que una persona
 * pueda leer y arreglar (H-107).
 *
 * `target` llega de Prisma y cambia de forma según la versión y según si el
 * índice tiene `map`: unas veces es la lista de columnas
 * (`["institutionId","matricula"]`) y otras el nombre del índice
 * (`"edu_chairs_sede_numero_key"`). Se normaliza a un texto y se busca por
 * dentro, en vez de casarse con una de las dos formas.
 *
 * ⚠️ El texto por defecto NO inventa cuál fue el dato: dice lo único que se
 * sabe seguro —que alguien se adelantó— y qué hacer. Un mensaje concreto y
 * equivocado es peor que uno general y cierto.
 */
export function eduMensajeP2002(target: unknown): string {
  const texto = (Array.isArray(target) ? target.join(" ") : String(target ?? "")).toLowerCase();

  if (texto.includes("matricula")) {
    return "Esa matrícula ya está en uso. Alguien más acaba de guardarla: usa otra.";
  }
  if (texto.includes("folio")) {
    return "Ese folio ya está en uso. Alguien más acaba de guardarlo: vuelve a intentarlo.";
  }
  if (texto.includes("supabaseid") || texto.includes("email")) {
    return "Ya hay alguien con ese correo en este instituto.";
  }
  if (texto.includes("code")) {
    return "Esa clave ya está en uso en este instituto. Alguien más acaba de guardarla: usa otra.";
  }
  if (texto.includes("name") || texto.includes("nombre")) {
    return "Ese nombre ya está en uso en este instituto. Alguien más acaba de guardarlo: usa otro.";
  }
  return "Alguien más acaba de guardar ese mismo dato. Actualiza la pantalla y vuelve a intentarlo.";
}
