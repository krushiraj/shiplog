function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomB64url(n: number): string {
  return base64url(globalThis.crypto.getRandomValues(new Uint8Array(n)));
}

// Buffer requires PKCE S256 for all clients. 64 bytes encodes to 86 chars (within 43–128).
export async function createPkce(): Promise<{ verifier: string; challenge: string; method: "S256" }> {
  const verifier = randomB64url(64);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)), method: "S256" };
}

export function randomState(): string {
  return randomB64url(32);
}
