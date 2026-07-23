import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'crypto';

@Injectable()
export class TenantCryptoService {
  constructor(private readonly config: ConfigService) {}

  private key() {
    const value = this.config.get<string>('TENANT_ID_ENCRYPTION_KEY');
    const key = value ? Buffer.from(value, 'base64') : undefined;
    if (!key || key.length !== 32)
      throw new ServiceUnavailableException('承租人证件加密密钥未正确配置');
    return key;
  }

  private hmacSecret() {
    const value = this.config.get<string>('TENANT_ID_HMAC_SECRET');
    if (!value)
      throw new ServiceUnavailableException('承租人证件摘要密钥未配置');
    return value;
  }

  normalize(value: string) {
    return value.trim().replace(/\s+/g, '').toUpperCase();
  }
  hash(value: string) {
    return createHmac('sha256', this.hmacSecret())
      .update(this.normalize(value))
      .digest('hex');
  }
  encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ciphertext.toString('base64')}`;
  }
  decrypt(value: string) {
    const [ivText, tagText, cipherText] = value.split('.');
    if (!ivText || !tagText || !cipherText)
      throw new ConflictException('证件数据格式无效');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key(),
      Buffer.from(ivText, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagText, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(cipherText, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
