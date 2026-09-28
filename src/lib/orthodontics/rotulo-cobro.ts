// El rótulo del botón de cobro en la lista de mensualidades de Caja (ws1-t5).
// Regla pura. Lo prueba __tests__/rotulo-cobro.test.ts.
//
// Por qué existe: cuando varios hermanos comparten responsable de pago, la
// lista los agrupa y ofrece cobrarlos seguidos. El botón decía «Cobrar a los
// dos» escrito fijo: con tres hermanos seguía diciendo «a los dos», y quien
// cobraba no sabía que detrás venía una tercera factura.

const EN_LETRA: Record<number, string> = {
  2: "dos",
  3: "tres",
  4: "cuatro",
  5: "cinco",
};

/**
 * Cuántas mensualidades cobra el botón → lo que dice.
 * 1 (o menos) → «Cobrar»; 2 a 5 → en letra; de 6 en adelante, en cifra.
 */
export function rotuloCobrar(cuantas: number): string {
  const n = Number.isFinite(cuantas) ? Math.floor(cuantas) : 0;
  if (n <= 1) return "Cobrar";
  return `Cobrar a los ${EN_LETRA[n] ?? String(n)}`;
}

/** «Ana y Luis» · «Ana, Luis y Sofía»: la lista de hermanos, como se dice. */
export function listaDeNombres(nombres: readonly string[]): string {
  const limpios = nombres.map((n) => n.trim()).filter(Boolean);
  if (limpios.length <= 1) return limpios[0] ?? "";
  return `${limpios.slice(0, -1).join(", ")} y ${limpios[limpios.length - 1]}`;
}
