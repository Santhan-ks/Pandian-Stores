import { getDatabase } from "@/lib/db/connection";
import { currentActor } from "@/modules/auth/server";
import { AccessError } from "@/modules/auth/policy";
import { schemas, type Resource } from "@/modules/catalog/validation";
import { listMaster, saveMaster } from "@/modules/catalog/service";
import { errorResponse, checkOrigin } from "@/modules/catalog/http";
type Context = { params: Promise<{ resource: string }> };
function resourceKey(value: string): Resource {
  if (!Object.hasOwn(schemas, value))
    throw new AccessError(404, "Unknown master.");
  return value as Resource;
}
export async function GET(request: Request, context: Context) {
  try {
    return Response.json(
      await listMaster(
        getDatabase(),
        await currentActor(request.headers),
        resourceKey((await context.params).resource),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    checkOrigin(request);
    const actor = await currentActor(request.headers);
    const resource = resourceKey((await context.params).resource);
    const id = new URL(request.url).searchParams.get("id") ?? undefined;
    return Response.json(
      await saveMaster(
        getDatabase(),
        actor,
        resource,
        await request.json(),
        id,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
