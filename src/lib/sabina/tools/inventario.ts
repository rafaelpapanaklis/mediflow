/**
 * `inventario` — existencias, stock bajo y agotados, lotes por caducar y
 * caducados, valor del inventario, últimas compras y un resumen. SOLO LEE.
 *
 * ── UNA HERRAMIENTA, SEIS VISTAS ───────────────────────────────────────
 * Igual que `caja`: seis herramientas serían seis esquemas pagados en CADA
 * llamada al modelo; aquí es una con un parámetro `vista`.
 *
 * ── DE DÓNDE SALE CADA COSA (nada reescrito) ───────────────────────────
 *  · Los artículos: `listarInventario` de @/lib/inventory/costo.server — la
 *    misma lectura que hace la página y GET /api/inventory, con `ctx.db`.
 *  · Los lotes por caducar y caducados: `getExpiryAlerts` de
 *    @/lib/inventory/lots.server, la de GET /api/inventory/alerts (y la que
 *    usa «Hoy» del admin). El corte «por caducar» son los días de aviso de la
 *    clínica (`getAlertDaysAhead`, 30 por defecto) y se cuenta por DÍA de
 *    calendario en la zona de la clínica.
 *  · Agotado y bajo: `contarExistenciasVigentes` de
 *    @/lib/inventory/avisos-existencias, la que cuenta el aviso de «Hoy».
 *  · Las compras: `listarCompras` de @/lib/inventory/compras.server, la de
 *    GET /api/inventory/purchases; el total de cada una es `montoTotalCompra`.
 *  · El valor: `sumarValorInventario` (Σ costo unitario × existencias).
 *
 * ── LO QUE CUENTA COMO «EXISTENCIAS» ───────────────────────────────────
 * Lo VIGENTE, no lo guardado: a la cantidad del artículo se le resta lo que hay
 * en lotes caducados (decisión de Rafael, H17), exactamente como lo hace la
 * pantalla de Inventario. Un artículo con 10 guardadas y 4 caducadas tiene 6.
 * La cantidad caducada viaja aparte para poder decirlo.
 *
 * ── EL PERMISO ─────────────────────────────────────────────────────────
 * `inventory.view`, el de la página y de las tres rutas de las que sale cada
 * cifra. Todo lo de esta herramienta cuelga de esa misma llave.
 */

import { z } from "zod";
import { getExpiryAlerts, getAlertDaysAhead, type AvisoLote } from "@/lib/inventory/lots.server";
import { listarInventario, type ItemConCosto } from "@/lib/inventory/costo.server";
import { listarCompras } from "@/lib/inventory/compras.server";
import { contarExistenciasVigentes } from "@/lib/inventory/avisos-existencias";
import { idsSinContar } from "@/lib/inventory/sin-contar.server";
import { sumarValorInventario } from "@/lib/inventory/costo-core";
import { diasParaCaducar, estadoDeCaducidad } from "@/lib/inventory/lots-core";
import { diaDeCompra, fechaCalendarioDe, hoyEnZona } from "@/lib/inventory/fecha-calendario";
import { money } from "@/lib/caja";
import { dbDe, definirHerramienta, fraseRecorte, lineasDeLista, pesos, pesosDeLista, plural, recortar, type Lista } from "./base";
import type { SabinaCtx } from "../tipos";

export const ENLACE_INVENTARIO = "/dashboard/inventory";

const VISTAS = ["resumen", "articulo", "stock_bajo", "por_caducar", "valor", "compras"] as const;
export type VistaInventario = (typeof VISTAS)[number];

const parametros = z.object({
  vista: z
    .enum(VISTAS)
    .optional()
    .describe(
      "resumen (default) | articulo (existencias de uno; pasa `articulo`) | stock_bajo (bajos y agotados) | " +
        "por_caducar (lotes por caducar y caducados) | valor (valor total) | compras (las últimas)",
    ),
  articulo: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Nombre (o parte del nombre) del artículo, para la vista `articulo`"),
});

export type ParamsInventario = z.infer<typeof parametros>;

/** `sin_contar` (12f): en cero y NUNCA contado — no es «agotado», no se sabe cuánto hay. */
export type EstadoExistencias = "agotado" | "bajo" | "disponible" | "sin_contar";

export interface ArticuloFila {
  nombre: string;
  categoria: string;
  /** Lo VIGENTE: lo guardado menos lo que hay en lotes caducados. */
  existencias: number;
  minimo: number;
  unidad: string;
  estado: EstadoExistencias;
  /** Unidades que están en lotes caducados y NO cuentan como existencias. */
  caducadas: number;
  costoUnitario: number;
}

export interface LoteFila {
  articulo: string;
  lote: string | null;
  /** Día de caducidad, YYYY-MM-DD. */
  caduca: string;
  /** 0 = caduca hoy; negativo = ya pasó. */
  dias: number | null;
  restante: number;
  unidad: string;
  /** Solo en los lotes de UN artículo: el estado que le da la pantalla. */
  estado?: "ok" | "por_caducar" | "caducado";
}

export interface CompraFila {
  /** Día de la compra en la zona de la clínica. */
  fecha: string | null;
  proveedor: string | null;
  folio: string | null;
  total: number;
  articulos: number;
}

export interface DatosInventario {
  vista: VistaInventario;
  enlace: string;
  /** El inventario no tiene ni un artículo capturado. */
  sinArticulos: boolean;
  /** Foto general (todas las vistas la traen: es barata y orienta). */
  resumen: {
    articulos: number;
    unidades: number;
    agotados: number;
    bajos: number;
    /** Artículos en cero que nunca se contaron (no entran en `agotados`). */
    sinContar: number;
    lotesPorCaducar: number;
    lotesCaducados: number;
    valorTotal: number;
  } | null;
  diasAviso: number | null;
  /** `articulo`: lo que coincide con el nombre pedido. */
  buscado: string | null;
  coincidencias: Lista<ArticuloFila> | null;
  /** `articulo`: los lotes con saldo del artículo, solo si coincidió UNO. */
  lotesDelArticulo: LoteFila[] | null;
  agotados: Lista<ArticuloFila> | null;
  bajos: Lista<ArticuloFila> | null;
  porCaducar: Lista<LoteFila> | null;
  caducados: Lista<LoteFila> | null;
  valor: {
    total: number;
    unidades: number;
    /** Artículos con existencias y sin costo capturado: valen $0 en el total. */
    sinCosto: number;
    porCategoria: Array<{ categoria: string; valor: number }>;
  } | null;
  compras: Lista<CompraFila> | null;
}

/** Minúsculas y sin acentos, para que «resina» encuentre «Resína» y «Resina compuesta A2». */
function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function estadoDe(existencias: number, minimo: number): EstadoExistencias {
  if (existencias <= 0) return "agotado";
  if (existencias <= minimo) return "bajo";
  return "disponible";
}

function caducadoPorArticulo(caducados: AvisoLote[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of caducados) m.set(a.itemId, (m.get(a.itemId) ?? 0) + Math.max(0, a.remaining));
  return m;
}

function filaLote(a: AvisoLote, hoy: string): LoteFila {
  return {
    articulo: a.itemName,
    lote: a.lotNumber,
    caduca: fechaCalendarioDe(a.expiresAt) ?? a.expiresAt.slice(0, 10),
    dias: diasParaCaducar(new Date(a.expiresAt), hoy),
    restante: a.remaining,
    unidad: a.unit,
  };
}

export const inventario = definirHerramienta<ParamsInventario, DatosInventario>({
  nombre: "inventario",
  descripcion:
    "El inventario de la clínica, en seis vistas: existencias de un artículo (`articulo`), artículos con " +
    "stock bajo y agotados (`stock_bajo`), lotes por caducar y ya caducados (`por_caducar`), valor total " +
    "del inventario (`valor`), últimas compras con proveedor, fecha y total (`compras`) y un `resumen` " +
    "general. Úsala para «¿cuántas resinas me quedan?», «¿qué se me está acabando?», «¿qué caduca pronto?», " +
    "«¿cuánto vale mi inventario?», «¿qué compré últimamente?». Las existencias son las VIGENTES (sin lo " +
    "caducado), igual que la pantalla de Inventario. Solo consulta: no da de alta ni descuenta nada.",
  parametros,
  permiso: "inventory.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosInventario> {
    const db = dbDe(ctx) as any;
    const vista: VistaInventario = params.vista ?? (params.articulo ? "articulo" : "resumen");
    const hoy = hoyEnZona(ctx.timezone);

    const vacia: DatosInventario = {
      vista,
      enlace: ENLACE_INVENTARIO,
      sinArticulos: false,
      resumen: null,
      diasAviso: null,
      buscado: null,
      coincidencias: null,
      lotesDelArticulo: null,
      agotados: null,
      bajos: null,
      porCaducar: null,
      caducados: null,
      valor: null,
      compras: null,
    };

    // Las compras no necesitan ni los artículos ni los lotes.
    if (vista === "compras") {
      const compras = await listarCompras(ctx.clinicId, db);
      const filas: CompraFila[] = compras.map((c) => ({
        fecha: diaDeCompra(c.date, ctx.timezone),
        proveedor: c.providerName,
        folio: c.receiptRef,
        total: money(c.total),
        articulos: c.lines.length,
      }));
      // La pantalla lista las 50 últimas; a Sabina le tocan las 10 más recientes.
      return { ...vacia, compras: recortar(filas.slice(0, 10), filas.length) };
    }

    // Lectura base: artículos + lotes por caducar/caducados (2 tandas de pocas consultas).
    const [items, avisos]: [ItemConCosto[], { porCaducar: AvisoLote[]; caducado: AvisoLote[] }] = await Promise.all([
      listarInventario({ clinicId: ctx.clinicId }, db),
      getExpiryAlerts(ctx.clinicId, db),
    ]);

    const cad = caducadoPorArticulo(avisos.caducado);
    // 12f: la misma regla que la pantalla — en cero y sin historia no es «agotado».
    const sinContarIds = await idsSinContar(ctx.clinicId, items, db);
    const vigente = (i: ItemConCosto) => Math.max(0, i.quantity - Math.round(cad.get(i.id) ?? 0));
    const fila = (i: ItemConCosto): ArticuloFila => {
      const q = vigente(i);
      return {
        nombre: i.name,
        categoria: i.category,
        existencias: q,
        minimo: i.minQuantity,
        unidad: i.unit,
        estado: q <= 0 && sinContarIds.has(i.id) ? "sin_contar" : estadoDe(q, i.minQuantity),
        caducadas: Math.round(cad.get(i.id) ?? 0),
        costoUnitario: i.unitCost ?? 0,
      };
    };

    // Los conteos salen de la MISMA función que el aviso de «Hoy».
    const conteo = contarExistenciasVigentes(
      items.map((i) => ({ id: i.id, quantity: i.quantity, minQuantity: i.minQuantity })),
      avisos.caducado.map((a) => ({ itemId: a.itemId, remaining: a.remaining })),
      sinContarIds,
    );
    const valorTotal = money(sumarValorInventario(items.map((i) => ({ unitCost: i.unitCost ?? 0, quantity: vigente(i) }))));
    const unidades = items.reduce((s, i) => s + vigente(i), 0);

    const datos: DatosInventario = {
      ...vacia,
      sinArticulos: items.length === 0,
      resumen: {
        articulos: items.length,
        unidades,
        agotados: conteo.agotados,
        bajos: conteo.bajos,
        sinContar: conteo.sinContar ?? 0,
        lotesPorCaducar: avisos.porCaducar.length,
        lotesCaducados: avisos.caducado.length,
        valorTotal,
      },
    };

    if (vista === "resumen") {
      // Para la foto general también sirven los días de aviso y la última compra.
      datos.diasAviso = await getAlertDaysAhead(ctx.clinicId, db);
      const compras = await listarCompras(ctx.clinicId, db);
      datos.compras = recortar(
        compras.slice(0, 1).map((c) => ({
          fecha: diaDeCompra(c.date, ctx.timezone),
          proveedor: c.providerName,
          folio: c.receiptRef,
          total: money(c.total),
          articulos: c.lines.length,
        })),
        compras.length,
      );
      return datos;
    }

    if (vista === "stock_bajo") {
      const filas = items.map(fila);
      const agotados = filas.filter((f) => f.estado === "agotado").sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
      // Los bajos, del más urgente (menos existencias frente a su mínimo) al menos.
      const bajos = filas
        .filter((f) => f.estado === "bajo")
        .sort((a, b) => a.existencias / Math.max(1, a.minimo) - b.existencias / Math.max(1, b.minimo));
      datos.agotados = recortar(agotados);
      datos.bajos = recortar(bajos);
      return datos;
    }

    if (vista === "por_caducar") {
      datos.diasAviso = await getAlertDaysAhead(ctx.clinicId, db);
      datos.porCaducar = recortar(avisos.porCaducar.map((a) => filaLote(a, hoy)));
      datos.caducados = recortar(avisos.caducado.map((a) => filaLote(a, hoy)));
      return datos;
    }

    if (vista === "valor") {
      const porCat = new Map<string, number>();
      let sinCosto = 0;
      for (const i of items) {
        const q = vigente(i);
        if (q > 0 && !(i.unitCost > 0)) sinCosto++;
        porCat.set(i.category, (porCat.get(i.category) ?? 0) + (i.unitCost ?? 0) * q);
      }
      datos.valor = {
        total: valorTotal,
        unidades,
        sinCosto,
        porCategoria: Array.from(porCat.entries())
          .map(([categoria, valor]) => ({ categoria, valor: money(valor) }))
          .filter((c) => c.valor > 0)
          .sort((a, b) => b.valor - a.valor)
          .slice(0, 8),
      };
      return datos;
    }

    // vista === "articulo"
    const buscado = params.articulo ?? "";
    datos.buscado = buscado;
    const q = normalizar(buscado);
    const coinciden = items.filter((i) => normalizar(i.name).includes(q));
    // Un nombre exacto gana a los que solo lo contienen («Resina» ≠ «Resina compuesta A2»).
    const exactos = coinciden.filter((i) => normalizar(i.name) === q);
    const elegidos = exactos.length === 1 ? exactos : coinciden;
    datos.coincidencias = recortar(elegidos.map(fila));
    if (elegidos.length === 1) {
      const lotes: any[] = await db.inventoryLot.findMany({
        where: { clinicId: ctx.clinicId, itemId: elegidos[0].id, remaining: { gt: 0 } },
        orderBy: { expiresAt: "asc" },
      });
      const dias = await getAlertDaysAhead(ctx.clinicId, db);
      datos.diasAviso = dias;
      datos.lotesDelArticulo = lotes.slice(0, 10).map((l) => ({
        articulo: elegidos[0].name,
        lote: l.lotNumber ?? null,
        caduca: l.expiresAt ? (fechaCalendarioDe(l.expiresAt) ?? "") : "",
        dias: l.expiresAt ? diasParaCaducar(l.expiresAt, hoy) : null,
        restante: Number(l.remaining),
        unidad: elegidos[0].unit,
        // El mismo juicio que el de los avisos: por DÍA de calendario y con los días de aviso de la clínica.
        estado: estadoDeCaducidad(l.expiresAt ?? null, hoy, dias),
      }));
    }
    return datos;
  },

  vacio(d) {
    if (d.vista === "compras") return (d.compras?.total ?? 0) === 0;
    if (d.vista === "articulo") return d.sinArticulos || (d.coincidencias?.total ?? 0) === 0;
    return d.sinArticulos;
  },

  resumir(d) {
    const ver = `[ver el inventario](${d.enlace})`;
    const r = d.resumen;

    if (d.vista === "compras") {
      const c = d.compras!;
      const fmt = pesosDeLista(c.filas.map((x) => x.total));
      const linea = (x: CompraFila) =>
        `${x.fecha ?? "sin fecha"} · ${x.proveedor ?? "sin proveedor"}${x.folio ? ` (folio ${x.folio})` : ""}: ${fmt(x.total)}, ${plural(x.articulos, "artículo", "artículos")}`;
      const cuerpo =
        c.filas.length === 1
          ? `La última compra: ${linea(c.filas[0])}.`
          : `Las últimas ${c.filas.length} compras${c.total > c.filas.length ? ` (de ${c.total})` : ""}:${lineasDeLista(c.filas, linea)}`;
      return `${cuerpo}\n${ver}`;
    }

    if (d.sinArticulos) return `El inventario de la clínica está vacío: todavía no hay artículos capturados. ${ver}`;

    if (d.vista === "stock_bajo") {
      const ag = d.agotados!;
      const ba = d.bajos!;
      // 12f: lo que nunca se contó no se da por agotado, pero se dice que falta contarlo.
      const sc = r!.sinContar;
      const nota = sc > 0 ? ` Ojo: ${plural(sc, "artículo está sin contar", "artículos están sin contar")} (nadie ha capturado cuánto hay), así que no se pueden dar por agotados.` : "";
      if (ag.total === 0 && ba.total === 0) return `No hay artículos agotados ni con stock bajo.${nota} ${ver}`;
      const fmt = (f: ArticuloFila) => `${f.nombre}: ${f.existencias} ${f.unidad} (mínimo ${f.minimo})`;
      const partes = [
        `${plural(ag.total, "artículo agotado", "artículos agotados")} y ${plural(ba.total, "con stock bajo", "con stock bajo")}.`,
      ];
      if (ba.total > 0) partes.push(`Con stock bajo${fraseRecorte(ba, "artículos")}:${lineasDeLista(ba.filas, fmt) || ` ${ba.filas.map(fmt).join("; ")}.`}`);
      if (ag.total > 0) partes.push(`Agotados${fraseRecorte(ag, "artículos")}:${lineasDeLista(ag.filas, (f) => f.nombre) || ` ${ag.filas.map((f) => f.nombre).join("; ")}.`}`);
      if (nota) partes.push(nota.trim());
      return `${partes.join("\n")}\n${ver}`;
    }

    if (d.vista === "por_caducar") {
      const pc = d.porCaducar!;
      const ca = d.caducados!;
      if (pc.total === 0 && ca.total === 0) {
        return `No hay lotes por caducar en los próximos ${d.diasAviso ?? 30} días ni lotes caducados con existencias. ${ver}`;
      }
      const cuando = (l: LoteFila) =>
        l.dias === null ? l.caduca : l.dias < 0 ? `caducó el ${l.caduca} (hace ${plural(-l.dias, "día", "días")})` : l.dias === 0 ? `caduca hoy (${l.caduca})` : `caduca el ${l.caduca} (en ${plural(l.dias, "día", "días")})`;
      const fmt = (l: LoteFila) => `${l.articulo}${l.lote ? ` lote ${l.lote}` : ""}: ${l.restante} ${l.unidad}, ${cuando(l)}`;
      const partes = [
        `${plural(pc.total, "lote por caducar", "lotes por caducar")} (próximos ${d.diasAviso ?? 30} días) y ${plural(ca.total, "lote caducado", "lotes caducados")} con existencias.`,
      ];
      if (pc.total > 0) partes.push(`Por caducar${fraseRecorte(pc, "lotes")}:${lineasDeLista(pc.filas, fmt) || ` ${pc.filas.map(fmt).join("; ")}.`}`);
      if (ca.total > 0) partes.push(`Caducados${fraseRecorte(ca, "lotes")} (no cuentan como existencias; hay que darlos de baja en Inventario):${lineasDeLista(ca.filas, fmt) || ` ${ca.filas.map(fmt).join("; ")}.`}`);
      return `${partes.join("\n")}\n${ver}`;
    }

    if (d.vista === "valor") {
      const v = d.valor!;
      const cats = v.porCategoria.length >= 2
        ? `\nPor categoría:${lineasDeLista(v.porCategoria, (c) => `${c.categoria}: ${pesos(c.valor)}`)}`
        : "";
      const aviso = v.sinCosto > 0
        ? ` ${plural(v.sinCosto, "artículo con existencias no tiene", "artículos con existencias no tienen")} costo capturado, así que no suman al valor.`
        : "";
      return `El inventario vale ${pesos(v.total)} (costo unitario × existencias vigentes, ${v.unidades} unidades en ${plural(r!.articulos, "artículo", "artículos")}).${aviso}${cats}\n${ver}`;
    }

    if (d.vista === "articulo") {
      const c = d.coincidencias!;
      if (c.total === 0) return `No encontré ningún artículo que se llame o contenga «${d.buscado}» en el inventario. ${ver}`;
      const fmt = (f: ArticuloFila) =>
        `${f.nombre}: ${f.existencias} ${f.unidad}${f.estado === "agotado" ? " (agotado)" : f.estado === "sin_contar" ? " (sin contar: nadie ha capturado cuánto hay)" : f.estado === "bajo" ? ` (stock bajo; mínimo ${f.minimo})` : ""}` +
        `${f.caducadas > 0 ? `, más ${f.caducadas} caducadas que no cuentan` : ""}`;
      if (c.filas.length === 1) {
        const lotes = d.lotesDelArticulo ?? [];
        const cuando = (l: LoteFila) =>
          l.caduca === "" ? "sin caducidad" : l.estado === "caducado" ? `caducado (${l.caduca})` : l.estado === "por_caducar" ? `caduca el ${l.caduca}, por caducar` : `caduca el ${l.caduca}`;
        const fl = (l: LoteFila) => `${l.lote ? `lote ${l.lote}` : "sin lote"}: ${l.restante} ${l.unidad}, ${cuando(l)}`;
        const detalle = lotes.length >= 2 ? `\nPor lote:${lineasDeLista(lotes, fl)}` : lotes.length === 1 ? ` ${fl(lotes[0])}.` : "";
        return `${fmt(c.filas[0])}.${detalle}\n${ver}`;
      }
      return `Hay ${c.total} artículos que coinciden con «${d.buscado}»${fraseRecorte(c, "artículos")}:${lineasDeLista(c.filas, fmt)}\n${ver}`;
    }

    // resumen
    const ult = d.compras && d.compras.filas[0]
      ? ` La última compra fue el ${d.compras.filas[0].fecha ?? "(sin fecha)"}${d.compras.filas[0].proveedor ? ` a ${d.compras.filas[0].proveedor}` : ""} por ${pesos(d.compras.filas[0].total)}.`
      : "";
    return (
      `Inventario: ${plural(r!.articulos, "artículo", "artículos")}, ${r!.unidades} unidades en existencia, valor ${pesos(r!.valorTotal)}. ` +
      `${plural(r!.agotados, "agotado", "agotados")} y ${plural(r!.bajos, "con stock bajo", "con stock bajo")}` +
      `${r!.sinContar > 0 ? ` (y ${plural(r!.sinContar, "artículo sin contar", "artículos sin contar")}: en cero porque nadie ha capturado cuánto hay, no porque se hayan acabado)` : ""}; ` +
      `${plural(r!.lotesPorCaducar, "lote por caducar", "lotes por caducar")} (próximos ${d.diasAviso ?? 30} días) y ` +
      `${plural(r!.lotesCaducados, "lote caducado", "lotes caducados")}.${ult}\n${ver}`
    );
  },
});
