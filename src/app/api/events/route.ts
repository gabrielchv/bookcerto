import { redis } from "@/lib/redis";
import { appointmentsChannel } from "@/lib/events";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId");

  if (!tenantId) {
    return new Response("missing tenantId", { status: 400 });
  }

  const sub = redis.duplicate();
  await sub.subscribe(appointmentsChannel(tenantId));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) =>
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));

      const onMessage = (_channel: string, message: string) => send(message);
      sub.on("message", onMessage);

      const cleanup = () => {
        sub.off("message", onMessage);
        void sub.unsubscribe(appointmentsChannel(tenantId));
        sub.disconnect();
      };

      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
