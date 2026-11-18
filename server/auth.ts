// Who is making the request.
// Local mode (no OIDC_ISSUER): a single local user with all rights, server bound to 127.0.0.1.
// Server mode: the login proxy in front of the app (oauth2-proxy -> Keycloak) passes Keycloak's
// signed ID token along. It is verified here again, so the app does not rely on the proxy alone.
import { createRemoteJWKSet, jwtVerify } from "jose";
import { HttpError } from "./files";

export type Role = "admin" | "editor" | "viewer";
export type User = { id: string; email: string; name: string; role: Role; local: boolean };

const ISSUER = (process.env.OIDC_ISSUER ?? "").replace(/\/$/, "");
const AUDIENCE = process.env.OIDC_AUDIENCE ?? "analyzer";
const GROUP_USERS = process.env.GROUP_USERS ?? "analyzer-users";
const GROUP_ADMINS = process.env.GROUP_ADMINS ?? "analyzer-admins";
const GROUP_VIEWERS = process.env.GROUP_VIEWERS ?? "analyzer-viewers";

export const SERVER_MODE = ISSUER !== "";
export const LOGOUT_URL = SERVER_MODE ? `${ISSUER}/protocol/openid-connect/logout` : "";

const LOCAL_USER: User = { id: "local", email: "", name: "Local user", role: "admin", local: true };
const keys = SERVER_MODE ? createRemoteJWKSet(new URL(`${ISSUER}/protocol/openid-connect/certs`)) : null;

export async function authenticate(req: Request): Promise<User> {
  if (!SERVER_MODE) return LOCAL_USER;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : (req.headers.get("x-forwarded-access-token") ?? "");
  if (!token) throw new HttpError(401, "Not signed in");
  let claims: Record<string, unknown>;
  try {
    claims = (await jwtVerify(token, keys!, { issuer: ISSUER, audience: AUDIENCE })).payload;
  } catch {
    throw new HttpError(401, "The sign-in is not valid any more. Reload the page to sign in again.");
  }
  const groups = Array.isArray(claims.groups) ? claims.groups.map((g) => String(g).replace(/^\//, "")) : [];
  const role: Role | null = groups.includes(GROUP_ADMINS)
    ? "admin"
    : groups.includes(GROUP_USERS)
      ? "editor"
      : groups.includes(GROUP_VIEWERS)
        ? "viewer"
        : null;
  if (!role) throw new HttpError(403, "Your account has no access to the analyzer.");
  const email = String(claims.email ?? claims.preferred_username ?? "");
  return { id: String(claims.sub ?? email), email, name: String(claims.name ?? email), role, local: false };
}
