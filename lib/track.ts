import { VISITOR_COOKIE } from "@/lib/session";

const BOT_UA =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slackbot|discord|embedly|quora|pinterest|vkshare|wget|curl|python-requests|go-http|headless|phantom|bytespider|petalbot/i;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ClickDraft = {
  visitorId: string;
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  isBot: boolean;
  isNewVisitor: boolean;
};

export function isPrefetch(request: Request): boolean {
  const purpose =
    request.headers.get("purpose") || request.headers.get("sec-purpose") || "";
  return purpose.toLowerCase().includes("prefetch");
}

export function describeClick(request: Request): ClickDraft {
  const existing = readCookie(request, VISITOR_COOKIE);
  const visitorId = existing && UUID.test(existing) ? existing : crypto.randomUUID();
  const userAgent = request.headers.get("user-agent");

  return {
    visitorId,
    ip: clientIp(request),
    userAgent,
    referrer: cleanReferrer(request.headers.get("referer")),
    country: headerValue(request, "x-vercel-ip-country"),
    region: headerValue(request, "x-vercel-ip-country-region"),
    city: headerValue(request, "x-vercel-ip-city"),
    isBot: Boolean(userAgent && BOT_UA.test(userAgent)),
    isNewVisitor: visitorId !== existing,
  };
}

export function browserLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown";
  if (/edg\//i.test(userAgent)) return "Edge";
  if (/opr\//i.test(userAgent) || /opera/i.test(userAgent)) return "Opera";
  if (/chrome|crios/i.test(userAgent)) return "Chrome";
  if (/firefox|fxios/i.test(userAgent)) return "Firefox";
  if (/safari/i.test(userAgent)) return "Safari";
  return userAgent.slice(0, 42);
}

export function countryName(code: string | null): string {
  if (!code || code === "Unknown") return "Unknown";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function isLoopback(ip: string | null): boolean {
  return ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1";
}

export function ipLabel(ip: string | null): string {
  if (!ip) return "—";
  if (isLoopback(ip)) return "localhost";
  return ip;
}

export function placeLabel(click: {
  city: string | null;
  region: string | null;
  country: string | null;
}): string {
  const country = click.country ? countryName(click.country) : null;
  const parts = [click.city, click.region, country].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length ? parts.join(", ") : "Unknown";
}

export function formatDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, date)));
}

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp ? realIp.slice(0, 64) : null;
}

function headerValue(request: Request, name: string): string | null {
  const value = request.headers.get(name)?.trim();
  if (!value) return null;
  try {
    return decodeURIComponent(value).slice(0, 80);
  } catch {
    return value.slice(0, 80);
  }
}

function cleanReferrer(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin + url.pathname;
  } catch {
    return value.slice(0, 180);
  }
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      const value = rest.join("=");
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}
