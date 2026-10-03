// Indicaciones postoperatorias y constancia de asistencia (ws1-t10, mejora 12 de
// la auditoría BEVADENT) — los textos DE FÁBRICA.
//
// Son genéricos y prudentes A PROPÓSITO: ninguno indica medicamentos, dosis ni
// tiempos clínicos finos; todos remiten a «las indicaciones de tu dentista». La
// clínica no los edita: los copia («Copiar y editar») y adapta su copia. Los
// revisa Rafael (DECISIONES PARA RAFAEL del reporte de ws1-t10).
//
// PURO: sin Prisma ni React. Lo leen la siembra (servidor), las pruebas y la
// pantalla de Plantillas (para saber de qué texto de fábrica sale una copia).

export type TipoHoja = "INDICACIONES" | "CONSTANCIA";

export interface TextoDeFabrica {
  /** Llave estable (va a la columna `factoryKey`). Nunca se renombra. */
  clave: string;
  tipo: TipoHoja;
  nombre: string;
  cuerpo: string;
  /**
   * Palabras (sin acentos, minúsculas) que, si aparecen en el nombre de un
   * procedimiento del catálogo o en el motivo de la cita, ligan este texto. Solo
   * proponen: quien está en la cita elige.
   */
  palabras: readonly string[];
  /** Palabras que, si aparecen, DESCARTAN la liga («Corona sobre implante» no es cirugía). */
  excluir?: readonly string[];
}

const CIERRE =
  "Sigue siempre las indicaciones de tu dentista: estas recomendaciones son generales y no sustituyen su valoración.";

const ALARMA =
  "Comunícate con la clínica si tienes sangrado que no se detiene, dolor o inflamación que aumentan con los días, fiebre o cualquier molestia que te preocupe.";

const MEDICAMENTOS =
  "Toma únicamente los medicamentos que te indicó tu dentista, en la forma y el horario que te indicó. No te automediques.";

export const TEXTOS_DE_FABRICA: readonly TextoDeFabrica[] = [
  {
    clave: "extraccion",
    tipo: "INDICACIONES",
    nombre: "Después de una extracción",
    palabras: ["extraccion", "exodoncia", "tercer molar", "terceros molares", "cordal", "muela del juicio"],
    cuerpo: [
      "Hola [NOMBRE_PACIENTE], estas son las indicaciones para cuidar la zona después de tu extracción:",
      "",
      "- Mantén mordida la gasa el tiempo que te indicó tu dentista. Si al retirarla sigue sangrando un poco, coloca una gasa limpia y vuelve a morder sin moverla.",
      "- Durante el primer día no escupas, no te enjuagues con fuerza ni uses popote: ayuda a que la herida cierre.",
      "- Evita fumar y las bebidas alcohólicas mientras la zona cicatriza.",
      "- Las primeras horas come alimentos blandos, tibios o fríos, y mastica del lado contrario.",
      "- Puedes aplicar frío por fuera de la cara (envuelto en un trapo), en ratos cortos.",
      "- Cepilla tus dientes con cuidado, sin tallar la zona de la extracción.",
      `- ${MEDICAMENTOS}`,
      "",
      ALARMA,
      "",
      CIERRE,
    ].join("\n"),
  },
  {
    clave: "cirugia",
    tipo: "INDICACIONES",
    nombre: "Después de una cirugía bucal",
    palabras: [
      "cirugia",
      "frenectomia",
      "frenilectomia",
      "apicectomia",
      "alargamiento de corona",
      "biopsia",
      "injerto",
      "elevacion de seno",
      "regeneracion",
    ],
    cuerpo: [
      "Hola [NOMBRE_PACIENTE], estas son las indicaciones para después de tu cirugía:",
      "",
      "- Descansa el resto del día y evita el ejercicio intenso los primeros días.",
      "- No levantes el labio ni toques la zona con los dedos o la lengua para revisarla.",
      "- Durante el primer día no escupas, no te enjuagues con fuerza ni uses popote.",
      "- Puedes aplicar frío por fuera de la cara (envuelto en un trapo), en ratos cortos.",
      "- Come alimentos blandos, tibios o fríos, y mastica del lado contrario.",
      "- Evita fumar y las bebidas alcohólicas mientras cicatriza.",
      "- Cepilla tus dientes con cuidado, sin tallar la zona operada.",
      "- Si te colocaron puntos, acude a la cita que te indicaron para revisarlos o retirarlos.",
      `- ${MEDICAMENTOS}`,
      "",
      ALARMA,
      "",
      CIERRE,
    ].join("\n"),
  },
  {
    clave: "implante",
    tipo: "INDICACIONES",
    nombre: "Después de la colocación de un implante",
    palabras: ["implante"],
    // La corona o la prótesis SOBRE el implante no es la cirugía.
    excluir: ["corona", "protesis", "retiro", "carga"],
    cuerpo: [
      "Hola [NOMBRE_PACIENTE], estas son las indicaciones para después de la colocación de tu implante:",
      "",
      "- Descansa el resto del día y evita el ejercicio intenso los primeros días.",
      "- No mastiques sobre la zona del implante hasta que tu dentista te lo indique.",
      "- Durante el primer día no escupas, no te enjuagues con fuerza ni uses popote.",
      "- Puedes aplicar frío por fuera de la cara (envuelto en un trapo), en ratos cortos.",
      "- Come alimentos blandos, tibios o fríos.",
      "- No fumes: el tabaco puede afectar la cicatrización del implante.",
      "- Mantén limpia la boca cepillando con cuidado alrededor de la zona.",
      "- Acude a todas las citas de revisión que te indicaron.",
      `- ${MEDICAMENTOS}`,
      "",
      ALARMA,
      "",
      CIERRE,
    ].join("\n"),
  },
  {
    clave: "endodoncia",
    tipo: "INDICACIONES",
    nombre: "Después de una endodoncia",
    palabras: ["endodoncia", "conducto", "pulpotomia", "pulpectomia", "retratamiento"],
    cuerpo: [
      "Hola [NOMBRE_PACIENTE], estas son las indicaciones para después de tu tratamiento de conductos (endodoncia):",
      "",
      "- Es normal sentir el diente sensible o molestia al morder durante algunos días.",
      "- Si te pusieron anestesia, no comas hasta que pase el adormecimiento para no morderte.",
      "- Mientras tengas una curación provisional, evita masticar alimentos duros o pegajosos con ese diente.",
      "- Si la curación provisional se cae o se rompe, avísanos.",
      "- El diente necesita su restauración definitiva (por ejemplo, una resina o una corona): acude a la cita que te indicaron para evitar que se fracture.",
      `- ${MEDICAMENTOS}`,
      "",
      "Comunícate con la clínica si el dolor aumenta en lugar de disminuir, si notas inflamación en la cara o la encía, si tienes fiebre o cualquier molestia que te preocupe.",
      "",
      CIERRE,
    ].join("\n"),
  },
  {
    clave: "limpieza",
    tipo: "INDICACIONES",
    nombre: "Después de una limpieza dental",
    palabras: ["profilaxis", "limpieza", "tartrectomia", "detartraje"],
    cuerpo: [
      "Hola [NOMBRE_PACIENTE], estas son las indicaciones para después de tu limpieza dental:",
      "",
      "- Puedes sentir algo de sensibilidad al frío o al calor durante unos días; suele pasar sola.",
      "- Es posible que tus encías sangren un poco al cepillarte los primeros días.",
      "- Si te aplicaron flúor, sigue las indicaciones de tu dentista sobre cuándo volver a comer y beber.",
      "- Cepilla tus dientes después de cada comida y usa hilo dental todos los días.",
      "- Agenda tu próxima limpieza cuando te lo indique tu dentista.",
      "",
      "Comunícate con la clínica si la sensibilidad o el sangrado no disminuyen con los días.",
      "",
      CIERRE,
    ].join("\n"),
  },
  {
    clave: "periodoncia",
    tipo: "INDICACIONES",
    nombre: "Después de un tratamiento de encías (raspado y alisado)",
    palabras: ["curetaje", "raspado", "alisado"],
    cuerpo: [
      "Hola [NOMBRE_PACIENTE], estas son las indicaciones para después de tu tratamiento de encías:",
      "",
      "- Es normal sentir sensibilidad al frío y molestia en las encías durante algunos días.",
      "- Si te pusieron anestesia, no comas hasta que pase el adormecimiento.",
      "- Los primeros días come alimentos blandos y evita los muy calientes, picantes o duros.",
      "- Cepilla con un cepillo suave y con cuidado; usa hilo dental o cepillos interdentales como te indicaron.",
      "- Usa enjuague bucal solo si tu dentista te lo indicó.",
      "- Evita fumar: dificulta que las encías sanen.",
      `- ${MEDICAMENTOS}`,
      "",
      ALARMA,
      "",
      CIERRE,
    ].join("\n"),
  },
  {
    clave: "resina",
    tipo: "INDICACIONES",
    nombre: "Después de una restauración (resina)",
    palabras: ["resina", "amalgama", "restauracion", "obturacion", "ionomero"],
    cuerpo: [
      "Hola [NOMBRE_PACIENTE], estas son las indicaciones para después de tu restauración:",
      "",
      "- Si te pusieron anestesia, no comas hasta que pase el adormecimiento para no morderte la lengua o el labio.",
      "- Puedes sentir sensibilidad leve al frío o al morder durante unos días.",
      "- Si al cerrar la boca sientes que muerdes «alto» en ese diente, avísanos para ajustarlo.",
      "- Evita morder objetos duros (uñas, plumas, hielo).",
      "- Café, té, vino tinto y tabaco pueden manchar la resina con el tiempo.",
      "",
      "Comunícate con la clínica si la sensibilidad aumenta, si tienes dolor al morder o si sientes un borde roto o filoso.",
      "",
      CIERRE,
    ].join("\n"),
  },
  {
    clave: "corona",
    tipo: "INDICACIONES",
    nombre: "Después de una corona, puente o provisional",
    palabras: ["corona", "puente", "incrustacion", "onlay", "inlay", "carilla", "provisional", "protesis fija"],
    excluir: ["alargamiento de corona"],
    cuerpo: [
      "Hola [NOMBRE_PACIENTE], estas son las indicaciones para cuidar tu corona, puente o provisional:",
      "",
      "- Si te pusieron anestesia, no comas hasta que pase el adormecimiento.",
      "- Con un provisional, evita alimentos duros o pegajosos (chicle, caramelos) de ese lado.",
      "- Al usar hilo dental cerca de un provisional, sácalo deslizándolo hacia un lado, no hacia arriba.",
      "- Si el provisional se despega, guárdalo y avísanos. No lo pegues con pegamento de casa.",
      "- Puedes sentir sensibilidad leve unos días.",
      "- Si sientes que muerdes «alto» o algo molesta al cerrar, avísanos para ajustarlo.",
      "",
      "Comunícate con la clínica si tienes dolor que aumenta o inflamación de la encía.",
      "",
      CIERRE,
    ].join("\n"),
  },
  {
    clave: "blanqueamiento",
    tipo: "INDICACIONES",
    nombre: "Después de un blanqueamiento",
    palabras: ["blanqueamiento"],
    cuerpo: [
      "Hola [NOMBRE_PACIENTE], estas son las indicaciones para después de tu blanqueamiento:",
      "",
      "- Es normal sentir sensibilidad temporal en los dientes.",
      "- Los días que te indique tu dentista, evita alimentos y bebidas con color: café, té, vino tinto, refrescos de cola, salsas y frutos rojos.",
      "- Evita fumar para que el resultado dure más.",
      "- Si usas guardas en casa, sigue exactamente las indicaciones de tu dentista sobre cuánto tiempo usarlas.",
      "",
      "Comunícate con la clínica si la sensibilidad es intensa o no disminuye.",
      "",
      CIERRE,
    ].join("\n"),
  },
  {
    clave: "constancia",
    tipo: "CONSTANCIA",
    nombre: "Constancia de asistencia",
    palabras: [],
    cuerpo: [
      "A quien corresponda:",
      "",
      "Por medio de la presente se hace constar que [NOMBRE_PACIENTE] asistió a consulta en [NOMBRE_CLINICA] el día [FECHA_CITA], de las [HORA_INICIO] a las [HORA_FIN] horas, y fue atendido(a) por [NOMBRE_DOCTOR], con cédula profesional [CEDULA_DOCTOR].",
      "",
      "Se extiende la presente a petición del interesado, para los fines que a este convengan, en [LUGAR], el [FECHA].",
    ].join("\n"),
  },
];

export function textoDeFabrica(clave: string | null | undefined): TextoDeFabrica | null {
  if (!clave) return null;
  return TEXTOS_DE_FABRICA.find((t) => t.clave === clave) ?? null;
}

/** Sin acentos, minúsculas y espacios simples: así se comparan nombres y palabras. */
export function normalizar(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** ¿El texto (nombre de procedimiento, motivo de la cita) toca a este texto de fábrica? */
export function coincideConFabrica(fabrica: TextoDeFabrica, texto: string | null | undefined): boolean {
  const n = ` ${normalizar(texto)} `;
  if (n.trim() === "") return false;
  if ((fabrica.excluir ?? []).some((p) => n.includes(normalizar(p)))) return false;
  return fabrica.palabras.some((p) => n.includes(` ${normalizar(p)}`));
}
