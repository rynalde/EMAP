import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";

/**
 * Minimal line source abstraction so we can swap a real serial port for a
 * mock stdin source while developing without hardware.
 *
 * Emits:
 *   "line"  (text: string)  — one full line of input
 *   "open"  ()              — source ready
 *   "close" ()              — source closed
 *   "error" (err: Error)
 */
export interface LineSource extends EventEmitter {
  open(): Promise<void>;
  close(): Promise<void>;
}

export interface SerialOptions {
  path: string;
  baudRate: number;
}

/**
 * Real serial port source backed by `serialport`. Imported lazily so the bridge
 * can run in mock mode on machines that cannot build native serialport bindings.
 */
export class SerialLineSource extends EventEmitter implements LineSource {
  private port: unknown;
  private opts: SerialOptions;

  // Declared and assigned explicitly rather than as a constructor parameter
  // property: those need a code transform, not just type removal, so Node's
  // strip-only mode rejects them and the `dev:node` script cannot start.
  // That matters because `serialport` is a native module that Bun cannot load
  // (uv_default_loop), which leaves Node as the only way to run against real
  // hardware.
  constructor(opts: SerialOptions) {
    super();
    this.opts = opts;
  }

  async open(): Promise<void> {
    const { SerialPort } = await import("serialport");
    const { ReadlineParser } = await import("@serialport/parser-readline");

    const port = new SerialPort({
      path: this.opts.path,
      baudRate: this.opts.baudRate,
      autoOpen: false,
    });
    this.port = port;

    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));
    parser.on("data", (line: string) => this.emit("line", line));
    port.on("error", (err: Error) => this.emit("error", err));
    port.on("close", () => this.emit("close"));

    await new Promise<void>((resolve, reject) => {
      port.open((err: Error | null) => {
        if (err) return reject(err);
        resolve();
      });
    });

    this.emit("open");
  }

  async close(): Promise<void> {
    const port = this.port as { close?: (cb: () => void) => void } | undefined;
    if (port?.close) {
      await new Promise<void>((resolve) => port.close!(() => resolve()));
    }
  }
}

/**
 * Mock source that reads newline-delimited lines from stdin.
 * Enable with MOCK_SERIAL=1. Great for testing the pipeline with fake JSON.
 */
export class StdinLineSource extends EventEmitter implements LineSource {
  private rl?: ReturnType<typeof createInterface>;

  async open(): Promise<void> {
    this.rl = createInterface({ input: process.stdin });
    this.rl.on("line", (line) => this.emit("line", line));
    this.rl.on("close", () => this.emit("close"));
    this.emit("open");
  }

  async close(): Promise<void> {
    this.rl?.close();
  }
}

export function createLineSource(opts: SerialOptions): LineSource {
  if (process.env.MOCK_SERIAL === "1") {
    return new StdinLineSource();
  }
  return new SerialLineSource(opts);
}
