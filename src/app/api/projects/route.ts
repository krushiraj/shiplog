import { after, NextResponse, type NextRequest } from "next/server";
import { createProject, ProjectInputError, runBrief } from "@/lib/projects";
import { getSessionUserId } from "@/lib/session";

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in with Buffer first" }, { status: 401 });

  const body = await req.json().catch(() => null);
  try {
    const { id } = await createProject(userId, body);
    after(() => runBrief(id));
    return NextResponse.json({ id, redirect: `/projects/${id}?building=1` }, { status: 201 });
  } catch (e) {
    if (e instanceof ProjectInputError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("Creating a project failed", e);
    return NextResponse.json({ error: "Could not create the project" }, { status: 500 });
  }
}
