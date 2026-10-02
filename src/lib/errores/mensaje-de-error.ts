// Un solo traductor de «lo que dijo el servidor» a una frase que una persona de
// la clínica entienda. 12j (ticket 3 de BEVADENT).
//
// Por qué existe: las APIs responden CÓDIGOS (`not_found` ×64, `internal_error`
// ×49, `invalid_payload` ×40, `patient_not_found`, `upload_failed`…) y, en
// cientos de rutas, el inglés «Unauthorized». Cada pantalla traducía por su
// cuenta (appointments-client.tsx tiene el suyo) y donde nadie lo hacía el
// toast decía literalmente «upload_failed» o «Unauthorized». Aquí hay UN mapa
// código → frase (es y en, en el diccionario `errores.*`), y un par de
// funciones para usarlo desde cualquier catch o respuesta. NO cambia las APIs:
// ellas siguen mandando sus códigos (los consumen también el bot, Sabina y los
// tests).
//
// Reglas, en orden:
//  1. Un `reason` legible que mande el servidor (p. ej. el de `doctor_not_found`
//     de la Agenda, que ya lo trae en español) manda sobre el código.
//  2. Un código conocido → su frase.
//  3. Una frase con espacios («Paciente no encontrado») ya la escribió una
//     persona: se deja tal cual SOLO si está en español. Las frases HTTP en
//     inglés de siempre («Unauthorized», «Not found», «Internal Server Error»)
//     y los mensajes técnicos del navegador o de una librería («Unexpected
//     token '<'… is not valid JSON», «The operation was aborted.», «Request
//     failed with status code 500», un error de Prisma) se traducen o caen en
//     la frase genérica: nunca se le enseñan a la clínica.
//  4. Un código desconocido NUNCA se enseña: se usa el estado HTTP si lo hay, y
//     si no, la frase por defecto de la pantalla o la genérica.
//
// Puro (sin React): `t` es la función del i18n, que se pasa desde el componente.

export type Traductor = (key: string, vars?: Record<string, string | number>) => string;

/** código (en minúsculas) → llave dentro de `errores.*`. */
export const CODIGOS_DE_ERROR: Record<string, string> = {
  // Sesión y permisos
  unauthorized: "sesion",
  no_autenticado: "sesion",
  forbidden: "permiso",
  sin_permiso: "permiso",
  no_autorizado: "permiso",
  override_not_allowed_for_role: "permiso",
  not_your_appointment: "citaAjena",
  // No encontrado
  not_found: "noEncontrado",
  no_encontrada: "noEncontrado",
  no_encontrado: "noEncontrado",
  record_not_found: "noEncontrado",
  thread_not_found: "noEncontrado",
  not_found_or_not_owned: "noEncontrado",
  patient_not_found: "pacienteNoEncontrado",
  appointment_not_found: "citaNoEncontrada",
  resource_not_found: "sillonNoEncontrado",
  clinic_not_found: "clinicaNoEncontrada",
  assignee_not_found: "personaNoEncontrada",
  // Agenda
  slot_taken: "horarioOcupado",
  appointment_overlap: "horarioOcupado",
  resource_unavailable: "sillonNoDisponible",
  resource_has_active_appointments: "sillonConCitas",
  outside_schedule: "fueraDeHorario",
  invalid_transition: "estadoNoPermitido",
  not_changeable: "estadoNoPermitido",
  legacy_status: "estadoNoPermitido",
  invalid_date: "fechaInvalida",
  invalid_schedule: "fechaInvalida",
  invalid_duration: "fechaInvalida",
  range_too_large: "rangoGrande",
  // Solicitudes y enlaces
  not_pending: "solicitudNoPendiente",
  not_found_or_not_pending: "solicitudNoPendiente",
  pending_exists: "solicitudPendiente",
  expired: "vencido",
  slug_taken: "enlaceEnUso",
  // Datos
  invalid_payload: "datosInvalidos",
  invalid_json: "datosInvalidos",
  se_espera_json: "datosInvalidos",
  bad_request: "datosInvalidos",
  validation: "datosInvalidos",
  too_many_ids: "datosInvalidos",
  invalid_type: "datosInvalidos",
  invalid_mode: "datosInvalidos",
  origen_invalido: "datosInvalidos",
  via_invalid: "datosInvalidos",
  anio_invalido: "datosInvalidos",
  valor_invalido: "datosInvalidos",
  patient_no_phone: "pacienteSinTelefono",
  patient_no_email: "pacienteSinCorreo",
  // Servidor y funciones aún sin habilitar
  internal_error: "interno",
  upstream: "servicioExterno",
  schema_not_migrated: "noDisponible",
  tools_not_ready: "noDisponible",
  table_missing: "noDisponible",
  sql_pendiente: "noDisponible",
  no_disponible: "noDisponible",
  whatsapp_not_connected: "whatsappNoConectado",
  whatsapp_not_configured: "whatsappNoConectado",
  // Acciones que fallaron
  upload_failed: "subidaFallida",
  attach_failed: "adjuntoFallido",
  send_failed: "envioFallido",
  sign_failed: "firmaFallida",
  update_failed: "guardadoFallido",
};

/** Frases HTTP en inglés que sueltan las rutas o el servidor (minúsculas) → llave. */
export const FRASES_EN_INGLES: Record<string, string> = {
  "unauthorized": "sesion",
  "forbidden": "permiso",
  "not found": "noEncontrado",
  "bad request": "datosInvalidos",
  "internal server error": "interno",
  "service unavailable": "interno",
  "bad gateway": "servicioExterno",
  "gateway timeout": "servicioExterno",
  "too many requests": "demasiadas",
  "payload too large": "archivoGrande",
  "request entity too large": "archivoGrande",
  "patientid required": "datosInvalidos",
  "failed to fetch": "red",
  "load failed": "red",
  "network error": "red",
  "networkerror when attempting to fetch resource.": "red",
  "the network connection was lost.": "red",
};

/**
 * Mensajes técnicos que sueltan el navegador o las librerías (no son para una
 * persona). Cada uno apunta a la frase que sí le sirve: sin conexión, o «algo
 * salió mal de nuestro lado» cuando el servidor devolvió HTML en vez de JSON.
 */
const TECNICOS_A_LLAVE: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(fetch failed|network request failed|the user aborted a request\.?|the operation was aborted\.?|signal is aborted without reason|aborterror.*|request timed out|timeout of \d+ms exceeded)$/i, "red"],
  [/unexpected token|is not valid json|json\.parse|unexpected end of json input|unexpected character/i, "interno"],
];

/** Palabras de relleno del español: señal de que la frase la escribió una persona de aquí. */
const PALABRAS_ES = new Set(
  ("el la los las un una unos unas de del al en por para con sin que se su sus tu tus ya hay no ni y es son esta están " +
    "fue ha han puede debe falta más menos como cuando ese esa este esto mi te lo le les si sí aún todavía antes después")
    .split(" "),
);

/** Palabras que salen en mensajes técnicos en inglés (una sola no basta: «token» puede ser español). */
const PALABRAS_EN = new Set(
  ("the of is was are were to on at not valid failed failure cannot unexpected request operation token status timeout exceeded " +
    "invalid undefined null fetch aborted read properties connection server something wrong went again unable could missing " +
    "required found denied access expired bad too many with from for and this that").split(" "),
);

/** Marcas que delatan un mensaje de máquina por sí solas. */
const MARCA_TECNICA = /`|\bprisma\b|\binvocation\b|\bundefined\b|\bhttp \d{3}\b|\bstatus code\b|\bat .+:\d+/i;

/**
 * ¿Es una frase en español hecha para una persona? Sin marca técnica y sin dos o
 * más palabras de inglés técnico, y con tilde, ñ o signo de apertura (seguro) o,
 * si no, alguna palabra de relleno del español. «Paciente no encontrado» pasa;
 * «The operation was aborted.», «Request failed with status code 500» y «No
 * connection to server» no.
 */
export function esFraseEnEspanol(texto: string): boolean {
  const t = texto.trim();
  if (!t || MARCA_TECNICA.test(t)) return false;
  const palabras = t.toLowerCase().split(/[^a-záéíóúüñ]+/).filter(Boolean);
  if (new Set(palabras.filter((w) => PALABRAS_EN.has(w))).size >= 2) return false;
  if (/[áéíóúüñ¿¡]/i.test(t)) return true;
  return palabras.some((w) => PALABRAS_ES.has(w));
}

/** Un estado HTTP sin código útil → llave. */
function llaveDeEstado(estado?: number | null): string | null {
  if (!estado) return null;
  if (estado === 401) return "sesion";
  if (estado === 403) return "permiso";
  if (estado === 404) return "noEncontrado";
  if (estado === 413) return "archivoGrande";
  if (estado === 429) return "demasiadas";
  if (estado >= 500) return "interno";
  return null;
}

/** ¿Parece un código de máquina (`upload_failed`, `invalid_payload`, `E_FOO(x)`) y no una frase? */
export function pareceCodigo(texto: string): boolean {
  const limpio = texto.trim();
  return limpio !== "" && !/\s/.test(limpio) && /^[A-Za-z0-9_.:()\-\[\]]+$/.test(limpio);
}

/** Saca el texto del error de lo que sea que llegue a un catch o a un cuerpo JSON. */
function textoDe(error: unknown): { texto: string; razon: string } {
  if (typeof error === "string") return { texto: error.trim(), razon: "" };
  if (error instanceof Error) return { texto: (error.message ?? "").trim(), razon: "" };
  if (error && typeof error === "object") {
    const o = error as { error?: unknown; message?: unknown; reason?: unknown };
    const razon = typeof o.reason === "string" ? o.reason.trim() : "";
    const texto =
      typeof o.error === "string" ? o.error.trim() : typeof o.message === "string" ? o.message.trim() : "";
    return { texto, razon };
  }
  return { texto: "", razon: "" };
}

export interface OpcionesMensaje {
  /** Estado HTTP de la respuesta, si se tiene: respalda a un código desconocido o ausente. */
  estado?: number | null;
  /** Lo que dice esta pantalla cuando no hay nada mejor («No se pudo subir el archivo»). */
  porDefecto?: string;
}

/**
 * La frase para la persona. Acepta lo que llega a un `catch` (Error), el cuerpo
 * JSON de una respuesta (`{ error, reason? }`) o el código suelto.
 */
export function mensajeDeError(error: unknown, t: Traductor, opciones: OpcionesMensaje = {}): string {
  const { texto, razon } = textoDe(error);
  const mensaje = (llave: string) => t(`errores.${llave}`);
  const alternativa = () => {
    const porEstado = llaveDeEstado(opciones.estado);
    if (porEstado) return mensaje(porEstado);
    return opciones.porDefecto?.trim() ? opciones.porDefecto : mensaje("generico");
  };

  // 1. El servidor ya dio una razón legible.
  if (razon && !pareceCodigo(razon)) return razon;

  if (!texto) return alternativa();

  // `upload_failed(abc): detalle` → el código es lo de antes del paréntesis o los dos puntos.
  const minus = texto.toLowerCase();
  const codigo = minus.replace(/[(:].*$/, "").trim();

  // 2. Código conocido.
  const llave = CODIGOS_DE_ERROR[minus] ?? CODIGOS_DE_ERROR[codigo];
  if (llave) return mensaje(llave);

  // 3. Frase en inglés conocida.
  const ingles = FRASES_EN_INGLES[minus];
  if (ingles) return mensaje(ingles);

  // 3b. Mensaje técnico del navegador o de una librería: a su frase, nunca crudo.
  for (const [patron, llaveTecnica] of TECNICOS_A_LLAVE) if (patron.test(texto)) return mensaje(llaveTecnica);

  // 4. Una frase escrita por una persona, en español: se deja. Con espacios pero en
  //    inglés técnico (HTTP 502, «Cannot read properties…», un error de Prisma): lo de
  //    la pantalla o lo genérico.
  if (!pareceCodigo(texto)) return esFraseEnEspanol(texto) ? texto : alternativa();

  // Código desconocido: por la forma, antes que mostrarlo.
  if (/^(missing|invalid)_/.test(codigo) || /_(invalid|invalido|invalida)$/.test(codigo)) return mensaje("datosInvalidos");
  if (/_not_found$/.test(codigo)) return mensaje("noEncontrado");
  if (/_failed$/.test(codigo)) return mensaje("fallo");
  return alternativa();
}

/**
 * La frase para una respuesta HTTP que no salió bien. Lee el cuerpo (si es JSON)
 * y traduce; si no se puede leer, usa el estado.
 */
export async function mensajeDeRespuesta(
  res: { status: number; json: () => Promise<unknown> },
  t: Traductor,
  porDefecto?: string,
): Promise<string> {
  const cuerpo = await res.json().catch(() => null);
  return mensajeDeError(cuerpo, t, { estado: res.status, porDefecto });
}
