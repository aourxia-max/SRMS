export const CONTRACT_TIME_ZONE = 'Asia/Shanghai';

export function contractBusinessDay(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CONTRACT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return new Date(
    Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day)),
  );
}
const CHINA_STANDARD_TIME_OFFSET = '+08:00';
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

function contractBusinessDayStart(value: string): Date {
  return new Date(`${value}T00:00:00.000${CHINA_STANDARD_TIME_OFFSET}`);
}

export function contractBusinessDateRange(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: contractBusinessDayStart(from) } : {}),
    ...(to
      ? {
          lt: new Date(
            contractBusinessDayStart(to).getTime() + DAY_IN_MILLISECONDS,
          ),
        }
      : {}),
  };
}
