import { getDatabase } from "@/lib/db/connection";
import { currentActor } from "@/modules/auth/server";
import {
  createDocument,
  postDocument,
  readInventory,
  reviseDraft,
} from "@/modules/inventory/service";
import { checkOrigin, errorResponse } from "@/modules/catalog/http";
export async function GET(request: Request) {
  try {
    return Response.json(
      await readInventory(
        getDatabase(),
        await currentActor(request.headers),
        Object.fromEntries(new URL(request.url).searchParams),
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const actor = await currentActor(request.headers);
    const id = new URL(request.url).searchParams.get("post");
    const edit = new URL(request.url).searchParams.get("edit");
    if (edit)
      return Response.json({
        id: await reviseDraft(getDatabase(), actor, edit, await request.json()),
      });
    return Response.json({
      id: id
        ? await postDocument(getDatabase(), actor, id)
        : await createDocument(getDatabase(), actor, await request.json()),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
