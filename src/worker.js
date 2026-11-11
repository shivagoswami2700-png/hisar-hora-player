const DRik_URL = "https://www.drikpanchang.com/muhurat/hora.html?geoname-id=1270022&lang=en&time-format=12hour";
const TZ = "Asia/Kolkata";
const PLANETS = ["Sun","Moon","Mars","Mercury","Jupiter","Venus","Saturn"];

function localDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const get = (t) => parts.find(p => p.type === t).value;
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")) };
}
function todayLabel(p) {
  return new Date(Date.UTC(p.year, p.month - 1, p.day))
    .toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
}
function stripHtml(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&ndash;|&#8211;/gi, "–")
    .replace(/&mdash;|&#8212;/gi, "—")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ").trim();
}
function timeToMinutes(value, inheritedMeridiem) {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = Number(m[1]), min = Number(m[2]), mer = (m[3] || inheritedMeridiem || "").toUpperCase();
  if (min > 59 || h > 12 || h < 1) return null;
  if (mer === "AM") h = h === 12 ? 0 : h;
  else if (mer === "PM") h = h === 12 ? 12 : h + 12;
  else if (h === 12) return null;
  return h * 60 + min;
}
function findPairs(text) {
  const re = /(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*(?:to|–|—|-)\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/gi;
  const out = [];
  for (const m of text.matchAll(re)) {
    let a = m[1].trim(), b = m[2].trim();
    const ampmA = a.match(/(AM|PM)$/i)?.[1];
    const ampmB = b.match(/(AM|PM)$/i)?.[1];
    if (!ampmA && ampmB) a += " " + ampmB;
    if (ampmA && !ampmB) b += " " + ampmA;
    const start = timeToMinutes(a), end = timeToMinutes(b);
    if (start !== null && end !== null) out.push({ start, end });
  }
  return out;
}
function parseRows(html) {
  const rows = [...html.matchAll(/<(?:tr|li)\b[^>]*>([\s\S]*?)<\/(?:tr|li)>/gi)].map(m => stripHtml(m[1]));
  const periods = [];
  for (const row of rows) {
    const planet = PLANETS.find(p => new RegExp(`\\b${p}\\b`, "i").test(row));
    if (!planet) continue;
    const pairs = findPairs(row);
    if (pairs.length) periods.push({ planet, ...pairs[0] });
  }
  if (periods.length >= 24) return periods.slice(0, 24);

  // Fallback for layouts that render each Hora as a div/card rather than a table row.
  const text = stripHtml(html);
  const fallback = [];
  const re = /\b(Sun|Moon|Mars|Mercury|Jupiter|Venus|Saturn)\b[\s\S]{0,90}?(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*(?:to|–|—|-)\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/gi;
  for (const m of text.matchAll(re)) {
    let a=m[2].trim(), b=m[3].trim();
    const ma=a.match(/(AM|PM)$/i)?.[1], mb=b.match(/(AM|PM)$/i)?.[1];
    if (!ma && mb) a += " " + mb;
    if (ma && !mb) b += " " + ma;
    const start=timeToMinutes(a), end=timeToMinutes(b);
    if (start!==null && end!==null) fallback.push({planet:m[1],start,end});
  }
  return fallback.slice(0,24);
}
function dateVisible(text, p) {
  const d = String(p.day), mm = String(p.month).padStart(2,"0");
  const monthName = new Date(Date.UTC(p.year,p.month-1,p.day)).toLocaleDateString("en-US",{month:"long",timeZone:"UTC"});
  const shortMonth = monthName.slice(0,3);
  const candidates = [
    new RegExp(`\\b${monthName}\\s+${d},?\\s+${p.year}\\b`, "i"),
    new RegExp(`\\b${shortMonth}\\s+${d},?\\s+${p.year}\\b`, "i"),
    new RegExp(`\\b${d}[/-]${mm}[/-]${p.year}\\b`),
    new RegExp(`\\b${mm}[/-]${d}[/-]${p.year}\\b`)
  ];
  return candidates.some(r => r.test(text));
}
function toTimestamp(dayOffset, minutes, p) {
  const date = new Date(Date.UTC(p.year,p.month-1,p.day + dayOffset,0,0));
  date.setUTCMinutes(minutes);
  return date.toISOString();
}
function validate(periods, p) {
  if (periods.length !== 24) throw new Error(`Expected 24 Hora periods, found ${periods.length}.`);
  const result = [];
  let dayOffset = 0, previousEnd = null;
  for (let i=0;i<periods.length;i++) {
    const item = periods[i];
    let start = item.start, end = item.end;
    if (previousEnd !== null) {
      while (start < previousEnd - 1) start += 1440;
      if (start > previousEnd + 1) throw new Error("The Hora timings contain a gap; refusing to play an unverified schedule.");
      start = previousEnd;
    }
    while (end <= start) end += 1440;
    if (end - start > 90 || end - start < 35) throw new Error("An unusual Hora duration was detected; schedule was not accepted.");
    result.push({
      planet: item.planet,
      start: toTimestamp(0, start, p),
      end: toTimestamp(0, end, p)
    });
    previousEnd = end;
  }
  if (previousEnd - (periods[0].start) < 1400 || previousEnd - periods[0].start > 1480)
    throw new Error("The schedule does not cover a complete 24-hour Hora cycle.");
  return result;
}
async function getHora() {
  const now = new Date();
  const p = localDateParts(now);
  const url = new URL(DRik_URL);
  url.searchParams.set("date", `${p.month}/${p.day}/${p.year}`);
  const response = await fetch(url.toString(), {
    headers: { "User-Agent": "Mozilla/5.0 HoraPlayer/1.0", "Accept": "text/html" },
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  if (!response.ok) throw new Error(`Drik Panchang returned HTTP ${response.status}.`);
  const html = await response.text();
  const text = stripHtml(html);
  if (!dateVisible(text, p)) throw new Error("The fetched page did not confirm today's date for Hisar.");
  const raw = parseRows(html);
  const periods = validate(raw, p);
  return {
    date: todayLabel(p),
    location: "Hisar, Haryana, India",
    timezone: TZ,
    source: "Drik Panchang",
    fetchedAt: new Date().toISOString(),
    periods
  };
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/hora") {
      try {
        const data = await getHora();
        return Response.json(data, { headers: { "Cache-Control": "no-store" } });
      } catch (err) {
        return Response.json({
          error: "Today's Drik Panchang Hora schedule could not be verified.",
          detail: err?.message || "Unknown error",
          sourceUrl: DRik_URL
        }, { status: 503, headers: { "Cache-Control": "no-store" } });
      }
    }
    return env.ASSETS.fetch(request);
  }
};
