import { readJson } from "@/modules/catalog/http";
import { getDatabase } from "@/lib/db/connection";
import { currentActor } from "@/modules/auth/server";
import {
  readProfiles,
  saveProfile,
  demoInvoicesEnabled,
} from "@/modules/billing/profile";
import { checkOrigin, errorResponse } from "@/modules/catalog/http";
export async function GET(request: Request) {
  try {
    return Response.json({
      profiles: await readProfiles(
        getDatabase(),
        await currentActor(request.headers),
      ),
      demoEnabled: demoInvoicesEnabled(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await saveProfile(
      getDatabase(),
      await currentActor(request.headers),
      await readJson(request),
    );
    return Response.json({ saved: true });
  } catch (e) {
    return errorResponse(e);
  }
}
