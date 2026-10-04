// Qué le falta al paciente para poder firmar la carta (auditoría de uso, C-79).
//
// El botón «Firmar consentimiento» de la liga pública se quedaba gris sin decir por qué. Ahora, mientras esté
// apagado, se dice debajo qué falta. Y el renglón «Firmado … el 03/10/2026, 11:05 p.m..» llevaba doble punto:
// la hora en español ya termina en «p.m.». PURO.

export function queFaltaParaFirmar(e: { aceptado: boolean; conFirma: boolean; conHuecos: boolean; huecosConfirmados: boolean }): string | null {
  const falta: string[] = [];
  if (!e.conFirma) falta.push("dibujar tu firma en el recuadro");
  if (!e.aceptado) falta.push("marcar que leíste y aceptas la carta");
  if (e.conHuecos && !e.huecosConfirmados) falta.push("confirmar que firmas la carta con los espacios sin llenar");
  if (falta.length === 0) return null;
  if (falta.length === 1) return `Para firmar, falta ${falta[0]}.`;
  return `Para firmar, falta ${falta.slice(0, -1).join(", ")} y ${falta[falta.length - 1]}.`;
}

/** Cierra la frase con punto sin duplicarlo («… 11:05 p.m.» no lleva otro). */
export function conPuntoFinal(texto: string): string {
  const t = texto.trimEnd();
  return t.endsWith(".") ? t : `${t}.`;
}
