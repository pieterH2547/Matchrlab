import { requireSession } from "@/lib/session";
import { advanceRun } from "@/lib/pipeline/orchestrator";
import { runView } from "@/lib/runs";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

/**
 * Voert één stap van de run uit en streamt de voortgang als Server-Sent Events.
 * De client roept dit opnieuw aan zolang de status niet "done" of "failed" is.
 * Zo blijft elke functie-aanroep ruim onder de Vercel-limiet.
 */
export const maxDuration = 300;

export async function POST(_req: Request, ctx: RouteContext<"/api/runs/[id]/step">) {
  try {
    await requireSession();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  const { id } = await ctx.params;
  const runId = Number(id);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      const keepAlive = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 10_000);
      try {
        const status = await advanceRun(runId, send);
        const run = (await db().select().from(schema.runs).where(eq(schema.runs.id, runId)).limit(1))[0];
        send({ type: "run", status, run: run ? await runView(run) : null });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        clearInterval(keepAlive);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
