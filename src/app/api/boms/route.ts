import { readJson } from "@/modules/catalog/http";
import { getDatabase } from "@/lib/db/connection";
import { currentActor } from "@/modules/auth/server";
import { listBoms } from "@/modules/catalog/service";
import { publishBom, getBom } from "@/modules/catalog/bom";
import { errorResponse, checkOrigin } from "@/modules/catalog/http";
export async function GET(request: Request) {
  try {
    const actor = await currentActor(request.headers);
    const id = new URL(request.url).searchParams.get("id");
    return Response.json(
      id
        ? await getBom(getDatabase(), actor, id)
        : await listBoms(getDatabase(), actor),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const actor = await currentActor(request.headers);
    return Response.json(
      await publishBom(getDatabase(), actor, await readJson(request)),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
