import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";

const SESSION_COOKIE = "shiplog_session";
export const OAUTH_COOKIE = "shiplog_oauth";
const SESSION_DAYS = 30;

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

async function sign(payload: JWTPayload, expiresInSeconds: number): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(secret());
}

async function verify<T extends JWTPayload>(token: string): Promise<T | null> {
  try {
    const { payload } = await jwtVerify<T>(token, secret(), { algorithms: ["HS256"] });
    return payload;
  } catch {
    return null;
  }
}

export const cookieOptions = (maxAgeSeconds: number) => ({
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: maxAgeSeconds,
});

export async function setSession(userId: string): Promise<void> {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const token = await sign({ sub: userId }, maxAge);
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(maxAge));
}

export async function getSessionUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return (await verify(token))?.sub ?? null;
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export function signTemp(payload: JWTPayload, minutes: number): Promise<string> {
  return sign(payload, minutes * 60);
}

export function verifyTemp<T extends JWTPayload = JWTPayload>(token: string): Promise<T | null> {
  return verify<T>(token);
}
