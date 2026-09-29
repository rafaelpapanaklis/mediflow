"use client";
// «Editar diagnóstico» (ws1-t8): ventana centrada —el mismo marco que «Abrir caso»— que monta el PASO
// «Diagnóstico» (`PasoDiagnostico`), el MISMO formulario que usa el paso 1 de «Abrir caso» (ws1-t12). No hay
// otra versión del formulario: cuando la ventana de 2 pasos de ws1-t12 abra «Editar» en su paso Diagnóstico,
// esta cáscara se puede retirar sin perder nada.
//
// Guarda por `updateDiagnosis` (el servidor valida todo otra vez y deja el movimiento del paciente). Si algo
// falla, la ventana NO se cierra y el error queda a la vista (antes se cerraba y se perdía lo escrito).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2, Save, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { useCajon } from "../atoms/useCajon";
import type { DiagnosisDTO } from "../types";
import { updateDiagnosis } from "@/app/actions/orthodontics/updateDiagnosis";
import { isFailure } from "@/app/actions/orthodontics/result";
import {
  formularioAPeticion,
  formularioDesdeDiagnostico,
  type FormularioDelDiagnostico,
  type SeccionDelPaso,
} from "@/lib/orthodontics/diagnostico-formulario";
import { PasoDiagnostico } from "../diagnostico/PasoDiagnostico";
import { olvidarDiagnosticoCompleto, tomarSeccionPedida, useDiagnosticoCompleto } from "../diagnostico/useDiagnosticoCompleto";
import orto from "../orto.module.css";
import alta from "../alta-caso.module.css";
import dx from "../diagnostico.module.css";

export interface DrawerEditDiagnosisProps {
  diagnosis: DiagnosisDTO;
  patientFullName?: string;
  /** Sección con la que abre (el «Completar» de un apartado vacío del resumen). */
  seccionInicial?: SeccionDelPaso;
  onClose: () => void;
  /** Quedó guardado: quien monta cierra (la ficha ya se refrescó). */
  onGuardado: () => void;
}

export function DrawerEditDiagnosis(props: DrawerEditDiagnosisProps) {
  const router = useRouter();
  const { datos, error: errorDeCarga } = useDiagnosticoCompleto(props.diagnosis.id);
  const [form, setForm] = useState<FormularioDelDiagnostico | null>(null);
  const [inicial, setInicial] = useState<string>("");
  const [seccion, setSeccion] = useState<SeccionDelPaso>(
    () => props.seccionInicial ?? (tomarSeccionPedida() as SeccionDelPaso | null) ?? "clasificacion",
  );
  const [seccionConError, setSeccionConError] = useState<SeccionDelPaso | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El formulario se arma UNA vez, con lo que llegó del servidor.
  useEffect(() => {
    if (!datos || form) return;
    const f = formularioDesdeDiagnostico(datos.base, datos.detalle);
    setForm(f);
    setInicial(JSON.stringify(f));
  }, [datos, form]);

  const sinCambios = form !== null && JSON.stringify(form) === inicial;
  const cerrar = () => {
    if (form && !sinCambios && !window.confirm("Hay cambios sin guardar en el diagnóstico. ¿Cerrar sin guardar?")) return;
    props.onClose();
  };
  const cajonRef = useCajon<HTMLDivElement>(cerrar);

  const guardar = async () => {
    if (!form) return;
    setError(null);
    setSeccionConError(null);
    const r = formularioAPeticion(form, "editar");
    if (r.ok === false) {
      setError(r.error);
      setSeccionConError(r.seccion as SeccionDelPaso);
      setSeccion(r.seccion as SeccionDelPaso);
      return;
    }
    setGuardando(true);
    try {
      const res = await updateDiagnosis({ diagnosisId: props.diagnosis.id, ...r.peticion });
      if (isFailure(res)) {
        setError(res.error);
        return;
      }
      olvidarDiagnosticoCompleto(props.diagnosis.id);
      toast.success("Diagnóstico guardado");
      if (res.data.avisoDetalle) toast(res.data.avisoDetalle, { duration: 12000 });
      router.refresh();
      props.onGuardado();
    } catch {
      setError("No se pudo guardar el diagnóstico. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <div className={orto.velo} onClick={cerrar} aria-hidden />
      <div className={alta.marco}>
        <div ref={cajonRef} tabIndex={-1} className={`${alta.ventana} ${dx.dxVentanaAncha}`} role="dialog" aria-modal="true" aria-labelledby="dx-title">
          <header className={alta.cabeza}>
            <div className="min-w-0">
              <div className={orto.cajonCeja}>Diagnóstico</div>
              <h3 id="dx-title" className={orto.cajonTitulo}>
                Editar diagnóstico{props.patientFullName ? ` · ${props.patientFullName}` : ""}
              </h3>
              <p className={orto.cajonSub}>Cómo está el paciente. Lo que se le va a hacer va en el Plan de tratamiento.</p>
            </div>
            <button type="button" onClick={cerrar} aria-label="Cerrar" className={orto.botonIcono}>
              <X className="w-5 h-5" aria-hidden />
            </button>
          </header>

          <div className={alta.cuerpo}>
            {!form ? (
              errorDeCarga ? (
                <div className={alta.error} role="alert">{errorDeCarga}</div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-[color:var(--pr-texto-3)]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Cargando el diagnóstico…
                </div>
              )
            ) : (
              <PasoDiagnostico
                valor={form}
                onCambio={(f) => {
                  setForm(f);
                  if (error) setError(null);
                }}
                seccion={seccion}
                onSeccion={setSeccion}
                seccionConError={seccionConError}
                columna={datos?.columna}
                archivos={datos?.archivos}
                trazado={datos?.registros.trazado ?? null}
                anbDelTrazado={datos?.registros.anbDelTrazado ?? null}
                fotosIniciales={datos?.registros.fotosIniciales}
                modo="editar"
              />
            )}
            {error ? (
              <div className={alta.error} role="alert">
                {error}
              </div>
            ) : null}
          </div>

          <footer className={alta.pie}>
            <span className={alta.pieNota}>Cada cambio queda registrado en Movimientos del paciente.</span>
            <div className={alta.pieBotones}>
              <Btn variant="ghost" size="md" onClick={cerrar}>
                Cancelar
              </Btn>
              <Btn
                variant="primary"
                size="md"
                icon={guardando ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Save className="w-3.5 h-3.5" aria-hidden />}
                onClick={guardar}
                disabled={!form || guardando || sinCambios}
              >
                {guardando ? "Guardando…" : "Guardar diagnóstico"}
              </Btn>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
