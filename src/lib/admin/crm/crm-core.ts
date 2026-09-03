// ═══════════════════════════════════════════════════════════════════════
// CRM DE VENTAS DE DALECONTROL — el catálogo y las cuentas, en PURO.
//
// Este archivo es la fuente única de: qué etapas existe un prospecto, qué
// verticales se venden, de dónde salió el contacto, qué se puede anotar en
// la bitácora y cómo se arma el enlace de WhatsApp/llamada. No importa
// Prisma ni nada de servidor a propósito: lo usan por igual la pantalla
// (componente cliente) y el servicio (servidor), y así los dos deciden con
// las MISMAS reglas. Un catálogo duplicado en el componente es un catálogo
// que un día enseña una etapa que la base no acepta.
//
// ── POR QUÉ LAS ETAPAS SON `String` Y NO UN ENUM DE POSTGRES ───────────
// El resto del repo usa enums de Prisma (RealtyLeadStage, EduCaseStatus…).
// Aquí NO, y es a propósito: un embudo de ventas se retoca seguido —hoy
// son ocho etapas, mañana sobra "Negociación" o falta "Prueba gratis"— y
// cada retoque de un enum de Postgres es un ALTER TYPE que hay que correr
// a mano en Supabase antes de desplegar. Con TEXT + este catálogo, agregar
// una etapa es editar este arreglo y ya. La integridad que pierde la base
// la pone la escritura: el servicio valida contra estas listas ANTES de
// guardar (ver `crmEsEtapa`, `crmEsVertical`, …) y la lectura nunca truena
// con un valor desconocido — lo pinta con su etiqueta cruda.
//
// ── FECHAS ────────────────────────────────────────────────────────────
// `nextActionAt` es una FECHA DE CALENDARIO (el día que toca seguir), no
// un instante: se guarda a las 12:00 UTC (ver `crmFechaDeCalendario`).
// Medianoche UTC caería a las 18:00 del día ANTERIOR en México y el
// seguimiento se pintaría un día antes en todo el país. Los INSTANTES de
// verdad (cuándo le escribí) se guardan tal cual.
// ═══════════════════════════════════════════════════════════════════════
import { mxTenDigits } from "@/lib/phone-mx";

// ── Zona horaria ────────────────────────────────────────────────────────

/**
 * Offset fijo de México (UTC-6, sin horario de verano desde 2023), igual
 * que `src/lib/caja.ts` y `analytics/query.ts`. Ancla "hoy" al día natural
 * de quien vende, no al de UTC: a las 19:00 de Ciudad de México ya es
 * mañana en UTC y la lista de "hoy toca" se vaciaría sola.
 */
export const CRM_MX_OFFSET_MS = 6 * 60 * 60 * 1000;

/** Día calendario mexicano de un instante, como "YYYY-MM-DD". */
export function crmDiaMx(d: Date): string {
  const mx = new Date(d.getTime() - CRM_MX_OFFSET_MS);
  const y = mx.getUTCFullYear();
  const m = String(mx.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(mx.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Instante en que EMPIEZA el día natural mexicano de `ahora`. */
export function crmInicioDelDiaMx(ahora: Date = new Date()): Date {
  const mx = new Date(ahora.getTime() - CRM_MX_OFFSET_MS);
  const medianoche = Date.UTC(mx.getUTCFullYear(), mx.getUTCMonth(), mx.getUTCDate());
  return new Date(medianoche + CRM_MX_OFFSET_MS);
}

/** Instante en que TERMINA el día natural mexicano de `ahora` (exclusivo). */
export function crmFinDelDiaMx(ahora: Date = new Date()): Date {
  return new Date(crmInicioDelDiaMx(ahora).getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Convierte lo que teclea un `<input type="date">` ("2026-09-15") en el
 * instante que se guarda: MEDIODÍA UTC, con la Z explícita. A las 12:00
 * UTC no hay zona mexicana (UTC-6 a UTC-8) que cambie de día, así que la
 * fecha nunca retrocede al pintarla ni al reenviar el formulario.
 * Devuelve null si el texto no es una fecha.
 */
export function crmFechaDeCalendario(valor: string | null | undefined): Date | null {
  const s = String(valor ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** El inverso: el instante guardado de vuelta al valor de un `<input type="date">`. */
export function crmValorDeInput(fecha: Date | string | null | undefined): string {
  if (!fecha) return "";
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return "";
  return crmDiaMx(d);
}

/**
 * El día calendario que cae `n` días después de HOY en México, listo para
 * un `<input type="date">`. Lo usan los botones de posponer de la lista de
 * "hoy toca": posponer un día es un día contado desde hoy, no desde la
 * fecha vencida — si contara desde la fecha, posponer algo de hace tres
 * semanas lo dejaría igual de vencido.
 */
export function crmDiaRelativo(n: number, ahora: Date = new Date()): string {
  const base = crmInicioDelDiaMx(ahora).getTime();
  return crmDiaMx(new Date(base + n * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000));
}

// ── Etapas del embudo ───────────────────────────────────────────────────

export type CrmEtapaId =
  | "NUEVO"
  | "CONTACTADO"
  | "INTERESADO"
  | "DEMO"
  | "PROPUESTA"
  | "NEGOCIACION"
  | "GANADO"
  | "PERDIDO";

export type CrmTono = "neutral" | "info" | "brand" | "warning" | "success" | "danger";

export interface CrmEtapa {
  id: CrmEtapaId;
  label: string;
  /** Qué significa de verdad estar aquí. Se enseña en el tablero. */
  ayuda: string;
  tono: CrmTono;
  /** GANADO y PERDIDO cierran el prospecto: salen del pipeline abierto. */
  terminal?: boolean;
}

/** El embudo, EN ORDEN. El orden es el de las columnas del tablero. */
export const CRM_ETAPAS: readonly CrmEtapa[] = [
  {
    id: "NUEVO",
    label: "Sin contactar",
    ayuda: "Está en la lista y todavía nadie le ha escrito.",
    tono: "neutral",
  },
  {
    id: "CONTACTADO",
    label: "Contactado",
    ayuda: "Ya le escribí o le marqué; sigo esperando respuesta.",
    tono: "info",
  },
  {
    id: "INTERESADO",
    label: "Interesado",
    ayuda: "Contestó y quiere saber más. Aquí es donde se gana o se enfría.",
    tono: "info",
  },
  {
    id: "DEMO",
    label: "Junta / demo",
    ayuda: "Hay una demostración acordada, aunque la fecha esté por confirmar.",
    tono: "brand",
  },
  {
    id: "PROPUESTA",
    label: "Propuesta enviada",
    ayuda: "Ya conoce precios y está evaluando.",
    tono: "brand",
  },
  {
    id: "NEGOCIACION",
    label: "Negociación",
    ayuda: "Se está discutiendo precio, plazo o condiciones.",
    tono: "warning",
  },
  {
    id: "GANADO",
    label: "Ya es cliente",
    ayuda: "Cerrado: contrató.",
    tono: "success",
    terminal: true,
  },
  {
    id: "PERDIDO",
    label: "Perdido",
    ayuda: "No va a pasar, al menos por ahora. Guarda el motivo.",
    tono: "danger",
    terminal: true,
  },
];

const ETAPAS_POR_ID = new Map<string, CrmEtapa>(CRM_ETAPAS.map((e) => [e.id, e]));

export function crmEsEtapa(valor: unknown): valor is CrmEtapaId {
  return typeof valor === "string" && ETAPAS_POR_ID.has(valor);
}

/**
 * Metadatos de una etapa. NUNCA lanza: una fila con una etapa desconocida
 * (edición a mano en Supabase, etapa retirada del catálogo) tiene que
 * seguir pintándose en el tablero, no tumbar la pantalla entera.
 */
export function crmEtapa(id: string | null | undefined): CrmEtapa {
  const encontrada = ETAPAS_POR_ID.get(String(id ?? ""));
  if (encontrada) return encontrada;
  return {
    id: (id || "NUEVO") as CrmEtapaId,
    label: id ? String(id) : "Sin contactar",
    ayuda: "Etapa fuera del catálogo.",
    tono: "neutral",
  };
}

export function crmEtapaEsTerminal(id: string | null | undefined): boolean {
  return crmEtapa(id).terminal === true;
}

/** Las etapas que siguen abiertas — las que suman al pipeline. */
export const CRM_ETAPAS_ABIERTAS: readonly CrmEtapaId[] = CRM_ETAPAS.filter(
  (e) => !e.terminal,
).map((e) => e.id);

/** La siguiente etapa del embudo, para el botón "Avanzar". Null si ya cerró. */
export function crmEtapaSiguiente(id: string | null | undefined): CrmEtapaId | null {
  const i = CRM_ETAPAS.findIndex((e) => e.id === id);
  if (i < 0) return "CONTACTADO";
  const siguiente = CRM_ETAPAS[i + 1];
  if (!siguiente || siguiente.terminal) return null;
  return siguiente.id;
}

/**
 * Cómo se le enseña la etapa AL SOCIO que recomendó el prospecto.
 *
 * No se le enseña el embudo interno. Un afiliado no necesita saber si vamos
 * en "Propuesta enviada" o en "Negociación" —es información de ventas de
 * DaleControl— y sí necesita saber lo único que le importa: si su
 * recomendación sigue viva y si ya se convirtió en cliente (que es cuando
 * cobra). Cuatro estados, y ni uno más.
 */
export function crmEstadoParaAfiliado(stage: string | null | undefined): {
  label: string;
  ayuda: string;
  tono: CrmTono;
} {
  const id = crmEtapa(stage).id;
  if (id === "GANADO") {
    return { label: "Ya es cliente", ayuda: "Contrató. Gracias por la recomendación.", tono: "success" };
  }
  if (id === "PERDIDO") {
    return { label: "No prosperó", ayuda: "No se pudo cerrar, al menos por ahora.", tono: "danger" };
  }
  if (id === "NUEVO") {
    return { label: "Recibido", ayuda: "Ya está en la lista de DaleControl; todavía no lo contactamos.", tono: "neutral" };
  }
  return { label: "En seguimiento", ayuda: "DaleControl ya está hablando con ellos.", tono: "info" };
}

// ── Verticales (qué producto se le vende) ───────────────────────────────

export interface CrmVertical {
  id: string;
  label: string;
  /** Cómo se llama "el tamaño" en ese giro: cambia la etiqueta del campo. */
  medida: string;
  /** Producto de DaleControl que se le ofrece. Va en la plantilla de WhatsApp. */
  producto: string;
}

export const CRM_VERTICALES: readonly CrmVertical[] = [
  { id: "DENTAL", label: "Clínica dental", medida: "Consultorios", producto: "DaleControl Dental" },
  { id: "INSTITUCION", label: "Universidad / escuela", medida: "Estudiantes", producto: "DaleControl Institucional" },
  { id: "BARBERIA", label: "Barbería", medida: "Sillones", producto: "DaleControl Barber" },
  { id: "INMOBILIARIA", label: "Inmobiliaria", medida: "Asesores", producto: "DaleControl Inmuebles" },
  { id: "LABORATORIO", label: "Laboratorio dental", medida: "Técnicos", producto: "DaleControl Labs" },
  { id: "PROVEEDOR", label: "Proveedor / depósito", medida: "Sucursales", producto: "DaleControl Proveedores" },
  { id: "OTRO", label: "Otro", medida: "Personas", producto: "DaleControl" },
];

const VERTICALES_POR_ID = new Map<string, CrmVertical>(CRM_VERTICALES.map((v) => [v.id, v]));

export function crmEsVertical(valor: unknown): boolean {
  return typeof valor === "string" && VERTICALES_POR_ID.has(valor);
}

export function crmVertical(id: string | null | undefined): CrmVertical {
  return (
    VERTICALES_POR_ID.get(String(id ?? "")) ?? {
      id: (id || "OTRO") as string,
      label: id ? String(id) : "Otro",
      medida: "Personas",
      producto: "DaleControl",
    }
  );
}

// ── De dónde salió ──────────────────────────────────────────────────────

export const CRM_FUENTES: readonly { id: string; label: string }[] = [
  { id: "GOOGLE_MAPS", label: "Google Maps" },
  { id: "INSTAGRAM", label: "Instagram" },
  { id: "FACEBOOK", label: "Facebook" },
  { id: "REFERIDO", label: "Referido / recomendación" },
  { id: "AFILIADO", label: "Socio afiliado" },
  { id: "LLAMADA_FRIA", label: "Prospección en frío" },
  { id: "EVENTO", label: "Congreso o evento" },
  { id: "SITIO_WEB", label: "Llegó al sitio" },
  { id: "WHATSAPP", label: "Escribió por WhatsApp" },
  { id: "OTRO", label: "Otro" },
];

const FUENTES_POR_ID = new Map(CRM_FUENTES.map((f) => [f.id, f.label]));

export function crmEsFuente(valor: unknown): boolean {
  return typeof valor === "string" && FUENTES_POR_ID.has(valor);
}

export function crmFuenteLabel(id: string | null | undefined): string {
  if (!id) return "Sin fuente";
  return FUENTES_POR_ID.get(id) ?? id;
}

// ── Bitácora ────────────────────────────────────────────────────────────

export type CrmActividadId =
  | "WHATSAPP"
  | "LLAMADA"
  | "EMAIL"
  | "REUNION"
  | "VISITA"
  | "NOTA"
  | "ETAPA";

export interface CrmActividad {
  id: CrmActividadId;
  label: string;
  /**
   * true = es un CONTACTO real y mueve `lastContactAt`. Una nota interna
   * ("me dijeron que el dueño viaja") no es haber contactado a nadie: si
   * contara, el semáforo de "días sin contacto" mentiría.
   */
  cuentaComoContacto: boolean;
  /** La escribe el sistema, no se ofrece en el compositor. */
  sistema?: boolean;
}

export const CRM_ACTIVIDADES: readonly CrmActividad[] = [
  { id: "WHATSAPP", label: "WhatsApp", cuentaComoContacto: true },
  { id: "LLAMADA", label: "Llamada", cuentaComoContacto: true },
  { id: "EMAIL", label: "Correo", cuentaComoContacto: true },
  { id: "REUNION", label: "Junta / demo", cuentaComoContacto: true },
  { id: "VISITA", label: "Visita", cuentaComoContacto: true },
  { id: "NOTA", label: "Nota", cuentaComoContacto: false },
  { id: "ETAPA", label: "Cambio de etapa", cuentaComoContacto: false, sistema: true },
];

const ACTIVIDADES_POR_ID = new Map<string, CrmActividad>(CRM_ACTIVIDADES.map((a) => [a.id, a]));

export function crmEsActividad(valor: unknown): valor is CrmActividadId {
  return typeof valor === "string" && ACTIVIDADES_POR_ID.has(valor);
}

export function crmActividad(id: string | null | undefined): CrmActividad {
  return (
    ACTIVIDADES_POR_ID.get(String(id ?? "")) ?? {
      id: (id || "NOTA") as CrmActividadId,
      label: id ? String(id) : "Nota",
      cuentaComoContacto: false,
    }
  );
}

/** Lo que el usuario puede registrar a mano (todo menos lo que escribe el sistema). */
export const CRM_ACTIVIDADES_MANUALES: readonly CrmActividad[] = CRM_ACTIVIDADES.filter(
  (a) => !a.sistema,
);

export function crmActividadCuentaComoContacto(id: string | null | undefined): boolean {
  return crmActividad(id).cuentaComoContacto;
}

/** Cómo terminó el intento de contacto. Sólo aplica a WhatsApp/llamada/correo. */
export const CRM_RESULTADOS: readonly { id: string; label: string; tono: CrmTono }[] = [
  { id: "CONTESTO", label: "Contestó", tono: "success" },
  { id: "NO_CONTESTO", label: "No contestó", tono: "neutral" },
  { id: "PIDIO_DESPUES", label: "Pidió que le busque después", tono: "warning" },
  { id: "DATO_MALO", label: "El dato está mal", tono: "danger" },
  { id: "NO_INTERESA", label: "No le interesa", tono: "danger" },
];

const RESULTADOS_POR_ID = new Map(CRM_RESULTADOS.map((r) => [r.id, r]));

export function crmEsResultado(valor: unknown): boolean {
  return typeof valor === "string" && RESULTADOS_POR_ID.has(valor);
}

export function crmResultadoLabel(id: string | null | undefined): string {
  if (!id) return "";
  return RESULTADOS_POR_ID.get(id)?.label ?? id;
}

export function crmResultadoTono(id: string | null | undefined): CrmTono {
  if (!id) return "neutral";
  return RESULTADOS_POR_ID.get(id)?.tono ?? "neutral";
}

// ── Contacto: enlaces de WhatsApp, teléfono y correo ────────────────────

/**
 * Número listo para wa.me. Reglas, en este orden:
 *   1. Si son 10 dígitos mexicanos (con o sin +52 / +521 de más), se le
 *      antepone 52 — es lo que espera wa.me.
 *   2. Si trae 11 dígitos o más, ya viene con lada de país: se usa tal cual.
 *   3. Cualquier otra cosa (un fijo a 8 dígitos, un dato incompleto) NO
 *      arma enlace. Vale más un botón apagado que abrir WhatsApp con un
 *      número inventado.
 */
export function crmWhatsappNumero(telefono: string | null | undefined): string | null {
  const diez = mxTenDigits(telefono);
  if (diez) return `52${diez}`;
  const digitos = String(telefono ?? "").replace(/\D/g, "");
  if (digitos.length >= 11 && digitos.length <= 15) return digitos;
  return null;
}

/** Enlace wa.me con el mensaje ya escrito. Null si el número no sirve. */
export function crmWhatsappLink(
  telefono: string | null | undefined,
  mensaje?: string | null,
): string | null {
  const numero = crmWhatsappNumero(telefono);
  if (!numero) return null;
  const texto = String(mensaje ?? "").trim();
  return texto
    ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
    : `https://wa.me/${numero}`;
}

/**
 * Enlace `tel:`. Más permisivo que WhatsApp a propósito: un conmutador de
 * universidad a 8 dígitos se marca igual desde el celular.
 */
export function crmTelLink(telefono: string | null | undefined): string | null {
  const diez = mxTenDigits(telefono);
  if (diez) return `tel:+52${diez}`;
  const digitos = String(telefono ?? "").replace(/\D/g, "");
  if (digitos.length < 7) return null;
  return `tel:+${digitos.length >= 11 ? digitos : `52${digitos}`}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function crmEsEmail(valor: string | null | undefined): boolean {
  return EMAIL_RE.test(String(valor ?? "").trim());
}

export function crmMailLink(
  email: string | null | undefined,
  asunto?: string,
  cuerpo?: string,
): string | null {
  const e = String(email ?? "").trim();
  if (!crmEsEmail(e)) return null;
  const partes: string[] = [];
  if (asunto) partes.push(`subject=${encodeURIComponent(asunto)}`);
  if (cuerpo) partes.push(`body=${encodeURIComponent(cuerpo)}`);
  return partes.length ? `mailto:${e}?${partes.join("&")}` : `mailto:${e}`;
}

/** Teléfono legible: "55 1234 5678" si son 10 dígitos mexicanos. */
export function crmTelefonoLegible(telefono: string | null | undefined): string {
  const diez = mxTenDigits(telefono);
  if (!diez) return String(telefono ?? "").trim();
  return `${diez.slice(0, 2)} ${diez.slice(2, 6)} ${diez.slice(6)}`;
}

// ── Plantillas de primer contacto ───────────────────────────────────────

/**
 * El primer mensaje ya escrito, por vertical. Existe porque el momento en
 * que se pierde un prospecto es el de "ahorita le escribo": si hay que
 * redactar desde cero, se pospone. El texto sale con el nombre de quien
 * contesta cuando se sabe, y NUNCA promete nada que el producto no haga.
 */
export function crmPlantillaWhatsapp(
  vertical: string | null | undefined,
  opciones?: { negocio?: string | null; contacto?: string | null },
): string {
  const saludo = opciones?.contacto?.trim()
    ? `Hola ${opciones.contacto.trim()},`
    : "Hola, buen día:";
  const negocio = opciones?.negocio?.trim();
  const deQuien = negocio ? ` de ${negocio}` : "";

  switch (crmVertical(vertical).id) {
    case "INSTITUCION":
      return (
        `${saludo} le escribo de DaleControl Institucional. Es el sistema que usan las ` +
        `escuelas de odontología para llevar el padrón de estudiantes, asignar sillones, ` +
        `supervisar el expediente de cada caso y autorizar los tratamientos antes de que ` +
        `se hagan, todo en un solo lugar. ¿Le parece si le muestro en 20 minutos cómo se ` +
        `vería con los grupos${deQuien}?`
      );
    case "BARBERIA":
      return (
        `${saludo} le escribo de DaleControl Barber: agenda, comisiones de cada barbero, ` +
        `corte de caja y recordatorios por WhatsApp para que no se caigan las citas. ` +
        `¿Le muestro cómo funciona en 15 minutos?`
      );
    case "INMOBILIARIA":
      return (
        `${saludo} le escribo de DaleControl Inmuebles: seguimiento de prospectos, ` +
        `contratos con firma, cobranza de rentas y publicación en portales desde un solo ` +
        `panel. ¿Le late si se lo enseño en 15 minutos?`
      );
    case "LABORATORIO":
      return (
        `${saludo} le escribo de DaleControl Labs: las clínicas le mandan la orden desde ` +
        `su sistema, usted ve el pedido, el avance y el cobro sin cadenas de WhatsApp. ` +
        `¿Le muestro cómo se vería${deQuien}?`
      );
    case "PROVEEDOR":
      return (
        `${saludo} le escribo de DaleControl: conectamos a los depósitos dentales con las ` +
        `clínicas que ya usan nuestro sistema, para que le compren desde ahí. ` +
        `¿Le interesa que le platique cómo funciona?`
      );
    default:
      return (
        `${saludo} le escribo de DaleControl Dental 🦷 Es el sistema con el que las ` +
        `clínicas llevan agenda, expediente, radiografías y cobros en un solo lugar, y ` +
        `mandan los recordatorios por WhatsApp para que no se les caigan las citas. ` +
        `¿Le parece si le muestro en 15 minutos cómo quedaría${deQuien}?`
      );
  }
}

// ── Semáforo del seguimiento ────────────────────────────────────────────

export type CrmSemaforo = "vencido" | "hoy" | "proximo" | "sin-fecha";

/**
 * Cómo va el próximo paso. Se compara por DÍA NATURAL MEXICANO, no por
 * instante: un seguimiento puesto para hoy no puede aparecer "vencido" a
 * las 00:05 de México sólo porque en UTC ya sea otro día.
 */
export function crmSemaforo(
  nextActionAt: Date | string | null | undefined,
  ahora: Date = new Date(),
): CrmSemaforo {
  if (!nextActionAt) return "sin-fecha";
  const d = nextActionAt instanceof Date ? nextActionAt : new Date(nextActionAt);
  if (Number.isNaN(d.getTime())) return "sin-fecha";
  const dia = crmDiaMx(d);
  const hoy = crmDiaMx(ahora);
  if (dia < hoy) return "vencido";
  if (dia === hoy) return "hoy";
  return "proximo";
}

export function crmSemaforoTono(s: CrmSemaforo): CrmTono {
  if (s === "vencido") return "danger";
  if (s === "hoy") return "warning";
  if (s === "proximo") return "info";
  return "neutral";
}

/** "Vencido hace 3 días" / "Hoy" / "En 5 días" / "" */
export function crmSemaforoTexto(
  nextActionAt: Date | string | null | undefined,
  ahora: Date = new Date(),
): string {
  const s = crmSemaforo(nextActionAt, ahora);
  if (s === "sin-fecha") return "";
  if (s === "hoy") return "Hoy";
  const dias = Math.abs(crmDiasEntre(nextActionAt as Date | string, ahora));
  if (s === "vencido") return dias === 1 ? "Venció ayer" : `Venció hace ${dias} días`;
  return dias === 1 ? "Mañana" : `En ${dias} días`;
}

/**
 * Días naturales mexicanos entre dos instantes (b − a). Positivo si `b` es
 * posterior. Se cuenta por día de calendario, no por horas: "ayer a las
 * 23:00" es 1 día, no 0.
 */
export function crmDiasEntre(a: Date | string, b: Date | string): number {
  const da = a instanceof Date ? a : new Date(a);
  const db = b instanceof Date ? b : new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 0;
  const ia = crmInicioDelDiaMx(da).getTime();
  const ib = crmInicioDelDiaMx(db).getTime();
  return Math.round((ib - ia) / (24 * 60 * 60 * 1000));
}

/** Días sin tocar al prospecto. Null si nunca se le ha contactado. */
export function crmDiasSinContacto(
  lastContactAt: Date | string | null | undefined,
  ahora: Date = new Date(),
): number | null {
  if (!lastContactAt) return null;
  const d = lastContactAt instanceof Date ? lastContactAt : new Date(lastContactAt);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, crmDiasEntre(d, ahora));
}

/**
 * Prospecto ENFRIÁNDOSE: abierto, ya contactado alguna vez y sin nada
 * anotado en 14 días. No es lo mismo que un seguimiento vencido (ese tiene
 * fecha puesta); este es el que se olvidó sin dejar rastro.
 */
export const CRM_DIAS_PARA_ENFRIARSE = 14;

export function crmEstaFrio(
  p: { stage?: string | null; lastContactAt?: Date | string | null },
  ahora: Date = new Date(),
): boolean {
  if (crmEtapaEsTerminal(p?.stage)) return false;
  const dias = crmDiasSinContacto(p?.lastContactAt, ahora);
  if (dias === null) return false;
  return dias >= CRM_DIAS_PARA_ENFRIARSE;
}

// ── Validación de lo que se guarda ──────────────────────────────────────

export interface CrmProspectoEntrada {
  name?: string | null;
  vertical?: string | null;
  stage?: string | null;
  source?: string | null;
  contactName?: string | null;
  contactRole?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  website?: string | null;
  size?: number | string | null;
  monthlyValue?: number | string | null;
  nextActionAt?: string | null;
  nextActionNote?: string | null;
  notes?: string | null;
  lostReason?: string | null;
  clinicId?: string | null;
}

export const CRM_NOMBRE_MAX = 160;
export const CRM_TEXTO_MAX = 4000;

/**
 * Devuelve el mensaje de error, o null si pasa. Un solo validador para el
 * formulario y para la server action: si validaran distinto, el botón se
 * pondría verde y la acción reventaría después.
 */
export function crmValidarProspecto(entrada: CrmProspectoEntrada): string | null {
  const nombre = String(entrada?.name ?? "").trim();
  if (!nombre) return "Ponle nombre al prospecto (la clínica, el consultorio o la escuela).";
  if (nombre.length > CRM_NOMBRE_MAX) return `El nombre no puede pasar de ${CRM_NOMBRE_MAX} caracteres.`;

  if (entrada?.vertical && !crmEsVertical(entrada.vertical)) return "Ese giro no existe en el catálogo.";
  if (entrada?.stage && !crmEsEtapa(entrada.stage)) return "Esa etapa no existe en el catálogo.";
  if (entrada?.source && !crmEsFuente(entrada.source)) return "Esa fuente no existe en el catálogo.";

  const email = String(entrada?.email ?? "").trim();
  if (email && !crmEsEmail(email)) return "El correo no se ve bien escrito.";

  const size = crmNumeroOpcional(entrada?.size);
  if (size !== null && (size < 0 || size > 100000)) return "El tamaño no se ve real.";

  const valor = crmNumeroOpcional(entrada?.monthlyValue);
  if (valor !== null && (valor < 0 || valor > 10000000)) return "El valor mensual no se ve real.";

  if (entrada?.nextActionAt && !crmFechaDeCalendario(entrada.nextActionAt)) {
    return "La fecha del próximo paso no es válida.";
  }
  return null;
}

/** "" / null / basura → null. "12" → 12. Acepta comas y $ pegados. */
export function crmNumeroOpcional(valor: number | string | null | undefined): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const limpio = String(valor).replace(/[^0-9.-]/g, "");
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/** Recorta y devuelve null si queda vacío — para no guardar "" en columnas opcionales. */
export function crmTextoOpcional(valor: string | null | undefined, max = CRM_TEXTO_MAX): string | null {
  const s = String(valor ?? "").trim();
  if (!s) return null;
  return s.slice(0, max);
}

/** Etiquetas libres: minúsculas, sin repetidos, máximo 12. */
export function crmNormalizarEtiquetas(valor: string[] | string | null | undefined): string[] {
  const crudas = Array.isArray(valor)
    ? valor
    : String(valor ?? "")
        .split(",")
        .map((s) => s);
  const vistas: string[] = [];
  for (const c of crudas) {
    const t = String(c ?? "").trim().toLowerCase().slice(0, 24);
    if (t && vistas.indexOf(t) === -1) vistas.push(t);
    if (vistas.length >= 12) break;
  }
  return vistas;
}

// ── Búsqueda ────────────────────────────────────────────────────────────

/** Los signos que NFD deja sueltos detrás de una vocal acentuada. */
const DIACRITICO_MIN = 0x300;
const DIACRITICO_MAX = 0x36f;

/**
 * Minúsculas y sin acentos: así se comparan los textos al buscar y al
 * detectar repetidos en la importación. Buscar "clinica" tiene que
 * encontrar "Clínica".
 *
 * El filtrado va carácter por carácter y no con una clase de regex: el
 * rango se escribe con sus códigos a la vista, en vez de con caracteres
 * combinantes invisibles que cualquier editor puede estropear.
 */
export function crmTextoPlano(v: string | null | undefined): string {
  const descompuesto = String(v ?? "").normalize("NFD");
  let limpio = "";
  for (const c of descompuesto) {
    const cp = c.codePointAt(0) ?? 0;
    if (cp >= DIACRITICO_MIN && cp <= DIACRITICO_MAX) continue;
    limpio += c;
  }
  return limpio.toLowerCase();
}

export interface CrmBuscable {
  name?: string | null;
  contactName?: string | null;
  contactRole?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  notes?: string | null;
  nextActionNote?: string | null;
  tags?: string[];
}

/**
 * El buscador de la pantalla. Corre en el NAVEGADOR sobre la lista ya
 * cargada, y no como un `contains` de Prisma, por dos motivos concretos:
 * `contains` no escapa los comodines de LIKE (un "%" tecleado devolvería
 * todo) y no sabe que "55-1234-5678" y "5512345678" son el mismo número.
 *
 * Varias palabras se exigen TODAS ("sonrisa puebla" encuentra la Clínica
 * Sonrisa de Puebla, no todas las de Puebla), y si lo tecleado tiene
 * cuatro dígitos o más también se compara contra el teléfono por dígitos.
 */
export function crmCoincide(p: CrmBuscable, consulta: string): boolean {
  const q = crmTextoPlano(consulta).trim();
  if (!q) return true;

  const digitos = q.replace(/\D/g, "");
  if (digitos.length >= 4) {
    const tel = String(p?.phone ?? "").replace(/\D/g, "");
    if (tel && tel.indexOf(digitos) >= 0) return true;
  }

  const heno = crmTextoPlano(
    [
      p?.name,
      p?.contactName,
      p?.contactRole,
      p?.email,
      p?.city,
      p?.state,
      p?.country,
      p?.notes,
      p?.nextActionNote,
      (p?.tags ?? []).join(" "),
    ]
      .filter(Boolean)
      .join(" "),
  );
  return q.split(/\s+/).every((t) => heno.indexOf(t) >= 0);
}

// ── Importación por pegado ──────────────────────────────────────────────

export interface CrmFilaImportada {
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  notes: string | null;
}

export interface CrmImportacion {
  filas: CrmFilaImportada[];
  /** Líneas que no se pudieron leer, con el motivo, para enseñarlas antes de guardar. */
  ignoradas: { linea: string; motivo: string }[];
}

/** Máximo por pegada. Suficiente para una hoja de Maps y evita un POST enorme. */
export const CRM_IMPORT_MAX = 300;

const ENCABEZADOS: Record<string, keyof CrmFilaImportada> = {
  nombre: "name",
  negocio: "name",
  clinica: "name",
  "clínica": "name",
  empresa: "name",
  escuela: "name",
  universidad: "name",
  contacto: "contactName",
  responsable: "contactName",
  dueno: "contactName",
  "dueño": "contactName",
  doctor: "contactName",
  telefono: "phone",
  "teléfono": "phone",
  tel: "phone",
  celular: "phone",
  whatsapp: "phone",
  correo: "email",
  email: "email",
  mail: "email",
  ciudad: "city",
  municipio: "city",
  estado: "city",
  ubicacion: "city",
  "ubicación": "city",
  notas: "notes",
  nota: "notes",
  comentarios: "notes",
};

function partirLinea(linea: string): string[] {
  // Tabulador primero: es lo que pega una hoja de cálculo y el que nunca
  // aparece dentro de un nombre. Sólo si no hay, se prueban ; y ,.
  const sep = linea.indexOf("\t") >= 0 ? "\t" : linea.indexOf(";") >= 0 ? ";" : ",";
  return linea.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim());
}

function normalizarEncabezado(celda: string): string {
  return celda
    .trim()
    .toLowerCase()
    .replace(/[^a-záéíóúñü ]/g, "")
    .trim();
}

/**
 * Lee lo que se pegó en la caja de importar. Dos modos:
 *
 *   · CON encabezado (la primera línea trae "nombre", "teléfono"…): las
 *     columnas se mapean por nombre.
 *   · SIN encabezado: cada celda se clasifica por CONTENIDO — lo que parece
 *     correo es correo, lo que tiene 10 dígitos es teléfono, la primera
 *     celda es el nombre y lo que sobra es la ciudad. Se hace así, y no por
 *     posición fija, porque nadie pega dos veces las columnas en el mismo
 *     orden; la pantalla enseña la tabla resultante ANTES de guardar, así
 *     que un error de lectura se ve, no se descubre en la base.
 */
export function crmLeerImportacion(texto: string | null | undefined): CrmImportacion {
  const filas: CrmFilaImportada[] = [];
  const ignoradas: { linea: string; motivo: string }[] = [];
  const lineas = String(texto ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lineas.length === 0) return { filas, ignoradas };

  // ¿La primera línea es encabezado? Lo es si al menos dos celdas coinciden
  // con nombres conocidos y ninguna trae un teléfono de verdad.
  const primera = partirLinea(lineas[0]);
  const mapa = primera.map((c) => ENCABEZADOS[normalizarEncabezado(c)] ?? null);
  const conocidas = mapa.filter(Boolean).length;
  const traeDatos = primera.some((c) => mxTenDigits(c) || crmEsEmail(c));
  const hayEncabezado = conocidas >= 2 && !traeDatos;

  for (let i = hayEncabezado ? 1 : 0; i < lineas.length; i++) {
    if (filas.length >= CRM_IMPORT_MAX) {
      ignoradas.push({
        linea: lineas[i],
        motivo: `Sólo se leen ${CRM_IMPORT_MAX} por pegada.`,
      });
      continue;
    }
    const celdas = partirLinea(lineas[i]);
    const fila: CrmFilaImportada = {
      name: "",
      contactName: null,
      phone: null,
      email: null,
      city: null,
      notes: null,
    };

    if (hayEncabezado) {
      for (let c = 0; c < celdas.length; c++) {
        const campo = mapa[c];
        const valor = celdas[c];
        if (!campo || !valor) continue;
        if (campo === "name") fila.name = valor;
        else if (campo === "phone") fila.phone = valor;
        else fila[campo] = fila[campo] ? `${fila[campo]} · ${valor}` : valor;
      }
    } else {
      const sobrantes: string[] = [];
      for (const celda of celdas) {
        if (!celda) continue;
        if (!fila.email && crmEsEmail(celda)) {
          fila.email = celda;
        } else if (!fila.phone && crmWhatsappNumero(celda)) {
          fila.phone = celda;
        } else if (!fila.name) {
          fila.name = celda;
        } else {
          sobrantes.push(celda);
        }
      }
      if (sobrantes.length) {
        fila.city = sobrantes[0];
        if (sobrantes.length > 1) fila.notes = sobrantes.slice(1).join(" · ");
      }
    }

    if (!fila.name.trim()) {
      ignoradas.push({ linea: lineas[i], motivo: "No se distingue el nombre del negocio." });
      continue;
    }
    fila.name = fila.name.trim().slice(0, CRM_NOMBRE_MAX);
    filas.push(fila);
  }

  return { filas, ignoradas };
}

// ── Resumen del embudo ──────────────────────────────────────────────────

export interface CrmResumenEtapa {
  etapa: CrmEtapa;
  cuantos: number;
  valorMensual: number;
}

export interface CrmResumen {
  porEtapa: CrmResumenEtapa[];
  /** Prospectos que siguen vivos (ni ganados ni perdidos). */
  abiertos: number;
  /** Σ del valor mensual estimado de lo que sigue abierto. */
  valorAbierto: number;
  /** Seguimientos con fecha ANTERIOR a hoy. Es el número que urge. */
  vencidos: number;
  /** Seguimientos para hoy. */
  paraHoy: number;
  /** Abiertos, ya contactados y sin nada anotado en 14 días. */
  frios: number;
  ganados: number;
  perdidos: number;
}

export interface CrmProspectoResumible {
  stage?: string | null;
  monthlyValue?: number | null;
  nextActionAt?: Date | string | null;
  lastContactAt?: Date | string | null;
}

/**
 * Las cuentas del tablero, de una sola pasada. Vive aquí y no en el
 * componente para que la pantalla y cualquier contador futuro (el badge
 * del menú, un correo diario) digan el mismo número.
 */
export function crmResumen(
  prospectos: readonly CrmProspectoResumible[],
  ahora: Date = new Date(),
): CrmResumen {
  const conteo = new Map<string, { cuantos: number; valor: number }>();
  let abiertos = 0;
  let valorAbierto = 0;
  let vencidos = 0;
  let paraHoy = 0;
  let frios = 0;
  let ganados = 0;
  let perdidos = 0;

  for (const p of prospectos ?? []) {
    const etapa = crmEtapa(p?.stage);
    const acumulado = conteo.get(etapa.id) ?? { cuantos: 0, valor: 0 };
    acumulado.cuantos += 1;
    acumulado.valor += Number(p?.monthlyValue ?? 0) || 0;
    conteo.set(etapa.id, acumulado);

    if (etapa.id === "GANADO") ganados += 1;
    else if (etapa.id === "PERDIDO") perdidos += 1;

    if (!etapa.terminal) {
      abiertos += 1;
      valorAbierto += Number(p?.monthlyValue ?? 0) || 0;
      const s = crmSemaforo(p?.nextActionAt, ahora);
      if (s === "vencido") vencidos += 1;
      else if (s === "hoy") paraHoy += 1;
      if (crmEstaFrio(p, ahora)) frios += 1;
    }
  }

  return {
    porEtapa: CRM_ETAPAS.map((etapa) => ({
      etapa,
      cuantos: conteo.get(etapa.id)?.cuantos ?? 0,
      valorMensual: conteo.get(etapa.id)?.valor ?? 0,
    })),
    abiertos,
    valorAbierto,
    vencidos,
    paraHoy,
    frios,
    ganados,
    perdidos,
  };
}

/**
 * Orden de la lista "hoy toca": primero lo vencido (lo más viejo arriba),
 * luego lo de hoy, y al final lo que no tiene fecha. Devuelve un número
 * comparable, no ordena, para que quien llame decida el resto del criterio.
 */
export function crmPrioridad(
  p: CrmProspectoResumible,
  ahora: Date = new Date(),
): number {
  const s = crmSemaforo(p?.nextActionAt, ahora);
  if (s === "vencido") return -1000 + crmDiasEntre(p.nextActionAt as string, ahora) * -1;
  if (s === "hoy") return 0;
  if (s === "proximo") return crmDiasEntre(ahora, p.nextActionAt as string);
  return 9000;
}
