import { describe, expect, it } from "vitest";
import { fetchLivePosts, livePostsQuery } from "../buffer/post";

describe("live posts", () => {
  it("asks for every post in one aliased query", () => {
    const { query, variables } = livePostsQuery(["a", "b"]);
    expect(query).toContain("$id0: PostId!, $id1: PostId!");
    expect(query).toContain("p1: post(input: { id: $id1 }) { id status externalLink }");
    expect(variables).toEqual({ id0: "a", id1: "b" });
  });

  it("maps results by Buffer post id", async () => {
    const live = await fetchLivePosts("u", ["a", "b"], {
      gql: async () => ({ p0: { id: "a", status: "sent", externalLink: "https://x.com/i/status/1" }, p1: null }),
    });
    expect(live.get("a")).toEqual({ status: "sent", externalLink: "https://x.com/i/status/1" });
    expect(live.has("b")).toBe(false);
  });

  it("returns nothing, without throwing, when Buffer fails or is slow", async () => {
    expect((await fetchLivePosts("u", ["a"], { gql: async () => Promise.reject(new Error("down")) })).size).toBe(0);
    expect((await fetchLivePosts("u", ["a"], { gql: () => new Promise(() => {}), timeoutMs: 10 })).size).toBe(0);
  });

  it("skips the call when there are no posts", async () => {
    let called = false;
    await fetchLivePosts("u", [], { gql: async () => ((called = true), {}) });
    expect(called).toBe(false);
  });
});
