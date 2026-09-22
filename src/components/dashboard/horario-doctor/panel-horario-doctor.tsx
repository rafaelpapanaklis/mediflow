"use client";

/**
 * EL HORARIO DE UN DOCTOR — el mismo panel en los dos sitios donde se pone:
 *
 *   · Equipo → «Horario» en la tarjeta de cada doctor (ADMIN y SUPER_ADMIN),
 *     dentro de `ModalHorarioDoctor`;
 *   · Configuración → Horarios y bloqueos → «Mi horario» (el propio DOCTOR).
 *
 * Arriba del todo, el ESTADO, que es lo que más confunde si no se dice:
 *
 *     ● Sigue el horario de la clínica   (Lun-Vie 9:00-19:00 · Sáb 9:00-14:00)
 *       [ Darle un horario propio ]
 *
 *     ● Horario propio
 *       [ Volver al horario de la clínica ]   ← DELETE: vuelve a heredar
 *
 * 🔴 UN DOCTOR SIN HORARIO PROPIO SIGUE EL DE LA CLÍNICA. Es lo que garantiza
 * que el día del despliegue no cambie ni una agenda: nadie tiene horario
 * propio hasta que alguien se lo pone y lo GUARDA. Por eso «Darle un horario
 * propio» solo abre un borrador (copiado del de la clínica) y el estado de
 * arriba no cambia hasta que el PUT contesta bien.
 *
 * 🔴 Esconder no es permitir: el servidor rechaza al doctor que toque el
 * horario de otro. Aquí solo se evita enseñar puertas que dan 403.
 *
 * La API y su forma están en `tipos.ts`. Los errores se pintan con su FRASE
 * (`mensajeDeError`), nunca con su código.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { Info, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { mensajeDeError } from "@/components/dashboard/bloqueos/tipos";
import { EditorSemana } from "./editor-semana";
import {
  algunDiaAbierto,
  cuerpoPut,
  hayRangoInvalido,
  mismoHorario,
  parseHorarioDoctor,
  resumenSemana,
  semanaCompleta,
  type Dia,
} from "./tipos";
import s from "./horario-doctor.module.css";

/** El punto de partida del borrador si la clínica no tiene horario: L-V 9-18. */
function semanaInicial(clinica: Dia[] | null): Dia[] {
  if (clinica) return semanaCompleta(clinica);
  return semanaCompleta(
    [0, 1, 2, 3, 4].map((dayOfWeek) => ({ dayOfWeek, enabled: true, openTime: "09:00", closeTime: "18:00" })),
  );
}

export function PanelHorarioDoctor({
  doctorId,
  nombre,
  clinica,
  modo,
  enModal = false,
  onCerrar,
  onOcupado,
}: {
  doctorId: string;
  /** Nombre del doctor, para la confirmación de «Volver al de la clínica». */
  nombre: string;
  /** El horario de la clínica (0=Lunes…6=Domingo), o `null` si no tiene. */
  clinica: Dia[] | null;
  /** «equipo» = lo pone la administración · «propio» = el doctor, el suyo. */
  modo: "equipo" | "propio";
  /** Dentro de la ventana de Equipo: el pie usa el de la ventana y lleva «Cerrar». */
  enModal?: boolean;
  onCerrar?: () => void;
  /** Avisa mientras hay un PUT o un DELETE en marcha: la ventana no se cierra. */
  onOcupado?: (ocupado: boolean) => void;
}) {
  const t = useT();
  const askConfirm = useConfirm();
  const propio = modo === "propio";
  // Las frases que cambian de persona: «Sigue…» (equipo) / «Sigues…» (el doctor).
  const k = (base: string) => `settings.horarioDoctor.${base}${propio ? "Yo" : ""}`;

  const [carga, setCarga] = useState<"cargando" | "error" | "listo">("cargando");
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [hereda, setHereda] = useState(true);
  /** El horario propio tal y como está GUARDADO. `null` = hereda. */
  const [guardado, setGuardado] = useState<Dia[] | null>(null);
  /** Lo que se está editando. `null` = no se edita nada (heredando, sin borrador). */
  const [borrador, setBorrador] = useState<Dia[] | null>(null);
  const [ocupado, setOcupado] = useState<null | "guardando" | "volviendo">(null);

  const url = `/api/team/${encodeURIComponent(doctorId)}/horario`;

  useEffect(() => {
    onOcupado?.(ocupado !== null);
    // Solo cuando cambia `ocupado`: quien escucha no tiene por qué ser estable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocupado]);

  useEffect(() => {
    let vivo = true;
    setCarga("cargando");
    setErrorCarga(null);
    (async () => {
      try {
        const res = await fetch(url, { credentials: "include" });
        const datos = await res.json().catch(() => null);
        if (!vivo) return;
        if (!res.ok) {
          setErrorCarga(mensajeDeError(datos, t("settings.horarioDoctor.cargaError")));
          setCarga("error");
          return;
        }
        const dto = parseHorarioDoctor(datos);
        if (!dto) {
          setErrorCarga(t("settings.horarioDoctor.cargaError"));
          setCarga("error");
          return;
        }
        setHereda(dto.hereda);
        setGuardado(dto.hereda ? null : dto.horario);
        setBorrador(dto.hereda ? null : dto.horario);
        setCarga("listo");
      } catch {
        if (!vivo) return;
        setErrorCarga(t("settings.horarioDoctor.cargaError"));
        setCarga("error");
      }
    })();
    return () => {
      vivo = false;
    };
    // `t` cambia de identidad en cada render del proveedor de idioma; meterlo
    // aquí volvería a pedir el horario en cada uno.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, version]);

  const resumenClinica = useMemo(() => (clinica ? resumenSemana(clinica, t) : null), [clinica, t]);

  const invalido = borrador ? hayRangoInvalido(borrador) : false;
  const sucio = borrador !== null && (hereda || guardado === null || !mismoHorario(borrador, guardado));
  const idBase = `horario-${modo}-${doctorId}`;
  // En la ventana de Equipo el cuerpo lleva el relleno de la ventana y el pie
  // va FUERA de él, en el `modal__footer` de siempre.
  const cuerpoClase = enModal ? `modal__body ${s.cuerpo} ${s.cuerpoModal}` : s.cuerpo;
  const pieClase = enModal ? `modal__footer ${s.pieModal}` : s.pie;

  function cambiar(dayOfWeek: number, cambio: Partial<Omit<Dia, "dayOfWeek">>) {
    setBorrador((prev) => (prev ? prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...cambio } : d)) : prev));
  }

  async function guardar() {
    if (!borrador || invalido || ocupado) return;
    setOcupado("guardando");
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(cuerpoPut(borrador)),
      });
      const datos = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(mensajeDeError(datos, t("settings.horarioDoctor.guardarError")));
        return;
      }
      // Lo que guardó el servidor, si lo devuelve; si no, lo que se mandó.
      // Sin `horario` (o con una lista vacía) NO se toma por «todo cerrado»:
      // un `{ ok: true }` o un `{ hereda: false }` a secas también es un sí.
      const devuelto = (datos as { horario?: unknown } | null)?.horario;
      const vuelta =
        Array.isArray(devuelto) && devuelto.length > 0 ? semanaCompleta(devuelto) : semanaCompleta(borrador);
      setHereda(false);
      setGuardado(vuelta);
      setBorrador(vuelta);
      toast.success(t("settings.horarioDoctor.guardadoToast"));
    } catch {
      toast.error(t("settings.horarioDoctor.guardarError"));
    } finally {
      setOcupado(null);
    }
  }

  async function volverAClinica() {
    if (ocupado) return;
    const ok = await askConfirm({
      title: t("settings.horarioDoctor.volverConfirmTitulo"),
      description: propio
        ? t("settings.horarioDoctor.volverConfirmDescYo")
        : t("settings.horarioDoctor.volverConfirmDesc", { name: nombre }),
      confirmText: t("settings.horarioDoctor.volverConfirmBtn"),
      variant: "warning",
    });
    if (!ok) return;
    setOcupado("volviendo");
    try {
      const res = await fetch(url, { method: "DELETE", credentials: "include" });
      const datos = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(mensajeDeError(datos, t("settings.horarioDoctor.volverError")));
        return;
      }
      setHereda(true);
      setGuardado(null);
      setBorrador(null);
      toast.success(t("settings.horarioDoctor.volvioToast"));
    } catch {
      toast.error(t("settings.horarioDoctor.volverError"));
    } finally {
      setOcupado(null);
    }
  }

  const botonCerrar = enModal && onCerrar ? (
    <button key="c" type="button" className={s.boton} onClick={onCerrar} disabled={ocupado !== null}>
      {t("common.close")}
    </button>
  ) : null;

  // ── Cargando / error ───────────────────────────────────────────────────
  if (carga !== "listo") {
    return (
      <>
        <div className={cuerpoClase}>
          {carga === "cargando" ? (
            <div className={s.vacio} role="status">
              <Loader2 size={16} className={s.girando} aria-hidden />
              {t("settings.horarioDoctor.cargando")}
            </div>
          ) : (
            <div className={`${s.vacio} ${s.vacioError}`} role="alert">
              <span style={{ flex: "1 1 200px", minWidth: 0 }}>{errorCarga}</span>
              <button type="button" className={s.boton} onClick={() => setVersion((v) => v + 1)}>
                {t("common.retry")}
              </button>
            </div>
          )}
        </div>
        {botonCerrar && <div className={pieClase}>{botonCerrar}</div>}
      </>
    );
  }

  // ── El estado + el editor ──────────────────────────────────────────────
  const editando = borrador !== null;
  const sinDias = borrador !== null && !algunDiaAbierto(borrador);

  const acciones: React.ReactNode[] = [];
  if (botonCerrar && !(hereda && editando)) acciones.push(botonCerrar);
  if (hereda && editando) {
    acciones.push(
      <button key="x" type="button" className={s.boton} onClick={() => setBorrador(null)} disabled={ocupado !== null}>
        {t("common.cancel")}
      </button>,
    );
  }
  if (editando) {
    acciones.push(
      <button
        key="g"
        type="button"
        className={s.botonPrincipal}
        onClick={guardar}
        disabled={!sucio || invalido || ocupado !== null}
      >
        {ocupado === "guardando" && <Loader2 size={15} className={s.girando} aria-hidden />}
        {ocupado === "guardando"
          ? t("common.saving")
          : hereda
            ? t("settings.horarioDoctor.guardarPropio")
            : t("common.saveChanges")}
      </button>,
    );
  }

  return (
    <>
      <div className={cuerpoClase}>
        <div className={`${s.estado} ${hereda ? "" : s.estadoPropio}`}>
          <span className={s.punto} aria-hidden />
          <div className={s.estadoTextos}>
            <p className={s.estadoTitulo}>
              {hereda ? t(k("heredaTitulo")) : t("settings.horarioDoctor.propioTitulo")}
            </p>
            {hereda && (
              <p className={s.estadoResumen}>
                {clinica === null
                  ? t("settings.horarioDoctor.clinicaSinHorario")
                  : resumenClinica
                    ? // Cada tramo entero en su renglón: «Sáb 9:00-⏎14:00» no se
                      // lee. El «·» viaja con el tramo que introduce.
                      resumenClinica.split(" · ").map((tramo, i) => (
                        <Fragment key={i}>
                          {i > 0 ? " " : null}
                          <span className={s.tramo}>{i > 0 ? `· ${tramo}` : tramo}</span>
                        </Fragment>
                      ))
                    : t("settings.horarioDoctor.clinicaSinDias")}
              </p>
            )}
            <p className={s.estadoNota}>
              {hereda ? t("settings.horarioDoctor.heredaNota") : t(k("propioNota"))}
            </p>
          </div>
          {/* La acción, DEBAJO del estado y alineada con su texto: es la
              respuesta a lo que acaba de leer, no un botón más de la fila. */}
          {hereda && !editando && (
            <div className={s.estadoAccion}>
              <button type="button" className={s.boton} onClick={() => setBorrador(semanaInicial(clinica))}>
                {t(k("darPropio"))}
              </button>
            </div>
          )}
          {!hereda && (
            <div className={s.estadoAccion}>
              <button
                type="button"
                className={s.botonTexto}
                onClick={volverAClinica}
                disabled={ocupado !== null}
              >
                {ocupado === "volviendo" ? t("settings.horarioDoctor.volviendo") : t("settings.horarioDoctor.volverClinica")}
              </button>
            </div>
          )}
        </div>

        {editando && (
          <>
            {hereda && (
              <p className={s.nota}>
                <Info size={14} strokeWidth={2.2} className={s.notaIcono} aria-hidden />
                <span>{t(k("borradorNota"))}</span>
              </p>
            )}
            <EditorSemana
              dias={borrador}
              clinica={clinica}
              onCambio={cambiar}
              deshabilitado={ocupado !== null}
              idBase={idBase}
            />
            {sinDias && (
              <p className={`${s.nota} ${s.notaAviso}`}>
                <Info size={14} strokeWidth={2.2} className={s.notaIcono} aria-hidden />
                <span>{t(k("sinDiasAbiertos"))}</span>
              </p>
            )}
          </>
        )}

        {!enModal && acciones.length > 0 && <div className={s.pie}>{acciones}</div>}
      </div>
      {enModal && acciones.length > 0 && <div className={pieClase}>{acciones}</div>}
    </>
  );
}
