"use client";

/**
 * LA LISTA DE BLOQUEOS — los futuros primero, agrupados por mes; los pasados,
 * plegados, para que no estorben.
 *
 * 🔴 El botón de retirar sale SOLO si el DTO trae `puedoRetirarlo: true`. Ese
 * permiso ya lo decidió el servidor —que sabe si quien mira es admin, o el
 * doctor dueño del bloqueo— y aquí NO se vuelve a razonar: ni un `role ===`,
 * ni un «por si acaso». Esconder no es permitir, pero enseñar una puerta que
 * va a dar 403 tampoco ayuda a nadie.
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Building2, User } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { diaCorto, diaDeInstante, diasDelBloqueo, horaDeInstante, mesLargo } from "./fechas";
import type { BloqueoDTO } from "./tipos";
import s from "./bloqueos.module.css";

interface Grupo {
  /** `YYYY-MM-01` del mes, para el rótulo y para ordenar. */
  mesISO: string;
  bloqueos: BloqueoDTO[];
}

/** Agrupa por el mes del PRIMER día del bloqueo, en la zona de la clínica. */
function agruparPorMes(bloqueos: BloqueoDTO[], timezone: string): Grupo[] {
  const mapa = new Map<string, BloqueoDTO[]>();
  for (const b of bloqueos) {
    const { primero } = diasDelBloqueo(b, timezone);
    const mesISO = `${primero.slice(0, 7)}-01`;
    const lista = mapa.get(mesISO);
    if (lista) lista.push(b);
    else mapa.set(mesISO, [b]);
  }
  return [...mapa.entries()]
    .map(([mesISO, lista]) => ({ mesISO, bloqueos: lista }))
    .sort((a, b) => a.mesISO.localeCompare(b.mesISO));
}

export function ListaBloqueos({
  bloqueos,
  timezone,
  locale,
  hoyISO,
  cargando,
  error,
  onCambio,
}: {
  bloqueos: BloqueoDTO[];
  timezone: string;
  locale: string;
  /** Hoy EN LA ZONA DE LA CLÍNICA. De aquí sale qué es pasado y qué futuro. */
  hoyISO: string;
  cargando: boolean;
  error: boolean;
  onCambio: () => void;
}) {
  const t = useT();
  const [verPasados, setVerPasados] = useState(false);
  const [retirando, setRetirando] = useState<string | null>(null);

  const { futuros, pasados } = useMemo(() => {
    const futuros: BloqueoDTO[] = [];
    const pasados: BloqueoDTO[] = [];
    for (const b of bloqueos) {
      // Un bloqueo es «pasado» cuando su ÚLTIMO día ya quedó atrás. El que
      // corre hoy sigue siendo de los de arriba: es el que importa.
      const { ultimo } = diasDelBloqueo(b, timezone);
      (ultimo < hoyISO ? pasados : futuros).push(b);
    }
    return { futuros, pasados };
  }, [bloqueos, timezone, hoyISO]);

  const grupos = useMemo(() => agruparPorMes(futuros, timezone), [futuros, timezone]);
  const gruposPasados = useMemo(
    // Los pasados, del más reciente al más viejo: el de la semana pasada
    // explica por qué esa tarde no hubo nadie; el de hace dos años, no.
    () => agruparPorMes(pasados, timezone).reverse(),
    [pasados, timezone],
  );

  async function retirar(b: BloqueoDTO) {
    setRetirando(b.id);
    try {
      const res = await fetch(`/api/settings/bloqueos/${encodeURIComponent(b.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success(t("settings.bloqueos.retiradoToast"));
      onCambio();
    } catch {
      toast.error(t("settings.bloqueos.retirarError"));
    } finally {
      setRetirando(null);
    }
  }

  return (
    <div className={s.tarjeta}>
      <h3 className={s.tarjetaTitulo}>{t("settings.bloqueos.listaTitulo")}</h3>

      {cargando && <p className={s.cargando}>{t("common.loading")}</p>}
      {error && !cargando && <p className={s.error}>{t("settings.bloqueos.listaError")}</p>}

      {!cargando && !error && grupos.length === 0 && (
        <p className={s.vacio}>{t("settings.bloqueos.listaVacia")}</p>
      )}

      {grupos.map((g) => (
        <section key={g.mesISO} className={s.grupo}>
          <h4 className={s.grupoTitulo}>{mesLargo(g.mesISO, locale)}</h4>
          <ul className={s.renglones}>
            {g.bloqueos.map((b) => (
              <Renglon
                key={b.id}
                b={b}
                timezone={timezone}
                locale={locale}
                retirando={retirando === b.id}
                onRetirar={retirar}
              />
            ))}
          </ul>
        </section>
      ))}

      {pasados.length > 0 && (
        <div className={s.plegado}>
          <button
            type="button"
            className={s.plegadoBoton}
            aria-expanded={verPasados}
            onClick={() => setVerPasados((v) => !v)}
          >
            {verPasados ? (
              <ChevronDown size={14} strokeWidth={2.2} aria-hidden />
            ) : (
              <ChevronRight size={14} strokeWidth={2.2} aria-hidden />
            )}
            {t("settings.bloqueos.pasados", { count: pasados.length })}
          </button>
          {verPasados &&
            gruposPasados.map((g) => (
              <section key={g.mesISO} className={s.grupo}>
                <h4 className={s.grupoTitulo}>{mesLargo(g.mesISO, locale)}</h4>
                <ul className={`${s.renglones} ${s.renglonesPasados}`}>
                  {g.bloqueos.map((b) => (
                    <Renglon
                      key={b.id}
                      b={b}
                      timezone={timezone}
                      locale={locale}
                      retirando={retirando === b.id}
                      onRetirar={retirar}
                    />
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── un renglón de la lista ─────────────────────── */

/**
 * Fuera del componente padre A PROPÓSITO: definida dentro, React la ve como un
 * tipo distinto en cada render y desmonta y vuelve a montar la lista entera en
 * cada tecla que toque el estado de arriba.
 */
function Renglon({
  b,
  timezone,
  locale,
  retirando,
  onRetirar,
}: {
  b: BloqueoDTO;
  timezone: string;
  locale: string;
  retirando: boolean;
  onRetirar: (b: BloqueoDTO) => void;
}) {
  const t = useT();
  const { primero, ultimo } = diasDelBloqueo(b, timezone);
  const cuando =
    primero === ultimo
      ? diaCorto(primero, locale)
      : t("settings.bloqueos.rangoDias", {
          desde: diaCorto(primero, locale),
          hasta: diaCorto(ultimo, locale),
        });
  // Día completo se dice con palabras; por horas, con la hora de pared DE LA
  // CLÍNICA — `inicio`/`fin` son instantes UTC y pintarlos crudos daría las
  // 22:00 de un congreso que fue a las 16:00.
  const horas = b.diaCompleto
    ? t("settings.bloqueos.diaCompletoEtiqueta")
    : `${horaDeInstante(b.inicio, timezone)} – ${horaDeInstante(b.fin, timezone)}`;

  const puesto = quienYCuando(b, timezone, locale, t);

  return (
    <li className={s.renglon}>
      <div className={s.renglonCuando}>
        <span className={s.renglonFechas}>{cuando}</span>
        <span className={s.renglonHoras}>{horas}</span>
      </div>

      <div className={s.renglonCuerpo}>
        <p className={s.renglonMotivo}>{b.reason}</p>
        <p className={s.renglonMeta}>
          <span className={s.alcance}>
            {b.doctorId === null ? (
              <Building2 size={12} strokeWidth={2.2} aria-hidden />
            ) : (
              <User size={12} strokeWidth={2.2} aria-hidden />
            )}
            {b.doctorId === null
              ? t("settings.bloqueos.todaLaClinica")
              : b.doctorNombre ?? t("settings.bloqueos.doctorSinNombre")}
          </span>
          <span className={s.punto}>·</span>
          <span>{t(`settings.bloqueos.tipo${b.kind}`)}</span>
        </p>
        {puesto && <p className={s.renglonAutor}>{puesto}</p>}
      </div>

      {b.puedoRetirarlo && (
        <button
          type="button"
          className={s.botonTexto}
          disabled={retirando}
          onClick={() => onRetirar(b)}
        >
          {retirando ? t("settings.bloqueos.retirando") : t("settings.bloqueos.retirar")}
        </button>
      )}
    </li>
  );
}

/** «Lo puso Ana Ruiz · 3 nov», o solo el nombre si la fecha no es legible. */
function quienYCuando(
  b: BloqueoDTO,
  timezone: string,
  locale: string,
  t: ReturnType<typeof useT>,
): string {
  if (!b.creadoPor) return "";
  const valida = b.creadoEl && !Number.isNaN(new Date(b.creadoEl).getTime());
  if (!valida) return t("settings.bloqueos.puestoPorSinFecha", { quien: b.creadoPor });
  return t("settings.bloqueos.puestoPor", {
    quien: b.creadoPor,
    cuando: diaCorto(diaDeInstante(b.creadoEl, timezone), locale),
  });
}
