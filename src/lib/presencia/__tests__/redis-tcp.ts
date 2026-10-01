/**
 * Un cliente RESP2 mínimo por TCP (node:net, sin dependencias) para probar el script
 * de Lua contra un Redis REAL. Implementa lo mismo que `RedisMini` y cuenta las
 * llamadas (viajes) y los comandos que mandó. Solo para pruebas.
 */
import net from "node:net";
import type { PipelineMini, RedisMini } from "../presencia-store";

type Resp = string | number | null | Resp[] | Error;

function codificar(args: unknown[]): Buffer {
  const partes = [`*${args.length}\r\n`];
  for (const a of args) {
    const b = Buffer.from(String(a), "utf8");
    partes.push(`$${b.length}\r\n`, b.toString("binary"), "\r\n");
  }
  return Buffer.from(partes.join(""), "binary");
}

/** Decodifica UNA respuesta desde `buf` en `pos`; null si aún no está completa. */
function leer(buf: Buffer, pos: number): { v: Resp; pos: number } | null {
  if (pos >= buf.length) return null;
  const fin = buf.indexOf("\r\n", pos, "binary");
  if (fin < 0) return null;
  const tipo = String.fromCharCode(buf[pos]);
  const linea = buf.toString("utf8", pos + 1, fin);
  const sig = fin + 2;
  switch (tipo) {
    case "+": return { v: linea, pos: sig };
    case "-": return { v: new Error(linea), pos: sig };
    case ":": return { v: Number(linea), pos: sig };
    case "$": {
      const n = Number(linea);
      if (n < 0) return { v: null, pos: sig };
      if (buf.length < sig + n + 2) return null;
      return { v: buf.toString("utf8", sig, sig + n), pos: sig + n + 2 };
    }
    case "*": {
      const n = Number(linea);
      if (n < 0) return { v: null, pos: sig };
      const items: Resp[] = [];
      let p = sig;
      for (let i = 0; i < n; i++) {
        const r = leer(buf, p);
        if (!r) return null;
        items.push(r.v);
        p = r.pos;
      }
      return { v: items, pos: p };
    }
    default: throw new Error("RESP desconocido: " + tipo);
  }
}

export class RedisTcp implements RedisMini {
  /** Viajes de red (cada pipeline.exec, eval o evalsha es uno). */
  viajes = 0;
  /** Comandos mandados (los de dentro de un script no se ven desde fuera). */
  comandos = 0;
  /** Si se pone, evalsha/eval lanzan esto (para probar la caída al camino de varios comandos). */
  evalRoto: Error | null = null;
  private sock!: net.Socket;
  private buf = Buffer.alloc(0);
  private esperando: Array<(r: Resp) => void> = [];

  static async conectar(hostPuerto: string): Promise<RedisTcp> {
    const [host, puerto] = hostPuerto.split(":");
    const c = new RedisTcp();
    await new Promise<void>((ok, mal) => {
      c.sock = net.connect(Number(puerto), host, ok);
      c.sock.once("error", mal);
    });
    c.sock.on("data", (d) => { c.buf = Buffer.concat([c.buf, d]); c.vaciar(); });
    return c;
  }

  private vaciar() {
    while (this.esperando.length) {
      const r = leer(this.buf, 0);
      if (!r) return;
      this.buf = this.buf.subarray(r.pos);
      this.esperando.shift()!(r.v);
    }
  }

  /** Un comando suelto (no cuenta como viaje de la señal: es para preparar y mirar). */
  async cmd(...args: unknown[]): Promise<Resp> {
    const p = new Promise<Resp>((ok) => this.esperando.push(ok));
    this.sock.write(codificar(args));
    const r = await p;
    if (r instanceof Error) throw r;
    return r;
  }

  private async tanda(comandos: unknown[][]): Promise<unknown[]> {
    this.viajes++;
    this.comandos += comandos.length;
    const ps = comandos.map(() => new Promise<Resp>((ok) => this.esperando.push(ok)));
    this.sock.write(Buffer.concat(comandos.map(codificar)));
    const r = await Promise.all(ps);
    const err = r.find((x) => x instanceof Error);
    if (err) throw err;
    return r;
  }

  async evalsha(sha: string, keys: string[], args: unknown[]): Promise<unknown> {
    if (this.evalRoto) throw this.evalRoto;
    return (await this.tanda([["EVALSHA", sha, keys.length, ...keys, ...args]]))[0];
  }
  async eval(script: string, keys: string[], args: unknown[]): Promise<unknown> {
    if (this.evalRoto) throw this.evalRoto;
    return (await this.tanda([["EVAL", script, keys.length, ...keys, ...args]]))[0];
  }

  pipeline(): PipelineMini {
    const cola: unknown[][] = [];
    const self = this;
    const p: PipelineMini = {
      get(k) { cola.push(["GET", k]); return p; },
      set(k, v, o) { cola.push(o?.ex ? ["SET", k, v, "EX", o.ex] : ["SET", k, v]); return p; },
      mget(...ks) { cola.push(["MGET", ...ks]); return p; },
      zadd(k, { score, member }) { cola.push(["ZADD", k, score, member]); return p; },
      zrange(k, min, max) { cola.push(["ZRANGE", k, min, max, "BYSCORE"]); return p; },
      zremrangebyscore(k, min, max) { cola.push(["ZREMRANGEBYSCORE", k, min, max]); return p; },
      exec() { return self.tanda(cola); },
    };
    return p;
  }

  cerrar() { this.sock.destroy(); }
}
