// Ortodoncia — ws1-t4 #81: el bracket repuesto que la doctora anota al firmar la
// hoja cuenta contra las reposiciones incluidas del caso. Puro.

/**
 * El aviso que la hoja firmada le da a quien cobra. `repuestos` = brackets
 * repuestos en ESTA hoja; `incluidas` = cuántos cupieron en las incluidas.
 * Todos incluidos → «llevan N de las incluidas» (nada que cobrar). Si alguno
 * quedó fuera, se dice cuántos hay que cobrar. Ninguno repuesto → nada.
 */
export function avisoDeReposiciones(args: { repuestos: number; incluidas: number }): string | undefined {
  const repuestos = Math.max(0, Math.floor(args.repuestos));
  const incluidas = Math.max(0, Math.min(repuestos, Math.floor(args.incluidas)));
  if (repuestos === 0) return undefined;
  const aCobrar = repuestos - incluidas;
  const plural = (n: number) => (n === 1 ? "1 bracket repuesto" : `${n} brackets repuestos`);
  // «ya se descontó»: si además se registra «Cobrar extra» como reposición incluida, el cupo bajaría dos veces.
  if (aCobrar === 0) return `${plural(repuestos)} en este control: cuenta${repuestos === 1 ? "" : "n"} dentro de las reposiciones incluidas del caso (ya se descontó del cupo; no la registres otra vez como extra incluido).`;
  return `${plural(repuestos)} en este control: ${incluidas > 0 ? `${incluidas} dentro de las incluidas y ` : "ya no quedan reposiciones incluidas: "}${aCobrar === 1 ? "1 hay que cobrarlo" : `${aCobrar} hay que cobrarlos`} con «Cobrar extra» (Cobro del tratamiento).`;
}
