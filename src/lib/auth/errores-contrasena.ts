// src/lib/auth/errores-contrasena.ts
//
// Traduce al español los errores de Supabase Auth (GoTrue) que salen al crear o
// cambiar una contraseña. SIN dependencias: lo usan igual las rutas del servidor
// y los formularios del cliente, y se prueba con `tsx --test` sin montar nada.
//
// 🔴 POR QUÉ: GoTrue contesta en inglés y varias superficies le pasaban su
// `error.message` tal cual al usuario. El caso que lo destapó: con la protección
// de contraseñas filtradas encendida, el alta respondía «Password is known to be
// weak and easy to guess, please choose a different one.» a una clínica que solo
// lee español y que no tenía forma de saber qué corregir.
//
// Aquí NO se decide qué contraseña es válida: las reglas de fuerza siguen siendo
// las de scorePassword y las del propio Supabase. Esto solo pone en español lo
// que Supabase ya decidió.

/** El texto exacto que ve quien elige una contraseña que salió en filtraciones. */
export const MENSAJE_CONTRASENA_FILTRADA =
  "Esta contraseña apareció en filtraciones públicas y es fácil de adivinar. Elige otra.";

/** Línea de ayuda del medidor de fuerza. */
export const AYUDA_CONTRASENA = "Evita contraseñas comunes; no la reutilices";

export type MotivoContrasena =
  | "filtrada" // reasons: ["pwned"] — apareció en filtraciones (HaveIBeenPwned)
  | "corta" // reasons: ["length"]
  | "caracteres" // reasons: ["characters"] — le falta una clase de carácter
  | "debil" // weak_password sin un motivo que sepamos leer
  | "igual" // same_password
  | "larga"; // más de 72 (límite de bcrypt)

export interface ErrorContrasena {
  motivo: MotivoContrasena;
  /** En español y listo para enseñarse. */
  mensaje: string;
  /** Solo en `corta`: el mínimo que se le dice al usuario. */
  minimo?: number;
}

/** El mínimo que exigen nuestros formularios; nunca se anuncia uno menor. */
const MINIMO_PROPIO = 8;

interface ErrorLeido {
  mensaje: string;
  codigo: string;
  motivos: string[];
}

/** Acepta un AuthError, un objeto suelto `{ message, code }`, un string o nada. */
function leer(error: unknown): ErrorLeido {
  if (typeof error === "string") return { mensaje: error, codigo: "", motivos: [] };
  if (!error || typeof error !== "object") return { mensaje: "", codigo: "", motivos: [] };
  const e = error as Record<string, unknown>;
  const mensaje = typeof e.message === "string" ? e.message : "";
  const codigo =
    typeof e.code === "string" ? e.code : typeof e.error_code === "string" ? e.error_code : "";
  // AuthWeakPasswordError trae `reasons`; la respuesta cruda de GoTrue, `weak_password.reasons`.
  const crudos = Array.isArray(e.reasons)
    ? e.reasons
    : Array.isArray((e.weak_password as Record<string, unknown> | undefined)?.reasons)
      ? ((e.weak_password as Record<string, unknown>).reasons as unknown[])
      : [];
  const motivos = crudos.filter((m): m is string => typeof m === "string");
  return { mensaje, codigo, motivos };
}

const CLASES: Array<{ muestra: RegExp; nombre: string }> = [
  { muestra: /abcdefghijklmnopqrstuvwxyz/, nombre: "una minúscula" },
  { muestra: /ABCDEFGHIJKLMNOPQRSTUVWXYZ/, nombre: "una mayúscula" },
  { muestra: /0123456789/, nombre: "un número" },
  // GoTrue lista los símbolos así: !@#$%^&*()_+-=[]{};':"|<>?,./`~
  { muestra: /!@#\$%/, nombre: "un símbolo" },
];

function enLista(partes: string[]): string {
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

function mensajeCaracteres(mensaje: string): string {
  const pedidas = CLASES.filter(c => c.muestra.test(mensaje)).map(c => c.nombre);
  if (pedidas.length === 0) {
    return "A la contraseña le faltan tipos de carácter. Combina mayúsculas, minúsculas, números y símbolos.";
  }
  return `La contraseña debe incluir al menos ${enLista(pedidas)}.`;
}

function corta(mensaje: string): ErrorContrasena {
  const dicho = Number(/at least (\d+) characters/i.exec(mensaje)?.[1]);
  const minimo = Number.isFinite(dicho) && dicho > MINIMO_PROPIO ? dicho : MINIMO_PROPIO;
  return {
    motivo: "corta",
    minimo,
    mensaje: `La contraseña es demasiado corta. Usa al menos ${minimo} caracteres.`,
  };
}

/**
 * Si el error de Supabase es de CONTRASEÑA, devuelve el motivo y el mensaje en
 * español; si es de otra cosa (correo repetido, red, sesión), devuelve null y
 * quien llama sigue con su manejo de siempre.
 *
 * Manda el dato más fiable que haya: primero `reasons`, luego `code`, y el texto
 * en inglés solo como último recurso (es lo único que traen las versiones viejas
 * de GoTrue y los errores que ya pasaron por un JSON).
 */
export function leerErrorContrasena(error: unknown): ErrorContrasena | null {
  const { mensaje, codigo, motivos } = leer(error);
  if (!mensaje && !codigo && motivos.length === 0) return null;

  // Si Supabase dio `reasons`, mandan ELLAS y el texto no se interpreta: un
  // mensaje que junte varios requisitos puede nombrar uno que no es el que falló.
  // El texto solo decide cuando no hay reasons.
  const hayMotivos = motivos.length > 0;
  const es = (motivo: string, texto: RegExp) =>
    hayMotivos ? motivos.includes(motivo) : texto.test(mensaje);

  // La filtrada va primero: aunque además sea corta, «elige otra» es lo único
  // que la arregla, y es el aviso que de otro modo nadie le daría.
  if (es("pwned", /known to be weak|easy to guess|pwned/i)) {
    return { motivo: "filtrada", mensaje: MENSAJE_CONTRASENA_FILTRADA };
  }
  if (es("length", /password should be at least \d+ characters/i)) {
    return corta(mensaje);
  }
  if (es("characters", /password should contain at least one character/i)) {
    return { motivo: "caracteres", mensaje: mensajeCaracteres(mensaje) };
  }
  if (codigo === "same_password" || /different from the old password/i.test(mensaje)) {
    return {
      motivo: "igual",
      mensaje: "La contraseña nueva debe ser distinta de la anterior.",
    };
  }
  if (/password (cannot|can't|must not|should not) be longer than|longer than 72/i.test(mensaje)) {
    return { motivo: "larga", mensaje: "La contraseña no puede tener más de 72 caracteres." };
  }
  if (codigo === "weak_password" || /weak password|password is too weak/i.test(mensaje)) {
    return {
      motivo: "debil",
      mensaje: "Esta contraseña es demasiado débil. Elige una más larga y difícil de adivinar.",
    };
  }
  return null;
}

/** ¿Supabase dice que ese correo ya tiene cuenta? */
export function esCorreoYaRegistrado(error: unknown): boolean {
  const { mensaje, codigo } = leer(error);
  // «A user with this phone number has already been registered» usa la misma
  // frase: si el choque es de teléfono, no se le echa la culpa al correo.
  if (codigo === "phone_exists" || /phone/i.test(mensaje)) return false;
  return (
    codigo === "email_exists" ||
    codigo === "user_already_exists" ||
    /already (been )?registered|already exists/i.test(mensaje)
  );
}

/**
 * Para las superficies que enseñaban `error.message` tal cual: devuelve SIEMPRE
 * un texto en español. Los de contraseña salen de leerErrorContrasena; de los
 * demás se traducen los que un usuario puede provocar y entender, y todo lo que
 * no se reconoce cae a `respaldo` — nunca se deja pasar el inglés de GoTrue.
 */
export function traducirErrorDeAuth(error: unknown, respaldo: string): string {
  const deContrasena = leerErrorContrasena(error);
  if (deContrasena) return deContrasena.mensaje;

  const { mensaje, codigo } = leer(error);
  if (esCorreoYaRegistrado(error)) {
    return "Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña.";
  }
  if (
    codigo === "email_address_invalid" ||
    /email address .* is invalid|unable to validate email address|invalid email/i.test(mensaje)
  ) {
    return "El correo no es válido. Revísalo e inténtalo de nuevo.";
  }
  if (
    codigo === "over_request_rate_limit" ||
    codigo === "over_email_send_rate_limit" ||
    /rate limit|too many requests|for security purposes, you can only request this/i.test(mensaje)
  ) {
    return "Demasiados intentos seguidos. Espera un momento e inténtalo de nuevo.";
  }
  if (codigo === "signup_disabled" || /signups? not allowed/i.test(mensaje)) {
    return "El registro no está disponible en este momento. Inténtalo más tarde.";
  }
  if (/failed to fetch|fetch failed|network ?error|load failed/i.test(mensaje)) {
    return "No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.";
  }
  return respaldo;
}
