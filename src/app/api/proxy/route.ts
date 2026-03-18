import { NextRequest, NextResponse } from "next/server";

/**
 * Streaming proxy for cross-origin media URLs.
 * Fetches the remote resource and streams it back with proper CORS headers,
 * enabling playback of videos from servers that don't set CORS or CORP headers.
 * Supports HTTP Range requests for seeking.
 */
export async function GET(request: NextRequest) {
  const targetUrl = request.nextUrl.searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // Validate the URL
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Only allow http/https protocols
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Only HTTP(S) URLs are allowed" }, { status: 400 });
  }

  // Build headers to forward to the remote server
  const forwardHeaders: HeadersInit = {};
  const range = request.headers.get("range");
  if (range) {
    forwardHeaders["Range"] = range;
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: forwardHeaders,
      redirect: "follow",
    });

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json(
        { error: `Upstream returned ${upstream.status}` },
        { status: upstream.status }
      );
    }

    // Build response headers
    const headers = new Headers();

    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);

    const contentRange = upstream.headers.get("content-range");
    if (contentRange) headers.set("Content-Range", contentRange);

    const acceptRanges = upstream.headers.get("accept-ranges");
    if (acceptRanges) headers.set("Accept-Ranges", acceptRanges);

    // CORS / CORP headers so the browser allows the resource
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Proxy fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
