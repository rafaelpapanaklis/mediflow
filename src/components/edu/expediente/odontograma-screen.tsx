"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_ODONTOGRAM_NOTE_KEY,
  EDU_TOOTH_WHOLE,
  eduConditionLabel,
  eduEntriesToRecords,
  eduRecordsSummary,
  type EduOdontogramEntryRow,
} from "@/lib/edu/odontograma-core";

// ═══════════════════════════════════════════════════════════════════════
// 🔴 EL DIBUJO ES **DEL INSTITUTO**. Vive en src/components/edu/odontograma/
// y ya NO se importa de la carpeta del dental bajo src/components/dashboard/.
//
// Hasta WS2-T3 se importaba del dental, con este argumento escrito aquí:
// "copiar la carpeta daría dos catálogos que empiezan iguales y terminan
// distintos". Era verdad — y el otro lado de la moneda resultó ser peor:
// significaba que un cambio en un archivo del PRODUCTO DENTAL, hecho por
// otro equipo y por otra razón, cambiaba el odontograma clínico de una
// escuela sin que nadie del instituto lo pidiera ni se enterara. Un
// expediente no se mueve desde fuera.
//
// Así que la carpeta se BIFURCÓ (13 archivos, con su hoja de estilo). El
// original se queda intacto y sigue siendo del dental. El precio, escrito
// para que nadie lo descubra solo: un hallazgo nuevo del catálogo dental
// ya no aparece aquí hasta que alguien lo traiga a mano.
//
// De los 13, DOS no se usan y no deben usarse: `App.tsx` y `adapter.ts`,
// que son la raíz acoplada a /api/odontogram (la tabla del dental). Su
// propia cabecera lo dice. El contenedor del vertical es ESTE archivo, y
// escribe en /api/instituto/pacientes/[id]/odontograma.
//
// El CSS de la copia viene entero bajo `.odo-app`, así que no se pisa con
// el del panel; edu-theme.css solo corrige que ese contenedor está pensado
// para ocupar una pantalla completa (`.edu-odo .odo-app`).
// ═══════════════════════════════════════════════════════════════════════
import { OdoDefs } from "@/components/edu/odontograma/OdoDefs";
import { Odontogram } from "@/components/edu/odontograma/Odontogram";
import { Palette } from "@/components/edu/odontograma/Palette";
import { Legend } from "@/components/edu/odontograma/Legend";
import { COND_BY_ID } from "@/components/edu/odontograma/data";
import { EMPTY_RECORD } from "@/components/edu/odontograma/types";
import type {
  ApplyKind,
  Dentition,
  Records,
  SurfaceLetter,
} from "@/components/edu/odontograma/types";
import "@/components/edu/odontograma/odontogram.css";

/**
 * El panel de detalle trae un diente en 3D (three.js). Se carga SOLO
 * cuando alguien abre un diente: son cientos de KB de shader que el piso
 * clínico no necesita para mirar el dibujo, y esta pantalla se abre en un
 * teléfono con datos móviles.
 */
const DetailPanel = dynamic(
  () => import("@/components/edu/odontograma/DetailPanel").then((m) => m.DetailPanel),
  { ssr: false },
);

/** El motivo, escrito una vez y usado en los dos sitios donde se apaga
 *  algo por falta de permiso: el aviso de arriba y el panel del diente. */
const SIN_PERMISO =
  "Estás viendo el odontograma en solo lectura: para marcar hallazgos, quitarlos o escribir la nota de un diente hace falta el permiso odontograma.edit.";

export interface EduOdontogramaScreenProps {
  patientId: string;
  /** Solo las VIVAS: es lo que se dibuja. Las recorta el servidor. */
  entries: EduOdontogramEntryRow[];
  /**
   * TODAS: vivas y dadas de baja. Es lo que alimenta «Quién marcó qué», y
   * es lo único que puede contestar "¿quién quitó esto y cuándo?".
   */
  historial: EduOdontogramEntryRow[];
  /** true = la consulta se topó con el techo y hay historia más vieja. */
  historialTruncado: boolean;
  /** Con qué dentición abre (temporal si el paciente es `isChild`). */
  denticionInicial: Dentition;
  /** true = el paciente está marcado como de dentición temporal. */
  esInfantil: boolean;
  canEdit: boolean;
}

/**
 * /instituto/pacientes/[id]/odontograma
 *
 * ── CÓMO SE GUARDA ──────────────────────────────────────────────────────
 * Optimista: el clic se pinta ANTES de que el servidor conteste, porque un
 * odontograma con medio segundo de retraso por diente es insoportable de
 * usar. Si el servidor rechaza (un hallazgo que no va en esa cara, una
 * sesión caducada), se DESHACE el cambio y se enseña el motivo. Nunca se
 * deja pintado algo que no se guardó: un odontograma que miente es peor que
 * uno vacío.
 *
 * ── LO QUE ESTA PANTALLA NO DECIDE ──────────────────────────────────────
 * Ni qué paciente se ve (lo resolvió el servidor con el alcance clínico) ni
 * quién puede marcar (`canEdit` llega resuelto y el endpoint lo vuelve a
 * exigir). En solo lectura el pincel no se pinta.
 */
export function EduOdontogramaScreen({
  patientId,
  entries,
  historial,
  historialTruncado,
  denticionInicial,
  esInfantil,
  canEdit,
}: EduOdontogramaScreenProps) {
  const [records, setRecords] = useState<Records>(() => eduEntriesToRecords(entries));
  // El arranque lo decide el SERVIDOR con `isChild`; a partir de ahí es de
  // quien atiende. Un `useState` con valor inicial y no un `useEffect` que
  // lo "corrija" después: lo segundo pintaría un odontograma de adulto
  // durante un fotograma y pisaría el cambio manual en cada re-render.
  //
  // (La dentición NO se resincroniza y el dibujo SÍ — ver el `useEffect` de
  // más abajo. No es una incoherencia: la dentición es una preferencia de
  // quien mira, y el dibujo es el expediente.)
  const [dentition, setDentition] = useState<Dentition>(denticionInicial);
  const [brush, setBrush] = useState<string | null>(null);
  const [eraser, setEraser] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(0);

  // 🔴 El contador se calcula sobre el MAPA que se está pintando, no sobre
  // las filas que llegaron del servidor. Como el marcado es optimista y no
  // se recarga la página por cada clic, contar las filas diría "2 hallazgos"
  // con tres dibujados — y de las dos cifras, la que la persona cree es la
  // que ve.
  const resumen = eduRecordsSummary(records);

  // `records` por ref: `apply` lo lee en el momento del clic sin llevarlo
  // en sus dependencias, así su identidad es estable y los React.memo de
  // las 32 celdas del dibujo no se invalidan en cada pintado.
  const recordsRef = useRef(records);
  recordsRef.current = records;

  // ══════════════════════════════════════════════════════════════════
  // 🔴 N-4 · EL DIBUJO SE RESINCRONIZA CON `entries`.
  //
  // `records` nacía de un `useState` con valor inicial y nadie lo volvía a
  // tocar desde el servidor. `router.refresh()` —el botón "Actualizar" de
  // abajo— baja props nuevas pero NO remonta el cliente, así que la lista
  // de movimientos se recalculaba y el dibujo se quedaba como estaba. Dos
  // personas con el mismo paciente abierto: B retira la caries del 16, A
  // pulsa "Actualizar", y la lista decía "Retirado … por B" mientras el
  // dibujo de arriba seguía pintando la caries y el contador sumándola.
  // Es exactamente el odontograma que miente que prohíbe la cabecera de
  // este archivo.
  //
  // 🔴 SOLO CUANDO NO HAY ESCRITURAS EN VUELO, y el guardia se lee de un
  // ref y no de la dependencia del efecto. El marcado es OPTIMISTA: si
  // llegara un `entries` tomado ANTES de que el servidor recibiera el
  // último clic, resincronizar borraría del dibujo un hallazgo que sí se
  // guardó. Esa foto se DESCARTA (se marca consumida y no se aplica) en
  // vez de guardarse para aplicarla al terminar de guardar, que es la
  // versión sutilmente rota del mismo arreglo: la foto no mejora con el
  // tiempo, y aplicarla tarde repintaría lo viejo encima de lo nuevo. El
  // siguiente "Actualizar" trae una foto que ya incluye todo.
  //
  // Se compara por IDENTIDAD del array: `entries` es una prop nueva en
  // cada render del servidor y la misma referencia mientras no lo haya.
  // ══════════════════════════════════════════════════════════════════
  const guardandoRef = useRef(0);
  guardandoRef.current = guardando;
  const entriesRef = useRef(entries);
  useEffect(() => {
    if (entriesRef.current === entries) return;
    entriesRef.current = entries;
    if (guardandoRef.current > 0) return;
    setRecords(eduEntriesToRecords(entries));
  }, [entries]);

  /**
   * Una escritura del odontograma, con su deshacer.
   *
   * El verbo viaja como opción porque la ruta tiene tres: PUT marca o quita
   * UN hallazgo, PATCH escribe la nota de un diente y POST limpia el diente
   * entero de una vez (H-22).
   */
  const escribir = useCallback(
    async (
      body: Record<string, unknown>,
      deshacer: () => void,
      opciones: { method?: "PUT" | "POST"; queFalló?: string } = {},
    ) => {
      setGuardando((n) => n + 1);
      try {
        await eduRequest(`/api/instituto/pacientes/${patientId}/odontograma`, {
          method: opciones.method ?? "PUT",
          body,
        });
        setError(null);
      } catch (err) {
        // Se deshace lo pintado: dejar el hallazgo en pantalla haría creer
        // que quedó guardado.
        deshacer();
        setError(
          err instanceof Error
            ? err.message
            : opciones.queFalló ?? "No se pudo guardar el hallazgo.",
        );
      } finally {
        setGuardando((n) => n - 1);
      }
    },
    [patientId],
  );

  /**
   * 🔴 H-22 · EL DESHACER DE **UN** HALLAZGO.
   *
   * Vuelve a pintar exactamente el hallazgo que el servidor rechazó, sobre
   * el estado que haya EN ESE MOMENTO (`setRecords` con función, no con la
   * foto de antes del gesto). Es lo que permite mandar N peticiones por un
   * gesto sin que el fallo de una repinte lo que las otras sí borraron.
   *
   * `cara === null` = el hallazgo es del diente entero.
   */
  const restaurar = useCallback((fdi: number, cara: string | null, condition: string) => {
    setRecords((actual) =>
      clonar(actual, fdi, (r) => {
        if (cara) {
          if (!r.surfaces[cara]) r.surfaces[cara] = [];
          if (!r.surfaces[cara].includes(condition)) r.surfaces[cara].push(condition);
        } else if (!r.tooth.includes(condition)) {
          r.tooth.push(condition);
        }
      }),
    );
  }, []);

  const apply = useCallback(
    (fdi: number, kind: ApplyKind, letter?: SurfaceLetter | string) => {
      if (!canEdit) {
        setSelected(fdi);
        return;
      }
      const antes = recordsRef.current;
      const rec = antes[fdi] ?? EMPTY_RECORD;

      // ── Goma: quita lo que haya en esa cara (o en el diente) ──────────
      //
      // 🔴 H-22 · CADA PETICIÓN DESHACE **LO SUYO**, no el diente entero.
      //
      // Aquí seguía vivo el patrón que H-22 arregló en "Limpiar diente":
      // una cara con tres hallazgos mandaba tres peticiones y le daba a
      // las tres el MISMO deshacer, `() => setRecords(antes)`. Si fallaba
      // la tercera, volvían a pintarse las tres — incluidas las dos que
      // las peticiones 1 y 2 sí habían dado de baja en Postgres. La
      // pantalla quedaba enseñando hallazgos que ya no existen, que es lo
      // contrario de lo que promete la cabecera de este archivo, y solo se
      // arreglaba recargando.
      //
      // No se une en una sola escritura porque no hay una: el POST de
      // "Limpiar diente" borra el diente ENTERO (caras, corona y nota), y
      // la goma por cara tiene que dejar en pie lo de las otras caras.
      // Así que se hace lo otro que pedía H-22: deshacer solo lo que
      // falló, con `restaurar`, que reinyecta ESE hallazgo sobre el estado
      // que haya en ese momento en vez de volver a una foto vieja.
      if (eraser || kind === "glyphErase") {
        const enCara = kind === "surface" && letter;
        const cara = enCara ? String(letter) : null;
        const ids = enCara ? (rec.surfaces?.[cara as string] ?? []) : (rec.tooth ?? []);
        if (ids.length === 0) return;

        // Copia: `ids` apunta al array de `antes`, y `clonar` lo reemplaza.
        const borrados = [...ids];
        const siguiente = clonar(antes, fdi, (r) => {
          if (cara) delete r.surfaces[cara];
          else r.tooth = [];
        });
        setRecords(siguiente);
        // Una petición por hallazgo: son pocos (lo que quepa en una cara).
        for (const condition of borrados) {
          void escribir(
            { tooth: fdi, surface: cara, condition, present: false },
            () => restaurar(fdi, cara, condition),
          );
        }
        return;
      }

      // ── Sin pincel: se abre el detalle del diente ─────────────────────
      if (!brush) {
        setSelected(fdi);
        return;
      }

      const cond = COND_BY_ID[brush];
      if (!cond) return;

      const enCara = kind === "surface" && cond.target === "surface";
      const cara = enCara ? String(letter) : null;
      const yaEstaba = enCara
        ? Boolean(rec.surfaces?.[cara as string]?.includes(brush))
        : Boolean(rec.tooth?.includes(brush));

      const siguiente = clonar(antes, fdi, (r) => {
        if (enCara) {
          const k = cara as string;
          if (!r.surfaces[k]) r.surfaces[k] = [];
          alternar(r.surfaces[k], brush);
        } else {
          alternar(r.tooth, brush);
        }
      });
      setRecords(siguiente);
      void escribir({ tooth: fdi, surface: cara, condition: brush, present: !yaEstaba }, () =>
        setRecords(antes),
      );
    },
    [brush, canEdit, eraser, escribir, restaurar],
  );

  const quitar = useCallback(
    (fdi: number, scope: "surface" | "tooth", letter: string | undefined, condId: string) => {
      if (!canEdit) return;
      const antes = recordsRef.current;
      const siguiente = clonar(antes, fdi, (r) => {
        if (scope === "surface" && letter) {
          const i = (r.surfaces[letter] ?? []).indexOf(condId);
          if (i >= 0) r.surfaces[letter].splice(i, 1);
        } else {
          const i = r.tooth.indexOf(condId);
          if (i >= 0) r.tooth.splice(i, 1);
        }
      });
      setRecords(siguiente);
      void escribir(
        {
          tooth: fdi,
          surface: scope === "surface" ? (letter ?? null) : null,
          condition: condId,
          present: false,
        },
        () => setRecords(antes),
      );
    },
    [canEdit, escribir],
  );

  /**
   * 🔴 H-22 · «LIMPIAR DIENTE» ES **UNA** ESCRITURA, NO N.
   *
   * Antes mandaba una petición por hallazgo y le daba a todas el mismo
   * deshacer: repintar el diente entero. Un diente con cinco hallazgos
   * mandaba cinco peticiones y, si fallaba la tercera, volvían a pintarse
   * los cinco — incluidos los dos que las peticiones 1 y 2 sí habían
   * borrado en Postgres. La pantalla quedaba enseñando hallazgos que ya no
   * existían, justo lo contrario de lo que promete la cabecera de este
   * archivo, y solo se arreglaba recargando (cosa que nadie sabía).
   *
   * Ahora es un POST que borra el diente entero en una sola sentencia. Los
   * dos únicos resultados posibles son "se limpió" y "no se limpió nada", y
   * el deshacer de restaurar el diente entero por fin dice la verdad.
   *
   * 🔴 Y LIMPIA TAMBIÉN LA NOTA (H-21). La nota vive en la misma tabla con
   * la key reservada "__nota__", así que entra en el mismo borrado. Antes
   * se quedaba huérfana: un diente sin un solo hallazgo y con la nota de lo
   * que ya no está.
   */
  const limpiarDiente = useCallback(
    (fdi: number) => {
      if (!canEdit) return;
      const antes = recordsRef.current;
      const rec = antes[fdi];
      if (!rec) return;
      setRecords(
        clonar(antes, fdi, (r) => {
          r.tooth = [];
          r.surfaces = {};
          r.note = "";
        }),
      );
      void escribir(
        { tooth: fdi },
        () => setRecords(antes),
        { method: "POST", queFalló: "No se pudo limpiar el diente." },
      );
    },
    [canEdit, escribir],
  );

  /**
   * 🔴 H-18 · MIRAR UNA NOTA NO ES ESCRIBIRLA — el segundo cinturón.
   *
   * El primero está en el panel (DetailPanel: el `onBlur` no dispara si el
   * texto no cambió). Éste es el de aquí, y hacen falta los dos: el panel
   * puede volver a cambiar, o alguien puede llamar a `anotar` desde otro
   * sitio, y esta función es por donde pasa TODA nota que sale a la red.
   *
   * Si la nota no cambió, no se manda nada. La petición reescribiría
   * `recordedById` y `recordedAt` en el servidor, y la nota que escribió el
   * alumno pasaría a figurar como del docente que la abrió para leerla.
   */
  const anotar = useCallback(
    async (fdi: number, texto: string) => {
      if (!canEdit) return;
      const antes = recordsRef.current;
      if ((antes[fdi]?.note ?? "") === texto) return;
      setRecords(clonar(antes, fdi, (r) => {
        r.note = texto;
      }));
      setGuardando((n) => n + 1);
      try {
        // La nota va por PATCH y no por PUT: se guarda con una key
        // RESERVADA que el saneo del PUT rechaza a propósito, para que el
        // pincel no pueda pisarla ni borrarla.
        await eduRequest(`/api/instituto/pacientes/${patientId}/odontograma`, {
          method: "PATCH",
          body: { tooth: fdi, notes: texto },
        });
        setError(null);
      } catch (err) {
        setRecords(antes);
        setError(err instanceof Error ? err.message : "No se pudo guardar la nota.");
      } finally {
        setGuardando((n) => n - 1);
      }
    },
    [canEdit, patientId],
  );

  const pickBrush = useCallback((id: string) => {
    setEraser(false);
    setBrush((b) => (b === id ? null : id));
  }, []);
  const pickEraser = useCallback(() => {
    setBrush(null);
    setEraser((e) => !e);
  }, []);

  const activo = brush ? COND_BY_ID[brush] : null;

  return (
    <div className="edu-odo">
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {!canEdit && (
        <p className="edu-note">
          Estás viendo el odontograma en solo lectura. Para marcar hallazgos, quitarlos o escribir
          la nota de un diente hace falta el permiso <code>odontograma.edit</code>.
        </p>
      )}

      <div className="edu-toolbar">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-odo-denticion">
            Dentición
          </label>
          <select
            id="edu-odo-denticion"
            className="edu-input edu-input--sm"
            value={dentition}
            onChange={(e) => setDentition(e.target.value as Dentition)}
          >
            <option value="permanent">Permanente</option>
            <option value="mixed">Mixta</option>
            <option value="primary">Temporal</option>
          </select>
          {/* Se DICE por qué abrió así, y no se deja adivinar: quien ve
              cuadrantes 5-8 sin explicación piensa que la pantalla se
              equivocó de paciente. */}
          {esInfantil && (
            <span className="edu-field__hint">
              Este paciente está marcado como de dentición temporal, así que abre en los
              cuadrantes 5-8. Puedes cambiarlo aquí.
            </span>
          )}
        </div>
        <div className="edu-field">
          <span className="edu-field__label">Marcado</span>
          <span className="edu-kv__v">
            {resumen.teeth} {resumen.teeth === 1 ? "diente" : "dientes"} · {resumen.findings}{" "}
            {resumen.findings === 1 ? "hallazgo" : "hallazgos"}
            {resumen.notes > 0 ? ` · ${resumen.notes} con nota` : ""}
          </span>
        </div>
      </div>

      <p className="edu-odo__saving">
        {guardando > 0
          ? "Guardando…"
          : activo
            ? `${activo.es} — toca la cara o el diente.`
            : eraser
              ? "Goma — toca lo que quieras quitar."
              : canEdit
                ? "Elige un hallazgo de la paleta, o toca un diente para ver su detalle."
                : "Toca un diente para ver su detalle."}
      </p>

      {/* Los <pattern> del SVG (punteados, tramas) viven UNA sola vez para
          todo el dibujo, y fuera del contenedor que se desplaza: es un svg
          de 0×0 con position:absolute y ahí dentro se posicionaría contra un
          bloque que no es el suyo. */}
      <OdoDefs />

      <div className="edu-odo__lienzo">
        <div className="odo-app">
          <Odontogram
            dentition={dentition}
            lang="es"
            numbering="fdi"
            records={records}
            brush={canEdit ? brush : null}
            eraser={canEdit && eraser}
            selected={selected}
            onApply={apply}
            onSelect={setSelected}
          />
          <Legend lang="es" />
        </div>
      </div>

      {canEdit && (
        <div className="odo-app">
          <Palette
            lang="es"
            brush={brush}
            eraser={eraser}
            onPick={pickBrush}
            onEraser={pickEraser}
          />
        </div>
      )}

      {selected != null && (
        <div className="odo-app">
          <DetailPanel
            fdi={selected}
            lang="es"
            numbering="fdi"
            record={records[selected] || EMPTY_RECORD}
            brush={canEdit ? brush : null}
            eraser={canEdit && eraser}
            onApply={apply}
            onClose={() => setSelected(null)}
            onClearTooth={() => limpiarDiente(selected)}
            onNote={(txt: string) => void anotar(selected, txt)}
            onRemove={quitar}
            onPick={pickBrush}
            // H-21 + N-14: los CINCO controles de escritura del panel se
            // apagan CON el motivo escrito debajo, en vez de quedarse
            // pintados sin hacer nada. Los tres del hallazgo original (la ×
            // de cada hallazgo, «Limpiar diente» y la nota) y los dos que
            // se quedaron fuera y encontró N-14: la rejilla de caras y la
            // mini-paleta. El número va escrito porque el panel dice «los
            // tres controles» en su propio comentario y ya no eran tres.
            canEdit={canEdit}
            disabledReason={SIN_PERMISO}
          />
        </div>
      )}

      <HistorialDeHallazgos entries={historial} truncado={historialTruncado} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// QUIÉN MARCÓ QUÉ — Y QUIÉN LO QUITÓ.
//
// El dibujo enseña el ESTADO; esta lista enseña la HISTORIA, que es lo que
// un expediente tiene que poder contestar. Desde la Ola B enseña las dos
// caras: hasta ahora un hallazgo quitado desaparecía de la tabla y de aquí,
// así que la pregunta "¿quién pasó la goma sobre lo que yo marqué?" no
// tenía dónde contestarse.
//
// ⚠️ HASTA DÓNDE LLEGA, DICHO AQUÍ PARA QUE NADIE LO DESCUBRA SOLO (N-3):
// esta lista sale de las MISMAS filas que el dibujo, y hay UNA fila por
// hallazgo, no una por movimiento. De un hallazgo que se quitó y se volvió
// a marcar queda quién lo quitó (`deletedById` sobrevive al revivir) pero
// no cuándo, ni la cadena si pasó más de una vez. La secuencia completa
// pide el índice único parcial de la Ola C — el SQL exacto está en la
// cabecera de lib/edu/odontograma.ts.
//
// 🔴 Y YA NO CORTA EN SILENCIO (S-12). Cortaba a 40 filas sin decir una
// palabra: un odontograma con 41 movimientos y uno con 400 se veían
// idénticos, y el que buscaba el suyo concluía que nunca existió. Ahora se
// pintan 40 y hay un botón que enseña el resto, con el número escrito.
// ═══════════════════════════════════════════════════════════════════════

/** Cuántos movimientos se pintan antes de pedir «ver todo». */
const HISTORIAL_PRIMERAS = 40;

function HistorialDeHallazgos({
  entries,
  truncado,
}: {
  entries: EduOdontogramEntryRow[];
  truncado: boolean;
}) {
  const router = useRouter();
  const [actualizando, startNav] = useTransition();
  const [verTodo, setVerTodo] = useState(false);

  // La ÚLTIMA ACCIÓN de cada fila: la fecha en que se quitó si se quitó, y
  // si no la del marcaje. Sin esto, un hallazgo marcado en enero y quitado
  // hoy saldría al final de la lista, que es donde nadie lo busca.
  const historial = useMemo(
    () =>
      // Una COPIA: `sort` muta, y mutar el array del render reordenaría
      // también el que alimenta el dibujo.
      [...entries].sort((a, b) =>
        (b.deletedAt ?? b.recordedAt).localeCompare(a.deletedAt ?? a.recordedAt),
      ),
    [entries],
  );

  if (historial.length === 0) return null;

  const visibles = verTodo ? historial : historial.slice(0, HISTORIAL_PRIMERAS);
  const ocultas = historial.length - visibles.length;
  const bajas = historial.filter((e) => e.deletedAt !== null).length;
  // 🔴 N-3 · vivo pero con `deletedById`: se quitó y se volvió a marcar.
  // Las dos columnas ya no van siempre juntas (ver toRow en
  // lib/edu/odontograma.ts) y ESA es la combinación que lo dice.
  const revividos = historial.filter((e) => e.deletedAt === null && e.deletedById !== null).length;

  return (
    <section className="edu-section">
      <div className="edu-section__head">
        <h2 className="edu-section__title">Quién marcó qué</h2>
        <span className="edu-count">{historial.length}</span>
      </div>
      {/* Honestidad, no adorno: los hallazgos se guardan de uno en uno y sin
          recargar (marcar y esperar medio segundo por diente es
          insoportable), así que esta lista es la foto de cuando se abrió la
          pantalla. El CONTADOR de arriba sí va en vivo. */}
      {/* 🔴 N-3 · EL RÓTULO DICE EXACTAMENTE LO QUE HAY, NI UNA PALABRA MÁS.
          Prometía "constancia de quién lo quitó" a secas. Es verdad para un
          hallazgo retirado y también, desde N-3, para uno que se quitó y se
          volvió a marcar (revivir conserva `deletedById`) — pero de ése ya
          no queda la FECHA, ni la cadena entera si pasó más de una vez:
          una fila por hallazgo solo puede contar un movimiento. El arreglo
          completo pide el índice único parcial, y eso es un DROP INDEX:
          está escrito con su SQL exacto en la cabecera de lib/edu/odontograma.ts,
          para la Ola C. */}
      <p className="edu-note">
        Así estaba al abrir la pantalla. Lo que marques ahora se guarda al
        instante, pero aparece en esta lista al actualizar.
        {bajas > 0
          ? ` Incluye ${bajas} ${bajas === 1 ? "hallazgo retirado" : "hallazgos retirados"}: quitar no borra, deja escrito quién lo quitó y cuándo.`
          : ""}
        {revividos > 0
          ? ` De los que siguen marcados, ${revividos === 1 ? "uno se había retirado antes" : `${revividos} se habían retirado antes`}: se conserva quién pasó la goma, no la fecha en que lo hizo.`
          : ""}
      </p>
      {truncado && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">
              Este odontograma tiene más historia de la que cabe en una consulta.
            </p>
            <p className="edu-banner__detail">
              Se trajeron los movimientos más recientes y todos los hallazgos que siguen
              marcados: el dibujo está completo, la lista de abajo no. Se avisa porque una
              historia que se corta en silencio se lee como una historia que no existió.
            </p>
          </div>
        </div>
      )}
      <p>
        <button
          type="button"
          className="edu-btn edu-btn--ghost edu-btn--sm"
          onClick={() => startNav(() => router.refresh())}
          disabled={actualizando}
        >
          {actualizando ? "Actualizando…" : "Actualizar"}
        </button>
      </p>
      <ul className="edu-chiplist">
        {visibles.map((e) => (
          <li key={e.id} className={`edu-assign ${e.deletedAt ? "edu-assign--baja" : ""}`}>
            <span>
              <strong>Diente {e.tooth}</strong>
              {e.surface !== EDU_TOOTH_WHOLE ? ` · cara ${e.surface}` : ""} ·{" "}
              {e.condition === EDU_ODONTOGRAM_NOTE_KEY
                ? `nota: ${e.notes ?? ""}`
                : eduConditionLabel(e.condition)}{" "}
              · {e.recordedByName} · {e.recordedLabel}
              {/* DESDE CUÁNDO, y solo cuando difiere de la marca de hoy:
                  `recordedAt` se pisa en cada remarcado, así que en un
                  hallazgo reconfirmado las dos fechas cuentan cosas
                  distintas. Repetir la misma no aporta nada. */}
              {e.firstRecordedLabel !== e.recordedLabel
                ? ` · marcado por primera vez el ${e.firstRecordedLabel}`
                : ""}
            </span>
            {e.deletedAt ? (
              <span className="edu-tag edu-tag--muted">
                Retirado {e.deletedLabel}
                {e.deletedByName ? ` por ${e.deletedByName}` : ""}
              </span>
            ) : e.deletedById ? (
              /* 🔴 N-3 · Sigue marcado, pero alguien lo había quitado y se
                 volvió a marcar. Sin esta línea, revivir dejaba el rastro
                 en la base y en ninguna pantalla — que es lo mismo que no
                 dejarlo. No se dice CUÁNDO a propósito: esa fecha era
                 `deletedAt` y hay que soltarla para revivir la fila. */
              <span className="edu-tag edu-tag--muted">
                Se había retirado{e.deletedByName ? ` (${e.deletedByName})` : ""} y volvió a ponerse
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {ocultas > 0 && (
        <p>
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() => setVerTodo(true)}
          >
            Ver los {ocultas} movimientos restantes
          </button>
        </p>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Utilería local
// ═══════════════════════════════════════════════════════════════════════

/** Copia inmutable de records[fdi], aplica el cambio y poda las caras que
 *  quedaron vacías (una cara con [] pintaría un hueco marcado). */
function clonar(prev: Records, fdi: number, fn: (r: { surfaces: Record<string, string[]>; tooth: string[]; note?: string }) => void): Records {
  const rec = prev[fdi]
    ? (JSON.parse(JSON.stringify(prev[fdi])) as { surfaces: Record<string, string[]>; tooth: string[]; note?: string })
    : { surfaces: {}, tooth: [] };
  fn(rec);
  for (const k of Object.keys(rec.surfaces)) {
    if (!rec.surfaces[k] || rec.surfaces[k].length === 0) delete rec.surfaces[k];
  }
  return { ...prev, [fdi]: rec };
}

function alternar(arr: string[], id: string): void {
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(id);
}
