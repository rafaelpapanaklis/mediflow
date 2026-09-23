// Base en memoria para conducir Mercado Pago en facturas (ws1-t1) sin Postgres.
//
// Solo lo que el servicio usa, pero DE VERDAD:
//   · el `where` se interpreta (clinicId, estados, `not`, `in`): el filtro de
//     tenant y el de «PENDING» se ejercitan. Un operador sin doble LANZA.
//   · `$transaction` NO se serializa con una cola (eso hacía pasar las pruebas
//     de «a la vez» aunque faltara el candado). Lo que forma las transacciones
//     son los candados que el código pide: `SELECT … FOR UPDATE` sobre
//     `invoices` y `pg_advisory_xact_lock(...)`. Cada uno es una cola por clave
//     que se suelta al terminar la transacción, como en Postgres.
//   · BARRERA: dentro de una transacción, la primera lectura espera a OTRA
//     transacción (plazo `barreraMs`). Sin candado, las dos llegan, se sueltan
//     juntas y leen las dos antes de que alguna escriba (el cruce que el candado
//     evita); con candado la segunda está bloqueada, la primera agota el plazo y
//     sigue sola. Un `sleep` no sirve: la primera terminaba entera antes de que
//     despertara la segunda y el control «sin candado» salía verde.
//   · ROLLBACK: lo que creó una transacción que lanza, desaparece.
//   · `ignorarCandados = true` es el CONTROL: demuestra que sin el candado la
//     prueba de concurrencia sí se cae.

type Fila = Record<string, any>;

function cumple(valor: any, cond: any): boolean {
  if (cond === null) return valor === null || valor === undefined;
  if (cond instanceof Date) return valor instanceof Date && valor.getTime() === cond.getTime();
  if (typeof cond !== "object") return valor === cond;
  for (const [op, arg] of Object.entries(cond)) {
    switch (op) {
      case "in":
        if (!(arg as any[]).includes(valor)) return false;
        break;
      case "not":
        if (arg === null ? valor === null || valor === undefined : valor === arg) return false;
        break;
      default:
        throw new Error(`doble-base: operador sin doble «${op}»`);
    }
  }
  return true;
}

export class DobleBase {
  tablas: Record<string, Fila[]> = {
    clinic: [],
    clinicMercadoPago: [],
    invoice: [],
    invoicePaymentLink: [],
    payment: [],
  };
  /** Modelos que «no existen» (SQL sin aplicar): lanzan P2021. */
  sinTabla = new Set<string>();
  barreraMs = 40;
  private enBarrera: Array<() => void> = [];
  ignorarCandados = false;
  /** Qué candados se pidieron (para comprobar que el código los pide). */
  candadosPedidos: string[] = [];
  private seq = 0;
  private colas = new Map<string, Promise<void>>();

  private esperarBarrera(): Promise<void> {
    return new Promise((soltar) => {
      this.enBarrera.push(soltar);
      if (this.enBarrera.length >= 2) {
        const juntas = this.enBarrera;
        this.enBarrera = [];
        juntas.forEach((f) => f());
        return;
      }
      setTimeout(() => {
        const i = this.enBarrera.indexOf(soltar);
        if (i >= 0) {
          this.enBarrera.splice(i, 1);
          soltar();
        }
      }, this.barreraMs);
    });
  }

  nuevoId(prefijo: string) {
    this.seq += 1;
    return `${prefijo}${this.seq}`;
  }

  filtrar(modelo: string, where: Fila = {}): Fila[] {
    if (this.sinTabla.has(modelo)) {
      const e: any = new Error(`The table \`${modelo}\` does not exist in the current database.`);
      e.code = "P2021";
      throw e;
    }
    return this.tablas[modelo].filter((f) => this.coincide(f, where));
  }

  private coincide(fila: Fila, where: Fila): boolean {
    for (const [k, cond] of Object.entries(where ?? {})) {
      if (k === "AND") {
        if (!(cond as Fila[]).every((w) => this.coincide(fila, w))) return false;
      } else if (k === "OR") {
        if (!(cond as Fila[]).some((w) => this.coincide(fila, w))) return false;
      } else if (!cumple(fila[k], cond)) {
        return false;
      }
    }
    return true;
  }

  private proyectar(modelo: string, fila: Fila | undefined, select?: Fila): Fila | null {
    if (!fila) return null;
    const copia: Fila = { ...fila };
    if (!select) return copia;
    const out: Fila = {};
    for (const [k, v] of Object.entries(select)) {
      if (!v) continue;
      if (modelo === "invoice" && k === "clinic") {
        const c = this.tablas.clinic.find((x) => x.id === fila.clinicId);
        out[k] = c ? this.proyectar("clinic", c, (v as Fila).select) : null;
      } else if (typeof v === "object") {
        throw new Error(`doble-base: relación sin doble «${modelo}.${k}»`);
      } else {
        out[k] = copia[k];
      }
    }
    return out;
  }

  /** Toma el candado `clave` para la transacción `tx` (se suelta al terminar). */
  private async candado(tx: TxEstado | null, clave: string) {
    this.candadosPedidos.push(clave);
    if (!tx || this.ignorarCandados) return;
    const previo = this.colas.get(clave) ?? Promise.resolve();
    let soltar!: () => void;
    const mio = new Promise<void>((r) => { soltar = r; });
    this.colas.set(clave, previo.then(() => mio));
    await previo;
    tx.soltar.push(soltar);
  }

  private modelo(nombre: string, tx: TxEstado | null) {
    const yo = this;
    async function leer() {
      if (tx && !tx.leyo) {
        tx.leyo = true;
        await yo.esperarBarrera();
      }
    }
    return {
      async findFirst(args: Fila = {}) {
        await leer();
        let filas = yo.filtrar(nombre, args.where);
        if (args.orderBy) filas = ordenar(filas, args.orderBy);
        return yo.proyectar(nombre, filas[0], args.select);
      },
      async findUnique(args: Fila) {
        await leer();
        return yo.proyectar(nombre, yo.filtrar(nombre, args.where)[0], args.select);
      },
      async findMany(args: Fila = {}) {
        await leer();
        let filas = yo.filtrar(nombre, args.where);
        if (args.orderBy) filas = ordenar(filas, args.orderBy);
        if (args.take) filas = filas.slice(0, args.take);
        return filas.map((f) => yo.proyectar(nombre, f, args.select));
      },
      async create(args: Fila) {
        yo.filtrar(nombre, {}); // P2021 si la tabla «no existe»
        const fila: Fila = { id: yo.nuevoId(nombre.slice(0, 3)), createdAt: new Date(Date.now() + yo.seq), ...args.data };
        yo.tablas[nombre].push(fila);
        tx?.creadas.push([nombre, fila]);
        return yo.proyectar(nombre, fila, args.select);
      },
      async update(args: Fila) {
        const fila = yo.filtrar(nombre, args.where)[0];
        if (!fila) {
          const e: any = new Error("Record to update not found.");
          e.code = "P2025";
          throw e;
        }
        Object.assign(fila, args.data);
        return yo.proyectar(nombre, fila, args.select);
      },
      async updateMany(args: Fila) {
        const filas = yo.filtrar(nombre, args.where);
        for (const f of filas) Object.assign(f, args.data);
        return { count: filas.length };
      },
    };
  }

  private cliente(tx: TxEstado | null): any {
    const yo = this;
    const base: any = {
      // `SELECT id FROM invoices WHERE id = ${id} FOR UPDATE`
      $queryRaw: async (partes: TemplateStringsArray, ...valores: unknown[]) => {
        const sql = partes.join("?");
        if (/FOR UPDATE/.test(sql) && /FROM invoices/.test(sql)) await yo.candado(tx, `invoices:${valores[0]}`);
        else throw new Error(`doble-base: $queryRaw sin doble «${sql}»`);
        return [];
      },
      // `SELECT pg_advisory_xact_lock(hashtext(${clave}))`
      $executeRaw: async (partes: TemplateStringsArray, ...valores: unknown[]) => {
        const sql = partes.join("?");
        if (/pg_advisory_xact_lock/.test(sql)) await yo.candado(tx, `advisory:${valores[0]}`);
        else throw new Error(`doble-base: $executeRaw sin doble «${sql}»`);
        return 1;
      },
      $transaction: async (fn: (tx: any) => Promise<unknown>) => {
        const estado: TxEstado = { creadas: [], soltar: [], leyo: false };
        try {
          return await fn(yo.cliente(estado));
        } catch (e) {
          for (const [m, f] of estado.creadas) yo.tablas[m] = yo.tablas[m].filter((x) => x !== f);
          throw e;
        } finally {
          for (const s of estado.soltar) s();
        }
      },
    };
    for (const m of Object.keys(this.tablas)) base[m] = this.modelo(m, tx);
    return base;
  }

  /** El cliente que se le pasa al servicio como `db`. */
  db(): any {
    return this.cliente(null);
  }
}

interface TxEstado {
  creadas: Array<[string, Fila]>;
  soltar: Array<() => void>;
  leyo: boolean;
}

function ordenar(filas: Fila[], orderBy: Fila): Fila[] {
  const [campo, dir] = Object.entries(orderBy)[0] as [string, string];
  const v = (x: any) => (x instanceof Date ? x.getTime() : x);
  return [...filas].sort((a, b) => (v(a[campo]) > v(b[campo]) ? 1 : -1) * (dir === "desc" ? -1 : 1));
}
