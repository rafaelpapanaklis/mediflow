"use client";
// Ortodoncia — H55/H57: «Elegir de los archivos del paciente». Lo que ya está
// en el expediente (Radiografías, fotos clínicas, lo que subió el paciente) se
// elige aquí en vez de subirse otra vez. Solo elige: quien lo monta decide qué
// hacer con el archivo (ligarlo a una vista de foto, a un trazado…).

import { useEffect, useState } from "react";
import { FileText, Loader2, X } from "lucide-react";
import {
  listarArchivosDelPaciente,
  type ArchivoDelPaciente,
  type TipoDeArchivoBuscado,
} from "@/app/actions/orthodontics/imagen/archivosDelPaciente";
import { isFailure } from "@/app/actions/orthodontics/result";
import { fmtDateShort } from "../redesign/atoms/format";
import orto from "../redesign/orto.module.css";

export interface ElegirArchivoDelPacienteProps {
  patientId: string;
  tipo: TipoDeArchivoBuscado;
  titulo?: string;
  onElegir: (archivo: ArchivoDelPaciente) => void;
  onCerrar: () => void;
}

export function ElegirArchivoDelPaciente(props: ElegirArchivoDelPacienteProps) {
  const [archivos, setArchivos] = useState<ArchivoDelPaciente[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    listarArchivosDelPaciente(props.patientId, props.tipo)
      .then((res) => {
        if (!vivo) return;
        if (!res || isFailure(res)) {
          setError(res && isFailure(res) ? res.error : "No se pudieron leer los archivos.");
          setArchivos([]);
          return;
        }
        setArchivos(res.data);
      })
      .catch(() => {
        if (vivo) {
          setError("No se pudieron leer los archivos.");
          setArchivos([]);
        }
      });
    return () => {
      vivo = false;
    };
  }, [props.patientId, props.tipo]);

  return (
    <div className={`${orto.caja} mt-2`} role="group" aria-label="Archivos del paciente">
      <div className="flex items-center justify-between gap-2 mb-2">
        <strong className="text-[13px]">{props.titulo ?? "Archivos del paciente"}</strong>
        <button type="button" onClick={props.onCerrar} className={orto.enlace} aria-label="Cerrar la lista de archivos">
          <X size={14} aria-hidden />
        </button>
      </div>
      {archivos === null ? (
        <div className="flex items-center gap-2 text-xs">
          <Loader2 size={14} className="animate-spin" aria-hidden /> Cargando…
        </div>
      ) : error ? (
        <div className="text-xs" role="alert">{error}</div>
      ) : archivos.length === 0 ? (
        <div className={orto.vacioLinea}>Este paciente no tiene archivos de este tipo en su expediente.</div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[260px] overflow-y-auto">
          {archivos.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => props.onElegir(a)}
              className="text-left rounded-[8px] border border-[color:var(--pr-borde)] p-1 hover:border-[color:var(--pr-activo)]"
              title={a.name}
            >
              {a.thumbUrl ? (
                <img src={a.thumbUrl} alt={a.name} className="w-full h-[70px] object-cover rounded-[6px]" />
              ) : (
                <div className="w-full h-[70px] flex items-center justify-center">
                  <FileText size={22} aria-hidden />
                </div>
              )}
              <div className="text-[11px] mt-1 truncate">{a.name}</div>
              <div className="text-[10.5px] opacity-70">{fmtDateShort(a.date)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
