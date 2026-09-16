import { NextResponse } from "next/server";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { fetchActiveDoctors } from "@/lib/agenda/server";
import { isValidDateISO, todayInTz } from "@/lib/agenda/time-utils";
import {
  buscarHuecosDelRango,
  rangoDeCuando,
  MAX_DIAS,
  TOPE_HUECOS_PANEL,
} from "@/lib/agenda-nueva/huecos.server";

export const dynamic = "force-dynamic";

/** Las duraciones que ofrece el panel. Nada fuera de esta lista. */
const DURACIONES = [30, 45, 60, 90];

const CUANDOS = ["asap", "semana", "proxima"] as const;
type Cuando = (typeof CUANDOS)[number];

/**
 * GET /api/agenda/huecos — los primeros huecos libres para el panel «Buscar
 * hueco» de la agenda nueva.
 *
 * Parámetros:
 *   cuando     asap | semana | proxima      (por defecto `asap`)
 *   duracion   30 | 45 | 60 | 90            (por defecto 45)
 *   doctorIds  lista separada por comas; vacío = todos los activos
 *
 * El `clinicId` sale SIEMPRE de la sesión, nunca de la petición. Un DOCTOR
 * solo ve huecos suyos: la agenda ya le restringe las citas a las propias, y
 * ofrecerle huecos de un compañero sería enseñarle su agenda por la puerta de
 * atrás.
 */
export async function GET(req: Request) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  // Mismo gate que la pantalla: quien no puede ver la agenda no busca huecos.
  const denegado = denyIfMissingPermission(session.user, "agenda.view");
  if (denegado) return denegado;

  const url = new URL(req.url);

  const cuandoCrudo = url.searchParams.get("cuando") ?? "asap";
  const cuando: Cuando = (CUANDOS as readonly string[]).includes(cuandoCrudo)
    ? (cuandoCrudo as Cuando)
    : "asap";

  const duracion = Number(url.searchParams.get("duracion") ?? 45);
  if (!DURACIONES.includes(duracion)) {
    return NextResponse.json(
      { error: "duracion_invalida", permitidas: DURACIONES },
      { status: 400 },
    );
  }

  const tz = session.clinic.timezone;
  const hoy = todayInTz(tz);

  // `desde` explícito para poder pedir huecos a partir de un día concreto; si
  // no viene (o es anterior a hoy), manda el rango de la opción «Cuándo». No
  // se ofrecen huecos en el pasado: `evaluarHora` los descarta igual, pero así
  // tampoco se barren días que no pueden dar nada.
  const desdeParam = url.searchParams.get("desde");
  const base = rangoDeCuando(cuando, hoy);
  const desde =
    desdeParam && isValidDateISO(desdeParam) && desdeParam > base.desde ? desdeParam : base.desde;
  const dias = Math.max(1, Math.min(MAX_DIAS, base.dias));

  // Los responsables entre los que buscar. Se cruzan con los activos de la
  // clínica: un id que llegue de fuera y no sea de esta clínica se cae aquí.
  const activos = await fetchActiveDoctors(session.clinic.id, session.clinic.category);
  const pedidos = (url.searchParams.get("doctorIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let candidatos = activos.filter((d) => pedidos.length === 0 || pedidos.includes(d.id));
  if (session.user.role === "DOCTOR") {
    candidatos = candidatos.filter((d) => d.id === session.user.id);
  }

  const nombres = new Map(candidatos.map((d) => [d.id, d.displayName]));

  const huecos = await buscarHuecosDelRango({
    clinicId: session.clinic.id,
    clinica: {
      timezone: tz,
      agendaDayStart: session.clinic.agendaDayStart,
      agendaDayEnd: session.clinic.agendaDayEnd,
      defaultSlotMinutes: session.clinic.defaultSlotMinutes,
      // Solo lo lee el camino de Sabina que sincroniza con Google; aquí no
      // interviene en el cálculo del hueco.
      googleCalendarEnabled: false,
      schedules: session.clinic.schedules,
    },
    desde,
    dias,
    duracionMin: duracion,
    doctorIds: candidatos.map((d) => d.id),
    nombresDoctor: nombres,
    ahora: new Date(),
    tope: TOPE_HUECOS_PANEL,
  });

  return NextResponse.json({ huecos, duracion, cuando, desde, dias, hoy });
}
