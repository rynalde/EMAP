import WebSocket from "ws";
import { parseAISMessage } from "./ais-parser";
import type { Vessel, AISData } from "./types";
type Store = {
  socket: WebSocket | null;
  vessels: Map<string, Vessel>;
  state: AISData["state"];
  lastMessageAt: string | null;
  retryAt: number;
  failures: number;
  error?: string;
};
const globalAIS = globalThis as typeof globalThis & { itaquiAIS?: Store };
const store: Store = (globalAIS.itaquiAIS ??= {
  socket: null,
  vessels: new Map(),
  state: "disabled",
  lastMessageAt: null,
  retryAt: 0,
  failures: 0,
});
export function getAIS(): AISData {
  const key = process.env.AISSTREAM_API_KEY;
  if (!key)
    return {
      configured: false,
      state: "disabled",
      vessels: [],
      lastMessageAt: null,
    };
  if (!store.socket && Date.now() >= store.retryAt) {
    store.state = "connecting";
    store.error = undefined;
    const ws = new WebSocket("wss://stream.aisstream.io/v0/stream", {
      perMessageDeflate: true,
      handshakeTimeout: 12000,
    });
    store.socket = ws;
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          APIKey: key,
          BoundingBoxes: [
            [
              [-2.85, -44.65],
              [-2.2, -44.1],
            ],
          ],
          FilterMessageTypes: [
            "PositionReport",
            "StandardClassBPositionReport",
            "ExtendedClassBPositionReport",
          ],
        }),
      );
    });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.error || msg.Error) {
          store.error =
            "O provedor AIS recusou a assinatura. Confira a chave no servidor.";
          ws.close();
          return;
        }
        if (msg.MessageType === "SubscriptionConfirmation") {
          store.state = "connected";
          store.failures = 0;
          return;
        }
        const vessel = parseAISMessage(msg);
        if (vessel) {
          store.state = "connected";
          store.failures = 0;
          store.lastMessageAt = new Date().toISOString();
          store.vessels.set(vessel.id, vessel);
        }
      } catch {
        /* Ignore malformed upstream messages, never expose credentials. */
      }
    });
    ws.on("error", () => {
      store.error = "Conexão AIS indisponível. Nova tentativa automática.";
      store.state = "error";
    });
    ws.on("close", () => {
      store.socket = null;
      store.state = "error";
      store.retryAt =
        Date.now() + Math.min(60000, 2000 * 2 ** Math.min(store.failures++, 5));
    });
  }
  for (const [id, v] of store.vessels)
    if (Date.now() - Date.parse(v.updatedAt) > 15 * 60000)
      store.vessels.delete(id);
  return {
    configured: true,
    state: store.state,
    vessels: [...store.vessels.values()],
    lastMessageAt: store.lastMessageAt,
    error: store.error,
  };
}
