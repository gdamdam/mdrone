/**
 * Regression: a socket retired by disconnect() fires onclose asynchronously.
 * If connect() has already opened a replacement by then, the stale close
 * used to null the live socket and schedule a second connection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMbusClient, type WebSocketLike } from "../../src/transport/mbus/client";

function makeSocket(): WebSocketLike & { closed: boolean } {
  return {
    readyState: 0,
    closed: false,
    send: vi.fn(),
    close() { this.closed = true; },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
}

describe("mbus client disconnect → connect race", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ignores the late close of a socket that was already replaced", () => {
    const sockets: ReturnType<typeof makeSocket>[] = [];
    const client = createMbusClient({
      urls: ["ws://test"],
      retryMs: 100,
      webSocketFactory: () => {
        const s = makeSocket();
        sockets.push(s);
        return s;
      },
    });

    client.connect();
    client.disconnect();
    client.connect();
    expect(sockets).toHaveLength(2);

    // The first socket's close event arrives only now.
    sockets[0].onclose?.();
    vi.advanceTimersByTime(10_000);

    expect(sockets).toHaveLength(2);
    expect(sockets[1].closed).toBe(false);
    expect(client.getState()).toBe("connecting");
    client.disconnect();
  });
});
