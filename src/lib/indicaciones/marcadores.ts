// Los marcadores que se pueden escribir en una hoja (indicaciones o constancia).
// Misma sintaxis de corchetes que las plantillas de nota y consentimiento
// (`[NOMBRE_PACIENTE]`…), para que la clínica no aprenda otra.
//
// PURO: sin Prisma ni React (lo carga el editor del navegador).

import type { TipoHoja } from "./fabrica";

export interface MarcadorHoja {
  token: string;
  /** Clave del texto que lo explica en `textos.ts` (`marcadores.<clave>`). */
  clave: MarcadorClave;
  /** En qué hojas tiene sentido. */
  tipos: readonly TipoHoja[];
}

export type MarcadorClave =
  | "nombrePaciente"
  | "nombreClinica"
  | "telefonoClinica"
  | "nombreDoctor"
  | "cedulaDoctor"
  | "fechaCita"
  | "horaInicio"
  | "horaFin"
  | "procedimiento"
  | "lugar"
  | "fecha";

const AMBAS: readonly TipoHoja[] = ["INDICACIONES", "CONSTANCIA"];

export const MARCADORES_HOJA: readonly MarcadorHoja[] = [
  { token: "[NOMBRE_PACIENTE]", clave: "nombrePaciente", tipos: AMBAS },
  { token: "[NOMBRE_CLINICA]", clave: "nombreClinica", tipos: AMBAS },
  { token: "[TELEFONO_CLINICA]", clave: "telefonoClinica", tipos: AMBAS },
  { token: "[NOMBRE_DOCTOR]", clave: "nombreDoctor", tipos: AMBAS },
  { token: "[CEDULA_DOCTOR]", clave: "cedulaDoctor", tipos: AMBAS },
  { token: "[FECHA_CITA]", clave: "fechaCita", tipos: AMBAS },
  { token: "[HORA_INICIO]", clave: "horaInicio", tipos: ["CONSTANCIA"] },
  { token: "[HORA_FIN]", clave: "horaFin", tipos: ["CONSTANCIA"] },
  { token: "[PROCEDIMIENTO]", clave: "procedimiento", tipos: ["INDICACIONES"] },
  { token: "[LUGAR]", clave: "lugar", tipos: ["CONSTANCIA"] },
  { token: "[FECHA]", clave: "fecha", tipos: AMBAS },
];

export function marcadoresDelTipo(tipo: TipoHoja): MarcadorHoja[] {
  return MARCADORES_HOJA.filter((m) => m.tipos.includes(tipo));
}

/** Los valores con que se rellena; lo que falta sale como raya para llenarse a mano. */
export type ValoresHoja = Partial<Record<MarcadorClave, string | null | undefined>>;

/** La raya de un dato que no hay (una cédula sin capturar): se llena a mano, nunca se inventa. */
export const RAYA = "________";

const TOKEN = /\[([A-Z_]+)\]/g;

/**
 * Sustituye los marcadores conocidos. Un dato vacío sale como raya. Un `[ALGO]`
 * que no es marcador se deja tal cual: puede ser texto de la clínica.
 */
export function rellenarHoja(cuerpo: string, valores: ValoresHoja): string {
  const porToken = new Map(MARCADORES_HOJA.map((m) => [m.token, m.clave] as const));
  return String(cuerpo ?? "").replace(TOKEN, (todo) => {
    const clave = porToken.get(todo);
    if (!clave) return todo;
    const v = (valores[clave] ?? "").toString().trim();
    return v || RAYA;
  });
}

/** `[ALGO]` en mayúsculas que NO es marcador: el editor avisa (probablemente un error al escribirlo). */
export function marcadoresDesconocidos(cuerpo: string): string[] {
  const conocidos = new Set(MARCADORES_HOJA.map((m) => m.token));
  const vistos = new Set<string>();
  for (const m of String(cuerpo ?? "").matchAll(TOKEN)) {
    if (!conocidos.has(m[0])) vistos.add(m[0]);
  }
  return Array.from(vistos);
}
