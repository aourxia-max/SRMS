import { ConfigService } from '@nestjs/config';
import { TenantCryptoService } from './tenant-crypto.service';

describe('TenantCryptoService', () => {
  const values: Record<string, string> = {
    TENANT_ID_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    TENANT_ID_HMAC_SECRET: 'test-hmac-secret-not-used-outside-tests',
  };
  const service = new TenantCryptoService({
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService);

  it('encrypts and decrypts a value without preserving plaintext in ciphertext', () => {
    const input = 'TEST-ID-0001';
    const encrypted = service.encrypt(input);
    expect(encrypted).not.toContain(input);
    expect(service.decrypt(encrypted)).toBe(input);
  });

  it('creates the same HMAC for formatting variants of the same identifier', () => {
    expect(service.hash('test id 0001')).toBe(service.hash('TESTID0001'));
  });
});
