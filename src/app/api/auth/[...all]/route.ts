import { getAuth } from "@/modules/auth/server";
import { getDatabase } from "@/lib/db/connection";
import { allowLogin, allowProxyLogin } from "@/modules/auth/login-limit";
import { setting } from "@/lib/config";
import { checkOrigin, errorResponse, readJson } from "@/modules/catalog/http";
export const runtime = "nodejs";
async function handle(request: Request) {
  try {
    const operation = new URL(request.url).pathname.replace("/api/auth/", "");
    if (!["sign-in/email", "sign-out", "get-session"].includes(operation))
      return Response.json({ error: "Not found" }, { status: 404 });
    const auth = getAuth();
    if (request.method === "POST") {
      checkOrigin(request);
      const body = await readJson(request.clone());
      if (
        operation === "sign-in/email" &&
        (!(await allowProxyLogin(
          getDatabase(),
          request.headers,
          setting("BETTER_AUTH_SECRET") ?? "",
        )) ||
          !(await allowLogin(
            getDatabase(),
            (body as { email?: unknown } | null)?.email,
            setting("BETTER_AUTH_SECRET") ?? "",
          )))
      )
        return Response.json(
          { error: "Too many attempts. Try again shortly." },
          { status: 429, headers: { "Retry-After": "60" } },
        );
    }
    return await auth.handler(request);
  } catch (error) {
    return errorResponse(error);
  }
}
export const GET = handle;
export const POST = handle;
