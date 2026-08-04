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
import type { AvisoAfiliado } from "@/components/afiliados/landing/avisos";

/** Ventana de actividad que se considera "reciente". */
const DIAS_VENTANA = 90;
/** Comisiones mínimas en la ventana para encender el modo real. */
const MIN_REALES = 3;
/** Afiliados distintos mínimos para que se pueda nombrar un estado. */
const MIN_AFILIADOS_ESTADO = 5;
/** Tarjetas máximas de un mismo afiliado dentro del ciclo. */
const MAX_POR_AFILIADO = 2;
/** Tope de tarjetas en cualquiera de los dos modos. */
const MAX_AVISOS = 10;
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
    where: { createdAt: { gte: desde }, commissionMxn: { gt: 0 } },
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
    if (avisos.length >= MAX_AVISOS) break;

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
    avisos.push({ k: `r${avisos.length}`, texto, pie, icono: "moneda" });
  }

  // Puede quedar por debajo del mínimo tras el tope por afiliado (p. ej. cinco
  // comisiones de un mismo afiliado dejan dos tarjetas): entonces no hay modo
  // real que valga.
  return avisos.length >= MIN_REALES ? avisos : [];
}

/**
 * Modo INFO. Afirmaciones sobre el programa, todas ciertas y todas con sus
 * cifras salidas de la config. No hay eventos ni personas, así que tampoco hay
 * nada que etiquetar como ejemplo.
 */
function avisosInformativos(offer: PublicOffer): AvisoAfiliado[] {
  const avisos: AvisoAfiliado[] = [];

  // Uno por plan con fijo recurrente encendido.
  for (const plan of offer.plans) {
    if (plan.recurringMxn <= 0) continue;
    avisos.push({
      k: `p-${plan.key}`,
      texto: `${fmtMxn(plan.recurringMxn)} al mes por cada clínica del plan ${plan.label}, mientras siga activa`,
      icono: "moneda",
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
      });
    }
  }

  // Los cinco fijos, en orden de importancia: si algún día sobran mensajes, el
  // recorte de `MAX_AVISOS` muerde por el final.
  //
  // Van todos MEDIDOS para caber en dos renglones de la tarjeta (236px de
  // columna). Alargar uno no rompe nada, pero el clamp lo corta a media frase:
  // si lo tocas, compruébalo en pantalla.
  avisos.push({
    k: "s-pago",
    texto: "Se paga dentro de los primeros 10 días del mes siguiente",
    icono: "calendario",
  });
  avisos.push({
    k: "s-anual",
    texto: "Si la clínica contrata el plan anual, cobras los 12 meses de golpe",
    icono: "calendario",
  });
  avisos.push({
    k: "s-gratis",
    texto: "Entrar al programa es gratis y sin exclusividad",
    icono: "escudo",
  });
  avisos.push({
    k: "s-equipo",
    texto: "Registra a tus propios vendedores y asígnales su porcentaje",
    icono: "personas",
  });
  avisos.push({
    k: "s-cobro",
    texto: "Cobras por SPEI o PayPal, tú eliges",
    icono: "escudo",
  });

  return avisos.slice(0, MAX_AVISOS);
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
