"use client";

/**
 * «¿Recepción puede agendar sobre un día bloqueado?» — el ajuste de la
 * clínica, en Configuración → Horarios y bloqueos, junto a los bloqueos.
 *
 *     ( ) Sí, avisando y dejando registro      ← de fábrica, como hoy
 *     ( ) No, queda prohibido
 *
 * Con «No», la ventana de confirmar (`confirmar-bloqueo.tsx`) y las dos de
 * arrastrar dejan de ofrecer «Agendar de todas formas» y dicen por qué.
 *
 * Solo la ve quien administra: el doctor entra a esta pestaña recortado y
 * esto no es suyo. El contrato y el endpoint están en `politica.ts`. Si no
 * se puede leer, la tarjeta lo dice y no deja tocar nada: no finge guardar.
 */

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { mensajeDeError } from "./tipos";
import { parsePolitica, RUTA_POLITICA } from "./politica";
import s from "./bloqueos.module.css";
import p from "./politica.module.css";

export function PoliticaCard() {
  const t = useT();
  const [estado, setEstado] = useState<"cargando" | "error" | "listo">("cargando");
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  /** `recepcionPuedeAgendar`. De fábrica, «Sí». */
  const [valor, setValor] = useState(true);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setEstado("cargando");
    setError(null);
    (async () => {
      try {
        const res = await fetch(RUTA_POLITICA, { credentials: "include" });
        const datos = await res.json().catch(() => null);
        if (!vivo) return;
        const politica = res.ok ? parsePolitica(datos) : null;
        if (!politica) {
          setError(mensajeDeError(datos, t("settings.bloqueos.politica.cargaError")));
          setEstado("error");
          return;
        }
        setValor(politica.recepcionPuedeAgendar);
        setEstado("listo");
      } catch {
        if (!vivo) return;
        setError(t("settings.bloqueos.politica.cargaError"));
        setEstado("error");
      }
    })();
    return () => {
      vivo = false;
    };
    // `t` cambia de identidad en cada render del proveedor de idioma.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  async function cambiar(nuevo: boolean) {
    if (guardando || estado !== "listo" || nuevo === valor) return;
    const antes = valor;
    setValor(nuevo);
    setGuardando(true);
    try {
      const res = await fetch(RUTA_POLITICA, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ recepcionPuedeAgendar: nuevo }),
      });
      const datos = await res.json().catch(() => null);
      if (!res.ok) {
        setValor(antes);
        toast.error(mensajeDeError(datos, t("settings.bloqueos.politica.guardarError")));
        return;
      }
      // Lo que el servidor dice que quedó, si lo dice.
      const vuelta = parsePolitica(datos);
      if (vuelta) setValor(vuelta.recepcionPuedeAgendar);
      toast.success(t("settings.bloqueos.politica.guardadoToast"));
    } catch {
      setValor(antes);
      toast.error(t("settings.bloqueos.politica.guardarError"));
    } finally {
      setGuardando(false);
    }
  }

  const bloqueado = estado !== "listo" || guardando;

  return (
    <div className={s.tarjeta}>
      <div className={s.tarjetaCabecera}>
        <span className={`${s.iconoCaja} ${s.iconoCajaMarca}`} aria-hidden>
          <ShieldCheck size={17} strokeWidth={2} />
        </span>
        <div className={s.tarjetaTextos}>
          <h3 className={s.tarjetaTitulo} id="politica-bloqueos-titulo">
            {t("settings.bloqueos.politica.titulo")}
          </h3>
          <p className={s.tarjetaSub}>{t("settings.bloqueos.politica.sub")}</p>
        </div>
        {guardando && <Loader2 size={16} className={p.girando} aria-label={t("common.saving")} />}
      </div>

      <div className={s.tarjetaCuerpo}>
        <fieldset
          className={p.opciones}
          aria-labelledby="politica-bloqueos-titulo"
          aria-busy={estado === "cargando" || guardando}
          disabled={bloqueado}
        >
          <label className={`${p.opcion} ${estado === "listo" && valor ? p.opcionElegida : ""}`}>
            <input
              type="radio"
              name="politica-bloqueos"
              className={p.radio}
              checked={estado === "listo" && valor}
              onChange={() => cambiar(true)}
            />
            <span className={p.textos}>
              <span className={p.titulo}>
                {t("settings.bloqueos.politica.si")}
                <span className={p.etiqueta}>{t("settings.bloqueos.politica.deFabrica")}</span>
              </span>
              <span className={p.ayuda}>{t("settings.bloqueos.politica.siAyuda")}</span>
            </span>
          </label>

          <label className={`${p.opcion} ${estado === "listo" && !valor ? p.opcionElegida : ""}`}>
            <input
              type="radio"
              name="politica-bloqueos"
              className={p.radio}
              checked={estado === "listo" && !valor}
              onChange={() => cambiar(false)}
            />
            <span className={p.textos}>
              <span className={p.titulo}>{t("settings.bloqueos.politica.no")}</span>
              <span className={p.ayuda}>{t("settings.bloqueos.politica.noAyuda")}</span>
            </span>
          </label>
        </fieldset>

        {estado === "cargando" && (
          <p className={p.estado} role="status">
            {t("settings.bloqueos.politica.cargando")}
          </p>
        )}
        {estado === "error" && (
          <div className={`${p.estado} ${p.estadoError}`} role="alert">
            <span className={p.estadoTexto}>{error}</span>
            <button type="button" className={p.reintentar} onClick={() => setVersion((v) => v + 1)}>
              {t("common.retry")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
