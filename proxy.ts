// Optional access code for the deployed app, so a public link can't run up the model bill.
// Set ACCESS_CODE on the server to turn it on. Open any page with ?code=<the code> (or type it on /unlock)
// and a cookie remembers it. Repair cards (/r/...) and their photos stay public so they can be shared.
import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "fixcam_code";
const OPEN = [/^\/unlock$/, /^\/r\//, /^\/api\/files\//];

export function proxy(request: NextRequest) {
  const code = process.env.ACCESS_CODE;
  if (!code) return NextResponse.next();

  const url = request.nextUrl;
  const given = url.searchParams.get("code");
  if (given !== null) {
    url.searchParams.delete("code");
    const res = given === code ? NextResponse.redirect(url) : NextResponse.redirect(unlockUrl(request, url.pathname, true));
    if (given === code) {
      res.cookies.set(COOKIE, code, {
        httpOnly: true,
        sameSite: "lax",
        secure: url.protocol === "https:",
        maxAge: 30 * 24 * 60 * 60,
        path: "/",
      });
    }
    return res;
  }

  if (request.cookies.get(COOKIE)?.value === code || OPEN.some((re) => re.test(url.pathname))) return NextResponse.next();
  if (url.pathname.startsWith("/api/")) return Response.json({ error: "Access code required." }, { status: 401 });
  return NextResponse.redirect(unlockUrl(request, url.pathname, false));
}

function unlockUrl(request: NextRequest, next: string, wrong: boolean): URL {
  const u = new URL("/unlock", request.url);
  if (next && next !== "/unlock") u.searchParams.set("next", next);
  if (wrong) u.searchParams.set("wrong", "1");
  return u;
}

export const config = {
  // Everything except Next's own assets and files with an extension (icons, images).
  matcher: ["/((?!_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)"],
};
