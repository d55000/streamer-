import { NextRequest, NextResponse } from "next/server";

/**
 * Streaming proxy for cross-origin media URLs.
 * Fetches the remote resource and streams it back with proper CORS headers,
 * enabling playback of videos from servers that don't set CORS or CORP headers.
 * Supports HTTP Range requests for seeking.
 */

/** Block requests to private / loopback IP ranges (SSRF protection). */
function isPrivateHost(hostname: string): boolean {
  // Loopback
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return true;
  // Private IPv4 ranges
  if (/^10\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  // Link-local
  if (/^169\.254\./.test(hostname)) return true;
  // 0.0.0.0
  if (hostname === "0.0.0.0") return true;
  return false;
}

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

  // Block private / internal addresses to prevent SSRF
  if (isPrivateHost(parsed.hostname)) {
    return NextResponse.json({ error: "Requests to private addresses are not allowed" }, { status: 403 });
  }

  // Build headers to forward to the remote server
  const forwardHeaders: HeadersInit = {};
  const range = request.headers.get("range");
  if (range) {
    forwardHeaders["Range"] = range;
  }

  // Derive the caller's origin for the CORS response header
  const origin = request.headers.get("origin") || request.nextUrl.origin;

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
    headers.set("Access-Control-Allow-Origin", origin);
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
