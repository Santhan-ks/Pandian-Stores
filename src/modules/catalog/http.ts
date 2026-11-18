import { ZodError } from "zod";
import { AccessError } from "../auth/policy";
export function errorResponse(error: unknown) {
  if (error instanceof AccessError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError)
    return Response.json(
      {
        error: error.issues
          .map((i) => i.path.join(".") + ": " + i.message)
          .join("; "),
      },
      { status: 422 },
    );
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  const code = (cause as { code?: string })?.code;
  if (
    [
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "57P01",
      "57P03",
      "08006",
      "53300",
    ].includes(code ?? "")
  )
    return Response.json(
      { error: "Database unavailable. Please retry." },
      { status: 503 },
    );
  if (code === "57014")
    return Response.json(
      {
        error: "Query time limit reached. Narrow the report period or filters.",
      },
      { status: 503 },
    );
  if (code === "23505")
    return Response.json(
      { error: "A record with this name or relationship already exists." },
      { status: 409 },
    );
  if (code === "23503" || code === "23514" || code === "P0001")
    return Response.json(
      {
        error:
          "The record violates a database relationship or validation rule.",
      },
      { status: 422 },
    );
  if (error instanceof SyntaxError)
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  console.error("Operation failed", {
    name: error instanceof Error ? error.name : "unknown",
    code,
  });
  return Response.json(
    { error: "The operation could not be completed." },
    { status: 500 },
  );
}
export function checkOrigin(request: Request) {
  if (
    request.headers.get("origin") !==
    new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin
  )
    throw new AccessError(403, "Invalid request origin.");
}

export async function readJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new AccessError(400, "JSON body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.length;
      if (size > 65536) {
        void reader.cancel();
        throw new AccessError(413, "Request exceeds 64 KiB.");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
