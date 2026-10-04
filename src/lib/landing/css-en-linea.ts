// N-60 (ws1-t8, segunda auditoría de uso): las plantillas de la página web
// metían su CSS como hijo de texto de <style> (`<style>{`…`}</style>`). En el
// render del servidor React escapa las comillas («'» → «&#x27;»): el
// `@import url('https://fonts…')` llegaba roto («Refused to apply style from
// …/&#x27;https://fonts…»), el navegador no cargaba las fuentes y React se
// quejaba de que el texto no coincidía al hidratar (errores #425 y #423).
// Con dangerouslySetInnerHTML el CSS va tal cual. Como lleva colores de la
// clínica interpolados, se le quita cualquier «<» para que nada pueda cerrar
// la etiqueta <style> (los colores ya se validan como #rrggbb al guardar).

export function cssEnLinea(css: string): { __html: string } {
  return { __html: css.replace(/</g, "") };
}
