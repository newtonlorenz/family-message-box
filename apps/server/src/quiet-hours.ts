export function isQuietHours(now: Date, start: string | null, end: string | null, timeZone: string): boolean {
  if (!start || !end || start === end) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const current = hour * 60 + minute;
  const parse = (value: string) => {
    const [h = 0, m = 0] = value.split(":").map(Number);
    return h * 60 + m;
  };
  const from = parse(start);
  const to = parse(end);
  return from < to ? current >= from && current < to : current >= from || current < to;
}
