import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { of, throwError } from "rxjs";
import { SegmentationClient } from "./segmentation.client";

describe("SegmentationClient", () => {
  let client: SegmentationClient;

  const httpService = {
    post: jest.fn(),
  } as unknown as HttpService;

  const configService = {
    get: jest.fn(),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new SegmentationClient(httpService, configService);
  });

  it("sends callback and progress URLs in the worker payload", async () => {
    (configService.get as jest.Mock).mockReturnValue("http://127.0.0.1:8080");
    (httpService.post as jest.Mock).mockReturnValue(
      of({ data: { status: "queued" } }),
    );

    const result = await client.trigger(
      "11111111-1111-1111-1111-111111111111",
      "https://gateway.test/chat/webhook/segmentation",
      "https://gateway.test/chat/webhook/progress",
    );

    expect(httpService.post).toHaveBeenCalledWith("http://127.0.0.1:8080", {
      session_id: "11111111-1111-1111-1111-111111111111",
      callback_url: "https://gateway.test/chat/webhook/segmentation",
      progress_url: "https://gateway.test/chat/webhook/progress",
    });
    expect(result).toEqual({ status: "queued" });
  });

  it("retries with /inference when the base endpoint returns 404", async () => {
    (configService.get as jest.Mock).mockReturnValue("http://127.0.0.1:8080");
    (httpService.post as jest.Mock)
      .mockReturnValueOnce(
        throwError(() => ({
          response: { status: 404 },
        })),
      )
      .mockReturnValueOnce(of({ data: { status: "queued" } }));

    const result = await client.trigger(
      "22222222-2222-2222-2222-222222222222",
      "https://gateway.test/chat/webhook/segmentation",
    );

    expect(httpService.post).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:8080",
      {
        session_id: "22222222-2222-2222-2222-222222222222",
        callback_url: "https://gateway.test/chat/webhook/segmentation",
        progress_url: undefined,
      },
    );
    expect(httpService.post).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8080/inference",
      {
        session_id: "22222222-2222-2222-2222-222222222222",
        callback_url: "https://gateway.test/chat/webhook/segmentation",
        progress_url: undefined,
      },
    );
    expect(result).toEqual({ status: "queued" });
  });
});
