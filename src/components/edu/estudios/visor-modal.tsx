"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import dynamic from "next/dynamic";
import { Download, Loader2, X } from "lucide-react";
import DiagnosticDisclaimer from "@/components/patient-3d/DiagnosticDisclaimer";
import type { Dictionary } from "@/i18n/t";
import { EduModelo3DViewer } from "@/components/edu/estudios/modelo-3d-viewer";
import { eduVisorPorExtension } from "@/components/edu/estudios/visor-tipo";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * EL VISOR DE ESTUDIOS DEL INSTITUTO — el del dental, en un modal propio.
 *
 * Los tres visores se IMPORTAN de `src/components/patient-3d/`. No hay
 * copia de ninguno: la corrección de geometría que el dental pague mañana
 * llega aquí sola, y una copia se habría quedado sin ella sin que nadie lo
 * note hasta que a un paciente se le lea una letra al revés.
 *
 * QUÉ ABRE CADA COSA — lo decide la EXTENSIÓN, igual que en el dental
 * (Models3DTab.tsx, bloque "Modal del visor"):
 *   · .zip            → DicomSetViewer  (set CBCT: rejilla MPR + volumen 3D
 *                                        + panorámica)
 *   · .dcm / .dicom   → DicomViewer2D   (corte único)
 *   · .stl/.ply/.obj  → Model3DViewer   (malla del escáner intraoral)
 *
 * LOS DOS ACOPLES DEL DENTAL, Y CÓMO SE RESUELVEN AQUÍ:
 *
 *  1. Las RUTAS. Los visores del dental hablan con `/api/patients/**`, que
 *     resuelve contra `Patient`/`PatientFile` con la sesión del dental: con
 *     un id del instituto contestan 401/404. `DicomSetViewer` recibe ahora
 *     una prop OPCIONAL `endpoints` y aquí se le pasan las del vertical
 *     (`/api/instituto/estudios/[id]/lite` y `.../notas`), que sí resuelven
 *     con el institutionId de la sesión. Es la ÚNICA línea del dental que
 *     esta ola cambió.
 *     `Model3DViewer` no necesita nada: sin `patientId`/`fileId` su
 *     `canPersist` es false y no pinta panel de notas.
 *     `DicomViewer2D` sí lo pinta y no acepta rutas: su panel se OCULTA
 *     desde el CSS del vertical (.edu-vsr__lienzo--dicom), porque un botón
 *     "Guardar" que siempre falla es peor que no tenerlo. Hay una prueba
 *     que se pone roja si el dental le cambia la clase con la que se
 *     oculta.
 *
 *  2. El i18n. Solo `Model3DViewer` lee textos con `useT()`, y ese provider
 *     no existe bajo /instituto (useT LANZA sin él). Se lo monta el
 *     adaptador `modelo-3d-viewer.tsx`, con el TROZO del diccionario que
 *     recorta el servidor — y de paso es quien NO le pasa
 *     `patientId`/`fileId`.
 *
 * 🔴 LA REJILLA 2×2 SE VE COMPLETA SIN BAJAR. Es lo único en lo que este
 * modal se aparta del dental: allí los cuatro paneles miden 420 px fijos y
 * en cualquier monitor hay que desplazarse para ver el cuarto. Aquí la hoja
 * mide contra la VENTANA (dvh) y `useAltoDeFila` reparte el hueco que de
 * verdad queda entre las dos filas. Lo que sobra —la leyenda clínica, el
 * apoyo de IA, la ficha del estudio— vive debajo, a un desplazamiento.
 *
 * Los tres visores entran por `dynamic(ssr:false)`: three.js, jszip y el
 * worker de decodificación pesan, y solo los paga quien abre un estudio.
 * ═══════════════════════════════════════════════════════════════════════
 */

const cargando = (que: string) => (
  <div className="edu-vsr__cargando" role="status">
    <Loader2 className="edu-girando" size={18} /> {que}
  </div>
);

const DicomSetViewer = dynamic(() => import("@/components/patient-3d/DicomSetViewer"), {
  ssr: false,
  loading: () => cargando("Preparando el visor de tomografía…"),
});

const DicomViewer2D = dynamic(() => import("@/components/patient-3d/DicomViewer2D"), {
  ssr: false,
  loading: () => cargando("Preparando el visor DICOM…"),
});

/**
 * La caja negra de un plano MPR. Es el ÚNICO sitio del visor donde
 * `select-none` y `overflow-hidden` van juntas, y lleva el alto EN LÍNEA
 * (420 px), así que es también el ancla desde la que se mide la rejilla.
 */
const SELECTOR_PANEL = ".select-none.overflow-hidden";

/** Alto mínimo y máximo de una fila. Por debajo del mínimo un corte axial
 *  ya no se lee y es mejor desplazar; por encima del máximo se desperdicia
 *  monitor en un panel enorme y medio vacío. */
const FILA_MIN = 220;
const FILA_MAX = 620;

/**
 * Reparte el alto REAL que queda entre las dos filas de la rejilla.
 *
 * Por qué se mide en JS y no con un `calc()` de dvh: lo único que hay entre
 * el borde de la hoja y la rejilla es la barra de control del visor, y esa
 * barra CAMBIA de alto —se parte en dos o tres renglones según el ancho del
 * modal—. Un número fijo acierta en un monitor y deja el cuarto panel
 * cortado en el siguiente, que es justo el defecto que este visor venía a
 * arreglar. El alto de la HOJA sí es dvh (ver el CSS).
 *
 * Se mide contra el CONTENIDO del cuerpo y no contra la ventana, para que
 * el resultado no cambie si alguien ya desplazó. Y solo se aplica cuando la
 * rejilla tiene 2 columnas de verdad: en una pantalla angosta son cuatro
 * paneles apilados y ahí no cabe nada, así que se desplaza como en el
 * dental en vez de encoger los cortes hasta lo ilegible.
 */
function useAltoDeFila(
  cuerpo: React.RefObject<HTMLElement>,
  lienzo: React.RefObject<HTMLElement>,
  activo: boolean,
) {
  useEffect(() => {
    if (!activo) return;
    const cuerpoEl = cuerpo.current;
    const lienzoEl = lienzo.current;
    if (!cuerpoEl || !lienzoEl || typeof ResizeObserver === "undefined") return;

    let pendiente = 0;

    const medir = () => {
      pendiente = 0;
      const panel = lienzoEl.querySelector<HTMLElement>(SELECTOR_PANEL);
      const tarjeta = panel?.parentElement ?? null;
      const rejilla = tarjeta?.parentElement ?? null;
      if (!panel || !tarjeta || !rejilla) {
        lienzoEl.style.removeProperty("--edu-vsr-fila");
        return;
      }

      const estiloRejilla = getComputedStyle(rejilla);
      const columnas =
        estiloRejilla.display === "grid"
          ? estiloRejilla.gridTemplateColumns.split(/\s+/).filter(Boolean).length
          : 0;
      // 1 columna (apilado), un panel maximizado, la panorámica o el modo
      // de poca memoria: no hay 2×2 que cuadrar, manda el dental.
      if (columnas < 2) {
        lienzoEl.style.removeProperty("--edu-vsr-fila");
        return;
      }

      const cajaCuerpo = cuerpoEl.getBoundingClientRect();
      const estiloCuerpo = getComputedStyle(cuerpoEl);
      const relleno = parseFloat(estiloCuerpo.paddingBottom) || 0;
      // El hueco se lee con `rowGap` y no con un 8 escrito a mano: la raíz
      // del panel mide 13 px, así que el `gap-2` de Tailwind NO son 8 px.
      const hueco = parseFloat(estiloRejilla.rowGap) || 0;

      const arriba = tarjeta.getBoundingClientRect().top - cajaCuerpo.top + cuerpoEl.scrollTop;
      const libre = cuerpoEl.clientHeight - relleno - arriba - hueco;
      const fila = Math.max(FILA_MIN, Math.min(FILA_MAX, Math.floor(libre / 2)));
      lienzoEl.style.setProperty("--edu-vsr-fila", `${fila}px`);
    };

    const pedirMedida = () => {
      if (pendiente) return;
      pendiente = requestAnimationFrame(medir);
    };

    // El cuerpo cambia de alto cuando cambia la ventana (y cuando el
    // teclado del móvil la encoge).
    const ro = new ResizeObserver(pedirMedida);
    ro.observe(cuerpoEl);

    // La rejilla no existe hasta que el estudio termina de decodificarse, y
    // desaparece al maximizar un panel o al pasar a la panorámica. Se mira
    // SOLO `childList`: los cambios de clase de los botones de la barra son
    // atributos y no tienen por qué volver a medir nada.
    const mo = new MutationObserver(pedirMedida);
    mo.observe(lienzoEl, { childList: true, subtree: true });

    pedirMedida();
    return () => {
      if (pendiente) cancelAnimationFrame(pendiente);
      ro.disconnect();
      mo.disconnect();
      lienzoEl.style.removeProperty("--edu-vsr-fila");
    };
  }, [cuerpo, lienzo, activo]);
}

export interface EduVisorModalProps {
  /** Id del EduStudy. Es el `fileId` del visor del dental: con él cachea
   *  los cortes decodificados en IndexedDB, así que tiene que ser estable y
   *  único. */
  studyId: string;
  patientId: string;
  name: string;
  /** URL FIRMADA del archivo original. */
  url: string;
  subtitle: string;
  /** Notas del estudio (EduStudy.notes). El visor CBCT las edita contra la
   *  ruta del instituto; los otros dos las enseñan en la ficha de abajo. */
  notes: string | null;
  /** El trozo `{ patients: { models3d } }` que necesita el visor de mallas. */
  dict3d: Dictionary;
  onClose: () => void;
  /** Apoyo de IA y ficha del estudio: van BAJO el visor, a un
   *  desplazamiento, para que no le quiten pantalla a los cuatro paneles. */
  children?: React.ReactNode;
}

export function EduVisorModal({
  studyId,
  patientId,
  name,
  url,
  subtitle,
  notes,
  dict3d,
  onClose,
  children,
}: EduVisorModalProps) {
  const tarjetaRef = useRef<HTMLDivElement | null>(null);
  const cuerpoRef = useRef<HTMLDivElement | null>(null);
  const lienzoRef = useRef<HTMLDivElement | null>(null);
  const volverA = useRef<HTMLElement | null>(null);
  const tituloId = useId();

  const tipo = eduVisorPorExtension(name);
  useAltoDeFila(cuerpoRef, lienzoRef, tipo === "cbct");

  // Las mismas reglas de la casa que `EduModal`: el foco entra al abrir y
  // VUELVE a donde estaba al cerrar, Escape cierra y el fondo no se
  // desplaza. No hay trampa de foco completa (Tab puede salirse): es la
  // limitación conocida del modal del vertical, y traer una biblioteca de
  // diálogos por esto habría metido dependencias nuevas.
  useEffect(() => {
    volverA.current = (document.activeElement as HTMLElement) ?? null;
    tarjetaRef.current?.focus();
    return () => {
      volverA.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previo;
    };
  }, []);

  const cerrarDesdeCortina = useCallback(
    (e: React.MouseEvent) => {
      // Solo la cortina cierra: un arrastre que empieza dentro del visor
      // (medir, rotar el volumen) y termina fuera no puede cerrar el
      // estudio a medio leer.
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  // 🔴 Las rutas del INSTITUTO. Objeto literal a propósito: `DicomSetViewer`
  // lo reduce a dos strings antes de meterlo en sus dependencias, así que
  // recrearlo en cada render no vuelve a decodificar el estudio.
  const endpoints = {
    lite: `/api/instituto/estudios/${studyId}/lite`,
    notes: `/api/instituto/estudios/${studyId}/notas`,
  };

  return (
    <div className="edu-vsr" onMouseDown={cerrarDesdeCortina}>
      <div
        ref={tarjetaRef}
        className="edu-vsr__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
      >
        <div className="edu-vsr__head">
          <div className="edu-vsr__titulos">
            <h2 className="edu-vsr__title" id={tituloId}>
              {name}
            </h2>
            <p className="edu-vsr__sub">{subtitle}</p>
          </div>
          <a
            className="edu-btn edu-btn--ghost edu-btn--sm"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download size={16} />
            Descargar
          </a>
          <button type="button" className="edu-iconbtn" onClick={onClose} aria-label="Cerrar">
            <X size={17} />
          </button>
        </div>

        <div className="edu-vsr__body" ref={cuerpoRef}>
          <div className={`edu-vsr__lienzo edu-vsr__lienzo--${tipo ?? "otro"}`} ref={lienzoRef}>
            {tipo === "cbct" ? (
              <DicomSetViewer
                url={url}
                name={name}
                fileId={studyId}
                patientId={patientId}
                initialNotes={notes ?? ""}
                endpoints={endpoints}
              />
            ) : tipo === "dicom" ? (
              <DicomViewer2D
                url={url}
                name={name}
                fileId={studyId}
                patientId={patientId}
                initialNotes={notes ?? ""}
              />
            ) : tipo === "malla" ? (
              <EduModelo3DViewer url={url} name={name} dict3d={dict3d} />
            ) : (
              <div className="edu-alert" role="alert">
                Este archivo no lo abre ningún visor: no es una tomografía (.zip, .dcm) ni una
                malla 3D (.stl, .ply, .obj). Descárgalo con el botón de arriba.
              </div>
            )}
          </div>

          {children}
        </div>

        {/* La leyenda legal se monta UNA vez aquí y no dentro de cada visor,
            para que salga igual con malla, con DICOM y con CBCT. */}
        <DiagnosticDisclaimer text="Solo apoyo visual — no sustituye una estación diagnóstica certificada ni el criterio del docente." />
      </div>
    </div>
  );
}
