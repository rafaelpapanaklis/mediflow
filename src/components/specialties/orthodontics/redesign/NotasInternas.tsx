"use client";
// Ortodoncia — «Notas internas» del caso (al final de la pestaña Ortodoncia de la ficha, que es también el
// detalle del caso al que lleva la lista del módulo). SOLO-EQUIPO: lo que se escribe aquí no sale en el portal
// del paciente, ni en el PDF del expediente, ni en los mensajes. Una nota no se borra: se CORRIGE, y el texto
// anterior queda en «Ver correcciones». Habla con /api/orthodontics/internal-notes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock, Pencil, Plus, StickyNote } from "lucide-react";
import { useLocale, useT } from "@/i18n/i18n-provider";
import { DictationMic, appendDictado } from "@/components/clinical/shared/dictation-mic";
import { MAX_CARACTERES_NOTA, type NotaInternaDTO } from "@/lib/orthodontics/notas-internas-service";
import { Card } from "./atoms/Card";
import { Btn } from "./atoms/Btn";
import { RAIZ_ORTO } from "./raiz";
import orto from "./orto.module.css";
import s from "./notas-internas.module.css";
import { claveDeErrorNotaInterna } from "./notas-internas-textos";

const RUTA = "/api/orthodontics/internal-notes";

type Carga = "cargando" | "listo" | "error" | "no-disponible";

export interface NotasInternasProps {
  /** El caso de ortodoncia (`orthodontic_treatment_plans.id`). Sin caso no hay nada que mostrar. */
  caseId: string | null;
  /** El módulo está en solo lectura (sin contratar): se leen las notas, no se agregan ni se corrigen. */
  soloLectura?: boolean;
}

export function NotasInternas({ caseId, soloLectura = false }: NotasInternasProps) {
  const t = useT();
  const locale = useLocale();
  const formato = useMemo(
    () => new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );
  const fecha = useCallback((iso: string) => formato.format(new Date(iso)), [formato]);

  const [carga, setCarga] = useState<Carga>("cargando");
  const [notas, setNotas] = useState<NotaInternaDTO[]>([]);
  const [puedeEscribir, setPuedeEscribir] = useState(false);
  const [maximo, setMaximo] = useState(MAX_CARACTERES_NOTA);
  const [intento, setIntento] = useState(0);

  // Agregar
  const [agregando, setAgregando] = useState(false);
  const [borrador, setBorrador] = useState("");
  // Corregir (una a la vez)
  const [corrigiendoId, setCorrigiendoId] = useState<string | null>(null);
  const [textoCorreccion, setTextoCorreccion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const guardandoRef = useRef(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  // Correcciones desplegadas por nota.
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!caseId) return;
    let vigente = true;
    setCarga("cargando");
    fetch(`${RUTA}?caseId=${encodeURIComponent(caseId)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!vigente) return;
        if (!r.ok || !j) {
          setCarga("error");
          return;
        }
        if (j.available === false) {
          setCarga("no-disponible");
          return;
        }
        setNotas(Array.isArray(j.notes) ? j.notes : []);
        setPuedeEscribir(j.canWrite === true);
        if (typeof j.maxChars === "number") setMaximo(j.maxChars);
        setCarga("listo");
      })
      .catch(() => {
        if (vigente) setCarga("error");
      });
    return () => {
      vigente = false;
    };
  }, [caseId, intento]);

  const puedeAgregar = puedeEscribir && !soloLectura;

  function cerrarFormularios() {
    setAgregando(false);
    setBorrador("");
    setCorrigiendoId(null);
    setTextoCorreccion("");
    setErrorForm(null);
  }

  async function enviar(metodo: "POST" | "PATCH", url: string, cuerpo: Record<string, unknown>) {
    if (guardandoRef.current) return null; // un segundo clic no manda otra
    guardandoRef.current = true;
    setGuardando(true);
    setErrorForm(null);
    try {
      const r = await fetch(url, {
        method: metodo,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.note) {
        setErrorForm(t(claveDeErrorNotaInterna(j?.code), { max: maximo }));
        return null;
      }
      return j.note as NotaInternaDTO;
    } catch {
      setErrorForm(t("ortoNotasInternas.errorGuardar"));
      return null;
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  }

  async function guardarNueva() {
    if (!caseId) return;
    const nota = await enviar("POST", RUTA, { caseId, text: borrador });
    if (!nota) return;
    setNotas((prev) => [nota, ...prev]);
    cerrarFormularios();
  }

  async function guardarCorreccion(id: string) {
    const nota = await enviar("PATCH", `${RUTA}/${encodeURIComponent(id)}`, { text: textoCorreccion });
    if (!nota) return;
    setNotas((prev) => prev.map((n) => (n.id === id ? nota : n)));
    cerrarFormularios();
  }

  if (!caseId) return null;

  const contador = (texto: string) => (
    <span className={`${s.contador} ${texto.length >= maximo ? s.contadorLleno : ""}`} aria-live="off">
      {t("ortoNotasInternas.contador", { n: texto.length, max: maximo })}
    </span>
  );

  return (
    <div className={`${RAIZ_ORTO} ${orto.lienzo}`}>
    <Card
      id="notas-internas"
      icon={<StickyNote size={15} strokeWidth={1.75} />}
      accent="slate"
      title={t("ortoNotasInternas.titulo")}
      action={
        puedeAgregar && carga === "listo" && !agregando ? (
          <Btn
            variant="secondary"
            size="sm"
            icon={<Plus size={14} strokeWidth={1.75} aria-hidden />}
            onClick={() => {
              cerrarFormularios();
              setAgregando(true);
            }}
          >
            {t("ortoNotasInternas.agregar")}
          </Btn>
        ) : undefined
      }
    >
      <div className={s.cuerpo}>
        <p className={s.aviso}>
          <Lock size={12} strokeWidth={1.75} aria-hidden style={{ verticalAlign: "-1px", marginRight: 6 }} />
          {t("ortoNotasInternas.aviso")}
        </p>

        {agregando ? (
          <div className={s.formulario}>
            <textarea
              className={orto.entrada}
              value={borrador}
              maxLength={maximo}
              rows={4}
              autoFocus
              disabled={guardando}
              placeholder={t("ortoNotasInternas.placeholder")}
              aria-label={t("ortoNotasInternas.agregar")}
              onChange={(e) => setBorrador(e.target.value)}
            />
            {errorForm ? <p className={s.errorForm} role="alert">{errorForm}</p> : null}
            <div className={s.formularioFila}>
              <Btn size="sm" disabled={guardando || !borrador.trim()} onClick={guardarNueva}>
                {guardando ? t("ortoNotasInternas.guardando") : t("ortoNotasInternas.guardar")}
              </Btn>
              <Btn variant="ghost" size="sm" disabled={guardando} onClick={cerrarFormularios}>
                {t("ortoNotasInternas.cancelar")}
              </Btn>
              <DictationMic disabled={guardando} onText={(txt) => setBorrador((p) => appendDictado(p, txt, "\n", maximo))} />
              {contador(borrador)}
            </div>
          </div>
        ) : null}

        {carga === "cargando" ? <p className={s.estado} role="status">{t("ortoNotasInternas.cargando")}</p> : null}
        {carga === "error" ? (
          <p className={s.estadoError} role="alert">
            {t("ortoNotasInternas.errorCarga")}
            <Btn variant="secondary" size="sm" onClick={() => setIntento((n) => n + 1)}>
              {t("ortoNotasInternas.reintentar")}
            </Btn>
          </p>
        ) : null}
        {carga === "no-disponible" ? <p className={s.estado}>{t("ortoNotasInternas.noDisponible")}</p> : null}
        {carga === "listo" && notas.length === 0 && !agregando ? (
          <p className={s.estado}>{t("ortoNotasInternas.vacio")}</p>
        ) : null}

        {carga === "listo" && notas.length > 0 ? (
          <ul className={s.lista}>
            {notas.map((n) => {
              const corrigiendo = corrigiendoId === n.id;
              const verCorrecciones = abiertas[n.id] === true;
              return (
                <li key={n.id} className={s.nota}>
                  <div className={s.notaCabeza}>
                    <span>
                      <span className={s.autor}>{n.authorNombre ?? t("ortoNotasInternas.sinAutor")}</span>
                      {" · "}
                      {fecha(n.createdAt)}
                    </span>
                  </div>

                  {corrigiendo ? (
                    <div className={s.formulario}>
                      <textarea
                        className={orto.entrada}
                        value={textoCorreccion}
                        maxLength={maximo}
                        rows={4}
                        autoFocus
                        disabled={guardando}
                        aria-label={t("ortoNotasInternas.corregir")}
                        onChange={(e) => setTextoCorreccion(e.target.value)}
                      />
                      {errorForm ? <p className={s.errorForm} role="alert">{errorForm}</p> : null}
                      <div className={s.formularioFila}>
                        <Btn
                          size="sm"
                          disabled={guardando || !textoCorreccion.trim() || textoCorreccion.trim() === n.texto}
                          onClick={() => guardarCorreccion(n.id)}
                        >
                          {guardando ? t("ortoNotasInternas.guardando") : t("ortoNotasInternas.guardarCorreccion")}
                        </Btn>
                        <Btn variant="ghost" size="sm" disabled={guardando} onClick={cerrarFormularios}>
                          {t("ortoNotasInternas.cancelar")}
                        </Btn>
                        <DictationMic
                          disabled={guardando}
                          onText={(txt) => setTextoCorreccion((p) => appendDictado(p, txt, "\n", maximo))}
                        />
                        {contador(textoCorreccion)}
                      </div>
                    </div>
                  ) : (
                    <p className={s.texto}>{n.texto}</p>
                  )}

                  {!corrigiendo ? (
                    <div className={s.pie}>
                      {n.corregida ? <span>{t("ortoNotasInternas.corregidaEl", { fecha: fecha(n.updatedAt) })}</span> : null}
                      {n.corregida ? (
                        <button
                          type="button"
                          className={s.enlaceBoton}
                          aria-expanded={verCorrecciones}
                          onClick={() => setAbiertas((p) => ({ ...p, [n.id]: !verCorrecciones }))}
                        >
                          {verCorrecciones
                            ? t("ortoNotasInternas.ocultarCorrecciones")
                            : t("ortoNotasInternas.verCorrecciones", { n: n.revisiones.length })}
                        </button>
                      ) : null}
                      {puedeAgregar && n.puedeCorregir ? (
                        <button
                          type="button"
                          className={s.enlaceBoton}
                          onClick={() => {
                            cerrarFormularios();
                            setCorrigiendoId(n.id);
                            setTextoCorreccion(n.texto);
                          }}
                        >
                          <Pencil size={11} strokeWidth={1.75} aria-hidden style={{ marginRight: 4 }} />
                          {t("ortoNotasInternas.corregir")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {verCorrecciones && n.revisiones.length > 0 ? (
                    <ul className={s.correcciones}>
                      {n.revisiones.map((r) => (
                        <li key={r.id}>
                          <p className={s.correccionMeta}>
                            {t("ortoNotasInternas.correccionDe", {
                              desde: fecha(r.textoAnteriorDesde),
                              quien: r.corregidaPorNombre ?? t("ortoNotasInternas.sinAutor"),
                              cuando: fecha(r.corregidaEl),
                            })}
                          </p>
                          <p className={s.correccionTexto}>{r.textoAnterior}</p>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </Card>
    </div>
  );
}
