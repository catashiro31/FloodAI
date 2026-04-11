import { RealtimeService } from "./realtime.service";

describe("RealtimeService", () => {
  it("avoids duplicate direct emits when the client already joined the session room", () => {
    const service = new RealtimeService();
    const roomEmit = jest.fn();
    const clientEmit = jest.fn();

    service.bindServer({
      sockets: {
        sockets: new Map([
          [
            "client-1",
            {
              rooms: new Set(["client-1", "session-1"]),
            },
          ],
        ]),
      },
      to: jest.fn((target: string) => ({
        emit: target === "session-1" ? roomEmit : clientEmit,
      })),
    } as any);

    service.sendStatus("client-1", "Processing", { step: 1 }, "session-1");
    service.sendReply("client-1", { reply: "done" }, "session-1");

    expect(roomEmit).toHaveBeenCalledTimes(2);
    expect(clientEmit).not.toHaveBeenCalled();
  });

  it("still emits directly when the client is not part of the session room", () => {
    const service = new RealtimeService();
    const roomEmit = jest.fn();
    const clientEmit = jest.fn();

    service.bindServer({
      sockets: {
        sockets: new Map([
          [
            "client-1",
            {
              rooms: new Set(["client-1"]),
            },
          ],
        ]),
      },
      to: jest.fn((target: string) => ({
        emit: target === "session-1" ? roomEmit : clientEmit,
      })),
    } as any);

    service.sendStatus("client-1", "Processing", { step: 1 }, "session-1");

    expect(roomEmit).toHaveBeenCalledTimes(1);
    expect(clientEmit).toHaveBeenCalledTimes(1);
  });
});
