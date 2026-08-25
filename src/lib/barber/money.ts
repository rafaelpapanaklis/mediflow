/**
 * DaleControl BARBER — sumas de dinero SIN punto flotante (client-safe).
 *
 * Los precios son Decimal(10,2) en la base y al navegador viajan como
 * `number`. Sumarlos con `+` acumula error binario: 179.99 + 180 + 180 da
 * 539.9899999999999 y en pantalla se ve "$539.99" o "$539.9899999999999"
 * según quién formatee. No afecta el cobro (la caja trabaja en centavos y
 * Prisma.Decimal), pero sí lo que ve la gente.
 *
 * Aquí cada importe se pasa a centavos ENTEROS (exacto para dos decimales),
 * la suma se hace en enteros y se divide UNA sola vez al final. Sin
 * Prisma.Decimal a propósito: esto lo importan componentes "use client" y
 * decimal.js no tiene que viajar al navegador para sumar tres precios.
 *
 * Reutiliza moneyToCents / centsToNumber de memberships-core (punto único
 * de la conversión): acepta number, string ("179.99") y Prisma.Decimal
 * (vía su toString), y basura → 0, igual que hacía el `Number(x) || 0`.
 */
import { centsToNumber, moneyToCents } from "@/lib/barber/memberships-core";

type MoneyLike = number | string | { toString(): string } | null | undefined;

/** Un importe → centavos enteros. Prisma.Decimal entra por su toString. */
export function toCents(value: MoneyLike): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number" || typeof value === "string") return moneyToCents(value);
  return moneyToCents(String(value));
}

/** Suma exacta de importes: enteros de centavos, un solo redondeo al final. */
export function sumMoney(values: readonly MoneyLike[]): number {
  let cents = 0;
  for (let i = 0; i < values.length; i++) cents += toCents(values[i]);
  return centsToNumber(cents);
}

/** sumMoney sobre una propiedad: `sumMoneyBy(services, (s) => s.price)`. */
export function sumMoneyBy<T>(items: readonly T[], pick: (item: T) => MoneyLike): number {
  let cents = 0;
  for (let i = 0; i < items.length; i++) cents += toCents(pick(items[i]));
  return centsToNumber(cents);
}
