"use client";
/* ============================================================
   <Txt> y <Foto>: los dos envoltorios que hacen editable una
   plantilla, y lo ÚNICO de la edición que entra en el bundle de la
   página pública.

   Sin proveedor —que es el caso de /[slug], el sitio que ven los
   pacientes— los dos son un passthrough exacto:

     <Txt as="h2" style={x} campo="…" valor={t} porDefecto="…" />
        →  <h2 style="…">lo que sea que pinta hoy</h2>

     <Foto slot="portada" url={u}>{u => <img src={u}/>}</Foto>
        →  <img src="…">

   Ni un nodo de más, ni un atributo de más. Eso es lo que prueba el
   assert de HTML byte-idéntico de __tests__/instrumentacion.test.tsx,
   y es la única señal que llega ANTES del deploy si instrumentar una
   plantilla cambió por accidente lo que ve un paciente.

   El runtime de edición (_shared/edit-runtime.tsx: el textarea, el
   overlay de la foto, los postMessage) NO se importa desde aquí. Lo
   carga LivePreviewBridge con import() dinámico y solo bajo ?edit=1,
   así que su chunk jamás toca /[slug].

   ── CÓMO SE INSTRUMENTA UN TEXTO ──────────────────────────────
   Los atributos del elemento se escriben en el MISMO ORDEN que
   tenían en la plantilla original (React serializa los atributos en
   el orden de las props). `style` primero si así estaba antes.
   ============================================================ */
import { createContext, useContext, type CSSProperties, type ReactNode } from "react";

/* ------------------------------------------------------------------
   Lo que el runtime le presta al contexto. Sin runtime, es null.
   ------------------------------------------------------------------ */

export interface TextoParaEditar {
  /** Dirección del campo (@/lib/landing-address). */
  campo: string;
  /** Nombre humano, para el aviso del editor. */
  etiqueta: string;
  /** Lo que se pinta ahora mismo. null = no hay nada escrito. */
  texto: string | null;
  /** El literal de la plantilla. Es lo que se ve si la clínica no escribió nada. */
  porDefecto: string | null;
  /** Lo que se ve atenuado cuando no hay ni valor ni texto por defecto. */
  placeholder: string;
  /** El valor real guardado (sin el texto por defecto de la plantilla). */
  valor: string | null;
  Tag: any;
  atributos: Record<string, any>;
  maxLen: number;
  /** true = una sola línea; Enter confirma en vez de hacer salto. */
  linea: boolean;
  /** No se puede dejar vacío (el nombre de un servicio, p. ej.). */
  requerido: boolean;
  prefijo?: string;
  sufijo?: string;
}

export interface FotoParaEditar {
  slot: string;
  etiqueta: string;
  ayuda?: string;
  /** Estilos del envoltorio que SOLO existe en modo edición. */
  caja?: CSSProperties;
  /** Esquina donde se ancla la botonera dentro de la caja. */
  zona: "completa" | "izquierda" | "derecha";
  /** Estilos del hueco punteado que se pinta, EN EDICIÓN, si no hay foto. */
  vacio?: CSSProperties;
  /** La url publicada. El runtime la sustituye por la vista previa local. */
  url: string | null;
  pintar: (url: string | null) => ReactNode;
}

export interface EditApi {
  texto(t: TextoParaEditar): ReactNode;
  foto(f: FotoParaEditar): ReactNode;
}

const EditCtx = createContext<EditApi | null>(null);

/** Lo usa el runtime para colgarse; nadie más. */
export const EditProviderRaw = EditCtx.Provider;

/** ¿Estamos dentro del lienzo del editor? Las plantillas casi nunca preguntan. */
export function useEnEdicion(): boolean {
  return useContext(EditCtx) !== null;
}

/* ------------------------------------------------------------------
   <Txt>
   ------------------------------------------------------------------ */

export interface TxtProps {
  /**
   * Dirección del campo, o null = "este texto NO se edita in situ".
   *
   * null es una declaración, no un olvido: hay sitios donde la cadena se
   * CONSTRUYE (una calificación compuesta, un eslogan partido por la primera
   * coma con un emoji pegado). Instrumentarlos como texto plano guardaría la
   * cadena ya montada. Se marcan aquí y se arreglan cambiando la plantilla,
   * no el editor.
   */
  campo: string | null;
  /** Lo que guardó la clínica. Vacío o null = no ha escrito nada. */
  valor?: string | null;
  /** El texto que pinta la plantilla si no hay valor. null = no pintar nada. */
  porDefecto?: string | null;
  /** Nombre humano del campo, para el editor. */
  etiqueta?: string;
  /** Qué elemento se pinta. Por defecto <span>. */
  as?: any;
  prefijo?: string;
  sufijo?: string;
  maxLen?: number;
  linea?: boolean;
  requerido?: boolean;
  /** Cualquier otra prop se pasa tal cual al elemento (style, className, id…). */
  [attr: string]: any;
}

export function Txt(props: TxtProps) {
  const api = useContext(EditCtx);
  const {
    campo, valor, porDefecto, etiqueta, as, prefijo, sufijo,
    maxLen, linea, requerido, ...atributos
  } = props;

  const guardado = typeof valor === "string" && valor.trim() ? valor : null;
  const texto = guardado ?? (porDefecto || null);
  const Tag = as ?? "span";

  if (!api || campo === null) {
    // Página pública: exactamente lo que había antes de instrumentar.
    // Las tres ramas existen para no meter un hijo `undefined` donde antes
    // había uno solo: React separa los nodos de texto adyacentes con marcas
    // de hidratación, y eso ya sería un DOM distinto.
    if (texto === null) return null;
    if (prefijo !== undefined && sufijo !== undefined) return <Tag {...atributos}>{prefijo}{texto}{sufijo}</Tag>;
    if (prefijo !== undefined) return <Tag {...atributos}>{prefijo}{texto}</Tag>;
    if (sufijo !== undefined) return <Tag {...atributos}>{texto}{sufijo}</Tag>;
    return <Tag {...atributos}>{texto}</Tag>;
  }

  return (
    <>
      {api.texto({
        campo,
        etiqueta: etiqueta ?? campo,
        texto,
        porDefecto: porDefecto || null,
        placeholder: etiqueta || "Escribe aquí",
        valor: guardado,
        Tag,
        atributos,
        maxLen: maxLen ?? 300,
        linea: linea ?? false,
        requerido: requerido ?? false,
        prefijo,
        sufijo,
      })}
    </>
  );
}

/* ------------------------------------------------------------------
   <Foto>
   ------------------------------------------------------------------ */

export interface FotoProps {
  /** Id de ranura del manifiesto ("portada", "caso1_antes"…). */
  slot: string;
  /** La url que la plantilla usaría hoy (photoOf con sus respaldos). */
  url: string | null;
  etiqueta?: string;
  ayuda?: string;
  /**
   * Estilos del envoltorio que se añade SOLO en modo edición.
   *
   * Es una decisión por sitio, no un default: la caja tiene que caer
   * donde no mueva nada. En un hueco normal basta `{position:"relative"}`;
   * sobre el fondo de un hero que ya es `position:absolute; inset:0`,
   * la caja copia esa misma geometría. Sin `caja`, no se envuelve nada y
   * la botonera se ancla al ancestro posicionado más cercano (para
   * meter dos ranuras en un mismo hueco, como el antes/después).
   */
  caja?: CSSProperties;
  zona?: "completa" | "izquierda" | "derecha";
  /**
   * Estilos del hueco punteado que se pinta EN EDICIÓN cuando no hay foto.
   *
   * Sirve para que una ranura vacía tenga dónde soltar el archivo: sin foto,
   * la plantilla no pinta nada y la caja se queda con 0 px de alto. Se le da
   * normalmente un `aspectRatio`. En la página pública no existe.
   */
  vacio?: CSSProperties;
  /** Pinta la foto. Recibe la url viva: la local mientras sube, la real después. */
  children: (url: string | null) => ReactNode;
}

export function Foto({ slot, url, etiqueta, ayuda, caja, zona, vacio, children }: FotoProps) {
  const api = useContext(EditCtx);
  if (!api) return <>{children(url)}</>;
  return (
    <>
      {api.foto({
        slot,
        etiqueta: etiqueta ?? slot,
        ayuda,
        caja,
        zona: zona ?? "completa",
        vacio,
        url,
        pintar: children,
      })}
    </>
  );
}
