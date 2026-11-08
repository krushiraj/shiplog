import { after, NextResponse, type NextRequest } from "next/server";
import { getBriefStatus, getOwnedProject, runBrief } from "@/lib/projects";
import { getSessionUserId } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

async function load(ctx: Ctx) {
  const userId = await getSessionUserId();
  if (!userId) return { error: NextResponse.json({ error: "Sign in with Buffer first" }, { status: 401 }) };
  const project = await getOwnedProject(userId, (await ctx.params).id);
  if (!project) return { error: NextResponse.json({ error: "Project not found" }, { status: 404 }) };
  return { project };
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { project, error } = await load(ctx);
  if (error) return error;
  const step = getBriefStatus(project.id);
  const running = step !== null && step !== "Done" && step !== "Failed";
  return NextResponse.json({
    brief: project.brief,
    building: project.brief === null ? step !== "Failed" : running,
    step,
    failed: step === "Failed",
  });
}

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { project, error } = await load(ctx);
  if (error) return error;
  after(() => runBrief(project.id));
  return NextResponse.json({ building: true, step: "Reading README" }, { status: 202 });
}
