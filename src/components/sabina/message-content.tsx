import { Fragment } from "react";
import { parseSabinaMarkdown, tokenizeInline, type SabinaBlock, type SabinaParagraphTone } from "./sabina-core";
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
  if (block.kind === "bullets") {
    return (
      <ul className={`${styles.bullets} ${toneClass(block.tone)}`}>
        {block.items.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    );
  }
  return <p className={`${styles.paragraph} ${toneClass(block.tone)}`}>{renderInline(block.text)}</p>;
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
    return <Fragment key={i}>{tok.text}</Fragment>;
  });
}
