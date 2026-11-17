import { getDatabase } from "@/lib/db/connection";
import { currentActor } from "@/modules/auth/server";
import {
  createRun,
  postRun,
  addOverhead,
  listRuns,
} from "@/modules/production/service";
import { errorResponse, checkOrigin } from "@/modules/catalog/http";
export async function GET(request: Request) {
  try {
    return Response.json(
      await listRuns(getDatabase(), await currentActor(request.headers)),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const actor = await currentActor(request.headers);
    const params = new URL(request.url).searchParams;
    const post = params.get("post"),
      overhead = params.get("overhead");
    if (post)
      return Response.json({ id: await postRun(getDatabase(), actor, post) });
    if (overhead) {
      await addOverhead(getDatabase(), actor, overhead, await request.json());
      return Response.json({ id: overhead });
    }
    return Response.json({
      id: await createRun(
        getDatabase(),
        actor,
        await request.json(),
        params.get("edit") ?? undefined,
      ),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
