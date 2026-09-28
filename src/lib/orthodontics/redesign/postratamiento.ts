// ═══════════════════════════════════════════════════════════════════════════
// Ortodoncia — qué enseña la sección «Post-tratamiento» de la ficha
// (ws1-t5, ronda 6 · sección I de la revisión de uso: «cosas que existen y no
// están conectadas»).
//
// Al pasar un caso a retención se SIEMBRAN tres encuestas de satisfacción
// (+3 días, +6 meses, +12 meses), pero ningún proceso las envía. La pantalla
// decía «Se manda por WhatsApp 3 días después de retirar los brackets» y
// listaba las tres como «scheduled». Lo mismo con Referidos: un código «—» y
// un botón de copiar que no copiaba nada.
//
// La Ola 0 ya había decidido QUITAR las dos cosas y les quitó los botones; se
// quedaron las tarjetas. Aquí se cierra: cada tarjeta se enseña solo si tiene
// algo REAL que enseñar, y nunca promete un envío.
//
//   · Encuesta  → solo si alguna se envió o se respondió de verdad.
//   · Referidos → solo si el paciente tiene un código.
//   · PDF antes/después → siempre (funciona).
//
// No se borra nada: las filas sembradas siguen en la base y los componentes
// siguen en su archivo, para el día que el envío se conecte.
//
// PURO: sin Prisma, sin React, sin CSS (un test que importe un .module.css
// no corre).
// ═══════════════════════════════════════════════════════════════════════════

export type TipoDeEncuesta = "POST_DEBOND_3D" | "POST_DEBOND_6M" | "POST_DEBOND_12M";
export type EstadoDeEncuesta = "SCHEDULED" | "SENT" | "RESPONDED" | "EXPIRED" | "CANCELLED";

export interface EncuestaSembrada {
  npsType: TipoDeEncuesta;
  status: EstadoDeEncuesta | string;
  npsScore: number | null;
  googleReviewTriggered: boolean;
}

const CUANDO: Record<TipoDeEncuesta, string> = {
  POST_DEBOND_3D: "a los 3 días",
  POST_DEBOND_6M: "a los 6 meses",
  POST_DEBOND_12M: "a los 12 meses",
};

const ORDEN: TipoDeEncuesta[] = ["POST_DEBOND_3D", "POST_DEBOND_6M", "POST_DEBOND_12M"];

/** ¿Esta encuesta llegó a salir hacia el paciente? Sembrada no es enviada. */
export function encuestaSalio(e: Pick<EncuestaSembrada, "status">): boolean {
  return e.status === "SENT" || e.status === "RESPONDED" || e.status === "EXPIRED";
}

/** El estado con palabras de la clínica. Nunca el valor crudo de la base. */
export function estadoDeEncuestaEnPalabras(e: Pick<EncuestaSembrada, "status" | "npsScore">): string {
  switch (e.status) {
    case "RESPONDED":
      return e.npsScore != null ? `${e.npsScore} de 10` : "Respondida";
    case "SENT":
      return "Enviada, sin respuesta";
    case "EXPIRED":
      return "No respondió";
    case "CANCELLED":
      return "Cancelada";
    case "SCHEDULED":
    default:
      // Sembrada y sin proceso que la envíe: no se dice «programada», que
      // suena a que va a salir sola.
      return "Sin enviar";
  }
}

export interface FilaDeEncuesta {
  clave: TipoDeEncuesta;
  etiqueta: string;
  estado: string;
}

export interface VistaDePostratamiento {
  encuesta: {
    visible: boolean;
    filas: FilaDeEncuesta[];
    /** «2 de 3 respondidas». */
    resumen: string;
    resenaPedida: boolean;
  };
  referidos: { visible: boolean };
  /** Cuántas tarjetas se pintan (el PDF siempre cuenta): 1, 2 o 3. */
  tarjetas: 1 | 2 | 3;
  /** Subtítulo de la sección, con solo lo que se ve. */
  subtitulo: string;
}

export function vistaDePostratamiento(args: {
  encuestas: readonly EncuestaSembrada[];
  codigoDeReferidos: string | null | undefined;
}): VistaDePostratamiento {
  const encuestas = [...args.encuestas].sort((a, b) => ORDEN.indexOf(a.npsType) - ORDEN.indexOf(b.npsType));
  const encuestaVisible = encuestas.some(encuestaSalio);
  const respondidas = encuestas.filter((e) => e.status === "RESPONDED").length;
  const enviadas = encuestas.filter(encuestaSalio).length;

  const codigo = (args.codigoDeReferidos ?? "").trim();
  const referidosVisible = codigo !== "" && codigo !== "—";

  const partes = ["Comparativa final"];
  if (encuestaVisible) partes.push("satisfacción");
  if (referidosVisible) partes.push("referidos");
  const subtitulo =
    partes.length === 1
      ? partes[0]
      : `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;

  return {
    encuesta: {
      visible: encuestaVisible,
      filas: encuestas.map((e) => ({
        clave: e.npsType,
        etiqueta: `Encuesta ${CUANDO[e.npsType] ?? ""}`.trim(),
        estado: estadoDeEncuestaEnPalabras(e),
      })),
      resumen: `${respondidas} de ${enviadas} respondida${enviadas === 1 ? "" : "s"}`,
      resenaPedida: encuestas.some((e) => e.googleReviewTriggered),
    },
    referidos: { visible: referidosVisible },
    tarjetas: (1 + (encuestaVisible ? 1 : 0) + (referidosVisible ? 1 : 0)) as 1 | 2 | 3,
    subtitulo,
  };
}
