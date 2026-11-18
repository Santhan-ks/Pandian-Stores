import { getDatabase } from "@/lib/db/connection";
import { currentActor } from "@/modules/auth/server";
import { checkOrigin, errorResponse } from "@/modules/catalog/http";
import { deleteRecord } from "@/modules/records/service";

export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const actor = await currentActor(request.headers);
    const p = new URL(request.url).searchParams;
    return Response.json(
      await deleteRecord(
        getDatabase(),
        actor,
        p.get("resource") ?? "",
        p.get("id"),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
