"use client";

import { useEffect, useRef, useState } from "react";
import { eduRequest } from "@/components/edu/edu-http";
import { EDU_CLINICA_MAX_ROWS } from "@/lib/edu/agenda-core";

/**
 * EL DESPLEGABLE DE PACIENTE, CON BUSCADOR — una sola vez para todo el
 * vertical.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 QUÉ ARREGLA (H-06, la otra mitad).
 *
 * Este `<select>` bajaba los `EDU_CLINICA_MAX_ROWS` primeros pacientes POR
 * FOLIO y ahí se acababa. En una escuela con 2 000 pacientes eso son los
 * 300 MÁS ANTIGUOS: al que se registró hoy —folio P-1874— no se le podía
 * agendar desde la agenda, porque un `<select>` no tiene buscador y el
 * suyo no estaba en la lista. El aviso decía "si no está el que buscas,
 * ábrelo desde Pacientes", que es pedirle a recepción que cambie de
 * pantalla a mitad de una llamada.
 *
 * La CAPACIDAD ya existía y la dejó lista la Ola B: `listEduPatientOptions`
 * filtra por texto en Postgres (misma columna `searchIndex` y los mismos
 * tokens que el buscador de la lista) y el endpoint la expone en
 * `GET /api/instituto/pacientes?opciones=1&q=`. Lo que faltaba —y es esto—
 * era montarle el buscador al desplegable.
 *
 * 🔴 UN COMPONENTE Y NO DOS. El mismo desplegable estaba copiado en
 * `agenda-modales.tsx` (agendar) y en `tamizaje-screen.tsx` (valoración).
 * Copiarle el buscador a los dos es garantizar que dentro de dos olas uno
 * de ellos se quede atrás. Vive aquí, en `clinica/`, que es donde ya viven
 * la lista de pacientes y el formulario de su ficha.
 *
 * ⚠️ NO ES UN AUTOCOMPLETAR CON LISTA FLOTANTE, y es deliberado: un menú
 * propio hay que teclearlo entero (flechas, Escape, foco, lector de
 * pantalla) y aquí el `<select>` nativo ya lo trae hecho y funciona con el
 * pulgar. El buscador solo cambia LO QUE HAY DENTRO del desplegable.
 *
 * ⚠️ EL ALCANCE NO SE TOCA. La búsqueda va al mismo endpoint con el mismo
 * `pacientes.view` y el mismo recorte por visibilidad: un alumno sigue
 * encontrando solo a los suyos. Aquí no se decide quién ve a quién.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Lo mínimo que necesita el desplegable. A propósito NO es
 *  `EduPatientOption`: aquella lleva `status`, y una de las dos pantallas
 *  que montan esto no lo pasa. Pedir de más obligaría a tocar las dos. */
export interface EduPacienteOpcion {
  id: string;
  folio: string;
  name: string;
}

/** Lo que baja una BÚSQUEDA. Menos que el tope del desplegable a
 *  propósito: quien escribe tres letras está afinando, y 300 coincidencias
 *  en un `<select>` son el mismo problema de antes con otro orden. */
const BUSCA_TOPE = 50;

/** Se espera a que la persona pare de teclear. Sin esto, "Zúñiga" son seis
 *  consultas a Postgres y seis respuestas que pueden llegar desordenadas. */
const DEBOUNCE_MS = 300;

/** Con una sola letra coincide media escuela; la consulta no aporta nada y
 *  la respuesta llega recortada por `BUSCA_TOPE`. */
const MIN_LETRAS = 2;

export function EduPacienteSelector({
  id,
  value,
  onChange,
  iniciales,
  inicialesTruncadas,
  label = "Paciente",
}: {
  /** Id del `<select>`, para el `htmlFor` de su etiqueta. */
  id: string;
  value: string;
  /** Devuelve también la OPCIÓN: quien la monta suele necesitar el nombre
   *  (el mensaje de "X quedó asignado") y, si el paciente vino de una
   *  búsqueda, no está en la lista que el servidor pintó. */
  onChange: (patientId: string, opcion: EduPacienteOpcion | null) => void;
  /** La primera página, la que ya pinta el servidor. Se sigue usando tal
   *  cual mientras nadie escriba: sin buscar, esto se comporta igual que
   *  antes y no hace ni una petición de más. */
  iniciales: EduPacienteOpcion[];
  inicialesTruncadas: boolean;
  label?: string;
}) {
  const [q, setQ] = useState("");
  /** `null` = nadie ha buscado, se enseñan las iniciales. Un array vacío
   *  SÍ es un resultado: "no coincide nadie". */
  const [encontrados, setEncontrados] = useState<EduPacienteOpcion[] | null>(null);
  const [masDeLasQueCaben, setMasDeLasQueCaben] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [errorBusca, setErrorBusca] = useState<string | null>(null);

  /** El paciente elegido, para no perderlo al cambiar la búsqueda. Si su
   *  `<option>` desaparece del DOM, el `<select>` se pinta en blanco
   *  mientras el formulario sigue teniendo su id: se agenda a alguien que
   *  la pantalla ya no dice. Se queda clavado arriba. */
  const [elegido, setElegido] = useState<EduPacienteOpcion | null>(
    () => iniciales.find((p) => p.id === value) ?? null,
  );

  /** Contador de peticiones. Dos búsquedas seguidas pueden contestar en el
   *  orden contrario y dejar en pantalla el resultado de lo que ya no está
   *  escrito; solo se acepta la respuesta de la ÚLTIMA. */
  const turno = useRef(0);

  useEffect(() => {
    const texto = q.trim();
    // Cada cambio invalida lo que estuviera volando, también el borrado.
    const mio = ++turno.current;

    if (texto.length < MIN_LETRAS) {
      setEncontrados(null);
      setMasDeLasQueCaben(false);
      setBuscando(false);
      setErrorBusca(null);
      return;
    }

    setBuscando(true);
    setErrorBusca(null);

    const t = setTimeout(() => {
      eduRequest<{ rows: EduPacienteOpcion[]; truncated: boolean }>(
        `/api/instituto/pacientes?opciones=1&take=${BUSCA_TOPE}&q=${encodeURIComponent(texto)}`,
      )
        .then((pagina) => {
          if (mio !== turno.current) return;
          setEncontrados(pagina.rows);
          setMasDeLasQueCaben(pagina.truncated);
          setBuscando(false);
        })
        .catch((err) => {
          if (mio !== turno.current) return;
          // Se vacía la lista a propósito: dejar los resultados viejos bajo
          // un texto nuevo es peor que decir que no se pudo buscar.
          setEncontrados([]);
          setMasDeLasQueCaben(false);
          setBuscando(false);
          setErrorBusca(err instanceof Error ? err.message : "No se pudo buscar.");
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(t);
  }, [q]);

  const base = encontrados ?? iniciales;
  const lista =
    elegido && !base.some((p) => p.id === elegido.id) ? [elegido, ...base] : base;

  return (
    <div className="edu-field">
      <label className="edu-field__label" htmlFor={id}>
        {label}
      </label>

      <input
        className="edu-input edu-input--sm"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por nombre, folio o teléfono"
        aria-label="Buscar paciente por nombre, folio o teléfono"
        autoComplete="off"
      />

      <select
        id={id}
        className="edu-input"
        value={value}
        onChange={(e) => {
          const nuevo = e.target.value;
          const opcion = lista.find((p) => p.id === nuevo) ?? null;
          setElegido(opcion);
          onChange(nuevo, opcion);
        }}
      >
        <option value="">Elige…</option>
        {lista.map((p) => (
          <option key={p.id} value={p.id}>
            {p.folio} · {p.name}
          </option>
        ))}
      </select>

      <Pista
        buscando={buscando}
        errorBusca={errorBusca}
        encontrados={encontrados}
        masDeLasQueCaben={masDeLasQueCaben}
        inicialesTruncadas={inicialesTruncadas}
        q={q.trim()}
      />
    </div>
  );
}

/** La línea de debajo del desplegable. Aparte porque son seis estados y
 *  encadenados dentro del JSX no se leen. */
function Pista({
  buscando,
  errorBusca,
  encontrados,
  masDeLasQueCaben,
  inicialesTruncadas,
  q,
}: {
  buscando: boolean;
  errorBusca: string | null;
  encontrados: EduPacienteOpcion[] | null;
  masDeLasQueCaben: boolean;
  inicialesTruncadas: boolean;
  q: string;
}) {
  if (errorBusca) {
    return (
      <span className="edu-field__hint" role="alert">
        {errorBusca}
      </span>
    );
  }

  if (buscando) {
    return <span className="edu-field__hint">Buscando…</span>;
  }

  if (encontrados !== null) {
    if (encontrados.length === 0) {
      return (
        <span className="edu-field__hint">
          Ningún paciente tuyo coincide con «{q}».
        </span>
      );
    }
    if (masDeLasQueCaben) {
      return (
        <span className="edu-field__hint">
          Más de {BUSCA_TOPE} coinciden con «{q}». Escribe también el apellido o el folio.
        </span>
      );
    }
    return (
      <span className="edu-field__hint">
        {encontrados.length === 1
          ? "1 paciente coincide."
          : `${encontrados.length} pacientes coinciden.`}
      </span>
    );
  }

  if (inicialesTruncadas) {
    return (
      <span className="edu-field__hint">
        La lista trae los primeros {EDU_CLINICA_MAX_ROWS} por folio, que son los más
        antiguos. Para el resto —el que registraste hoy, entre otros— escribe arriba.
      </span>
    );
  }

  return null;
}
