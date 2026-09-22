"use client";

/**
 * DÍAS FESTIVOS DE MÉXICO — el catálogo del año, con su casilla cada uno.
 *
 * 🔴 NADA SE APLICA SOLO. Se proponen; el cliente elige y da a «Aplicar». Ni
 * hacia atrás ni hacia adelante: esta tarjeta no crea un bloqueo sin un clic.
 *
 * 🔴 Y `porDefecto` SE RESPETA TAL CUAL, como llega del servidor. Los oficiales
 * vienen marcados; los de costumbre (Jueves y Viernes Santo, 2 de noviembre,
 * 12 de diciembre, 24 y 31 de diciembre) vienen DESMARCADOS. Lo decidió Rafael
 * y tiene un motivo: muchas clínicas dentales abren esos días. La pantalla no
 * marca ninguno «por ayudar».
 */

import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { diaLargo } from "./fechas";
import { parseFestivos, parseRespuestaFestivos, type BloqueoDTO, type FestivoDTO } from "./tipos";
import s from "./bloqueos.module.css";

/** El mes (1-12) a partir del cual se ofrece el año siguiente. */
const MES_DEL_AVISO = 11;

export function FestivosCard({
  anioActual,
  mesActual,
  locale,
  bloqueoPorFestivo,
  onCambio,
}: {
  /** El año EN LA ZONA DE LA CLÍNICA, no el del navegador. */
  anioActual: number;
  /** El mes (1-12) en la zona de la clínica: de él sale el aviso de fin de año. */
  mesActual: number;
  locale: string;
  /** Los bloqueos ya aplicados, por `holidayKey`: de ahí sale el id para retirar. */
  bloqueoPorFestivo: Map<string, BloqueoDTO>;
  onCambio: () => void;
}) {
  const t = useT();
  const [anio, setAnio] = useState(anioActual);
  const [festivos, setFestivos] = useState<FestivoDTO[] | null>(null);
  const [error, setError] = useState(false);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [aplicando, setAplicando] = useState(false);
  const [retirando, setRetirando] = useState<string | null>(null);
  // Contador de relectura: subirlo vuelve a pedir el catálogo del MISMO año
  // (tras aplicar o retirar), sin tener que tocar `anio`.
  const [recarga, setRecarga] = useState(0);
  const recargar = () => setRecarga((n) => n + 1);

  // El catálogo del año. Cada cambio de año lo vuelve a pedir; el servidor ya
  // lo calcula (Semana Santa se mueve) y aquí no se calcula ninguna fecha.
  useEffect(() => {
    let vivo = true;
    setFestivos(null);
    setError(false);
    (async () => {
      try {
        const res = await fetch(`/api/settings/bloqueos/festivos?anio=${anio}`);
        if (!res.ok) throw new Error();
        const datos = await res.json();
        if (!vivo) return;
        const lista = parseFestivos(datos);
        setFestivos(lista);
        // El estado inicial de las casillas es EXACTAMENTE `porDefecto`, y los
        // ya aplicados no entran en la selección (no se vuelven a mandar).
        setMarcados(new Set(lista.filter((f) => f.porDefecto && !f.aplicado).map((f) => f.key)));
      } catch {
        if (vivo) {
          setFestivos([]);
          setError(true);
        }
      }
    })();
    return () => {
      vivo = false;
    };
  }, [anio, recarga]);

  const { oficiales, costumbre } = useMemo(() => {
    const lista = festivos ?? [];
    return {
      oficiales: lista.filter((f) => f.oficial),
      costumbre: lista.filter((f) => !f.oficial),
    };
  }, [festivos]);

  const seleccion = useMemo(
    () => (festivos ?? []).filter((f) => !f.aplicado && marcados.has(f.key)),
    [festivos, marcados],
  );

  function alternar(key: string) {
    setMarcados((prev) => {
      const sig = new Set(prev);
      if (sig.has(key)) sig.delete(key);
      else sig.add(key);
      return sig;
    });
  }

  async function aplicar() {
    if (seleccion.length === 0) {
      toast.error(t("settings.bloqueos.seleccionVacia"));
      return;
    }
    setAplicando(true);
    try {
      const res = await fetch("/api/settings/bloqueos/festivos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anio, keys: seleccion.map((f) => f.key) }),
      });
      const datos = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(
          (datos && typeof datos.error === "string" && datos.error) ||
            t("settings.bloqueos.festivosAplicarError"),
        );
        return;
      }
      const { creados, chocaron } = parseRespuestaFestivos(datos);

      // 🔴 Se enseñan LAS DOS COSAS. Aplicar diciembre entero no puede parecer
      // un fracaso porque el 24 tenga dos citas: seis se aplicaron de verdad.
      if (creados.length > 0) {
        toast.success(t("settings.bloqueos.aplicadosResumen", { count: creados.length }));
      }
      for (const choque of chocaron) {
        const f = (festivos ?? []).find((x) => x.key === choque.key);
        toast.error(
          t("settings.bloqueos.choqueFestivo", {
            dia: f ? diaLargo(f.fecha, locale) : choque.key,
            count: choque.total,
          }),
          { duration: 8000 },
        );
      }
      if (creados.length === 0 && chocaron.length === 0) {
        toast.error(t("settings.bloqueos.festivosAplicarError"));
      }
      onCambio();
      // Y se relee el catálogo: los aplicados tienen que salir ya marcados y
      // bloqueados, sin recargar la pantalla.
      recargar();
    } catch {
      toast.error(t("settings.bloqueos.festivosAplicarError"));
    } finally {
      setAplicando(false);
    }
  }

  async function retirar(f: FestivoDTO) {
    const bloqueo = bloqueoPorFestivo.get(f.key);
    if (!bloqueo) return;
    setRetirando(f.key);
    try {
      const res = await fetch(`/api/settings/bloqueos/${encodeURIComponent(bloqueo.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success(t("settings.bloqueos.retiradoToast"));
      onCambio();
      recargar();
    } catch {
      toast.error(t("settings.bloqueos.retirarError"));
    } finally {
      setRetirando(null);
    }
  }

  // El aviso de fin de año: discreto, y solo cuando de verdad se acaba el año
  // que se está mirando. No carga nada — solo ofrece el salto.
  const ofreceSiguiente =
    anio === anioActual && mesActual >= MES_DEL_AVISO;

  const anios = [anioActual - 1, anioActual, anioActual + 1];

  return (
    <div className={s.tarjeta}>
      <div className={s.tarjetaCabecera}>
        <h3 className={s.tarjetaTitulo}>{t("settings.bloqueos.festivosTitulo")}</h3>
        <label className={s.anioCampo}>
          <span className={s.sr}>{t("settings.bloqueos.anio")}</span>
          <select
            className={s.controlCorto}
            value={anio}
            onChange={(e) => setAnio(Number(e.target.value))}
          >
            {anios.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
      </div>

      {ofreceSiguiente && (
        <button type="button" className={s.pista} onClick={() => setAnio(anioActual + 1)}>
          {t("settings.bloqueos.avisoAnioNuevo", { anio: anioActual + 1 })}
        </button>
      )}

      {festivos === null && <p className={s.cargando}>{t("common.loading")}</p>}
      {error && <p className={s.error}>{t("settings.bloqueos.festivosError")}</p>}

      {festivos !== null && !error && festivos.length === 0 && (
        <p className={s.vacio}>{t("settings.bloqueos.festivosVacio")}</p>
      )}

      {[
        { lista: oficiales, titulo: "grupoOficiales", ayuda: "grupoOficialesAyuda" },
        { lista: costumbre, titulo: "grupoCostumbre", ayuda: "grupoCostumbreAyuda" },
      ].map(
        (grupo) =>
          grupo.lista.length > 0 && (
            <section key={grupo.titulo} className={s.grupo}>
              <h4 className={s.grupoTitulo}>{t(`settings.bloqueos.${grupo.titulo}`)}</h4>
              <p className={s.grupoAyuda}>{t(`settings.bloqueos.${grupo.ayuda}`)}</p>
              <ul className={s.festivos}>
                {grupo.lista.map((f) => {
                  const bloqueo = bloqueoPorFestivo.get(f.key);
                  // El botón de retirar solo si el SERVIDOR dice que se puede.
                  const puedeRetirar = f.aplicado && !!bloqueo?.puedoRetirarlo;
                  return (
                    <li key={f.key} className={s.festivo}>
                      <label className={s.festivoEtiqueta}>
                        <input
                          type="checkbox"
                          className={s.casilla}
                          // Aplicado = marcado y bloqueado: ya no es una
                          // propuesta, es un hecho. Se deshace con «Retirar».
                          checked={f.aplicado || marcados.has(f.key)}
                          disabled={f.aplicado}
                          onChange={() => alternar(f.key)}
                        />
                        <span className={s.festivoNombre} title={f.nombre}>{f.nombre}</span>
                        <span className={s.festivoFecha}>{diaLargo(f.fecha, locale)}</span>
                      </label>
                      {f.aplicado && (
                        <span className={s.insignia}>
                          <Check size={12} strokeWidth={2.6} aria-hidden />
                          {t("settings.bloqueos.aplicado")}
                        </span>
                      )}
                      {puedeRetirar && (
                        <button
                          type="button"
                          className={s.botonTexto}
                          disabled={retirando === f.key}
                          onClick={() => retirar(f)}
                        >
                          {t("settings.bloqueos.retirar")}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ),
      )}

      {festivos !== null && festivos.length > 0 && (
        <div className={s.acciones}>
          <button
            type="button"
            className={s.botonPrincipal}
            disabled={aplicando || seleccion.length === 0}
            onClick={aplicar}
          >
            {aplicando
              ? t("settings.bloqueos.aplicando")
              : t("settings.bloqueos.aplicarN", { count: seleccion.length })}
          </button>
        </div>
      )}
    </div>
  );
}
