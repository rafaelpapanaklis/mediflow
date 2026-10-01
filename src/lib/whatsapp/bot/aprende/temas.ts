/**
 * Tema de una pregunta de paciente (ws1-t11). Puro y barato: palabras clave,
 * sin IA. Sirve para agrupar el reporte «lo que el bot no supo contestar».
 *
 * El orden importa: lo clínico va primero (se cuenta, pero nunca se ofrece
 * convertirlo en respuesta automática) y «pagos» va antes que «precios» para
 * que «¿aceptan tarjeta?» no caiga en precios.
 */
import { motivoClinico } from "./anonimizar";

export type ClaveTema =
  | "clinico"
  | "pagos"
  | "precios"
  | "horarios"
  | "ubicacion"
  | "citas"
  | "tratamientos"
  | "otros";

export const ETIQUETA_TEMA: Record<ClaveTema, string> = {
  clinico: "Salud del paciente (no se automatiza)",
  pagos: "Formas de pago y seguros",
  precios: "Precios",
  horarios: "Horarios",
  ubicacion: "Ubicación y cómo llegar",
  citas: "Citas",
  tratamientos: "Tratamientos",
  otros: "Otras preguntas",
};

const REGLAS: Array<{ clave: Exclude<ClaveTema, "clinico" | "otros">; re: RegExp }> = [
  {
    clave: "pagos",
    re: /\b(tarjeta|efectivo|transferencia|deposito|meses sin intereses|msi|a meses|factura|facturan|seguro|aseguradora|gastos medicos|credito|financiamiento|pagos? en parcialidades|mercado ?pago|paypal)\b/,
  },
  { clave: "precios", re: /\b(cuanto (cuesta|cobran|sale|es)|precio|precios|costo|costos|cuesta|cobran|tarifa|promocion|descuento|\$\s?\d)/ },
  { clave: "horarios", re: /\b(horario|horarios|abren|cierran|abierto|atienden (el|los|hoy|en)|sabado|sabados|domingo|domingos|dias festivos|a que hora)\b/ },
  {
    clave: "ubicacion",
    re: /\b(donde (estan|queda|se ubican)|direccion|ubicacion|ubicados|estacionamiento|como llego|como llegar|sucursal|sucursales|cerca de|metro|mapa)\b/,
  },
  { clave: "citas", re: /\b(cita|citas|agendar|agenda|reagendar|cancelar|disponibilidad|espacio|lugar para|turno|consulta)\b/ },
  {
    clave: "tratamientos",
    re: /\b(limpieza|ortodoncia|brackets|frenos|alineadores|invisalign|blanqueamiento|implante|implantes|endodoncia|resina|resinas|corona|coronas|extraccion|muela del juicio|carillas|valoracion|protesis|placa|guarda|periodoncia|odontopediatr|pediatric)\b/,
  },
];

function normalizar(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[¿?¡!.,;:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function temaDePregunta(texto: string): ClaveTema {
  if (motivoClinico(texto)) return "clinico";
  const n = normalizar(texto);
  for (const r of REGLAS) if (r.re.test(n)) return r.clave;
  return "otros";
}

/** Orden en que se pintan los grupos del reporte (el clínico, al final). */
export const ORDEN_TEMAS: ClaveTema[] = ["precios", "pagos", "horarios", "ubicacion", "citas", "tratamientos", "otros", "clinico"];
