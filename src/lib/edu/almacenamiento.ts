/**
 * DaleControl INSTITUCIONAL — la CUOTA DE ALMACENAMIENTO contra la base.
 *
 * SERVIDOR: importa prisma. Lo puro —los umbrales, el precio del TB extra,
 * los textos, la aritmética— vive en almacenamiento-core.ts; aquí solo hay
 * consultas.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL CONSUMO SE CUENTA, NO SE GUARDA
 *
 * `SUM(sizeBytes)` de EduStudy con un `aggregate`, filtrando por
 * institutionId (el índice edu_studies_patient_idx empieza justo por esa
 * columna). Nunca se traen las filas: una escuela con 40 000 estudios
 * tumbaría la pantalla que intenta contarlos en memoria.
 *
 * No hay columna "bytes usados" a propósito, igual que en el cupo de IA de
 * la Ola 8: un contador guardado se desincroniza el día que una escritura
 * falle a la mitad, y a partir de ahí o se le bloquea la subida a una
 * escuela que sí tenía espacio, o se le regala el que ya usó. Se cuenta.
 *
 * 🔴 SE SUMA POR INSTITUTO, CON TODAS SUS SEDES DENTRO
 *
 * Tres sedes con 5 TB son 5 TB entre las tres. EduStudy ni siquiera tiene
 * campusId, así que el `where` de un instituto ya pool los campus solo — y
 * ese `where` lo construye eduAlmacenamientoWhere, que tiene su prueba
 * justo para que nadie le agregue un campusId "para afinar el reporte".
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LA CARRERA ENTRE /sign Y /confirm — QUÉ SE DECIDIÓ Y POR QUÉ
 *
 * La subida son tres pasos: /sign firma, el navegador hace el PUT, /confirm
 * mide el objeto real y CREA la fila. Los bytes solo cuentan cuando existe
 * la fila, así que dos personas que firman a la vez con la bolsa casi llena
 * ven las dos el mismo "quedan 100 GB" y las dos suben 80 GB: al final hay
 * 160 GB donde cabían 100.
 *
 * LA DECISIÓN: el corte vive en /sign y /confirm NO RECHAZA POR CUOTA.
 * Registra, aunque el total quede por encima, y deja un `console.warn` con
 * los números para que el rebase se pueda auditar.
 *
 * Por qué, en orden de peso:
 *
 *   1. En /confirm los bytes YA ESTÁN en el bucket. Rechazar ahí no ahorra
 *      un peso: para eso habría que BORRAR el objeto, y eso es destruir una
 *      radiografía que alguien subió entera, por una carrera que no podía
 *      ver. (No es lo mismo que el tope de 2 GB por archivo, que sí
 *      borra: allí el cliente MINTIÓ sobre el tamaño al firmar. Aquí no
 *      mintió nadie.)
 *   2. El rebase está ACOTADO: solo puede colarse lo que estaba en vuelo, y
 *      cada archivo en vuelo pesa como mucho EDU_MAX_STUDY_BYTES (2 GB).
 *      No es una fuga abierta, es un desbordamiento de borde.
 *   3. Se AUTOCORRIGE en el intento siguiente. Como el consumo se cuenta y
 *      no se guarda, el próximo /sign ya ve el total real —rebase incluido—
 *      y dice que no. No queda deriva ni contador que reparar.
 *   4. La alternativa honesta (RESERVAR los bytes al firmar) exige una
 *      tabla de reservas con caducidad. Un navegador que se cierra a media
 *      subida deja reservas fantasma que le comen la cuota a una escuela
 *      real hasta que pase un barrido — o sea, el modo de fallo pasa a ser
 *      "no puedo subir y nadie sabe por qué", que es peor que pasarse dos
 *      gigas.
 *   5. Y el rebase no es dinero perdido: el /admin enseña los TB usados y
 *      el contrato institucional se factura a mano. Esto no es la cuenta de
 *      API de la Ola 8, donde DaleControl se come el excedente en silencio.
 *
 * Es la misma forma del rebase que ya documentó el cupo de IA: el techo
 * frena lo que EMPIEZA, no aborta lo que está en vuelo.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import {
  eduAlmacenamientoWhere,
  eduAlmBytesDeTb,
  eduAlmCostoExtraMxn,
  eduAlmTb,
  eduAlmTbExtra,
  eduAlmTbLabel,
  eduAlmValidarTb,
  EDU_ALM_INCLUIDO_BYTES,
  type EduAlmAdminRow,
  type EduAlmMedidor,
} from "@/lib/edu/almacenamiento-core";
import { eduPuedeVerAlmacenamiento, type EduClinicaContext } from "@/lib/edu/visibility";

/**
 * BigInt → number.
 *
 * `JSON.stringify` no sabe serializar un BigInt (revienta el route handler
 * con "Do not know how to serialize a BigInt") y tampoco viaja de un
 * componente de servidor a uno de cliente. La cuota máxima que este
 * producto acepta son 1000 TB = 1.1e15, por debajo de
 * Number.MAX_SAFE_INTEGER (9.0e15): la conversión no pierde un byte.
 */
function aNumero(v: bigint | number | null | undefined): number {
  if (typeof v === "bigint") return Number(v);
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Lo que lleva usado un instituto: bytes y cuántos estudios son.
 *
 * UN aggregate, sin traer filas. El `_count` no es decoración: es lo que le
 * da derecho a la pantalla a decir "son N estudios" en vez de dejar creer
 * que ahí está TODO lo que pesa el bucket (las firmas de consentimiento
 * también viven ahí y no tienen fila con su tamaño).
 */
export async function eduAlmacenamientoUsado(
  institutionId: string,
): Promise<{ usadoBytes: number; estudios: number }> {
  const agg = await prisma.eduStudy.aggregate({
    where: eduAlmacenamientoWhere(institutionId),
    _sum: { sizeBytes: true },
    _count: { _all: true },
  });
  return {
    // Sin estudios, `_sum.sizeBytes` es null y no 0.
    usadoBytes: aNumero(agg._sum.sizeBytes),
    estudios: agg._count._all ?? 0,
  };
}

/**
 * EL MEDIDOR de un instituto: usado + cuota + número de estudios.
 *
 * Sin cerradura de rol a propósito: lo llama tanto la pantalla de dirección
 * (que ya pasó por `eduPuedeVerAlmacenamiento`) como el corte de /sign, que
 * se ejecuta para CUALQUIERA que suba un estudio — un alumno incluido. La
 * cerradura de quién ve el medidor está en quien lo pinta, no aquí: el
 * corte de la subida tiene que funcionar para todo el mundo.
 */
export async function getEduAlmacenamientoMedidor(institutionId: string): Promise<EduAlmMedidor> {
  if (!institutionId || typeof institutionId !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }

  const [institucion, usado] = await Promise.all([
    // Solo la columna que hace falta: la fila entera de un instituto trae
    // datos de contrato que esta pantalla no necesita ni debe arrastrar.
    prisma.eduInstitution.findUnique({
      where: { id: institutionId },
      select: { storageQuotaBytes: true },
    }),
    eduAlmacenamientoUsado(institutionId),
  ]);

  return {
    usadoBytes: usado.usadoBytes,
    estudios: usado.estudios,
    // Un instituto que no existe no puede subir nada: cuota 0. No se cae
    // aquí porque quien llama ya tiene sesión válida de ese instituto.
    cuotaBytes: aNumero(institucion?.storageQuotaBytes),
  };
}

/**
 * El medidor PARA EL PANEL DE DIRECCIÓN.
 *
 * Devuelve `null` —y no lanza— cuando el rol no lo ve: es una tarjeta más
 * de un tablero, y una excepción dejaría toda la pantalla de dirección en
 * blanco por una cuenta que simplemente no tiene que ver esta parte.
 *
 * 🔴 El alcance lo decide el punto único (visibility.ts), no esta función.
 * ⚠️ Y NO recibe la SEDE de la barra superior aunque el resto del tablero
 * sí: la cuota es del INSTITUTO. Filtrarla por campus le enseñaría a una
 * escuela con dos edificios la mitad de su consumo, y creería que le sobra
 * el doble de espacio del que le sobra.
 */
export async function getEduAlmacenamientoPanel(
  ctx: EduClinicaContext,
): Promise<EduAlmMedidor | null> {
  if (!eduPuedeVerAlmacenamiento(ctx)) return null;
  return getEduAlmacenamientoMedidor(ctx.institutionId);
}

// ═══════════════════════════════════════════════════════════════════════
// EL /admin DE DALECONTROL
// ═══════════════════════════════════════════════════════════════════════

/**
 * Todos los institutos con su cuota, su consumo y lo que hay que
 * facturarles al mes por el TB extra.
 *
 * DOS consultas para N institutos y no N+1: la lista, y UN `groupBy` que
 * suma los estudios de todos de una vez. La tercera cuenta las sedes, que
 * es informativo (no dividen la cuota: son ilimitadas y comparten bolsa).
 */
export async function listEduAlmacenamientoAdmin(): Promise<EduAlmAdminRow[]> {
  const institutos = await prisma.eduInstitution.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      storageQuotaBytes: true,
      _count: { select: { campuses: true } },
    },
  });
  if (institutos.length === 0) return [];

  const porInstituto = await prisma.eduStudy.groupBy({
    by: ["institutionId"],
    _sum: { sizeBytes: true },
    _count: { _all: true },
  });

  const usoPorId = new Map<string, { usadoBytes: number; estudios: number }>();
  for (const fila of porInstituto) {
    usoPorId.set(fila.institutionId, {
      usadoBytes: aNumero(fila._sum.sizeBytes),
      estudios: fila._count._all ?? 0,
    });
  }

  return institutos.map((i) => {
    const uso = usoPorId.get(i.id) ?? { usadoBytes: 0, estudios: 0 };
    const cuotaBytes = aNumero(i.storageQuotaBytes);
    const medidor: EduAlmMedidor = {
      usadoBytes: uso.usadoBytes,
      estudios: uso.estudios,
      cuotaBytes,
    };
    return {
      institutionId: i.id,
      nombre: i.name,
      slug: i.slug,
      activo: i.isActive,
      sedes: i._count.campuses,
      medidor,
      cuotaTbLabel: eduAlmTbLabel(cuotaBytes),
      usadoTbLabel: eduAlmTbLabel(uso.usadoBytes),
      extraTb: eduAlmTbExtra(cuotaBytes),
      costoExtraMxn: eduAlmCostoExtraMxn(cuotaBytes),
    };
  });
}

export interface EduAlmCambioCuota {
  ok: boolean;
  error?: string;
  /** Para la auditoría del /admin: qué había y qué quedó. */
  antesBytes?: number;
  despuesBytes?: number;
}

/**
 * Cambia la cuota de un instituto, en TB enteros.
 *
 * 🔴 ESTA ES LA ÚNICA PUERTA DE ESCRITURA, Y SALE DEL /admin DE DALECONTROL.
 * No hay ni un endpoint bajo /api/instituto que toque esta columna: si la
 * escuela pudiera subírsela sola, el cobro por TB extra no existiría. La
 * comprobación de sesión de administrador la hace la server action que
 * llama aquí (una server action se alcanza sin pasar por ningún layout).
 *
 * Devuelve el ANTES y el DESPUÉS porque el /admin los audita: subir una
 * cuota es cambiar lo que se le factura a un cliente, y eso tiene que dejar
 * rastro con nombre.
 */
export async function setEduAlmacenamientoCuotaTb(
  institutionId: string,
  tb: unknown,
): Promise<EduAlmCambioCuota> {
  if (!institutionId || typeof institutionId !== "string") {
    return { ok: false, error: "Falta el instituto." };
  }

  const invalido = eduAlmValidarTb(tb);
  if (invalido) return { ok: false, error: invalido };

  const antes = await prisma.eduInstitution.findUnique({
    where: { id: institutionId },
    select: { storageQuotaBytes: true },
  });
  if (!antes) return { ok: false, error: "Ese instituto no existe." };

  const despuesBytes = eduAlmBytesDeTb(Number(tb));
  await prisma.eduInstitution.update({
    where: { id: institutionId },
    data: { storageQuotaBytes: BigInt(despuesBytes) },
  });

  return { ok: true, antesBytes: aNumero(antes.storageQuotaBytes), despuesBytes };
}

/**
 * El total de lo que DaleControl debería estar facturando al mes por
 * almacenamiento extra, sumando todos los institutos.
 *
 * Es el número que contesta "¿cuánto dinero se me está yendo?": se calcula
 * a partir de las MISMAS filas que se pintan, no con una consulta aparte
 * que podría contestar otra cosa.
 */
export function eduAlmTotalMensualMxn(rows: EduAlmAdminRow[]): number {
  return (rows ?? []).reduce((suma, r) => suma + (r?.costoExtraMxn ?? 0), 0);
}

/** Los TB incluidos por contrato, para que el /admin lo diga sin repetirlo. */
export const EDU_ALM_INCLUIDO_TB = eduAlmTb(EDU_ALM_INCLUIDO_BYTES);
