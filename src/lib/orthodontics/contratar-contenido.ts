/**
 * Lo que INCLUYE el módulo de Ortodoncia, por categorías (ws1-t3, 28-sep-2026).
 * Es lo que lee la clínica en la página de contratar, antes de pagar.
 *
 * REGLA: cada línea describe algo que EXISTE hoy en pantalla. Se comprobó
 * contra el código el 28-sep-2026 (archivo de cada cosa en
 * REPORTE-ws1-t3.md, «Contratar Ortodoncia»). Antes de añadir una línea,
 * comprueba que la función está conectada a una pantalla; una librería
 * suelta no cuenta.
 *
 * Cancelado por Rafael, no se promete: hacer la cefalometría dentro del panel
 * (marcar puntos a mano) y cualquier análisis automático. Lo que hay es
 * guardar el PDF que entrega el centro radiológico.
 *
 * Sin React ni íconos a propósito: los íconos los pone la vista por `id`.
 */

export interface CategoriaIncluida {
  id:
    | "casos"
    | "cobro"
    | "controles"
    | "recepcion"
    | "tablero"
    | "imagen"
    | "paciente";
  titulo: string;
  /** Una línea: para qué sirve. */
  resumen: string;
  /** Tres o cuatro líneas cortas. */
  puntos: string[];
}

export const CONTENIDO_ORTODONCIA: readonly CategoriaIncluida[] = [
  {
    id: "casos",
    titulo: "Casos y expediente",
    resumen: "Cada tratamiento con su diagnóstico y su plan, dentro de la ficha del paciente.",
    puntos: [
      "Alta del caso desde la ficha: clase de Angle, overjet, overbite y apiñamiento",
      "Aparatología, duración estimada y doctor tratante",
      "Responsable del pago, para cobrar juntos a los hermanos",
      "Paciente en observación, con la fecha de su próxima revisión",
    ],
  },
  {
    id: "cobro",
    titulo: "Cobro y mensualidades",
    resumen: "El tratamiento a plazos, con lo que ya se pagó y lo que falta siempre a la vista.",
    puntos: [
      "Plan de pagos con enganche y mensualidades",
      "Abonos de cualquier monto, hasta el saldo",
      "Promesas de pago, con su seguimiento",
      "Saldo vencido y próxima mensualidad de cada caso",
    ],
  },
  {
    id: "controles",
    titulo: "Controles y agenda",
    resumen: "Los controles son citas de tu Agenda de siempre, con su hoja de control.",
    puntos: [
      "Siete tipos de cita de ortodoncia, que puedes editar",
      "Hoja de control por cita: arco, elásticos, activaciones e indicaciones",
      "Fecha sugerida del siguiente control",
      "Hoja firmada y ligada a su cita",
    ],
  },
  {
    id: "recepcion",
    titulo: "Recepción y Caja",
    resumen: "Tu recepción sabe quién debe y cuánto, sin preguntarle al doctor.",
    puntos: [
      "Mensualidades vencidas, de hoy y de los próximos 7 días, en Caja",
      "Cada una con su botón de cobrar",
      "Hermanos con el mismo responsable, en un solo cobro",
      "Aviso de mensualidades vencidas en la pantalla de Hoy",
    ],
  },
  {
    id: "tablero",
    titulo: "Tablero y alertas",
    resumen: "El estado de todos tus casos, de un vistazo.",
    puntos: [
      "Pacientes activos, controles de hoy y saldos vencidos",
      "Lo que va a entrar por mensualidades en los próximos 6 meses",
      "Producción del mes por doctor",
      "Cinco alertas: mensualidad vencida, sin control agendado, falta a un control, por terminar y pasado de fecha",
    ],
  },
  {
    id: "imagen",
    titulo: "Imagen, alineadores y elásticos",
    resumen: "Los registros del caso, juntos y a la mano.",
    puntos: [
      "Fotos por etapa: inicial, 3 meses, 6 meses y control",
      "El PDF de la cefalometría que te entrega tu centro radiológico, guardado en el caso",
      "Acceso a las radiografías del paciente desde su caso",
      "Alineadores: cuál debería traer hoy y si va atrasado",
      "Elásticos: cumplimiento de los últimos 14 días",
      "Cálculo de Bolton",
    ],
  },
  {
    id: "paciente",
    titulo: "Paciente: portal y WhatsApp",
    resumen: "Tu paciente también ve su tratamiento.",
    puntos: [
      "Portal del paciente: su mensualidad, su saldo y su próximo control",
      "Registra sus elásticos y te manda fotos de seguimiento",
      "Recordatorio de mensualidad por WhatsApp desde Alertas",
      "Indicaciones del control por WhatsApp desde el Tablero",
    ],
  },
];

/**
 * Lo que NO se lista todavía, y por qué. No se pinta en ningún sitio: está
 * aquí para que quien lo termine sepa qué línea añadir arriba.
 */
export const PENDIENTE_DE_LISTAR: readonly { categoria: CategoriaIncluida["id"]; linea: string; porQue: string }[] = [
  {
    categoria: "cobro",
    linea: "Tu clínica elige: a plazos o pago por control",
    porQue:
      "El pago por control existe en el servidor (billing-mode.ts, updateOrthoClinicSettings), pero ninguna pantalla deja elegirlo: todas las clínicas quedan en «a plazos».",
  },
  {
    categoria: "imagen",
    linea: "Fotos con líneas: línea E, ángulo nasolabial y línea media",
    porQue:
      "La pantalla existe, pero pide la imagen a /api/files/<id>, una ruta que no existe (responde 404), y los puntos marcados no se guardan.",
  },
];
