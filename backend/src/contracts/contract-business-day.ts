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
