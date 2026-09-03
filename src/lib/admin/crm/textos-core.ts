// ═══════════════════════════════════════════════════════════════════════
// "MIS TEXTOS" — el guion de venta de DaleControl. Núcleo PURO.
//
// Qué es: los mensajes que se le mandan a un prospecto, escritos UNA vez y
// reusados. No es una plantilla de WhatsApp Business (esas se aprueban en
// Meta y las manda el producto); esto se COPIA AL PORTAPAPELES y lo pega
// una persona. Por eso no hay estados de entrega ni aprobación: es una
// libreta de textos.
//
// Este archivo NO toca la base ni importa nada de servidor: lo comparten
// la pantalla y el servicio, igual que crm-core.ts. Lo que habla con
// Prisma vive en ./textos-service.ts.
//
// ── LOS HUECOS, Y LA TRAMPA QUE RESUELVEN ──────────────────────────────
// Un texto puede traer {{negocio}}, {{ciudad}}… y se rellenan solos con el
// prospecto que se tiene abierto. La trampa está en el prospecto al que le
// FALTA ese dato: "Hola {{contacto}}," con contacto vacío produciría
// "Hola ,", que es exactamente el mensaje que hace que no te contesten.
//
// Se resuelve en dos tiempos:
//   1. `{{saludo}}` existe para no tener que escribir "Hola {{contacto}},".
//      Resuelve solo a "Hola Dra. Ana," o a "Hola, buen día:" — es la
//      MISMA regla que ya usa crmPlantillaWhatsapp, no una segunda.
//   2. Lo que quede vacío se limpia: espacios dobles, " ," y " ." sueltos.
//      Y `crmRellenarTexto` devuelve QUÉ faltó para que la pantalla lo
//      diga antes de copiar, en vez de callarlo.
//
// Un hueco mal escrito ({{nomre}}) se rechaza AL GUARDAR, no al copiar:
// descubrirlo pegado en WhatsApp es descubrirlo tarde.
// ═══════════════════════════════════════════════════════════════════════
import {
  crmEsEtapa,
  crmEsVertical,
  crmEtapa,
  crmTextoPlano,
  crmVertical,
  CRM_VERTICALES,
} from "./crm-core";

// ── Lo que viaja a la pantalla ──────────────────────────────────────────

export interface CrmTextoDTO {
  id: string;
  title: string;
  body: string;
  /** Giro al que le queda. null = sirve para cualquiera. */
  vertical: string | null;
  /** Momento del embudo. null = sirve en cualquier momento. */
  stage: string | null;
  sortOrder: number;
  createdByEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrmTextoEntrada {
  title?: string | null;
  body?: string | null;
  vertical?: string | null;
  stage?: string | null;
}

export const CRM_TEXTO_TITULO_MAX = 80;
export const CRM_TEXTO_CUERPO_MAX = 4000;
/** Tope de textos. Es una libreta personal, no un catálogo. */
export const CRM_TEXTOS_MAX = 300;

// ── Los huecos ──────────────────────────────────────────────────────────

/** El dato del prospecto que necesita un hueco para rellenarse. */
export interface CrmTextoProspecto {
  name?: string | null;
  contactName?: string | null;
  city?: string | null;
  state?: string | null;
  vertical?: string | null;
  size?: number | null;
}

export interface CrmHueco {
  /** Lo que se escribe entre llaves: {{negocio}}. */
  clave: string;
  /** Cómo se llama en la ayuda de la pantalla. */
  etiqueta: string;
  /** Con qué se ve en la vista previa cuando no hay prospecto abierto. */
  ejemplo: string;
  /**
   * true = se resuelve SIEMPRE (el dato es obligatorio o tiene un valor por
   * omisión honesto). false = puede quedar vacío, y entonces se avisa.
   */
  siempre: boolean;
}

/**
 * EL CATÁLOGO COMPLETO. Nueve, y ni uno más: cada hueco que se agrega es un
 * hueco que hay que recordar al escribir. Todos salen del prospecto que se
 * tiene abierto — aquí NO entra nada interno (el valor mensual estimado, el
 * motivo de pérdida, quién lo recomendó): son datos NUESTROS, y un texto
 * que los pegue en un WhatsApp se los manda al prospecto.
 */
export const CRM_HUECOS: readonly CrmHueco[] = [
  {
    clave: "saludo",
    etiqueta: "Saludo",
    ejemplo: "Hola Dra. Ana,",
    siempre: true,
  },
  { clave: "negocio", etiqueta: "Nombre del negocio", ejemplo: "Clínica Dental Sonrisa", siempre: true },
  { clave: "contacto", etiqueta: "Persona de contacto", ejemplo: "Dra. Ana Ruiz", siempre: false },
  { clave: "ciudad", etiqueta: "Ciudad", ejemplo: "Puebla", siempre: false },
  { clave: "estado", etiqueta: "Estado", ejemplo: "Puebla", siempre: false },
  { clave: "giro", etiqueta: "Giro", ejemplo: "Clínica dental", siempre: true },
  { clave: "producto", etiqueta: "Producto que se le vende", ejemplo: "DaleControl Dental", siempre: true },
  { clave: "medida", etiqueta: "Cómo se mide su tamaño", ejemplo: "consultorios", siempre: true },
  { clave: "tamano", etiqueta: "Su tamaño", ejemplo: "4", siempre: false },
];

const HUECOS_POR_CLAVE = new Map<string, CrmHueco>(CRM_HUECOS.map((h) => [h.clave, h]));

/**
 * Encuentra los huecos escritos en un texto. Acepta espacios dentro de las
 * llaves ({{ negocio }}) porque es lo que sale al copiar y pegar de otro
 * lado, y la clave se compara en minúsculas.
 */
const HUECO_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function crmHuecosDelTexto(cuerpo: string | null | undefined): string[] {
  const vistos: string[] = [];
  const texto = String(cuerpo ?? "");
  HUECO_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HUECO_RE.exec(texto)) !== null) {
    const clave = String(m[1] ?? "").toLowerCase();
    if (clave && vistos.indexOf(clave) === -1) vistos.push(clave);
  }
  return vistos;
}

/** Los huecos escritos que NO existen en el catálogo. */
export function crmHuecosDesconocidos(cuerpo: string | null | undefined): string[] {
  return crmHuecosDelTexto(cuerpo).filter((c) => !HUECOS_POR_CLAVE.has(c));
}

/**
 * El saludo. Es la MISMA regla de crmPlantillaWhatsapp, a propósito: dos
 * saludos distintos según de dónde salga el texto es justo la incoherencia
 * que hace que un guion de venta se sienta improvisado.
 */
export function crmSaludo(contacto: string | null | undefined): string {
  const nombre = String(contacto ?? "").trim();
  return nombre ? `Hola ${nombre},` : "Hola, buen día:";
}

/**
 * Deja el texto presentable después de sustituir. Es lo que evita el
 * "Hola ," y el " ." de un hueco que se quedó vacío.
 *
 * Sólo toca espacios y el signo que quedó suelto: NUNCA junta líneas ni
 * quita saltos, porque los párrafos del mensaje son del que lo escribió.
 */
export function crmLimpiarTexto(texto: string): string {
  return String(texto ?? "")
    .split("\n")
    .map((linea) =>
      linea
        // Espacios y tabuladores repetidos → uno.
        .replace(/[ \t]{2,}/g, " ")
        // El espacio que dejó un hueco vacío antes de su puntuación.
        // Ojo: el % NO va en la lista. "50 %" se escribe con espacio en
        // todo el panel y juntarlo sería cambiarle el texto a quien lo puso.
        .replace(/[ \t]+([,.;:!?])/g, "$1")
        .replace(/\(\s+/g, "(")
        .replace(/\s+\)/g, ")")
        // Coma pegada a otra coma por dos huecos vacíos seguidos.
        .replace(/,\s*,/g, ",")
        .replace(/\s+$/g, ""),
    )
    .join("\n")
    .trim();
}

export interface CrmTextoRelleno {
  /** El texto listo para copiar. */
  texto: string;
  /** Etiquetas de los huecos que se quedaron sin dato (para avisar). */
  faltantes: string[];
  /** Claves escritas que no existen en el catálogo (no deberían llegar aquí). */
  desconocidos: string[];
}

/**
 * Rellena los huecos con los datos del prospecto.
 *
 * NO falla ni bloquea cuando falta un dato: devuelve el texto ya limpio y
 * la lista de lo que faltó. Quien decide si eso importa es la persona que
 * está a punto de mandarlo, no esta función — a veces el mensaje se manda
 * igual y el nombre se escribe a mano.
 */
export function crmRellenarTexto(
  cuerpo: string | null | undefined,
  p: CrmTextoProspecto | null | undefined,
): CrmTextoRelleno {
  const original = String(cuerpo ?? "");
  const desconocidos = crmHuecosDesconocidos(original);
  const faltantes: string[] = [];

  const v = crmVertical(p?.vertical);
  const contacto = String(p?.contactName ?? "").trim();
  const ciudad = String(p?.city ?? "").trim();
  const estado = String(p?.state ?? "").trim();
  const negocio = String(p?.name ?? "").trim();
  const tamano =
    p?.size === null || p?.size === undefined || !Number.isFinite(Number(p.size))
      ? ""
      : String(p.size);

  const valores: Record<string, string> = {
    saludo: crmSaludo(contacto),
    negocio,
    contacto,
    ciudad,
    estado,
    giro: v.label,
    producto: v.producto,
    medida: v.medida.toLowerCase(),
    tamano,
  };

  HUECO_RE.lastIndex = 0;
  const sustituido = original.replace(HUECO_RE, (coincidencia, clave: string) => {
    const c = String(clave ?? "").toLowerCase();
    const hueco = HUECOS_POR_CLAVE.get(c);
    // Un hueco que no existe se deja TAL CUAL: verlo entre llaves en la
    // vista previa es lo que hace que se corrija; borrarlo lo escondería.
    if (!hueco) return coincidencia;
    const valor = valores[c] ?? "";
    if (!valor && faltantes.indexOf(hueco.etiqueta) === -1) faltantes.push(hueco.etiqueta);
    return valor;
  });

  return { texto: crmLimpiarTexto(sustituido), faltantes, desconocidos };
}

/** La vista previa de la pantalla de edición, con datos de ejemplo. */
export const CRM_PROSPECTO_EJEMPLO: CrmTextoProspecto = {
  name: "Clínica Dental Sonrisa",
  contactName: "Dra. Ana Ruiz",
  city: "Puebla",
  state: "Puebla",
  vertical: "DENTAL",
  size: 4,
};

// ── Validación ──────────────────────────────────────────────────────────

/**
 * El MISMO validador para el formulario y para la server action. Si la
 * pantalla validara por su cuenta, el botón se pondría verde y la acción
 * reventaría después — el criterio de crmValidarProspecto.
 */
export function crmValidarTexto(entrada: CrmTextoEntrada): string | null {
  const titulo = String(entrada?.title ?? "").trim();
  if (!titulo) return "Ponle un título al texto: es como lo vas a encontrar después.";
  if (titulo.length > CRM_TEXTO_TITULO_MAX) {
    return `El título no puede pasar de ${CRM_TEXTO_TITULO_MAX} caracteres.`;
  }

  const cuerpo = String(entrada?.body ?? "").trim();
  if (!cuerpo) return "Escribe el mensaje.";
  if (cuerpo.length > CRM_TEXTO_CUERPO_MAX) {
    return `El mensaje no puede pasar de ${CRM_TEXTO_CUERPO_MAX} caracteres.`;
  }

  if (entrada?.vertical && !crmEsVertical(entrada.vertical)) {
    return "Ese giro no existe en el catálogo.";
  }
  if (entrada?.stage && !crmEsEtapa(entrada.stage)) {
    return "Esa etapa no existe en el catálogo.";
  }

  const malos = crmHuecosDesconocidos(cuerpo);
  if (malos.length > 0) {
    const lista = malos.map((c) => `{{${c}}}`).join(", ");
    const validos = CRM_HUECOS.map((h) => `{{${h.clave}}}`).join(", ");
    return `${lista} no existe. Los huecos que se rellenan solos son: ${validos}.`;
  }

  return null;
}

// ── Orden y agrupación ──────────────────────────────────────────────────

/**
 * El orden de la libreta: el que puso la persona, y a igualdad el título.
 * Sin el desempate por título, dos textos recién creados (los dos con
 * sortOrder 0) se intercambiarían de sitio entre recargas.
 */
export function crmOrdenarTextos<T extends { sortOrder: number; title: string }>(lista: T[]): T[] {
  return [...lista].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "es"),
  );
}

export interface CrmGrupoTextos {
  /** Id del giro, o "" para los que sirven para cualquiera. */
  verticalId: string;
  titulo: string;
  textos: CrmTextoDTO[];
}

/**
 * Agrupados POR GIRO, y no por etapa del embudo.
 *
 * Por qué el giro: lo que cambia de raíz entre un texto y otro es QUÉ se
 * está vendiendo — a una escuela de odontología no se le manda ni de lejos
 * el mensaje de una barbería, y eso ya está en el catálogo (cada vertical
 * trae su `producto`). La etapa cambia el MOMENTO, no casi nunca las
 * palabras: el mismo "te vuelvo a escribir por si lo viste" sirve en
 * Contactado y en Propuesta. Por eso la etapa viaja como etiqueta —
 * filtra y ordena— pero no parte la lista en ocho pedazos donde los tres
 * textos de dental quedarían desperdigados.
 */
export function crmAgruparTextos(lista: CrmTextoDTO[]): CrmGrupoTextos[] {
  const ordenados = crmOrdenarTextos(lista);
  const grupos: CrmGrupoTextos[] = [];
  const indice = new Map<string, CrmGrupoTextos>();

  function grupo(verticalId: string, titulo: string): CrmGrupoTextos {
    let g = indice.get(verticalId);
    if (!g) {
      g = { verticalId, titulo, textos: [] };
      indice.set(verticalId, g);
      grupos.push(g);
    }
    return g;
  }

  // Primero "cualquier giro" — son los que más se usan — y después los
  // giros del catálogo EN SU ORDEN, para que la lista no baile según qué
  // texto se creó primero.
  const hayGenericos = ordenados.some((t) => !t.vertical);
  if (hayGenericos) grupo("", "Para cualquier giro");
  for (const v of CRM_VERTICALES) {
    if (ordenados.some((t) => t.vertical === v.id)) grupo(v.id, v.label);
  }

  for (const t of ordenados) {
    const id = t.vertical ?? "";
    // Un giro retirado del catálogo se queda con su propio grupo al final
    // en vez de perder el texto (el criterio del tablero con las etapas).
    const g = indice.get(id) ?? grupo(id, crmVertical(id).label);
    g.textos.push(t);
  }

  return grupos;
}

export interface CrmTextosParaProspecto {
  /** Los que le quedan a este prospecto, del más específico al más general. */
  sugeridos: CrmTextoDTO[];
  /** El resto. Se SIGUEN enseñando: esconderlos haría dudar de la lista. */
  otros: CrmTextoDTO[];
}

/**
 * Qué textos le quedan al prospecto que está abierto.
 *
 * "Le queda" = su giro coincide (o el texto sirve para cualquiera) Y su
 * etapa coincide (o el texto sirve en cualquier momento). Lo que no le
 * queda NO se esconde: se manda a "otros". Una lista que oculta cosas es
 * una lista en la que se deja de confiar, y a veces el texto de dental es
 * justo el que se quiere adaptar para una barbería.
 */
export function crmTextosParaProspecto(
  lista: CrmTextoDTO[],
  p: { vertical?: string | null; stage?: string | null } | null | undefined,
): CrmTextosParaProspecto {
  const ordenados = crmOrdenarTextos(lista);
  const verticalId = crmVertical(p?.vertical).id;
  const etapaId = crmEtapa(p?.stage).id;

  const sugeridos: CrmTextoDTO[] = [];
  const otros: CrmTextoDTO[] = [];

  for (const t of ordenados) {
    const giroOk = !t.vertical || t.vertical === verticalId;
    const etapaOk = !t.stage || t.stage === etapaId;
    if (giroOk && etapaOk) sugeridos.push(t);
    else otros.push(t);
  }

  // Del más específico al más general, y a igualdad el orden de la libreta.
  // `sort` de JS es estable desde ES2019, así que el desempate ya lo puso
  // crmOrdenarTextos y no hace falta repetirlo aquí.
  const peso = (t: CrmTextoDTO) => (t.vertical ? 0 : 1) + (t.stage ? 0 : 1);
  sugeridos.sort((a, b) => peso(a) - peso(b));

  return { sugeridos, otros };
}

/** Búsqueda dentro de la libreta: título y cuerpo, sin acentos. */
export function crmTextoCoincide(t: CrmTextoDTO, consulta: string): boolean {
  const q = crmTextoPlano(consulta).trim();
  if (!q) return true;
  const heno = `${crmTextoPlano(t.title)} ${crmTextoPlano(t.body)}`;
  return q.split(/\s+/).every((palabra) => heno.indexOf(palabra) !== -1);
}

/** Cómo se lee el alcance de un texto en la pantalla. */
export function crmAlcanceTexto(t: { vertical: string | null; stage: string | null }): string {
  const giro = t.vertical ? crmVertical(t.vertical).label : "Cualquier giro";
  const etapa = t.stage ? crmEtapa(t.stage).label : "Cualquier momento";
  return `${giro} · ${etapa}`;
}
