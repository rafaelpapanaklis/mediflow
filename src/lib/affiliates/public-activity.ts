/**
 * Afiliados — AVISOS FLOTANTES de la landing pública (/afiliados).
 *
 * Arma la lista de mensajes que el widget de la esquina inferior izquierda va
 * rotando. Se resuelve ENTERA en el servidor y viaja como props: el navegador
 * recibe texto ya formado y nada más.
 *
 * DOS MODOS, y el que manda lo decide este archivo:
 *
 *  · REAL — con `MIN_REALES` o más comisiones en los últimos `DIAS_VENTANA`
 *    días. Cada tarjeta corresponde a una fila de `affiliate_commissions`.
 *  · INFO — mientras no haya tantas. Mensajes que son VERDAD sobre cómo
 *    funciona el programa: sin personas, sin eventos, sin nadie cobrando.
 *
 * El modo info trae DOS TIPOS de tarjeta y se publican mezclados —el widget los
 * alterna, ver `intercala` en avisos.tsx—:
 *
 *  · "regla"  — una condición del programa ("se paga en los primeros 10 días").
 *  · "sueldo" — cuánto cobra AL MES quien tiene tantas clínicas activas ("una
 *    persona con 18 clínicas del plan Profesional cobra $2,520 al mes"). No es
 *    un evento ni un caso: es la mecánica del programa dicha en pesos, en
 *    presente y sin sujeto, y el monto SIEMPRE es cantidad × fijo del plan.
 *
 * REGLA QUE NO SE NEGOCIA: ninguna tarjeta puede decir que alguien cobró si no
 * cobró. En modo real el verbo sale del `status` de la fila —"cobró" sólo con
 * status "paid"; lo demás "generó una comisión de"— y en modo info no se
 * menciona a nadie.
 *
 * PRIVACIDAD (modo real):
 *  · Al cliente NO viaja ni un id, correo, nombre ni fecha exacta. Sólo la
 *    frase ya redactada.
 *  · El estado sólo aparece con `MIN_AFILIADOS_ESTADO`+ afiliados distintos
 *    comisionando en la ventana. Con dos afiliados en el programa, el estado
 *    los señala con el dedo.
 *  · Fechas relativas y redondeadas ("esta semana"), nunca el día.
 *  · Máximo `MAX_POR_AFILIADO` tarjetas por afiliado, para que la actividad de
 *    uno solo no se pueda reconstruir viendo el ciclo entero.
 *
 * OJO CON EL ESTADO: `Affiliate` no tiene columna de ubicación —sólo `Clinic`
 * la tiene—, así que el estado que se publica es el DE LA CLÍNICA y la frase lo
 * dice así ("por una clínica del plan Profesional en Jalisco"). Atribuírselo al
 * afiliado sería inventar un dato que no existe en la BD.
 *
 * MONTOS: ni uno escrito a mano. Los reales salen de la fila; los del modo info,
 * de `getPublicOffer()` (plan_configs + affiliate_payout_config). Si el admin
 * mueve una comisión en /admin, estas tarjetas cambian sin deploy.
 *
 * NUNCA LANZA: la consulta va en try/catch y cualquier fallo cae a modo info.
 * La landing es estática con ISR y se prerenderiza en el build, donde puede no
 * haber BD: un throw aquí tumbaría la página entera.
 */
import { prisma } from "@/lib/prisma";
import { fmtMxn, type PublicOffer } from "./public-offer";
import type { PlanKey } from "./payout-core";
// Desde `network-bonus-core` (puro) y no desde `network-bonus`: aquí solo hace
// falta la cadena del `kind`, no el motor de bonos. Se importa en vez de
// teclear "network_bonus" porque una copia desincronizada volvería a colar los
// bonos en los avisos públicos sin que nadie lo note.
import { NETWORK_BONUS_KIND } from "./network-bonus-core";
import type { AvisoAfiliado } from "@/components/afiliados/landing/avisos";

/** Ventana de actividad que se considera "reciente". */
const DIAS_VENTANA = 90;
/** Comisiones mínimas en la ventana para encender el modo real. */
const MIN_REALES = 3;
/** Afiliados distintos mínimos para que se pueda nombrar un estado. */
const MIN_AFILIADOS_ESTADO = 5;
/** Tarjetas máximas de un mismo afiliado dentro del ciclo. */
const MAX_POR_AFILIADO = 2;
/** Tope de tarjetas del modo real. */
const MAX_REALES = 10;
/**
 * Tope POR TIPO en modo info. Se cuenta por separado, no sobre el total, y esa
 * es la clave de la mezcla: el widget alterna reglas y sueldos, y la alternancia
 * sólo se sostiene mientras ningún tipo pase de la mitad de la lista. Un tope
 * común dejaría pasar 9 reglas y 1 sueldo.
 */
const MAX_POR_TIPO = 10;
/** Filas que se leen como mucho: el ciclo nunca necesita más. */
const MAX_FILAS = 200;

export interface AvisosAfiliados {
  modo: "real" | "info";
  avisos: AvisoAfiliado[];
}

/**
 * Fecha relativa REDONDEADA. Nunca el día exacto: en modo real, una fecha
 * precisa más el estado y el plan bastarían para señalar a una clínica.
 */
function cuando(dias: number): string {
  if (dias <= 7) return "esta semana";
  if (dias <= 14) return "hace unos días";
  if (dias <= 31) return "este mes";
  if (dias <= 62) return "hace unas semanas";
  return "hace un par de meses";
}

/**
 * Modo REAL. Devuelve [] si no hay material suficiente y el caller cae a info.
 */
async function avisosReales(offer: PublicOffer): Promise<AvisoAfiliado[]> {
  const desde = new Date(Date.now() - DIAS_VENTANA * 24 * 60 * 60 * 1000);

  const filas = await prisma.affiliateCommission.findMany({
    // Los BONOS POR RED quedan FUERA. Toda tarjeta de este modo dice "por una
    // clínica" y resuelve el plan a partir de `clinicId`; un bono no nace de
    // ninguna clínica (su `clinicId` va vacío a propósito), así que publicaría
    // en una página PÚBLICA una frase falsa —"Un afiliado cobró $400,000 por
    // una clínica"— sobre el pago más grande del programa. Los bonos tienen su
    // sitio en el panel del afiliado y en los términos, no aquí.
    //
    // El `NOT` es seguro sobre esta columna: `kind` es `text NOT NULL DEFAULT
    // 'pct'` (sql/afiliados-comisiones.sql), así que no hay filas con NULL que
    // un `kind <> 'network_bonus'` descartaría en silencio. Sobre una columna
    // nullable haría falta además la rama `OR { kind: null }`.
    where: {
      createdAt: { gte: desde },
      commissionMxn: { gt: 0 },
      NOT: { kind: NETWORK_BONUS_KIND },
    },
    // Sólo lo que hace falta para redactar. `Clinic` entera jamás: esta página
    // es pública y toda columna nueva se filtraría sola.
    select: {
      affiliateId: true,
      clinicId: true,
      commissionMxn: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: MAX_FILAS,
  });

  if (filas.length < MIN_REALES) return [];

  // Umbral de anonimato: con pocos afiliados en el programa, el estado deja de
  // ser un dato agregado y se convierte en una identificación.
  const afiliados = new Set<string>();
  for (const f of filas) afiliados.add(f.affiliateId);
  const puedeNombrarEstado = afiliados.size >= MIN_AFILIADOS_ESTADO;

  // `clinicId` es una columna suelta, no una relación de Prisma: se resuelve
  // aparte. Una clínica borrada simplemente no aparece en el mapa y su tarjeta
  // sale sin plan ni estado, en vez de tumbar la consulta.
  const ids: string[] = [];
  const vistos = new Set<string>();
  for (const f of filas) {
    if (vistos.has(f.clinicId)) continue;
    vistos.add(f.clinicId);
    ids.push(f.clinicId);
  }

  const clinicas = await prisma.clinic.findMany({
    where: { id: { in: ids } },
    select: { id: true, state: true, plan: true },
  });
  const porClinica = new Map<string, { state: string | null; plan: string }>();
  for (const c of clinicas) porClinica.set(c.id, { state: c.state, plan: String(c.plan) });

  // Etiqueta comercial del plan tal como la define plan_configs — nunca
  // "Profesional" tecleado aquí.
  const etiqueta = new Map<string, string>();
  for (const p of offer.plans) etiqueta.set(p.key, p.label);

  const ahora = Date.now();
  const porAfiliado = new Map<string, number>();
  const vistas = new Set<string>();
  const avisos: AvisoAfiliado[] = [];

  for (const fila of filas) {
    if (avisos.length >= MAX_REALES) break;

    const usados = porAfiliado.get(fila.affiliateId) ?? 0;
    if (usados >= MAX_POR_AFILIADO) continue;

    const clinica = porClinica.get(fila.clinicId);
    const label = clinica ? etiqueta.get(clinica.plan) : undefined;
    const plan = label ? ` del plan ${label}` : "";
    const monto = fmtMxn(fila.commissionMxn);

    // El status manda. "Cobró" afirma que el dinero ya salió; una comisión
    // pendiente todavía no se cobró, así que ahí la frase no tiene sujeto
    // cobrando nada.
    const texto =
      fila.status === "paid"
        ? `Un afiliado cobró ${monto} por una clínica${plan}`
        : `Comisión de ${monto} por una clínica${plan}`;

    // El estado va en la SEGUNDA línea, no en la frase: en la primera la
    // empujaba a un tercer renglón y la tarjeta la cortaba a media palabra.
    const estado =
      puedeNombrarEstado && clinica?.state && clinica.state.trim()
        ? clinica.state.trim()
        : "";
    const dias = Math.max(0, Math.floor((ahora - fila.createdAt.getTime()) / 86_400_000));
    const pie = estado ? `${estado} · ${cuando(dias)}` : cuando(dias);

    // Se deduplica por las DOS líneas: dos comisiones iguales en estados
    // distintos son tarjetas distintas.
    const clave = `${texto}|${pie}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);

    porAfiliado.set(fila.affiliateId, usados + 1);
    avisos.push({ k: `r${avisos.length}`, texto, pie, icono: "moneda", tipo: "real" });
  }

  // Puede quedar por debajo del mínimo tras el tope por afiliado (p. ej. cinco
  // comisiones de un mismo afiliado dejan dos tarjetas): entonces no hay modo
  // real que valga.
  return avisos.length >= MIN_REALES ? avisos : [];
}

/**
 * Modo INFO, tipo REGLA. Afirmaciones sobre el programa, todas ciertas y todas
 * con sus cifras salidas de la config. No hay eventos ni personas, así que
 * tampoco hay nada que etiquetar como ejemplo.
 */
function avisosReglas(offer: PublicOffer): AvisoAfiliado[] {
  const avisos: AvisoAfiliado[] = [];

  // Uno por plan con fijo recurrente encendido.
  for (const plan of offer.plans) {
    if (plan.recurringMxn <= 0) continue;
    avisos.push({
      k: `p-${plan.key}`,
      texto: `${fmtMxn(plan.recurringMxn)} al mes por cada clínica del plan ${plan.label}, mientras siga activa`,
      icono: "moneda",
      tipo: "regla",
    });
  }

  // Bonos: sólo si la promoción está encendida en /admin. Con más de dos
  // escalones se publican el primero y el grande — los dos que de verdad
  // cuentan— para no comerse el ciclo entero con bonos.
  const tiers = offer.milestones.tiers;
  if (offer.milestones.enabled && tiers.length > 0) {
    const elegidos = tiers.length > 2 ? [tiers[0], tiers[tiers.length - 1]] : tiers;
    for (const hito of elegidos) {
      avisos.push({
        k: `h-${hito.n}`,
        texto: `Al llegar a ${hito.clinics} clínicas activas recibes un bono de ${fmtMxn(hito.mxn)}`,
        icono: "regalo",
        tipo: "regla",
      });
    }
  }

  // Los cinco fijos, en orden de importancia: si algún día sobran mensajes, el
  // recorte de `MAX_POR_TIPO` muerde por el final.
  //
  // Van todos MEDIDOS para caber en dos renglones de la tarjeta (236px de
  // columna). Alargar uno no rompe nada, pero el clamp lo corta a media frase:
  // si lo tocas, compruébalo en pantalla.
  avisos.push({
    k: "s-pago",
    texto: "Se paga dentro de los primeros 10 días del mes siguiente",
    icono: "calendario",
    tipo: "regla",
  });
  avisos.push({
    k: "s-anual",
    texto: "Si la clínica contrata el plan anual, cobras los 12 meses de golpe",
    icono: "calendario",
    tipo: "regla",
  });
  avisos.push({
    k: "s-gratis",
    texto: "Entrar al programa es gratis y sin exclusividad",
    icono: "escudo",
    tipo: "regla",
  });
  avisos.push({
    k: "s-equipo",
    texto: "Registra a tus propios vendedores y asígnales su porcentaje",
    icono: "personas",
    tipo: "regla",
  });
  avisos.push({
    k: "s-cobro",
    texto: "Cobras por SPEI o PayPal, tú eliges",
    icono: "escudo",
    tipo: "regla",
  });

  return avisos.slice(0, MAX_POR_TIPO);
}

/** Lo que el redactor de un sueldo tiene a mano. Todo sale de la config. */
interface SueldoCtx {
  /** Clínicas de la receta (la suma de la mezcla). */
  total: number;
  /** Cuántas de cada plan, en el orden de la mezcla. */
  ns: number[];
  /** Etiqueta comercial de cada plan, en el orden de la mezcla. */
  planes: string[];
  /** El sueldo mensual ya formateado. Es Σ (n × fijo recurrente del plan). */
  monto: string;
}

/**
 * Las diez recetas del tipo SUELDO: una cantidad de clínicas, sus planes y cómo
 * se dice. El monto NO está aquí —se calcula— y el `frase` tampoco teclea las
 * cantidades: las lee del contexto, para que texto y número no se puedan
 * desincronizar.
 *
 * REGLAS DE REDACCIÓN, que son el motivo de que esto exista:
 *  · PRESENTE genérico y sujeto indefinido. Describen la mecánica del programa
 *    ("una persona con 18 clínicas cobra…"), no algo que le pasó a alguien: ni
 *    pasado, ni nombres, ni correos, ni ciudades, ni marcas de tiempo.
 *  · El monto es cantidad × fijo del plan, leído de `getPublicOffer()`. Si el
 *    admin mueve un fijo, estas frases cambian solas.
 *
 * LARGO: igual que las reglas, van medidos para caber en los dos renglones de
 * la tarjeta (236px de columna, ver afiliados.css). El más largo anda por 68
 * caracteres con las etiquetas de plan de hoy; pasarse de ahí no rompe nada,
 * pero el clamp corta la frase a media palabra.
 */
const SUELDOS: {
  k: string;
  mezcla: { key: PlanKey; n: number }[];
  frase: (c: SueldoCtx) => string;
}[] = [
  {
    k: "g-pro-18",
    mezcla: [{ key: "PRO", n: 18 }],
    frase: (c) => `Una persona con ${c.ns[0]} clínicas del plan ${c.planes[0]} cobra ${c.monto} al mes`,
  },
  {
    k: "g-basic-30",
    mezcla: [{ key: "BASIC", n: 30 }],
    frase: (c) => `Quien tiene ${c.ns[0]} clínicas del plan ${c.planes[0]} cobra ${c.monto} cada mes`,
  },
  {
    k: "g-clinic-12",
    mezcla: [{ key: "CLINIC", n: 12 }],
    frase: (c) => `Una persona con ${c.ns[0]} clínicas del plan ${c.planes[0]} cobra ${c.monto} mensuales`,
  },
  {
    // La única de una sola clínica: es el ladrillo con el que se arma el resto.
    k: "g-pro-1",
    mezcla: [{ key: "PRO", n: 1 }],
    frase: (c) => `Quien trae una clínica del plan ${c.planes[0]} cobra ${c.monto} cada mes`,
  },
  {
    k: "g-basic-45",
    mezcla: [{ key: "BASIC", n: 45 }],
    frase: (c) => `Quien mantiene ${c.ns[0]} clínicas del plan ${c.planes[0]} cobra ${c.monto} al mes`,
  },
  {
    k: "g-clinic-5",
    mezcla: [{ key: "CLINIC", n: 5 }],
    frase: (c) => `Con ${c.ns[0]} clínicas del plan ${c.planes[0]} activas se cobran ${c.monto} al mes`,
  },
  {
    k: "g-pro-8",
    mezcla: [{ key: "PRO", n: 8 }],
    frase: (c) => `${c.ns[0]} clínicas activas del plan ${c.planes[0]} dan ${c.monto} al mes`,
  },
  {
    k: "g-mix-25",
    mezcla: [{ key: "PRO", n: 15 }, { key: "BASIC", n: 10 }],
    frase: (c) =>
      `Quien tiene ${c.ns[0]} clínicas ${c.planes[0]} y ${c.ns[1]} ${c.planes[1]} cobra ${c.monto} al mes`,
  },
  {
    k: "g-mix-16",
    mezcla: [{ key: "PRO", n: 10 }, { key: "CLINIC", n: 6 }],
    frase: (c) =>
      `Con ${c.ns[0]} clínicas ${c.planes[0]} y ${c.ns[1]} ${c.planes[1]} se cobran ${c.monto} al mes`,
  },
  {
    k: "g-basic-20",
    mezcla: [{ key: "BASIC", n: 20 }],
    frase: (c) => `Una cartera de ${c.total} clínicas del plan ${c.planes[0]} deja ${c.monto} al mes`,
  },
];

/**
 * Modo INFO, tipo SUELDO. Cuánto se cobra al mes con tantas clínicas activas.
 *
 * Una receta cuyo plan esté APAGADO en /admin (fijo recurrente en 0) se descarta
 * ENTERA: quitar sólo esa parte de la mezcla dejaría una frase que dice "25
 * clínicas" al lado de un monto de 15, y la tarjeta mentiría.
 *
 * Alcance heredado de la página: como toda la landing, esto publica los montos
 * FIJOS por plan. En un programa configurado en modo "pct" (% del nivel) la
 * landing entera diría otra cosa — ver ORQUESTA.md.
 */
function avisosSueldo(offer: PublicOffer): AvisoAfiliado[] {
  const fijo = new Map<string, { label: string; mxn: number }>();
  for (const p of offer.plans) fijo.set(p.key, { label: p.label, mxn: p.recurringMxn });

  const avisos: AvisoAfiliado[] = [];
  for (const receta of SUELDOS) {
    if (avisos.length >= MAX_POR_TIPO) break;

    let mxn = 0;
    let total = 0;
    const ns: number[] = [];
    const planes: string[] = [];
    let completa = true;

    for (const parte of receta.mezcla) {
      const plan = fijo.get(parte.key);
      if (!plan || !(plan.mxn > 0)) {
        completa = false;
        break;
      }
      mxn += parte.n * plan.mxn;
      total += parte.n;
      ns.push(parte.n);
      planes.push(plan.label);
    }

    if (!completa || mxn <= 0) continue;

    avisos.push({
      k: receta.k,
      texto: receta.frase({ total, ns, planes, monto: fmtMxn(mxn) }),
      icono: "grafica",
      tipo: "sueldo",
    });
  }

  return avisos;
}

/**
 * Modo INFO completo: reglas + sueldos, en una sola lista. El ORDEN de aquí no
 * es el de la pantalla —el widget baraja y alterna por tipo—, así que se
 * entregan agrupados y con su tope por tipo, que es lo que deja la mezcla
 * pareja.
 */
function avisosInformativos(offer: PublicOffer): AvisoAfiliado[] {
  return avisosReglas(offer).concat(avisosSueldo(offer));
}

/**
 * Avisos vigentes para la landing. Recibe la oferta ya resuelta por la página
 * (una lectura, no dos) y elige el modo solo.
 */
export async function getAvisosAfiliados(offer: PublicOffer): Promise<AvisosAfiliados> {
  try {
    const reales = await avisosReales(offer);
    if (reales.length > 0) return { modo: "real", avisos: reales };
  } catch {
    // Sin BD (build, migración a medias, caída): la landing carga igual y el
    // widget se queda con los mensajes del programa. Nunca un 500 por esto.
  }
  return { modo: "info", avisos: avisosInformativos(offer) };
}
