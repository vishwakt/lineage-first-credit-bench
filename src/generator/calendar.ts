// Simulated calendar helpers. Dates are ISO strings (YYYY-MM-DD) in UTC; periods are YYYY-MM.

const DAY_MS = 86_400_000;

export function toDay(iso: string): number {
  return Math.floor(Date.parse(iso + "T00:00:00Z") / DAY_MS);
}

export function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromDay(toDay(iso) + days);
}

export function periodOf(iso: string): string {
  return iso.slice(0, 7);
}

export function firstOfPeriod(period: string): string {
  return period + "-01";
}

export function shiftPeriod(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const yy = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  return `${yy}-${String(mm).padStart(2, "0")}`;
}

// The n completed months before the month containing asOf, oldest first.
export function windowBefore(asOf: string, n: number): string[] {
  const current = periodOf(asOf);
  const out: string[] = [];
  for (let i = n; i >= 1; i--) out.push(shiftPeriod(current, -i));
  return out;
}

// Latest entry whose effective date is on or before the given date.
export function effectiveAt<T extends { effective: string }>(entries: readonly T[], date: string): T {
  let chosen: T | undefined;
  for (const e of entries) if (e.effective <= date) chosen = e;
  if (!chosen) throw new Error(`no entry effective at ${date}`);
  return chosen;
}
