import type { Request } from 'express';

export type PropertyAffairRequestContext = {
  ipAddress?: string;
  userAgent?: string;
};

function normalizedIp(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const withoutMappedPrefix = trimmed.startsWith('::ffff:')
    ? trimmed.slice('::ffff:'.length)
    : trimmed;
  return withoutMappedPrefix.slice(0, 45);
}

export function propertyAffairRequestContext(
  request?: Pick<Request, 'ip' | 'get'>,
): PropertyAffairRequestContext {
  if (!request) return {};
  const ipAddress = normalizedIp(request.ip);
  const userAgent =
    request.get('user-agent')?.trim().slice(0, 500) || undefined;
  return {
    ...(ipAddress ? { ipAddress } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
