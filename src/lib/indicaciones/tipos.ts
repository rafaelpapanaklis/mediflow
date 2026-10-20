// Formas que comparten servidor, cliente y pruebas. PURO.

import type { TipoHoja } from "./fabrica";

export type { TipoHoja };

export const TIPOS_HOJA: readonly TipoHoja[] = ["INDICACIONES", "CONSTANCIA"];

export function esTipoHoja(v: unknown): v is TipoHoja {
  return v === "INDICACIONES" || v === "CONSTANCIA";
}

/** Una hoja de la clínica tal como viaja a la pantalla. */
export interface HojaDTO {
  id: string;
  tipo: TipoHoja;
  nombre: string;
  cuerpo: string;
  /** Procedimientos del catálogo de la clínica a los que está ligada (solo indicaciones). */
  procedureIds: string[];
  /** Sembrada por DaleControl: el nombre no cambia; el texto se edita como versión de la clínica; la liga y el «en uso» sí. */
  deFabrica: boolean;
  /** El texto que rige es el de la clínica (editó la de fábrica). Solo en las de fábrica. */
  versionDeClinica?: boolean;
  /** De qué texto de fábrica es (la de fábrica) o de cuál salió (una copia). */
  basadaEn: string | null;
  activa: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Un procedimiento del catálogo, sin precio ni costo (esto no los necesita). */
export interface ProcedimientoLigable {
  id: string;
  name: string;
  isActive: boolean;
}

export const MAX_NOMBRE_HOJA = 120;
export const MAX_CUERPO_HOJA = 6000;
export const MAX_PROCEDIMIENTOS_HOJA = 200;

export type CodigoHoja =
  | "SIN_TABLA"
  | "TIPO_INVALIDO"
  | "NOMBRE_REQUERIDO"
  | "NOMBRE_LARGO"
  | "CUERPO_REQUERIDO"
  | "CUERPO_LARGO"
  | "NOMBRE_OCUPADO"
  | "NO_ENCONTRADA"
  | "FABRICA_NO_SE_EDITA"
  | "NO_ES_DE_FABRICA"
  | "VERSIONES_NO_DISPONIBLES";

export const STATUS_HOJA: Record<CodigoHoja, number> = {
  SIN_TABLA: 503,
  TIPO_INVALIDO: 400,
  NOMBRE_REQUERIDO: 400,
  NOMBRE_LARGO: 400,
  CUERPO_REQUERIDO: 400,
  CUERPO_LARGO: 400,
  NOMBRE_OCUPADO: 409,
  NO_ENCONTRADA: 404,
  FABRICA_NO_SE_EDITA: 409,
  NO_ES_DE_FABRICA: 409,
  VERSIONES_NO_DISPONIBLES: 503,
};

/**
 * Con `"strict": false` un `!r.ok` no estrecha la unión: las dos formas declaran
 * los dos campos para que `r.codigo` y `r.hoja` se lean sin TS2339.
 */
export type ResultadoHoja =
  | { ok: true; hoja: HojaDTO; codigo?: undefined; status?: undefined }
  | { ok: false; codigo: CodigoHoja; status: number; hoja?: undefined };

/** Lo que contesta GET /api/indicaciones/cita/[id] (el cuadro de la cita). */
export interface ContextoCita {
  /** La biblioteca existe (SQL pegado). Sin ella solo hay constancia de fábrica. */
  disponible: boolean;
  estado: string;
  admiteIndicaciones: boolean;
  admiteConstancia: boolean;
  paciente: string;
  procedimientos: string[];
  /** Las de indicaciones en uso, con el texto ya relleno con los datos de la cita. */
  indicaciones: Array<{ id: string; nombre: string; deFabrica: boolean; texto: string }>;
  sugeridas: string[];
  constancias: Array<{ id: string; nombre: string; deFabrica: boolean }>;
  constanciaPorDefecto: string | null;
  whatsapp: {
    modo: "text" | "template" | "blocked";
    motivo: "WA_SIN_CONECTAR" | "SIN_TELEFONO" | "FUERA_DE_VENTANA" | "PLANTILLA_EN_REVISION" | "PLANTILLA_RECHAZADA" | null;
  };
  /** Si las indicaciones ya salieron por WhatsApp hace menos de 10 min (ISO). */
  ultimoEnvio: string | null;
  /** C-60: el doctor de la cita, y si le falta la cédula (la constancia avisa antes de imprimirse en blanco). */
  doctor?: string;
  doctorSinCedula?: boolean;
  /** N-29: por qué no se puede emitir la constancia (o null). */
  motivoSinConstancia?: string | null;
}
