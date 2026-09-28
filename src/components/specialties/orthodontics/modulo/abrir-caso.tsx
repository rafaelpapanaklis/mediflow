"use client";
// Módulo de Ortodoncia — el botón «Abrir caso» de Pacientes en tratamiento
// (ws1-t3, H17 de la QA en vivo del 28-sep-2026). Antes un caso solo se podía
// abrir entrando primero a la ficha del paciente.
//
// No es otra alta: deja elegir al paciente y lleva a SU ficha, pestaña
// Ortodoncia, donde se abre el asistente de siempre. Las reglas (a dónde va
// cada paciente, qué dice su etiqueta) viven en
// `src/lib/orthodontics/abrir-caso.ts`, con tests.
//
// El cuadro se pinta en un portal, fuera de la raíz del módulo: esa raíz es un
// contenedor (`container-type`), y dentro de uno lo «fijo» se ancla al
// contenedor y no a la pantalla.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronRight, FolderPlus, Search, UserPlus, X } from "lucide-react";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { CLASES_REDISENO } from "@/components/dashboard/pacientes-rediseno/raiz";
import {
  buscarPacientesParaAbrirCaso,
  type PacienteParaAbrirCaso,
} from "@/app/actions/orthodontics/modulo/buscarPacientesParaAbrirCaso";
import { isFailure } from "@/app/actions/orthodontics/result";
import { MIN_LETRAS_BUSQUEDA, destinoDeAbrirCaso, etiquetaDeSituacion } from "@/lib/orthodontics/abrir-caso";
import s from "./modulo.module.css";

const ESPERA_MS = 250;

// Las etiquetas del módulo, no `BadgeNew`: el cuadro vive fuera de la raíz
// que viste a las piezas del sistema de diseño.
const CLASE_ETIQUETA: Record<ReturnType<typeof etiquetaDeSituacion>["tono"], string> = {
  success: s.etiquetaExito,
  warning: s.etiquetaAlerta,
  info: s.etiquetaVioleta,
  neutral: s.etiquetaNeutra,
};

export function AbrirCasoBoton({ principal = true }: { principal?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const botonRef = useRef<HTMLButtonElement>(null);
  const cerrar = useCallback(() => {
    setAbierto(false);
    // El foco vuelve al botón que abrió el cuadro.
    requestAnimationFrame(() => botonRef.current?.focus());
  }, []);

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        className={principal ? `${s.boton} ${s.botonPrincipal}` : s.boton}
        aria-haspopup="dialog"
        onClick={() => setAbierto(true)}
      >
        <FolderPlus size={15} strokeWidth={1.9} aria-hidden />
        Abrir caso
      </button>
      {abierto && <CuadroAbrirCaso alCerrar={cerrar} />}
    </>
  );
}

function CuadroAbrirCaso({ alCerrar }: { alCerrar: () => void }) {
  const idTitulo = useId();
  const [consulta, setConsulta] = useState("");
  const [pacientes, setPacientes] = useState<PacienteParaAbrirCaso[] | null>(null);
  const [recientes, setRecientes] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [montado, setMontado] = useState(false);
  const entradaRef = useRef<HTMLInputElement>(null);
  const cuadroRef = useRef<HTMLDivElement>(null);
  // Cada búsqueda lleva su número: una respuesta vieja que llegue tarde no pisa a la nueva.
  const turno = useRef(0);

  useEffect(() => {
    setMontado(true);
  }, []);

  useEffect(() => {
    if (montado) entradaRef.current?.focus();
  }, [montado]);

  useEffect(() => {
    const q = consulta.trim();
    // Con una sola letra no se busca: se queda lo que había.
    if (q.length > 0 && q.length < MIN_LETRAS_BUSQUEDA) return;
    const mio = ++turno.current;
    const espera = setTimeout(
      () => {
        buscarPacientesParaAbrirCaso({ q })
          .then((res) => {
            if (mio !== turno.current) return;
            if (isFailure(res)) {
              setError(res.error);
              setPacientes([]);
              return;
            }
            setError(null);
            setPacientes(res.data.pacientes);
            setRecientes(res.data.recientes);
          })
          .catch(() => {
            if (mio !== turno.current) return;
            setError("No se pudo buscar. Revisa tu conexión e intenta de nuevo.");
            setPacientes([]);
          });
      },
      q === "" ? 0 : ESPERA_MS,
    );
    return () => clearTimeout(espera);
  }, [consulta]);

  // Escape cierra; Tab no se sale del cuadro.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        alCerrar();
        return;
      }
      if (e.key !== "Tab" || !cuadroRef.current) return;
      const enfocables = Array.from(
        cuadroRef.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled)"),
      );
      if (enfocables.length === 0) return;
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener("keydown", alTeclear, true);
    return () => document.removeEventListener("keydown", alTeclear, true);
  }, [alCerrar]);

  if (!montado) return null;

  const q = consulta.trim();
  return createPortal(
    <div className={`${CLASES_REDISENO} ${s.portal}`}>
      <div
        className={s.velo}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) alCerrar();
        }}
      >
        <div ref={cuadroRef} className={s.dialogo} role="dialog" aria-modal="true" aria-labelledby={idTitulo}>
          <header className={s.dialogoCabeza}>
            <div className={s.dialogoTextos}>
              <h2 id={idTitulo} className={s.dialogoTitulo}>
                Abrir caso de ortodoncia
              </h2>
              <p className={s.dialogoSub}>
                Elige al paciente. Se abre su ficha en Ortodoncia, con el formulario del caso listo para llenar.
              </p>
            </div>
            <button type="button" className={`${s.botonIcono} ${s.botonCerrar}`} aria-label="Cerrar" onClick={alCerrar}>
              <X size={17} strokeWidth={1.9} aria-hidden />
            </button>
          </header>

          <div className={s.dialogoBuscador}>
            <div className={s.buscador}>
              <Search size={15} strokeWidth={1.9} aria-hidden />
              <input
                ref={entradaRef}
                type="search"
                value={consulta}
                onChange={(e) => setConsulta(e.target.value)}
                placeholder="Nombre, teléfono o folio…"
                aria-label="Buscar paciente por nombre, teléfono o folio"
                autoComplete="off"
                spellCheck={false}
                className={s.buscadorEntrada}
              />
            </div>
          </div>

          {error ? (
            <p className={s.dialogoEstado} role="alert">
              {error}
            </p>
          ) : pacientes === null ? (
            <p className={s.dialogoEstado} role="status">
              Buscando pacientes…
            </p>
          ) : pacientes.length === 0 ? (
            <p className={s.dialogoEstado} role="status">
              {q.length >= MIN_LETRAS_BUSQUEDA
                ? `Ningún paciente coincide con «${q}». Si es nuevo, regístralo primero en Pacientes.`
                : "Todavía no hay pacientes en la clínica. Registra al primero en Pacientes."}
            </p>
          ) : (
            <ul className={s.dialogoLista} aria-label={recientes ? "Pacientes más recientes" : "Resultados"}>
              {pacientes.map((p) => {
                const etiqueta = etiquetaDeSituacion(p.situacion);
                return (
                  <li key={p.id}>
                    <Link href={destinoDeAbrirCaso(p.id, p.situacion)} className={s.opcion} onClick={alCerrar}>
                      <AvatarNew name={p.fullName} size="sm" />
                      <span className={s.opcionTextos}>
                        <span className={s.nombre}>{p.fullName}</span>
                        <span className={s.detalle}>
                          {[p.patientNumber, p.phone].filter(Boolean).join(" · ") || "Sin teléfono"}
                        </span>
                      </span>
                      <span className={`${s.etiqueta} ${CLASE_ETIQUETA[etiqueta.tono]}`}>{etiqueta.texto}</span>
                      <ChevronRight size={15} strokeWidth={1.9} aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          <footer className={s.dialogoPie}>
            <span>
              {pacientes && pacientes.length > 0
                ? recientes
                  ? "Los pacientes más recientes. Escribe para buscar a otro."
                  : `${pacientes.length} resultado${pacientes.length === 1 ? "" : "s"}`
                : ""}
            </span>
            <Link href="/dashboard/patients" className={`${s.boton} ${s.botonPeq}`} onClick={alCerrar}>
              <UserPlus size={14} strokeWidth={1.9} aria-hidden />
              Ir a Pacientes para registrarlo
            </Link>
          </footer>
        </div>
      </div>
    </div>,
    document.body,
  );
}
