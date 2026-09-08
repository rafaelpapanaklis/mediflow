/**
 * DaleControl INSTITUCIONAL — LA PUERTA, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin `server-only`, sin un
 * `new Date()` escondido: la hora entra siempre por parámetro). Aquí vive
 * lo que el LOGIN, el CAMBIO DE CONTRASEÑA y sus dos endpoints tienen que
 * decidir EXACTAMENTE IGUAL, porque cuando la pantalla y el servidor usan
 * dos reglas parecidas es la persona la que paga la diferencia.
 *
 * ── POR QUÉ ESTE ARCHIVO Y NO TRES ──────────────────────────────────────
 * Las tres piezas de la puerta viven en tres carpetas distintas:
 *   · el formulario   → src/components/edu/edu-cambiar-contrasena-form.tsx
 *   · el endpoint     → src/app/api/instituto/auth/cambiar-contrasena
 *   · el sí/no del login → src/app/api/instituto/auth/session
 * y las tres tienen que contestar lo mismo. Un módulo puro en `lib/edu` es
 * el único sitio desde el que las tres pueden importar sin arrastrarse
 * nada (ni prisma al navegador, ni React al servidor).
 *
 * Lo que hay dentro:
 *   1 · LA REGLA DE LA CONTRASEÑA (H-161) — y su ayuda, que dice la verdad.
 *   2 · LA CADUCIDAD DE LA TEMPORAL (H-153) — derivada, sin columna nueva.
 *   3 · LOS MOTIVOS DEL LOGIN (H-158) — "dada de baja" ≠ "no es de aquí".
 *   4 · LA RUTA DE VUELTA (H-156) — a dónde regresa quien caducó su sesión.
 */

// ═══════════════════════════════════════════════════════════════════════
// 1 · LA REGLA DE LA CONTRASEÑA (H-161)
//
// 🔴 QUÉ ARREGLA. La ayuda del formulario pedía «mayúsculas, minúsculas y
// números» y el servidor aceptaba `contrasenita`: doce minúsculas seguidas.
// El desfase no era decorativo — quien leía la ayuda creía que se le exigía
// una contraseña fuerte y quien tecleaba lo que fuera pasaba igual.
//
// 🔴 QUÉ **NO** CAMBIA: la regla del servidor. Es la misma que el registro
// público del producto (`scorePassword >= 2` con mínimo 8), y endurecerla
// desde este vertical dejaría al instituto exigiendo una cosa y al resto de
// DaleControl otra. Lo que se arregla es la AYUDA, que ahora describe la
// regla EXACTA — y de paso el formulario ya no manda a validar de viaje lo
// que puede contestar aquí mismo.
//
// ⚠️ ESPEJO DELIBERADO de `scorePassword`
// (src/components/public/auth/password-strength.tsx). No se importa a
// propósito: este vertical no importa piezas del dental (arrastrar un
// componente suyo a una pantalla de instituto es cómo se hereda su marca
// sin querer). La copia es de TRES LÍNEAS y hay una prueba de FRONTERA
// —edu-puerta.test.ts— que lee el fuente del dental y se pone roja el día
// que allá cambien el criterio.
// ═══════════════════════════════════════════════════════════════════════

/** Mínimo del producto entero. Menos de 8 no se acepta en ninguna parte. */
export const EDU_PASSWORD_MIN = 8;

/** Tope de bcrypt: Supabase Auth trunca o rechaza más de 72 bytes. */
export const EDU_PASSWORD_MAX = 72;

/** El largo a partir del cual el largo SOLO ya basta (score 2 sin nada más). */
export const EDU_PASSWORD_LARGO_COMODO = 12;

/** Una de las tres alternativas que cumplen la segunda mitad de la regla. */
export interface EduPasswordAlternativa {
  clave: "largo" | "mayus" | "signo";
  texto: string;
  cumple: boolean;
}

export interface EduPasswordCheck {
  /** ¿La aceptaría el servidor? */
  ok: boolean;
  /** El porqué del "no", ya escrito para una persona. `null` si ok. */
  motivo: string | null;
  /** El puntaje 0-4, el mismo número que mira el servidor. */
  score: 0 | 1 | 2 | 3 | 4;
  /** Al menos EDU_PASSWORD_MIN caracteres. */
  largoOk: boolean;
  /** Más de EDU_PASSWORD_MAX: se rechaza aunque cumpla todo lo demás. */
  demasiadoLarga: boolean;
  /** Las tres formas de cumplir la segunda mitad. Basta UNA. */
  alternativas: EduPasswordAlternativa[];
}

/**
 * El puntaje, espejo exacto de `scorePassword` del dental.
 *
 * No se "mejora" ni se le añade un criterio: si aquí saliera un número
 * distinto del que calcula el servidor compartido, el formulario diría
 * "listo" sobre una contraseña que el endpoint rechaza (o al revés, que es
 * peor: un botón habilitado que contesta 400).
 */
export function eduPasswordScore(pwd: unknown): 0 | 1 | 2 | 3 | 4 {
  if (typeof pwd !== "string" || !pwd) return 0;
  let s = 0;
  if (pwd.length >= 8) s++;
  if (pwd.length >= 12) s++;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) s++;
  if (/\d/.test(pwd) && /[^\w\s]/.test(pwd)) s++;
  return Math.min(4, s) as 0 | 1 | 2 | 3 | 4;
}

/**
 * La ayuda del campo, palabra por palabra igual a lo que se aplica.
 *
 * Se exporta como CONSTANTE y no se escribe a mano en el formulario para
 * que no vuelva a haber dos textos: el de la pantalla y el de verdad.
 */
export const EDU_PASSWORD_AYUDA =
  `Al menos ${EDU_PASSWORD_MIN} caracteres. Y una de estas tres: ` +
  `${EDU_PASSWORD_LARGO_COMODO} caracteres o más, mayúsculas y minúsculas juntas, ` +
  `o un número y un signo.`;

/** El mensaje del rechazo. Lo usan el formulario y el endpoint, el mismo. */
export const EDU_PASSWORD_ERROR =
  `Esa contraseña no cumple la regla: ${EDU_PASSWORD_AYUDA}`;

export const EDU_PASSWORD_ERROR_LARGA =
  `La contraseña no puede pasar de ${EDU_PASSWORD_MAX} caracteres.`;

/**
 * ¿Se acepta esta contraseña? La MISMA respuesta en los dos lados.
 *
 * Devuelve además las tres alternativas con su estado para que el
 * formulario pueda pintar cuál falta en vez de repetir la frase entera —
 * una persona que no entiende por qué le rechazan la contraseña necesita
 * ver QUÉ le falta, no leer la regla otra vez.
 */
export function eduPasswordCheck(raw: unknown): EduPasswordCheck {
  const pwd = typeof raw === "string" ? raw : "";
  const largoOk = pwd.length >= EDU_PASSWORD_MIN;
  const demasiadoLarga = pwd.length > EDU_PASSWORD_MAX;
  const score = eduPasswordScore(pwd);

  const alternativas: EduPasswordAlternativa[] = [
    {
      clave: "largo",
      texto: `${EDU_PASSWORD_LARGO_COMODO} caracteres o más`,
      cumple: pwd.length >= EDU_PASSWORD_LARGO_COMODO,
    },
    {
      clave: "mayus",
      texto: "una mayúscula y una minúscula",
      cumple: /[a-z]/.test(pwd) && /[A-Z]/.test(pwd),
    },
    {
      clave: "signo",
      texto: "un número y un signo (! ? # …)",
      cumple: /\d/.test(pwd) && /[^\w\s]/.test(pwd),
    },
  ];

  // El orden de los "no" importa: el tope de 72 se comprueba antes que la
  // fuerza porque una contraseña de 90 caracteres cumple TODO lo demás y
  // "es muy débil" sería mentira.
  let motivo: string | null = null;
  if (demasiadoLarga) motivo = EDU_PASSWORD_ERROR_LARGA;
  else if (!largoOk || score < 2) motivo = EDU_PASSWORD_ERROR;

  return { ok: motivo === null, motivo, score, largoOk, demasiadoLarga, alternativas };
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LA CADUCIDAD DE LA TEMPORAL (H-153)
//
// 🔴 QUÉ ARREGLA. Las temporales del vertical tienen forma pública y
// conocida (`Edu-XXXX-XXXY`, ~38 bits) y **no caducaban nunca**: una
// dirección que dio de alta a cuarenta residentes en marzo dejaba cuarenta
// llaves de forma adivinable vivas para siempre, incluidas las de quienes
// nunca entraron.
//
// 🔴 CÓMO CADUCA SIN COLUMNA NUEVA. El esquema no tiene (todavía) un
// `tempPasswordAt`: esta ola no escribe SQL. Lo que sí hay, desde la Ola C
// base, es `updatedByAt` —«cuándo tocó una PERSONA esta cuenta»— que el
// alta y el restablecimiento escriben (src/lib/edu/equipo.ts). Así que el
// momento de emisión se DERIVA:
//
//     emitida = updatedByAt ?? createdAt
//
// y solo se mira cuando `mustChangePassword` está encendida, que es
// exactamente el estado "esta cuenta todavía vive con la que le dictaron".
//
// ⚠️ LA IMPRECISIÓN, DICHA EN VOZ ALTA: una edición cualquiera de la ficha
// (corregir un teléfono) también mueve `updatedByAt` y por tanto ALARGA la
// vida de la temporal de esa persona. Se equivoca hacia el lado permisivo,
// nunca hacia dejar a nadie fuera antes de tiempo. La columna que lo
// cerraría está pedida por su nombre exacto en el punto 6 del reporte.
//
// 🔴 DÓNDE MUERDE. No hace falta tocar el login de Supabase: con
// `mustChangePassword` encendida el panel entero ya está cerrado (el layout
// redirige y `eduApiGuard` contesta 403), así que lo único que una temporal
// puede hacer es CANJEARSE por una definitiva. Cerrar ese canje —y decirlo
// en la puerta— es cerrar la temporal.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cuántos días vive una contraseña temporal.
 *
 * 14 y no 90: la temporal se entrega EN LA MANO (el alta no manda correo, a
 * propósito), así que quien la recibe la estrena esa semana o no la estrena.
 * Y 14 y no 2: una generación que se da de alta el viernes antes de un
 * puente tiene que poder entrar el lunes siguiente sin que nadie rehaga
 * cuarenta cuentas.
 *
 * Es UN número y está aquí solo: cambiarlo es una línea.
 */
export const EDU_TEMP_PASSWORD_DIAS = 14;

const DIA_MS = 24 * 60 * 60 * 1000;

export interface EduTempPasswordEstado {
  /** ¿Esta cuenta vive con una temporal? (mustChangePassword) */
  aplica: boolean;
  /** Cuándo se emitió, derivado. `null` si no aplica. */
  emitida: Date | null;
  /** El instante en que deja de valer. `null` si no aplica. */
  caduca: Date | null;
  /** Ya caducó: no se puede canjear ni entrar con ella. */
  caducada: boolean;
  /** Días enteros que quedan (0 = hoy es el último). `null` si no aplica. */
  diasRestantes: number | null;
}

/**
 * El estado de la temporal de una cuenta. PURA: `now` entra por parámetro.
 *
 * Acepta fechas como Date o como texto ISO para poder llamarla igual desde
 * una fila de Prisma y desde un DTO ya serializado.
 */
export function eduTempPasswordEstado(
  user: {
    mustChangePassword?: boolean | null;
    createdAt?: Date | string | null;
    updatedByAt?: Date | string | null;
  } | null | undefined,
  now: Date,
): EduTempPasswordEstado {
  const sinTemporal: EduTempPasswordEstado = {
    aplica: false,
    emitida: null,
    caduca: null,
    caducada: false,
    diasRestantes: null,
  };
  if (!user || !user.mustChangePassword) return sinTemporal;

  const emitida = fecha(user.updatedByAt) ?? fecha(user.createdAt);
  // Sin ninguna de las dos fechas NO se caduca nada: dejar a alguien fuera
  // por un dato que falta es peor que la temporal que se quería cerrar.
  if (!emitida) return { ...sinTemporal, aplica: true };

  const caduca = new Date(emitida.getTime() + EDU_TEMP_PASSWORD_DIAS * DIA_MS);
  const restanteMs = caduca.getTime() - now.getTime();
  return {
    aplica: true,
    emitida,
    caduca,
    caducada: restanteMs <= 0,
    diasRestantes: restanteMs <= 0 ? 0 : Math.ceil(restanteMs / DIA_MS),
  };
}

function fecha(raw: Date | string | null | undefined): Date | null {
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * El mensaje de una temporal caducada. Dice QUÉ pasó y QUÉ hacer, y no
 * insinúa que la persona hizo algo mal: no lo hizo.
 */
export const EDU_TEMP_PASSWORD_CADUCADA =
  `Tu contraseña temporal caducó: se dan ${EDU_TEMP_PASSWORD_DIAS} días para estrenarla y ya pasaron. ` +
  "Pídele a la dirección de tu instituto que te genere otra — es un botón en tu ficha, no un trámite.";

// ═══════════════════════════════════════════════════════════════════════
// 3 · LOS MOTIVOS DEL LOGIN (H-158)
//
// 🔴 QUÉ ARREGLA. `getEduContext` devuelve `null` igual para «esta cuenta
// está DADA DE BAJA» que para «esta cuenta no es de ningún instituto», y el
// login enseñaba un solo texto: *«Pide a la dirección de tu escuela que te
// dé de alta»*. El docente que rotó llamaba a la escuela, que lo daba de
// alta OTRA VEZ —cuenta nueva, historial clínico colgando del id viejo—
// cuando lo único que hacía falta era reactivarlo con un clic.
//
// El servidor SÍ sabe distinguirlo (la fila existe con isActive false), y
// decírselo a quien YA se autenticó con esa cuenta no revela nada: es
// información sobre sí mismo.
// ═══════════════════════════════════════════════════════════════════════

export type EduLoginMotivo =
  /** El correo o la contraseña no son. */
  | "credenciales"
  /** Autenticó, pero esa cuenta no tiene fila en ningún instituto. */
  | "ajena"
  /** Tiene fila, y está dada de baja. */
  | "baja"
  /** Entra, pero su temporal ya no vale. */
  | "temporal-caducada"
  /** Demasiados intentos fallidos: failban. */
  | "bloqueo"
  /** La sesión caducó mientras usaba el panel (H-156). */
  | "sesion";

export const EDU_LOGIN_MENSAJES: Record<EduLoginMotivo, string> = {
  credenciales: "Correo o contraseña incorrectos.",
  ajena:
    "Esta cuenta no pertenece a ningún instituto. Pide a la dirección de tu escuela que te dé de alta.",
  // 🔴 El texto NO dice "que te dé de alta": darla de alta otra vez crea una
  // cuenta NUEVA y deja su historial clínico colgando de la vieja. Dice lo
  // que de verdad hay que pedir.
  baja: "Tu cuenta está dada de baja: la dirección de tu instituto le quitó el acceso. Pídele que la REACTIVE — no hace falta darte de alta otra vez, y así conservas todo tu historial.",
  "temporal-caducada": EDU_TEMP_PASSWORD_CADUCADA,
  bloqueo:
    "Demasiados intentos fallidos. Espera unos minutos y vuelve a intentarlo; si no recuerdas tu contraseña, pídele a la dirección de tu instituto que te la restablezca.",
  sesion: "Tu sesión caducó. Vuelve a entrar para seguir donde estabas.",
};

/** ¿Este texto es uno de los motivos del catálogo? (para leer `?motivo=`) */
export function eduLoginMotivo(raw: unknown): EduLoginMotivo | null {
  if (typeof raw !== "string") return null;
  return raw in EDU_LOGIN_MENSAJES ? (raw as EduLoginMotivo) : null;
}

/** El mensaje de un motivo, con el nombre del instituto cuando lo hay. */
export function eduLoginMensaje(motivo: EduLoginMotivo, institucion?: string | null): string {
  const base = EDU_LOGIN_MENSAJES[motivo];
  if (motivo === "baja" && institucion && institucion.trim()) {
    return `Tu cuenta de ${institucion.trim()} está dada de baja: la dirección le quitó el acceso. Pídele que la REACTIVE — no hace falta darte de alta otra vez, y así conservas todo tu historial.`;
  }
  return base;
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LA RUTA DE VUELTA (H-156)
//
// 🔴 QUÉ ARREGLA. Un 401 de la API se traducía a «Tu sesión caducó. Vuelve
// a entrar» y NINGÚN llamador redirigía: la cajera volvía de comer, guardaba
// un pago, leía el mensaje, lo intentaba otra vez y leía lo mismo. La única
// salida era recargar a mano.
//
// Al mandarla al login se lleva a dónde estaba, para que después de entrar
// vuelva a su pantalla y no a Inicio. Y por eso hace falta VALIDAR el
// destino: un `?volver=` que acepte cualquier cosa es un redirect abierto
// —el clásico `?volver=https://sitio-que-copia-el-login`—.
// ═══════════════════════════════════════════════════════════════════════

/**
 * La ruta a la que se puede volver tras entrar, o `null`.
 *
 * Reglas, y las tres importan:
 *   · empieza por `/instituto/` — una ruta ABSOLUTA de este vertical y de
 *     ningún otro sitio (ni del dental, ni de fuera);
 *   · no empieza por `//` ni trae `\` — las dos formas de colar un host;
 *   · no es el propio login ni el cambio de contraseña — volver ahí sería
 *     un bucle.
 */
export function eduRutaDeVuelta(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > 300) return null;
  if (v.includes("\\")) return null;
  if (!v.startsWith("/instituto/")) return null;
  if (v.startsWith("//")) return null;
  const sinQuery = v.split("?")[0].split("#")[0];
  if (sinQuery === "/instituto/login" || sinQuery === "/instituto/cambiar-contrasena") return null;
  return v;
}
