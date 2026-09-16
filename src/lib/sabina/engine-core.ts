/**
 * Sabina — las reglas PURAS del motor.
 *
 * Aquí no hay red, ni prisma, ni `server-only`: todo lo que decide algo
 * (qué modelo, si un argumento del modelo es válido, cómo se dice que falta un
 * permiso, qué se registra) vive aquí para que se pueda probar sin base y sin
 * gastar un peso en Anthropic. El bucle con la red está en `engine.ts`.
 *
 * El criterio del bucle está copiado de `src/lib/barber/bot.ts`, que ya hace
 * exactamente esto en producción: tope de rondas, presupuesto de tiempo por
 * turno y última vuelta sin herramientas. Ver el reporte para las tres
 * diferencias y por qué.
 */
import { ALL_PERMISSIONS, type PermissionKey } from "@/lib/auth/permissions";
import { DEFAULT_TZ } from "@/lib/agenda/date-ranges";
import { FRASE_SABINA_APAGADA, type CausaSinPermiso } from "./permisos-sabina";
import type {
  SabinaDificultad,
  SabinaRastro,
  SabinaResultado,
  SabinaResultadoFallo,
  SabinaResultadoOk,
  SabinaTool,
} from "./engine-types";

/* ═══════════════════════════════════════════════════════════════════════
   TOPES — el bolsillo de la clínica y la paciencia del doctor
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Cuántas veces puede el modelo pedir herramientas antes de tener que
 * contestar. Cuatro es lo que usan `barber/bot.ts` y `realty/bot`, y aquí sirve
 * el mismo número por la misma razón: `resumen_clinica` (la más golosa del
 * catálogo) necesita una ronda para ella sola, una pregunta abierta encadena
 * dos o tres (ocupación → ausencias → ingresos) y a partir de la cuarta el
 * modelo ya no descubre nada nuevo, solo gasta. En la ÚLTIMA vuelta el motor
 * retira las herramientas: el modelo tiene que cerrar con palabras, no pedir
 * otra consulta que ya no cabe.
 */
export const SABINA_MAX_TOOL_ROUNDS = 4;

/**
 * Todo el turno vive dentro de este presupuesto. «Un doctor no espera treinta
 * segundos»: a los 20 s se corta y se contesta con lo que haya.
 */
export const SABINA_TURN_BUDGET_MS = 20_000;

/** Cada llamada al modelo, acotada aparte (AbortSignal). */
export const SABINA_CALL_TIMEOUT_MS = 12_000;

/**
 * Tiempo mínimo que tiene que quedar del turno para darle al modelo UNA vuelta
 * de corrección cuando manda a una tarjeta que no preparó (ver
 * `mandaAConfirmarTarjeta`). Con menos, no le da para llamar a la herramienta y
 * contestar: se va directo a la frase honesta.
 */
export const SABINA_MARGEN_CORRECCION_MS = 3_000;

/** Techo de salida por llamada. Una respuesta de panel no es un ensayo. */
export const SABINA_MAX_OUTPUT_TOKENS = 1_200;

/**
 * Turnos previos de la conversación que se le reenvían al modelo. El historial
 * guardado devuelve hasta 500, y reenviarlos en cada ronda —hasta 10 llamadas
 * por pregunta— lo paga el monedero de la clínica. Veinte turnos son diez
 * intercambios: de sobra para «¿y el mes pasado?».
 */
export const SABINA_MAX_TURNOS_HISTORIAL = 20;

/** La pregunta que entra por el endpoint. Más que esto no es una pregunta. */
export const SABINA_MAX_PREGUNTA_CHARS = 2_000;

/* ═══════════════════════════════════════════════════════════════════════
   QUÉ MODELO — la diferencia entre 40 y 400 pesos al mes
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * El barato. Es el default del contrato y el que contesta la inmensa mayoría
 * de las preguntas de mostrador («¿cuántas citas tengo hoy?»), que son un dato
 * exacto que ya viene masticado en el `resumen` de la herramienta.
 */
export const SABINA_MODELO_DIRECTA = "claude-haiku-4-5";

/**
 * El caro, solo para lo que razona. `claude-sonnet-4-6` es el que ya usan el
 * bot de barbería, `/api/consult/ai-assist` y `integrations/claude`: se
 * mantiene el criterio de la casa en vez de estrenar un modelo aquí. Se cambia
 * por env sin redeploy, igual que el del bot de barbería.
 */
export const SABINA_MODELO_ABIERTA = "claude-sonnet-4-6";

/** El modelo de cada dificultad, con escape por env (sin redeploy). */
export function modeloPara(dificultad: SabinaDificultad): string {
  if (dificultad === "abierta") {
    return process.env.SABINA_MODELO_ABIERTA || SABINA_MODELO_ABIERTA;
  }
  return process.env.SABINA_MODELO_DIRECTA || SABINA_MODELO_DIRECTA;
}

/**
 * Señales de pregunta ABIERTA. Todas piden razonar sobre varias cosas a la vez
 * o pedir consejo; ninguna se contesta con una cifra.
 *
 * Van sin acentos y se comparan contra el texto ya normalizado (ver
 * `normalizar`), así que «por qué», «porque» y «PORQUÉ» entran por la misma
 * puerta y no hace falta duplicar cada entrada con y sin tilde.
 */
const SENALES_ABIERTA: readonly string[] = [
  "por que", "porque", "a que se debe", "a que se debio",
  "que hago", "que puedo hacer", "que me conviene", "me conviene",
  "como puedo", "como le hago", "como hago", "como expando", "como mejoro",
  "como aumento", "como subo", "como bajo", "como consigo", "como logro",
  "deberia", "convendria", "recomienda", "recomiendame", "recomendacion",
  "sugiere", "sugerencia", "aconseja", "consejo",
  "estrategia", "plan para", "plan de", "propon", "propuesta",
  "expandir", "crecer", "crecimiento", "mejorar", "optimiz", "rentab",
  "analiza", "analisis", "evalua", "diagnostica",
  "compara", "comparacion", "versus",
  "tendencia", "evolucion", "oportunidad", "riesgo",
  "bajaron", "bajo mucho", "cayeron", "cayo", "subieron", "aumentaron",
  "que opinas", "que piensas", "vale la pena", "tiene sentido",
];

/** Una pregunta larga rara vez es una consulta de dato. */
const PALABRAS_ABIERTA = 25;

/**
 * Quita acentos, baja a minúsculas y colapsa espacios. Es lo que permite que
 * `SENALES_ABIERTA` viva sin tildes.
 */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Directa o abierta.
 *
 * 🔴 EL DEFAULT ES «DIRECTA», Y ESO ES LA REGLA, NO UN DESCUIDO. Solo sube a
 * `abierta` si SALTA una señal; ante la duda contesta el barato, porque subir
 * en una segunda pasada (ver `debeEscalar`) cuesta una pregunta, y bajar no se
 * puede: lo caro ya se gastó en TODAS. Con Haiku a 1/5 del precio de entrada
 * de Sonnet, equivocarse hacia abajo cuesta una pasada extra; equivocarse
 * hacia arriba cuesta cinco veces en cada pregunta del mes.
 */
export function clasificarDificultad(pregunta: string): SabinaDificultad {
  const texto = normalizar(pregunta ?? "");
  if (!texto) return "directa";

  if (SENALES_ABIERTA.some((s) => texto.includes(s))) return "abierta";

  // Dos preguntas en un mensaje ya no es un dato, es un cruce.
  const interrogaciones = (texto.match(/\?/g) ?? []).length;
  if (interrogaciones >= 2) return "abierta";

  if (texto.split(" ").filter(Boolean).length > PALABRAS_ABIERTA) return "abierta";

  return "directa";
}

/**
 * La segunda pasada. Se sube a lo caro SOLO si la barata se quedó sin
 * contestar: o agotó las rondas sin cerrar, o volvió con datos y sin texto.
 * Si ya contestó, no se escala aunque la pregunta pareciera difícil — el
 * dinero ya se ahorró.
 *
 * No se escala nunca dos veces: `yaEscalado` corta.
 */
export function debeEscalar(estado: {
  dificultad: SabinaDificultad;
  yaEscalado: boolean;
  respuesta: string | null;
  rondasAgotadas: boolean;
  huboHerramientas: boolean;
}): boolean {
  if (estado.yaEscalado) return false;
  if (estado.dificultad === "abierta") return false; // ya iba con el caro
  if (estado.respuesta && estado.respuesta.trim().length > 0) return false;
  return estado.rondasAgotadas || estado.huboHerramientas;
}

/* ═══════════════════════════════════════════════════════════════════════
   LO QUE EL MODELO PIDE — nunca se ejecuta a ciegas
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Claves que el modelo NO puede mandar, pase lo que pase. El `clinicId` sale de
 * la sesión y lo pone el motor en el `ctx`; si viajara dentro de un argumento,
 * una clínica podría leer a otra. Se BORRAN antes de validar, no se rechaza la
 * llamada: el modelo a veces las añade por imitación del esquema y castigar eso
 * con un error solo le hace repetir la ronda (y gastar).
 */
const CLAVES_PROHIBIDAS = new Set([
  "clinicid", "clinic_id", "clinica_id", "clinicaid",
  "userid", "user_id", "usuario_id", "usuarioid",
  "tenantid", "tenant_id",
]);

/** Devuelve los argumentos sin las claves prohibidas, y cuáles se quitaron. */
export function sanearArgumentos(input: unknown): {
  limpio: Record<string, unknown>;
  retirados: string[];
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { limpio: {}, retirados: [] };
  }
  const limpio: Record<string, unknown> = {};
  const retirados: string[] = [];
  for (const [clave, valor] of Object.entries(input as Record<string, unknown>)) {
    if (CLAVES_PROHIBIDAS.has(clave.toLowerCase())) {
      retirados.push(clave);
      continue;
    }
    limpio[clave] = valor;
  }
  return { limpio, retirados };
}

/** Qué pasó al intentar preparar una llamada del modelo. */
export type ValidacionOk<P = any> = {
  ok: true;
  tool: SabinaTool<P>;
  params: P;
  retirados: string[];
};

/** Las dos formas de rechazo. Un nombre para poder estrechar por `motivo`. */
export type ValidacionFallo = {
  ok: false;
  motivo: "desconocida" | "parametros";
  detalle: string;
};

export type ValidacionLlamada<P = any> = ValidacionOk<P> | ValidacionFallo;

/**
 * Valida lo que pidió el modelo ANTES de tocar la base.
 *
 * Dos fallos posibles y los dos vuelven al modelo como texto, no como
 * excepción: una herramienta inventada («consultar_expediente_completo») y unos
 * parámetros que no cuadran con el zod. En ninguno de los dos casos se ejecuta
 * nada.
 */
export function validarLlamada(
  tools: readonly SabinaTool<any, any>[],
  nombre: string,
  input: unknown,
): ValidacionLlamada<any> {
  const tool = tools.find((t) => t.nombre === nombre);
  if (!tool) {
    const disponibles = tools.map((t) => t.nombre).join(", ");
    return {
      ok: false,
      motivo: "desconocida",
      detalle: `No existe la herramienta «${nombre}». Las que hay: ${disponibles || "ninguna"}.`,
    };
  }

  const { limpio, retirados } = sanearArgumentos(input);
  const parsed = tool.parametros.safeParse(limpio);
  if (!parsed.success) {
    const problemas = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      motivo: "parametros",
      detalle: `Parámetros inválidos para «${nombre}»: ${problemas}`,
    };
  }

  return { ok: true, tool, params: parsed.data, retirados };
}

/* ═══════════════════════════════════════════════════════════════════════
   SIN PERMISO — la regla 3, que es la que vuelve falsas las respuestas
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * El área en lenguaje de mostrador, para la frase que lee el doctor. Se saca
 * del prefijo de la key; si no está en el mapa se cae a la descripción del
 * catálogo (`ALL_PERMISSIONS`), que ya está escrita en español y se mantiene
 * sola cuando alguien añade un permiso.
 */
const AREA_POR_PREFIJO: Record<string, string> = {
  agenda: "la agenda",
  billing: "facturación",
  // No es una key: es el candado de la bandera canAccessCaja (tools/candado-caja.ts).
  caja: "Caja",
  patients: "los pacientes",
  medicalRecord: "el expediente clínico",
  prescription: "las recetas",
  reports: "los reportes",
  inventory: "el inventario",
  team: "el equipo",
};

/** Nombre legible del área que protege un permiso. */
export function areaDePermiso(permiso: string): string {
  const prefijo = (permiso || "").split(".")[0];
  if (Object.prototype.hasOwnProperty.call(AREA_POR_PREFIJO, prefijo)) {
    return AREA_POR_PREFIJO[prefijo];
  }
  if (Object.prototype.hasOwnProperty.call(ALL_PERMISSIONS, permiso)) {
    return `«${ALL_PERMISSIONS[permiso as PermissionKey]}»`;
  }
  return `«${permiso}»`;
}

/**
 * La frase explícita del contrato:
 *   ❌ «No tengo datos de facturación»  → suena a que la clínica no facturó.
 *   ✅ «No tienes acceso a facturación, eso no te lo puedo contestar.»
 */
export function fraseSinPermiso(permiso: string, causa: CausaSinPermiso = "usuario"): string {
  // Dos razones distintas, y el doctor merece saber cuál: si ÉL sí tiene el
  // permiso, «no tienes acceso» es falso y lo manda a pedir algo que ya tiene.
  if (causa === "apagada") return FRASE_SABINA_APAGADA;
  if (causa === "sabina") {
    return `Tú sí tienes acceso a ${areaDePermiso(permiso)}, pero el Super Admin de la clínica no me deja consultarlo en tu nombre, así que eso no te lo puedo contestar.`;
  }
  return `No tienes acceso a ${areaDePermiso(permiso)}, eso no te lo puedo contestar.`;
}

/**
 * Red de seguridad DETERMINISTA de la regla 3.
 *
 * El prompt del sistema ya se lo ordena al modelo, pero un prompt es una
 * súplica, no una garantía: si el modelo se come el aviso, la respuesta queda
 * falsa sin haber mentido en ninguna frase, que es justo el fallo que el
 * contrato llama «peor en una pregunta abierta». Así que si faltó un permiso y
 * la respuesta no lo dice, el aviso se añade aquí, en código.
 *
 * La detección es a propósito conservadora: basta con que la respuesta ya
 * mencione el área Y hable de acceso/permiso para darla por avisada.
 */
export function garantizarAvisoSinPermiso(
  respuesta: string,
  permisos: readonly string[],
  // Por qué faltó cada uno (ver `causaSinPermiso`). Sin él, «el usuario no lo tiene».
  causaDe: (permiso: string) => CausaSinPermiso = () => "usuario",
): string {
  if (permisos.length === 0) return respuesta;

  const texto = normalizar(respuesta);
  const habla_de_acceso =
    texto.includes("no tienes acceso") ||
    texto.includes("no tengo permiso") ||
    texto.includes("sin permiso") ||
    texto.includes("no tienes permiso");
  // Si fue el Super Admin quien se lo quitó a Sabina, un «no tienes acceso a
  // facturación» NO cuenta como avisado: es la frase falsa. Tiene que nombrar
  // al Super Admin.
  const habla_del_super_admin = texto.includes("super admin") || texto.includes("superadmin");

  const faltantes = Array.from(new Set(permisos)).filter((p) => {
    const causa = causaDe(p);
    if (texto.includes(normalizar(fraseSinPermiso(p, causa)))) return false;
    if (causa !== "usuario") return !(habla_del_super_admin && (causa === "apagada" || texto.includes(normalizar(areaDePermiso(p)))));
    if (!habla_de_acceso) return true;
    return !texto.includes(normalizar(areaDePermiso(p)));
  });
  if (faltantes.length === 0) return respuesta;

  // Una sola vez la frase de «apagada», aunque falten varias áreas.
  const avisos = Array.from(new Set(faltantes.map((p) => fraseSinPermiso(p, causaDe(p))))).join(" ");
  const base = respuesta.trim();
  return base ? `${base}\n\n${avisos}` : avisos;
}

/**
 * La misma red, para las ACCIONES: si a quien escribe le faltó el permiso para
 * hacer algo (la key, o una regla de rol como «un doctor no cancela»), la
 * respuesta tiene que decirlo. `frases` son las de cada acción, ya redactadas
 * («No tienes permiso para agendar citas…»).
 *
 * Se da por avisado si la respuesta ya contiene la frase, o si habla de permiso
 * y nombra lo que no se pudo hacer (`queHace`).
 */
export function garantizarAvisoSinPermisoAccion(
  respuesta: string,
  faltas: ReadonlyArray<{ frase: string; queHace: string }>,
): string {
  if (faltas.length === 0) return respuesta;
  const texto = normalizar(respuesta);
  const hablaDePermiso =
    texto.includes("permiso") || texto.includes("tu rol") || texto.includes("no puedes");
  const vistas = new Set<string>();
  const pendientes = faltas.filter((f) => {
    if (vistas.has(f.frase)) return false;
    vistas.add(f.frase);
    if (texto.includes(normalizar(f.frase))) return false;
    return !(hablaDePermiso && texto.includes(normalizar(f.queHace)));
  });
  if (pendientes.length === 0) return respuesta;
  const avisos = pendientes.map((f) => f.frase).join(" ");
  const base = respuesta.trim();
  return base ? `${base}\n\n${avisos}` : avisos;
}

/**
 * Frases que dan algo por HECHO, sobre el texto normalizado (sin acentos). Un
 * «quedó confirmada» menciona «confirm» y aun así afirma lo que no pasó: por eso
 * esto se mira aunque la respuesta hable de confirmar.
 */
const AFIRMA_HECHO =
  /\b(listo|hecho|ya (quedo|quedaron|esta|estan|lo hice|la hice)|quedo (agendad|cancelad|registrad|confirmad|movid|reagendad|hech|list|dad)\w*|(agende|cancele|registre|movi|reagende|confirme|di de alta|anote|programe)\b)/;

/** Lo que se añade si Sabina propuso algo y la respuesta no manda a confirmarlo. */
export const AVISO_PROPUESTA_PENDIENTE =
  "Todavía no hice nada: revisa la propuesta y confírmala con el botón si está bien.";

/**
 * Red determinista de `avisoObligatorio` (tipos.ts): si una herramienta dijo que
 * su dato no se puede dar sin una advertencia y la respuesta no la trae (no
 * contiene su `marca`), se añade al final. Existe por Caja: una pregunta
 * «directa» se contesta en dos líneas, y «en caja hay $1,900» sin «es un
 * cálculo» es cómo alguien cuadra mal una caja.
 */
export function garantizarAvisosObligatorios(
  respuesta: string,
  avisos: ReadonlyArray<{ frase: string; marca: string }>,
): string {
  // Sin respuesta no hay cifra que advertir. Y rellenarla con el aviso solo
  // taparía el fallo: el motor da por fallida una respuesta vacía (503), y un
  // «Ojo: es un cálculo» a secas no contesta nada.
  if (!respuesta || respuesta.trim() === "") return respuesta;
  const texto = normalizar(respuesta);
  const vistos = new Set<string>();
  const faltan: string[] = [];
  for (const a of avisos) {
    if (vistos.has(a.frase)) continue;
    vistos.add(a.frase);
    if (!texto.includes(normalizar(a.marca))) faltan.push(a.frase);
  }
  if (faltan.length === 0) return respuesta;
  const base = respuesta.trim();
  return base ? `${base}\n\n${faltan.join(" ")}` : faltan.join(" ");
}

/**
 * Red determinista de la confirmación: si hubo propuesta, la respuesta tiene que
 * dejar claro que falta confirmarla. Un «listo, ya quedó agendada» con una
 * tarjeta pendiente debajo es justo la mentira que este mecanismo existe para
 * impedir; el prompt lo pide, y esto lo garantiza.
 */
export function garantizarAvisoPropuesta(respuesta: string, huboPropuesta: boolean): string {
  if (!huboPropuesta) return respuesta;
  const texto = normalizar(respuesta);
  if (texto.includes("confirm") && !AFIRMA_HECHO.test(texto)) return respuesta;
  const base = respuesta.trim();
  return base ? `${base}\n\n${AVISO_PROPUESTA_PENDIENTE}` : AVISO_PROPUESTA_PENDIENTE;
}

/* ═══════════════════════════════════════════════════════════════════════
   LA TARJETA QUE NO EXISTE — la otra mitad de la misma mentira
   ═══════════════════════════════════════════════════════════════════════ */

/*
 * `garantizarAvisoPropuesta` cubre «hay tarjeta y Sabina dice que ya quedó». Esto
 * cubre lo contrario, que es lo que vivió Rafael el 14-sep-2026: NO hay tarjeta y
 * Sabina dice «confírmalo en la tarjeta». Para el doctor es peor que un error: ve
 * una instrucción y una pantalla donde no hay nada que apretar.
 *
 * Se mira por oración y sobre el texto normalizado (sin acentos). «tarjeta» a
 * secas no basta —la clínica cobra con tarjeta— y «confirmada» tampoco —es un
 * estado de cita—: hace falta LA tarjeta junto a la orden de confirmar o tocar.
 * Ante la duda, que se escape: un falso positivo borra una respuesta buena, y
 * para lo que se escapa ya está el prompt.
 */
/** La tarjeta de Sabina siempre lleva artículo («en la tarjeta»); la del cobro, no («pagos de tarjeta»). */
const TARJETA = /\b(la|las|esta|esa|una|tu|su) tarjetas?\b/;
const BOTON = /\bboton(es)?\b/;
const PROPUESTA = /\bpropuestas?\b/;
/** «confírmala», «confirmar», «confirma»… pero no «confirmada(s)/confirmado(s)». */
const CONFIRMAR = /\bconfirm(?!ad[ao]s?\b)[a-z]*/;
/**
 * «para que la confirmes», «confírmala»: confirmar ESO que se preparó. No «¿me
 * confirmas el motivo?» ni «confírmame la hora», que es Sabina pidiendo un dato.
 */
const CONFIRMAR_ESO = /\bconfirm(ala|alo|alas|alos|arla|arlo|arlas|arlos|es)\b/;
const TOCAR = /\b(toca|toque|tocar|pulsa|pulse|pulsar|presiona|presione|aprieta|oprime|dale|clic|click)\b/;
/** Lo que, junto a «tarjeta», también manda a mirarla: «revisa la tarjeta de abajo». */
const MIRAR = /\b(revisa|revisala|revisalo|abajo|debajo)\b/;
/**
 * «cobraste con tarjeta», «la tarjeta de ingresos del inicio»: no es la tarjeta de Sabina.
 * Se BORRA de la oración antes de buscar la de Sabina, no descarta la oración entera:
 * desde que Sabina cobra (ws1-t2), el método de pago y la tarjeta de la propuesta
 * caben en la misma frase («confirma el cobro con tarjeta de débito en la tarjeta»).
 */
const OTRA_TARJETA = /\b(con|por|en|de) tarjetas?\b|\btarjetas? de (credito|debito|ingresos|cobros?|pagos?|fidelidad|presentacion|regalo)\b/g;
/**
 * Los botones de las tarjetas son «Sí, <infinitivo>» («Sí, agendar», «Sí, dar de
 * alta»…). Con el infinitivo: «dime "sí, agéndala" y la preparo» es una pregunta
 * de Sabina, no un botón.
 */
const ETIQUETA_DE_BOTON = /["«“]\s*si,\s*(agendar|mover|cancelar|dar de alta|registrar|cobrar|crear|facturar|avisar|mandar)\b/;
/**
 * «No hay ninguna tarjeta que confirmar» es justo la frase honesta, no la mentira.
 * La negación tiene que ir SOBRE la tarjeta: «No hay problema, confírmala en la
 * tarjeta» sigue siendo la mentira.
 */
const NIEGA = /\b(no hay|ninguna|ningun)\b[^,;:]{0,25}\b(tarjetas?|propuestas?|boton(es)?)\b/;

/**
 * ¿La respuesta manda al usuario a confirmar en una tarjeta o botón?
 *
 * `huboAccion`: en el turno corrió alguna herramienta de acción. Sin acción solo
 * cuenta la orden explícita sobre LA tarjeta o su botón («confírmala en la
 * tarjeta», «toca "Sí, agendar"»): «revisa los datos abajo» o «usa el botón
 * Confirmar de la cita en la agenda» son respuestas de consulta, no tarjetas de
 * Sabina. Con acción cabe menos duda, y cuentan también «revisa la tarjeta de
 * abajo», «confirma la propuesta» y «para que la confirmes».
 */
export function mandaAConfirmarTarjeta(respuesta: string, huboAccion: boolean): boolean {
  return normalizar(respuesta ?? "")
    .split(/[.!?\n¿¡]+/)
    .some((oracion) => {
      if (!oracion.trim() || NIEGA.test(oracion)) return false;
      // «Sí, agendar», «Sí, dar de alta»: el nombre de un botón de tarjeta ya lo dice todo.
      if (ETIQUETA_DE_BOTON.test(oracion)) return true;
      const ordena = CONFIRMAR.test(oracion) || TOCAR.test(oracion);
      const tarjeta = TARJETA.test(oracion.replace(OTRA_TARJETA, " "));
      if (tarjeta && (ordena || BOTON.test(oracion))) return true;
      if (!huboAccion) return false;
      if (tarjeta && MIRAR.test(oracion)) return true;
      if (ordena && (BOTON.test(oracion) || PROPUESTA.test(oracion))) return true;
      return CONFIRMAR_ESO.test(oracion);
    });
}

/**
 * Lo que se le dice al modelo, en su propio turno, cuando acaba de mandar a una
 * tarjeta que no preparó. Va como mensaje de usuario porque es la única forma de
 * meterlo en medio del bucle; no se guarda en el historial.
 */
export const CORRECCION_SIN_TARJETA =
  "[Aviso del sistema; esto no lo escribió el usuario] En este turno no preparaste ninguna propuesta: en pantalla NO hay " +
  "ninguna tarjeta ni ningún botón, así que el usuario no tiene nada que confirmar. Si ya tienes los datos de lo que pidió, " +
  "llama AHORA a la herramienta de acción para preparar la propuesta. Si falta un dato, pregúntalo; si no se puede, explica " +
  "por qué. No menciones ninguna tarjeta que no hayas preparado.";

export const FRASE_SIN_TARJETA = "Todavía no preparé ninguna propuesta, así que no hay ninguna tarjeta que confirmar.";

/** En qué quedó la última herramienta de acción del turno, si no dejó propuesta. */
export type DesenlaceAccion =
  | { estado: "falta_aclarar"; pregunta: string }
  | { estado: "sin_permiso" | "no_se_puede"; frase: string }
  | { estado: "error" };

/**
 * Red determinista: si en el turno no hubo propuesta, no hay otra tarjeta
 * pendiente en pantalla y la respuesta aun así manda a confirmar, la respuesta se
 * sustituye. No se recorta la oración: lo que queda alrededor («te preparé la
 * cita del martes…») sigue describiendo algo que no existe.
 *
 * Si la acción SÍ corrió y dijo por qué no (el día está cerrado, falta el motivo,
 * sin permiso), se dice ESO: «no puedo agendar porque…» sirve; «no hay tarjeta» a
 * secas deja al doctor igual de perdido.
 */
export function garantizarSinTarjetaFantasma(
  respuesta: string,
  estado: {
    huboPropuesta: boolean;
    tarjetaPendiente: boolean;
    huboAccion: boolean;
    ultimaAccion: DesenlaceAccion | null;
  },
): string {
  if (estado.huboPropuesta || estado.tarjetaPendiente) return respuesta;
  if (!mandaAConfirmarTarjeta(respuesta, estado.huboAccion)) return respuesta;
  const a = estado.ultimaAccion;
  if (a?.estado === "falta_aclarar" && a.pregunta.trim()) return a.pregunta;
  if ((a?.estado === "no_se_puede" || a?.estado === "sin_permiso") && a.frase.trim()) {
    return `${a.frase.trim()} Por eso no preparé ninguna propuesta: no hay ninguna tarjeta que confirmar.`;
  }
  if (a?.estado === "error") {
    return "No pude preparar la propuesta porque falló la consulta de los datos, así que no hay ninguna tarjeta que confirmar. Pídemelo otra vez en un momento.";
  }
  return `${FRASE_SIN_TARJETA} Dime otra vez qué quieres hacer, con sus datos, y te la preparo.`;
}

/* ═══════════════════════════════════════════════════════════════════════
   LO QUE VE EL MODELO
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Traduce un `SabinaResultado` a lo que se le devuelve al modelo.
 *
 * `sin_permiso` no se le entrega como un fallo cualquiera: lleva una ORDEN
 * explícita, porque de esa frase depende que la respuesta no salga falsa.
 */
export function resultadoParaModelo(
  res: SabinaResultado,
  opciones?: { fraseSinPermiso?: string; causa?: CausaSinPermiso },
): string {
  // Se estrecha por `motivo` (texto) y no por `ok` (booleano): ver la nota de
  // SabinaResultado en engine-types.ts — este repo compila con "strict": false.
  if (res.ok === true) {
    const bien = res as SabinaResultadoOk;
    return JSON.stringify({ ok: true, resumen: bien.resumen, datos: bien.datos });
  }
  const mal = res as SabinaResultadoFallo;
  const causa = opciones?.causa ?? "usuario";
  if (mal.motivo === "sin_permiso" && causa !== "usuario") {
    // El usuario SÍ tiene el permiso: el recorte es de Sabina. Si el modelo dice
    // «no tienes acceso», miente — por eso la orden lo prohíbe con todas las letras.
    return JSON.stringify({
      ok: false,
      motivo: "sin_permiso",
      permiso: mal.permiso,
      instruccion:
        `EL USUARIO SÍ TIENE ESTE PERMISO, pero el Super Admin de la clínica no deja a Sabina usarlo en su nombre. ` +
        `NO digas que el usuario no tiene acceso ni lo mandes a pedir el permiso. No lo intentes por otro camino ni lo omitas en silencio: ` +
        `DI textualmente "${opciones?.fraseSinPermiso ?? fraseSinPermiso(mal.permiso, causa)}"`,
    });
  }
  if (mal.motivo === "sin_permiso" && opciones?.fraseSinPermiso) {
    // Una ACCIÓN sin permiso no es «no te lo puedo contestar»: es «no puedes
    // hacerlo». La frase la da la acción (engine-acciones.ts).
    return JSON.stringify({
      ok: false,
      motivo: "sin_permiso",
      permiso: mal.permiso,
      instruccion:
        `EL USUARIO NO TIENE PERMISO PARA HACER ESTO. No lo intentes por otro camino ni lo omitas en silencio: ` +
        `DI textualmente "${opciones.fraseSinPermiso}"`,
    });
  }
  if (mal.motivo === "sin_permiso") {
    return JSON.stringify({
      ok: false,
      motivo: "sin_permiso",
      permiso: mal.permiso,
      instruccion:
        `EL USUARIO NO TIENE ACCESO A ${areaDePermiso(mal.permiso).toUpperCase()}. ` +
        `NO omitas este dato en silencio ni lo sustituyas por otro: DI textualmente ` +
        `"${fraseSinPermiso(mal.permiso)}" y sigue con lo que sí puedas contestar. ` +
        `Si la pregunta dependía de esto, dilo antes de cualquier conclusión.`,
    });
  }
  if (mal.motivo === "sin_datos") {
    return JSON.stringify({
      ok: false,
      motivo: "sin_datos",
      instruccion:
        "No hay datos para eso en el periodo pedido. Dilo tal cual. NO estimes, " +
        "NO promedies y NO inventes una cifra de reemplazo.",
    });
  }
  return JSON.stringify({
    ok: false,
    motivo: "error",
    detalle: mal.detalle,
    instruccion: "La consulta falló. Dilo; no supongas el dato.",
  });
}

/**
 * El «hoy» que lee el modelo: el día de la CLÍNICA, con nombre y en
 * `AAAA-MM-DD` —el formato que piden los parámetros de fecha—, para que no
 * tenga que traducir «viernes, 12 de septiembre» y equivocarse.
 *
 * Con la zona del proceso (UTC en Vercel), a partir de las 18:00 de México el
 * servidor ya va en el día siguiente. Una zona ilegible cae al default de
 * México, igual que `crearSabinaCtx`, en vez de tumbar el turno.
 */
export function hoyParaPrompt(instante: Date, timezone: string): string {
  const formatear = (timeZone: string) =>
    `${instante.toLocaleDateString("es-MX", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone,
    })} (${new Intl.DateTimeFormat("en-CA", { timeZone }).format(instante)})`;
  try {
    return formatear(timezone || DEFAULT_TZ);
  } catch {
    return formatear(DEFAULT_TZ);
  }
}

/**
 * El prompt del sistema. Es donde viven las reglas 3, 5 y 6 del contrato.
 *
 * «CÓMO ESCRIBES» decía «dos o tres líneas» y «nada de tablas» sin más, y con eso
 * una lista de ocho deudores salía apretada en una línea separada por comas (lo
 * vivió Rafael el 14-sep-2026). La forma de la lista la ponen el `resumen` de cada
 * herramienta (`lineasDeLista`) y la pantalla (`parseSabinaMarkdown`); aquí solo va
 * CUÁNDO usarla, en pocas palabras: esto se paga en cada llamada al modelo.
 *
 * «Sin tablas EN EL CHAT»: desde que Sabina factura, la tarjeta de la propuesta sí
 * trae una tabla de conceptos, pero la arma el servidor, no el modelo. Sin «en el
 * chat» la regla podía leerse como si también valiera para la tarjeta. Los once
 * caracteres salen de «pesos mexicanos» → «pesos» (México ya va en la primera línea).
 */
export function construirSystemPrompt(opciones: {
  dificultad: SabinaDificultad;
  hoy: string;
  /**
   * Lo que el catálogo le deja PROPONER («agendar citas»). Vacío o ausente: Sabina
   * solo lee, y el prompt lo dice así.
   */
  acciones?: readonly string[];
  /**
   * La frase de la tarjeta de ESTA conversación que sigue esperando el botón, o
   * `null` si no hay ninguna. El modelo no la ve de otra forma: el historial es
   * solo texto, y «confírmalo en la tarjeta» de un turno anterior no dice si esa
   * tarjeta ya se confirmó, caducó o nunca existió.
   */
  tarjetaPendiente?: string | null;
  /**
   * La tarjeta de identidad de la clínica (ws1-t5). Es lo ÚNICO suyo que viaja
   * fijo en cada llamada, y son dos datos que `getAuthContext()` ya tiene en la
   * mano (`include: { clinic: true }`): ni una consulta más por pregunta.
   *
   * 🔴 Aquí NO van precios, ni el catálogo, ni los doctores, y no es por
   * ahorrar: el bloque de arriba le dice al modelo «no tienes ningún dato de la
   * clínica en la cabeza». Un precio metido en el prompt volvería falsa esa
   * frase y le daría permiso para recitar cifras sin consultar — que es justo el
   * fallo que el contrato persigue. Además el prompt se arma ANTES de mirar
   * ningún permiso: lo que se mete aquí lo lee todo el mundo.
   */
  clinica?: {
    nombre?: string;
    lugar?: string;
    /**
     * 🔴 Qué de la clínica puede consultar ESTE usuario. No es un adorno: el
     * prompt se arma antes de mirar ningún permiso, y el catálogo de
     * herramientas se le ofrece entero al modelo. Si aquí se le manda «busca el
     * precio antes de agendar» a una recepcionista a la que el SUPER_ADMIN le
     * quitó `billing.view`, el modelo obedece, recibe `sin_permiso` y la regla
     * más fuerte del prompt le obliga a soltar «no tienes acceso a facturación»
     * en mitad de una petición de agenda que sí podía atender.
     */
    puede?: { precios?: boolean; equipo?: boolean };
  } | null;
  /**
   * El bloque de «dónde está quien pregunta», ya construido y ya comprobado
   * contra la sesión (`bloqueDeContexto` de ./contexto). Llega como TEXTO y no
   * como objeto a propósito: este módulo no sabe de base ni de permisos, y así
   * no hay forma de que un id sin comprobar entre al prompt por aquí.
   *
   * Vacío o ausente = la pregunta cuesta exactamente lo que costaba antes de
   * que Sabina se abriera en un cajón: el contexto NO es parte fija.
   */
  contexto?: string | null;
}): string {
  const acciones = (opciones.acciones ?? []).filter(Boolean);
  const nombreClinica = opciones.clinica?.nombre?.trim() ?? "";
  const lugarClinica = opciones.clinica?.lugar?.trim() ?? "";
  // Solo se nombra lo que este usuario PUEDE consultar (ver `puede`, arriba).
  const vePrecios = opciones.clinica?.puede?.precios !== false;
  const veEquipo = opciones.clinica?.puede?.equipo !== false;
  const dondeEsta = vePrecios && veEquipo
    ? " Sus precios, sus duraciones y quién hace qué no te los sabes: salen de procedimientos_y_precios y equipo_clinica."
    : vePrecios
      ? " Sus precios y sus duraciones no te los sabes: salen de procedimientos_y_precios."
      : veEquipo
        ? " Quién hace qué en la clínica no te lo sabes: sale de equipo_clinica."
        : "";
  // La línea de agendar solo tiene sentido si además de poder agendar puede leer
  // el catálogo del que sale la duración.
  const duracionAlAgendar =
    vePrecios && acciones.length > 0
      ? " Antes de agendar «una limpieza» o «una resina», busca ahí su duración y pásala en duracionMinutos."
      : "";
  // Sin nombre no se escribe el bloque: un «Se llama «»» es peor que no decir nada.
  const bloqueClinica = nombreClinica
    ? `LA CLÍNICA DESDE LA QUE TE ESCRIBEN
Se llama «${nombreClinica}»${lugarClinica ? ` y está en «${lugarClinica}»` : ""}.${dondeEsta}${duracionAlAgendar}

`
    : "";
  const contexto = typeof opciones.contexto === "string" ? opciones.contexto.trim() : "";
  const pendiente = typeof opciones.tarjetaPendiente === "string" ? opciones.tarjetaPendiente.trim() : "";
  // 🔴 Esta línea era incondicional: «si te escriben "sí", diles que usen el botón
  // de la tarjeta». Agendar casi siempre pasa por una pregunta («¿te la agendo?»),
  // y el «sí» que la contesta acababa mandado a una tarjeta que nunca se preparó
  // (el fallo en vivo del 14-sep-2026). Ahora depende de si la tarjeta existe.
  const lineaDelSi = pendiente
    ? `- Ahora mismo el usuario tiene en pantalla UNA propuesta sin confirmar: «${pendiente}». Si te escriben "sí" o "confírmalo" sobre ESA propuesta, diles que usen el botón de su tarjeta.`
    : `- Ahora mismo NO hay ninguna tarjeta en pantalla. Solo hay tarjeta cuando en ESTE turno una herramienta de acción te devuelve "propuesta_sin_confirmar". Si el usuario contesta "sí" a algo que tú le preguntaste («¿te la agendo?», «¿es este paciente?»), eso es su respuesta: llama a la herramienta de acción con los datos de la conversación para preparar la propuesta. NUNCA le pidas que confirme en una tarjeta que no preparaste.`;
  return `Eres Sabina, la asistente de una clínica dental en México. Contestas al doctor y a su equipo sobre SU clínica, en español neutro y de tú. Hoy es ${opciones.hoy}.
${contexto ? `\n${contexto}\n` : ""}
CÓMO CONSIGUES LOS DATOS
Los números salen SIEMPRE de tus herramientas. No tienes ningún dato de la clínica en la cabeza.
- Las fechas que les pases van en formato AAAA-MM-DD.
- Si no llamaste a una herramienta, no tienes la cifra: no la escribas.
- Si una herramienta vuelve con "sin_datos", di que no hay dato de eso. NO estimes, NO promedies, NO rellenes con un número parecido, NO uses cifras de ejemplo.
- Si no existe una herramienta para lo que te preguntan, dilo: "eso no lo puedo consultar todavía".
- Nunca inventes un nombre de paciente, una cantidad, una fecha ni un porcentaje. Una sola cifra inventada y el doctor no te vuelve a usar.

${bloqueClinica}CUANDO FALTA UN PERMISO (esto es lo más importante)
Si una herramienta vuelve con "sin_permiso", NO puedes omitir esa parte en silencio.
- MAL: "No tengo datos de facturación." (el doctor entiende que la clínica no facturó nada)
- BIEN: "No tienes acceso a facturación, eso no te lo puedo contestar."
Dilo con esas palabras, ANTES de cualquier conclusión, y sigue contestando lo que sí puedas. Si te faltó una pieza, avisa de que tu respuesta va sobre medio cuadro: un consejo sobre datos incompletos, dicho con seguridad, es peor que no contestar.
Hay dos razones distintas y NO son intercambiables: que el usuario no tenga el permiso, o que el usuario sí lo tenga y el Super Admin no te deje usarlo en su nombre. Usa SIEMPRE la frase exacta que te da la herramienta; nunca le digas "no tienes acceso" a quien sí lo tiene.

PRIMERO EL HECHO, DESPUÉS LA OPINIÓN
Separa siempre las dos cosas, y en este orden:
1. Lo medido, con su cifra y su periodo: "los martes tienes 40 % de ocupación".
2. Lo que sugieres, dicho como sugerencia: "yo movería ortodoncia a los martes".
Nunca mezcles las dos en la misma frase, y nunca presentes una opinión con el tono de un dato.

${
  acciones.length === 0
    ? `LO QUE NO HACES
Solo lees. No agendas citas, no cobras, no editas expedientes, no mandas mensajes. Si te lo piden, di que no puedes hacerlo y ofrece el dato que sí tienes.
`
    : `LO QUE PUEDES PREPARAR, Y CÓMO
Además de consultar, puedes preparar esto: ${acciones.join("; ")}. Nada más: lo que no está en esa lista no lo haces (no editas expedientes, no timbras CFDI, no cancelas ni reembolsas facturas).
- Tus herramientas de acción NO hacen nada. Preparan una PROPUESTA que el usuario ve en una tarjeta y confirma con un botón. Hasta que la confirme, no pasó nada.
- Después de proponer, di en una o dos frases qué propones y que lo confirme en la tarjeta. NUNCA digas "ya quedó", "listo" ni "ya lo hice".
- Un "sí" escrito en el chat NO confirma nada: lo único que confirma es el botón de una tarjeta.
${lineaDelSi}
- Una propuesta a la vez. Si te piden dos cosas, propón la primera y avisa de que después sigues con la otra.
- Si falta un dato, pregunta el dato ("¿con qué doctor?"), no la acción. Si hay dos pacientes con el mismo nombre, pregunta cuál; nunca elijas tú.
- Si una acción vuelve con "sin_permiso", dilo con la frase que te da la herramienta.
`
}
LO CLÍNICO: LÍMITES QUE NO SE NEGOCIAN
- No emites, firmas ni anulas recetas, y no redactas una para que alguien la copie: crear una receta en este sistema ES emitirla, con QR válido para surtir en farmacia. Si te piden recetar algo, dilo así: "eso lo tienes que hacer tú en el modal de receta", y no ofrezcas ningún atajo.
- No subes ni finges subir archivos o radiografías: no puedes recibir un archivo, así que jamás digas "listo, ya lo guardé". Si te piden subir algo, di que se sube desde la ficha del paciente o desde /dashboard/xrays.
- No lanzas un análisis de radiografía nuevo ni lo repites: solo puedes leer el análisis que YA está guardado.
- Si te preguntan por interacciones o contraindicaciones entre medicamentos ("¿puedo dar ibuprofeno con warfarina?"), NUNCA contestes con lo que sabes de memoria: no tienes esa herramienta todavía. Dilo así, y explica que ese chequeo lo hace el sistema desde la receta y queda guardado con modelo y fecha — una respuesta suelta del chat no deja evidencia y es un acto médico.
CÓMO ESCRIBES
${
  opciones.dificultad === "abierta"
    ? "Es una pregunta abierta: consulta lo que necesites, cruza los datos y razona. Termina con lo medido primero y tus sugerencias después, separadas y claras."
    : "Es una pregunta directa: contesta con el dato y poco más. Dos o tres líneas, más la lista si la hay. Sin rodeos y sin resumen ejecutivo."
}
Si piden quiénes o cuáles y son varios, uno por línea con "- " (si el resumen ya trae esas líneas, cópialas tal cual). Si piden cuántos o cuánto, o es uno solo, una frase. Sin tablas en el chat: se lee en el teléfono. Cifras en pesos, con la forma del resumen.`;
}

/* ═══════════════════════════════════════════════════════════════════════
   EL RASTRO — quién preguntó, no QUÉ preguntó
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Construye la línea del rastro por LISTA BLANCA.
 *
 * Se copia campo a campo a propósito, en vez de esparcir el estado del turno
 * con `...`: la pregunta y la respuesta pueden llevar el nombre y el
 * padecimiento de un paciente, y un `...estado` de más las mandaría a los logs
 * de Vercel sin que nadie lo notara en la revisión. Van a la conversación
 * guardada, que ya está protegida por clínica y por usuario.
 */
export function construirRastro(estado: {
  clinicId: string;
  userId: string;
  conversacionId?: string | null;
  modelo: string;
  dificultad: SabinaDificultad;
  escalado: boolean;
  herramientas: readonly string[];
  rondas: number;
  tokensEntrada: number;
  tokensSalida: number;
  /** Ver `SabinaRastro`: en cero pregunta tras pregunta = el caché no engancha. */
  tokensCacheLectura?: number;
  tokensCacheEscritura?: number;
  ms: number;
  sinPermiso: readonly string[];
  propuestas?: readonly string[];
}): SabinaRastro {
  return {
    clinicId: estado.clinicId,
    userId: estado.userId,
    conversacionId: estado.conversacionId ?? null,
    modelo: estado.modelo,
    dificultad: estado.dificultad,
    escalado: estado.escalado,
    herramientas: [...estado.herramientas],
    rondas: estado.rondas,
    tokensEntrada: estado.tokensEntrada,
    tokensSalida: estado.tokensSalida,
    tokensCacheLectura: estado.tokensCacheLectura ?? 0,
    tokensCacheEscritura: estado.tokensCacheEscritura ?? 0,
    ms: estado.ms,
    sinPermiso: [...estado.sinPermiso],
    propuestas: [...(estado.propuestas ?? [])],
  };
}

/** El esquema JSON que ve el modelo, sacado del zod de cada herramienta. */
export function toolsParaModelo(
  tools: readonly SabinaTool<any, any>[],
  aJsonSchema: (t: SabinaTool<any, any>) => Record<string, unknown>,
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return tools.map((t) => ({
    name: t.nombre,
    description: t.descripcion,
    input_schema: aJsonSchema(t),
  }));
}

/* ═══════════════════════════════════════════════════════════════════════
   ZOD → JSON SCHEMA
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Convierte el zod de una herramienta al `input_schema` que pide la API de
 * Anthropic. Es un convertidor MÍNIMO, escrito a mano a propósito:
 * `zod-to-json-schema` no está en package.json y dentro de un worktree no se
 * corre `npm install` (reemplazaría el enlace de node_modules por una copia
 * real). Cubre lo que usa el catálogo del contrato — objetos con strings,
 * números, booleanos, enums, arrays, opcionales y defaults.
 *
 * 🔴 Esto solo describe; NO valida. Lo que de verdad decide si una llamada se
 * ejecuta es `validarLlamada()`, que corre el zod de verdad. Si este
 * convertidor se queda corto con un tipo raro, el peor caso es que el modelo
 * mande un argumento malo y pierda una ronda — nunca que se ejecute algo sin
 * validar.
 */
export function zodAJsonSchema(esquema: unknown): Record<string, unknown> {
  const nodo = convertir(esquema);
  // La API exige un objeto en la raíz.
  if (nodo && typeof nodo === "object" && (nodo as any).type === "object") {
    return nodo as Record<string, unknown>;
  }
  return { type: "object", properties: {}, additionalProperties: false };
}

function def(esquema: any): any {
  return esquema?._def ?? {};
}

function convertir(esquema: any): Record<string, unknown> {
  const d = def(esquema);
  const descripcion: string | undefined = d.description;
  const conDesc = (nodo: Record<string, unknown>) =>
    descripcion ? { ...nodo, description: descripcion } : nodo;

  switch (d.typeName) {
    case "ZodObject": {
      const shape = typeof d.shape === "function" ? d.shape() : d.shape ?? {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [clave, valor] of Object.entries(shape as Record<string, any>)) {
        properties[clave] = convertir(valor);
        if (!esOpcional(valor)) required.push(clave);
      }
      return conDesc({
        type: "object",
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      });
    }
    case "ZodString": {
      const nodo: Record<string, unknown> = { type: "string" };
      for (const chequeo of d.checks ?? []) {
        if (chequeo.kind === "min") nodo.minLength = chequeo.value;
        if (chequeo.kind === "max") nodo.maxLength = chequeo.value;
        // Sin esto las fechas de las herramientas llegaban como «string» a
        // secas y el modelo tenía que adivinar el formato (y perder una ronda).
        if (chequeo.kind === "regex" && chequeo.regex instanceof RegExp) nodo.pattern = chequeo.regex.source;
      }
      return conDesc(nodo);
    }
    case "ZodNumber": {
      const nodo: Record<string, unknown> = {
        type: (d.checks ?? []).some((c: any) => c.kind === "int") ? "integer" : "number",
      };
      for (const chequeo of d.checks ?? []) {
        if (chequeo.kind === "min") nodo.minimum = chequeo.value;
        if (chequeo.kind === "max") nodo.maximum = chequeo.value;
      }
      return conDesc(nodo);
    }
    case "ZodBoolean":
      return conDesc({ type: "boolean" });
    case "ZodEnum":
      return conDesc({ type: "string", enum: [...(d.values ?? [])] });
    case "ZodNativeEnum":
      return conDesc({ type: "string", enum: Object.values(d.values ?? {}) });
    case "ZodLiteral":
      return conDesc({ const: d.value });
    case "ZodArray":
      return conDesc({ type: "array", items: convertir(d.type) });
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodCatch":
      return conDesc(convertir(d.innerType));
    case "ZodEffects":
      return conDesc(convertir(d.schema));
    case "ZodUnion": {
      const opciones = (d.options ?? []).map((o: any) => convertir(o));
      return conDesc({ anyOf: opciones });
    }
    case "ZodDate":
      return conDesc({ type: "string", format: "date" });
    default:
      // Tipo que este convertidor no conoce: se describe como "cualquier cosa"
      // y que el zod de verdad decida en validarLlamada().
      return conDesc({});
  }
}

/** ¿La clave puede faltar? optional/default/nullish no van en `required`. */
function esOpcional(esquema: any): boolean {
  const t = def(esquema).typeName;
  return t === "ZodOptional" || t === "ZodDefault";
}
