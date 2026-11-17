import { getAuth } from "@/modules/auth/server";
export const runtime = "nodejs";
async function handle(request: Request) {
  const operation = new URL(request.url).pathname.replace("/api/auth/", "");
  if (!["sign-in/email", "sign-out", "get-session"].includes(operation))
    return Response.json({ error: "Not found" }, { status: 404 });
  return getAuth().handler(request);
}
export const GET = handle;
export const POST = handle;
