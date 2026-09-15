import { Fragment } from "react";
import { parseSabinaMarkdown, tokenizeInline, type SabinaBlock, type SabinaParagraphTone } from "./sabina-core";
import { columnasNumericas, filasConMonto } from "./sabina-listas";
import styles from "./sabina-widgets.module.css";

/**
 * Pinta la respuesta de Sabina con el markdown ligero de `sabina-core`.
 *
 * Es lo que cumple la regla 6 del contrato ("separa el hecho de la
 * opinión... que la pantalla lo respete visualmente"): un párrafo que el
 * texto marca como sugerencia se pinta con su propio borde y color; uno que
 * arranca citando un dato medido, con otro. Todo lo demás es un párrafo
 * normal — la pantalla nunca INVENTA qué es hecho y qué es opinión, solo
 * responde al vocabulario que ya trae el texto.
 */
export function SabinaMessageContent({ content }: { content: string }) {
  const blocks = parseSabinaMarkdown(content);
  if (!blocks.length) return null;

  return (
    <div className={styles.content}>
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: SabinaBlock }) {
  if (block.kind === "heading") {
    const Tag = block.level === 2 ? "h3" : "h4";
    return <Tag className={styles.heading}>{renderInline(block.text)}</Tag>;
  }
  if (block.kind === "table") return <Table header={block.header} rows={block.rows} />;
  if (block.kind === "bullets") {
    const List = block.ordered ? "ol" : "ul";
    const filas = filasConMonto(block.items);
    if (filas) {
      // «Ana López — $1,500» en cada línea: la cantidad va a su propia columna,
      // alineada a la derecha, para que la lista se lea en diagonal. Una fila por
      // renglón cabe igual a 360 px que en el escritorio (el nombre se parte, la
      // cantidad no).
      return (
        <List className={`${styles.rows} ${toneClass(block.tone)}`}>
          {filas.map((f, i) => (
            <li key={i} className={styles.row}>
              <span className={styles.rowLabel}>
                {block.ordered && <span className={styles.rowIndex}>{i + 1}.</span>}
                {renderInline(f.etiqueta)}
                {f.detalle && <span className={styles.rowDetail}> {renderInline(f.detalle)}</span>}
              </span>
              <span className={styles.rowAmount}>{f.monto}</span>
            </li>
          ))}
        </List>
      );
    }
    return (
      <List className={`${styles.bullets} ${toneClass(block.tone)}`}>
        {block.items.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </List>
    );
  }
  return <p className={`${styles.paragraph} ${toneClass(block.tone)}`}>{renderInline(block.text)}</p>;
}

/**
 * El prompt le pide a Sabina que no haga tablas; si aun así escribe una, no se
 * enseña como texto con barras. En el escritorio es una tabla; en el teléfono
 * (≤ 480 px, ver el CSS) cada fila se vuelve una ficha con «columna: valor»,
 * porque una tabla de cinco columnas en una burbuja de 300 px no se lee.
 */
function Table({ header, rows }: { header: string[]; rows: string[][] }) {
  const numericas = columnasNumericas(rows, header.length);
  const etiqueta = (h: string) => h.replace(/[*`]/g, "");
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {header.map((h, j) => (
              <th key={j} className={numericas[j] ? styles.num : undefined}>
                {renderInline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {header.map((h, j) => (
                <td key={j} data-label={etiqueta(h)} className={numericas[j] ? styles.num : undefined}>
                  {/* Un solo hijo: en el teléfono la celda es flex, y «**Ana** López» suelto se repartiría a lo ancho. */}
                  <span>{renderInline(r[j] ?? "")}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function toneClass(tone: SabinaParagraphTone): string {
  if (tone === "opinion") return styles.toneOpinion;
  if (tone === "fact") return styles.toneFact;
  return "";
}

function renderInline(text: string) {
  return tokenizeInline(text).map((tok, i) => {
    if (tok.bold) return <strong key={i}>{tok.text}</strong>;
    if (tok.italic) return <em key={i}>{tok.text}</em>;
    if (tok.code) return <code key={i}>{tok.text}</code>;
    if (tok.href) {
      return (
        <a key={i} href={tok.href} target="_blank" rel="noopener noreferrer" className="underline font-semibold">
          {tok.text}
        </a>
      );
    }
    return <Fragment key={i}>{tok.text}</Fragment>;
  });
}
