"use client";
// Módulo de Ortodoncia — lo que se hace con un caso desde la sección «Casos»
// (ws1-t8): editar sus datos y eliminarlo si se abrió por error.
//
// Los dos se pintan en un portal, fuera de la raíz del módulo: esa raíz es un
// contenedor (`container-type`) y dentro de uno lo «fijo» se ancla al
// contenedor y no a la pantalla (mismo motivo que `abrir-caso.tsx`).
//
// Nada de esto decide reglas: «Editar datos» es el mismo cajón «Datos del
// caso» de la ficha (doctor, responsable, fecha de colocación, estado) y
// guarda por la misma acción. «Eliminar» pide el motivo y lo demás lo decide
// el servidor (`eliminarCaso`), que vuelve a leer qué tiene el caso.
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2, Trash2, X } from "lucide-react";
import { CLASES_REDISENO } from "@/components/dashboard/pacientes-rediseno/raiz";
import { RAIZ_ORTO } from "@/components/specialties/orthodontics/redesign/raiz";
import { useCajon } from "@/components/specialties/orthodontics/redesign/atoms/useCajon";
import {
  DrawerCaseSettings,
  type DrawerCaseSettingsPayload,
} from "@/components/specialties/orthodontics/redesign/drawers/DrawerCaseSettings";
import { updateTreatmentPlan } from "@/app/actions/orthodontics/updateTreatmentPlan";
import { moverControlesFuturosAlDoctor } from "@/app/actions/orthodontics/moverControlesFuturosAlDoctor";
import { eliminarCaso } from "@/app/actions/orthodontics/modulo/eliminarCaso";
import { isFailure } from "@/app/actions/orthodontics/result";
import { MAX_LETRAS_MOTIVO, MIN_LETRAS_MOTIVO, motivoValido } from "@/lib/orthodontics/eliminar-caso";
import s from "./modulo.module.css";
import { DictationMic, appendDictado } from "@/components/clinical/shared/dictation-mic";

/** Monta `hijos` en el `<body>` (solo en el navegador, ya con la página pintada). */
function EnElBody({ clases, hijos }: { clases: string; hijos: React.ReactNode }) {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  if (!montado) return null;
  return createPortal(<div className={clases}>{hijos}</div>, document.body);
}

// ── Editar datos ───────────────────────────────────────────────────────────

export function EditarDatosDelCaso({
  patientId,
  planId,
  alCerrar,
}: {
  patientId: string;
  planId: string;
  alCerrar: () => void;
}) {
  const router = useRouter();

  const guardar = async (payload: DrawerCaseSettingsPayload) => {
    const res = await updateTreatmentPlan({
      treatmentPlanId: planId,
      ...payload,
      // `status` no acepta `null` (solo `undefined`) cuando el estado no cambió.
      status: payload.status ?? undefined,
    });
    if (isFailure(res)) {
      toast.error(res.error);
      return;
    }
    if (!res.data.altaCasoFieldsSaved && (payload.treatingDoctorId || payload.responsibleGuardianId || payload.newResponsibleGuardian)) {
      toast("Falta pegar el SQL del alta del caso: el doctor y el responsable no se pudieron guardar todavía.");
    }
    toast.success("Datos del caso guardados");
    if (res.data.avisoPrecioDesfasado) toast(res.data.avisoPrecioDesfasado, { duration: 12000 });
    // Cambio de doctor: los controles ya agendados se quedan con el anterior
    // salvo que se pasen (solo los que no chocan con la agenda del nuevo).
    if (res.data.controlesConOtroDoctor > 0) {
      const n = res.data.controlesConOtroDoctor;
      const pasar = window.confirm(
        `${n === 1 ? "Hay 1 control futuro agendado" : `Hay ${n} controles futuros agendados`} con el doctor anterior. ¿Pasarlo${n === 1 ? "" : "s"} al doctor nuevo? Solo se pasan los que no chocan con su agenda.`,
      );
      if (pasar) {
        const r = await moverControlesFuturosAlDoctor({ treatmentPlanId: planId });
        if (isFailure(r)) toast.error(r.error);
        else
          toast.success(
            `${r.data.movidos} control${r.data.movidos === 1 ? "" : "es"} pasado${r.data.movidos === 1 ? "" : "s"} al doctor nuevo` +
              (r.data.conChoque > 0 ? `; ${r.data.conChoque} chocan con su agenda y se quedaron como estaban.` : "."),
          );
      }
    }
    router.refresh();
    alCerrar();
  };

  return (
    <EnElBody
      clases={RAIZ_ORTO}
      hijos={<DrawerCaseSettings patientId={patientId} treatmentPlanId={planId} onClose={alCerrar} onConfirm={guardar} />}
    />
  );
}

// ── Eliminar ───────────────────────────────────────────────────────────────

export function EliminarCasoDialogo({
  planId,
  paciente,
  detalle,
  facturasACancelar,
  alCerrar,
}: {
  planId: string;
  paciente: string;
  /** «Brackets metálicos · Dra. Pérez»: para que no se borre el caso equivocado. */
  detalle: string;
  facturasACancelar: number;
  alCerrar: () => void;
}) {
  const router = useRouter();
  const idTitulo = useId();
  const idMotivo = useId();
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cuadroRef = useCajon<HTMLDivElement>(() => {
    if (!enviando) alCerrar();
  });
  const valido = motivoValido(motivo) !== null;

  const confirmar = async () => {
    if (!valido || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await eliminarCaso({ treatmentPlanId: planId, motivo });
      if (isFailure(res)) {
        setError(res.error);
        return;
      }
      toast.success(
        res.data.facturasCanceladas > 0
          ? `Caso eliminado. Se ${res.data.facturasCanceladas === 1 ? "canceló 1 factura" : `cancelaron ${res.data.facturasCanceladas} facturas`} sin pagos.`
          : "Caso eliminado",
      );
      router.refresh();
      alCerrar();
    } catch {
      setError("No se pudo eliminar el caso. No se cambió nada.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <EnElBody
      clases={`${CLASES_REDISENO} ${s.portal}`}
      hijos={
        <div
          className={s.velo}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !enviando) alCerrar();
          }}
        >
          <div
            ref={cuadroRef}
            tabIndex={-1}
            className={s.dialogo}
            role="dialog"
            aria-modal="true"
            aria-labelledby={idTitulo}
          >
            <header className={s.dialogoCabeza}>
              <div className={s.dialogoTextos}>
                <h2 id={idTitulo} className={s.dialogoTitulo}>
                  Eliminar caso (abierto por error)
                </h2>
                <p className={s.dialogoSub}>
                  {paciente}
                  {detalle ? ` · ${detalle}` : ""}
                </p>
              </div>
              <button type="button" className={`${s.botonIcono} ${s.botonCerrar}`} aria-label="Cerrar" onClick={alCerrar} disabled={enviando}>
                <X size={17} strokeWidth={1.9} aria-hidden />
              </button>
            </header>

            <div className={s.dialogoCuerpo}>
              <p className={s.dialogoSub}>
                Solo se elimina un caso que no tiene nada: ni hojas de control, ni pagos, ni fotos, ni citas atendidas. Queda
                en Movimientos del paciente quién lo eliminó y por qué.
              </p>
              {facturasACancelar > 0 && (
                <p className={s.avisoEliminar} role="note">
                  {facturasACancelar === 1
                    ? "La factura de este caso no tiene pagos: se cancelará junto con él."
                    : `Las ${facturasACancelar} facturas de este caso no tienen pagos: se cancelarán junto con él.`}
                </p>
              )}
              <div className={s.campo}>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={idMotivo} className={s.campoEtiqueta}>
                    Motivo
                  </label>
                  <DictationMic disabled={enviando} onText={(t) => setMotivo((p) => appendDictado(p, t, " ", MAX_LETRAS_MOTIVO))} />
                </div>
                <textarea
                  id={idMotivo}
                  className={s.campoEntrada}
                  rows={3}
                  maxLength={MAX_LETRAS_MOTIVO}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej.: se abrió en el paciente equivocado"
                  disabled={enviando}
                />
                <span className={s.campoAyuda}>
                  {valido ? "Queda escrito en el movimiento y en la factura cancelada." : `Al menos ${MIN_LETRAS_MOTIVO} letras.`}
                </span>
              </div>
              {error && (
                <p className={s.error} role="alert">
                  {error}
                </p>
              )}
            </div>

            <footer className={s.dialogoPie}>
              <button type="button" className={s.boton} onClick={alCerrar} disabled={enviando}>
                Cancelar
              </button>
              <button type="button" className={`${s.boton} ${s.botonPeligro}`} onClick={confirmar} disabled={!valido || enviando}>
                {enviando ? <Loader2 size={14} strokeWidth={1.9} aria-hidden className={s.girando} /> : <Trash2 size={14} strokeWidth={1.9} aria-hidden />}
                Eliminar caso
              </button>
            </footer>
          </div>
        </div>
      }
    />
  );
}
