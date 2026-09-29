"use client";
// Ortodoncia → Configuración → «Condiciones del convenio» (ws1-t4, 29-sep-2026).
//
// Decisión de Rafael: DaleControl trae unas condiciones de EJEMPLO, neutrales
// y cortas, y cada clínica las ajusta aquí. Lo que se guarde es lo que imprime
// el convenio de pago en PDF («Imprimir convenio» en el cobro del caso). La
// tarjeta se carga sola (no depende de lo que traiga la página) y guarda por
// su cuenta: no toca el guardado del resto de la Configuración.

import { useEffect, useId, useState } from "react";
import toast from "react-hot-toast";
import { FileSignature, Info } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Tarjeta } from "@/components/specialties/orthodontics/modulo/piezas";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";
import { isFailure } from "@/app/actions/orthodontics/result";
import {
  cargarCondicionesDelConvenio,
  guardarCondicionesDelConvenio,
  type CondicionesDelConvenioPayload,
} from "@/app/actions/orthodontics/cobro/condicionesDelConvenio";
import {
  CONDICIONES_CONVENIO_EJEMPLO,
  MAX_CONDICIONES_CONVENIO,
} from "@/lib/orthodontics/cobro/condiciones-convenio";

const AVISO = {
  display: "flex",
  gap: 8,
  alignItems: "flex-start",
  padding: "10px 12px",
  borderRadius: "var(--pr-radio-s)",
  background: "var(--pr-tarjeta-2)",
  fontSize: 12,
  lineHeight: 1.45,
  color: "var(--pr-texto-2)",
} as const;

export function CondicionesDelConvenio() {
  const id = useId();
  const [estado, setEstado] = useState<CondicionesDelConvenioPayload | null | "error">(null);
  const [texto, setTexto] = useState("");
  const [guardado, setGuardado] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    cargarCondicionesDelConvenio()
      .then((r) => {
        if (!vivo) return;
        if (isFailure(r)) return setEstado("error");
        setEstado(r.data);
        setTexto(r.data.texto);
        setGuardado(r.data.esEjemplo ? "" : r.data.texto);
      })
      .catch(() => vivo && setEstado("error"));
    return () => {
      vivo = false;
    };
  }, []);

  async function guardar() {
    setGuardando(true);
    const r = await guardarCondicionesDelConvenio({ texto });
    setGuardando(false);
    if (isFailure(r)) {
      toast.error(r.error);
      return;
    }
    setTexto(r.data.texto);
    setGuardado(r.data.texto);
    setEstado((e) => (e && e !== "error" ? { ...e, esEjemplo: false } : e));
    toast.success("Condiciones guardadas. El convenio ya las imprime.");
  }

  const sub = "Lo que imprime el convenio de pago de cada paciente, una condición por renglón.";

  if (estado === null || estado === "error") {
    return (
      <Tarjeta icono={FileSignature} titulo="Condiciones del convenio" sub={sub}>
        <div className={s.tarjetaCuerpo} role={estado === "error" ? "alert" : "status"} style={{ fontSize: 13, color: "var(--pr-texto-3)" }}>
          {estado === "error" ? "No se pudieron cargar las condiciones del convenio." : "Cargando…"}
        </div>
      </Tarjeta>
    );
  }

  const esElEjemplo = texto.trim() === CONDICIONES_CONVENIO_EJEMPLO.trim();
  const hayCambios = estado.esEjemplo ? true : texto !== guardado;
  const soloLectura = !estado.puedeEditar || !estado.columnaLista;

  return (
    <Tarjeta icono={FileSignature} titulo="Condiciones del convenio" sub={sub}>
      <div className={s.tarjetaCuerpo} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {esElEjemplo ? (
          <div style={AVISO} role="note" data-aviso-ejemplo>
            <Info size={15} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
            <span>
              <strong>Son un ejemplo: revísalas y ajústalas a tu clínica.</strong> DaleControl las trae para que no
              empieces en blanco; no llevan montos ni intereses. Si usas recargo por atraso, configúralo en «Política de
              cobro» y el convenio lo imprime con tus números.
            </span>
          </div>
        ) : null}
        {!estado.columnaLista ? (
          <div className={s.error} role="alert">
            Falta pegar sql/ortodoncia-condiciones-convenio.sql en Supabase: mientras tanto el convenio imprime este
            ejemplo y no se pueden guardar cambios.
          </div>
        ) : null}
        <div className={s.campo}>
          <label className={s.campoEtiqueta} htmlFor={`${id}-texto`}>
            Condiciones
          </label>
          <textarea
            id={`${id}-texto`}
            className="input-new"
            rows={9}
            maxLength={MAX_CONDICIONES_CONVENIO}
            value={texto}
            readOnly={soloLectura}
            aria-describedby={`${id}-ayuda`}
            onChange={(e) => setTexto(e.target.value)}
          />
          <div className={s.campoAyuda} id={`${id}-ayuda`}>
            Cada renglón sale como una condición numerada. Si lo dejas vacío, el convenio dice que las condiciones son las
            acordadas con la clínica.
          </div>
        </div>
        {soloLectura ? null : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <ButtonNew
              type="button"
              variant="secondary"
              disabled={guardando || esElEjemplo}
              onClick={() => setTexto(CONDICIONES_CONVENIO_EJEMPLO)}
            >
              Restaurar ejemplo
            </ButtonNew>
            <ButtonNew type="button" variant="primary" disabled={guardando || !hayCambios} onClick={guardar}>
              {guardando ? "Guardando…" : "Guardar condiciones"}
            </ButtonNew>
          </div>
        )}
      </div>
    </Tarjeta>
  );
}
