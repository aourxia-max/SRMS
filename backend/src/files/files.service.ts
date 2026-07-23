import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { basename, extname, resolve } from 'path';
import { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';

export type UploadedFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};
const signatures: Record<string, (content: Buffer) => boolean> = {
  'application/pdf': (content) => content.subarray(0, 5).toString() === '%PDF-',
  'image/png': (content) =>
    content
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/jpeg': (content) =>
    content.length >= 3 &&
    content[0] === 0xff &&
    content[1] === 0xd8 &&
    content[2] === 0xff,
  'image/heic': (content) =>
    content.subarray(4, 12).toString().startsWith('ftyphei'),
};

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}
  private async configLimit() {
    const setting = await this.prisma.db.systemSetting.findUnique({
      where: { settingKey: 'uploadSizeLimitMb' },
    });
    if (setting) {
      const megabytes = Number(setting.settingValue);
      if (Number.isSafeInteger(megabytes) && megabytes > 0)
        return megabytes * 1024 * 1024;
    }
    const value = Number(this.config.get<string>('TENANT_FILE_MAX_SIZE_BYTES'));
    if (!Number.isSafeInteger(value) || value < 1)
      throw new ServiceUnavailableException('证件附件大小限制未配置');
    return value;
  }
  private allowedTypes() {
    const values =
      this.config
        .get<string>('TENANT_FILE_ALLOWED_MIME_TYPES')
        ?.split(',')
        .map((item) => item.trim())
        .filter(Boolean) ?? [];
    if (!values.length)
      throw new ServiceUnavailableException('证件附件类型限制未配置');
    return values;
  }
  private folder() {
    return resolve(process.cwd(), '..', 'uploads', 'tenant-ids');
  }
  private pricingRebateFolder() {
    return resolve(process.cwd(), '..', 'uploads', 'pricing-rebate-proofs');
  }
  async savePricingRebateProof(file: UploadedFile, user: AuthUser) {
    if (!file || !file.buffer) throw new BadRequestException('请上传退款凭证');
    if (file.size > (await this.configLimit()))
      throw new BadRequestException('附件超过允许大小');
    if (
      !this.allowedTypes().includes(file.mimetype) ||
      !signatures[file.mimetype]?.(file.buffer)
    )
      throw new BadRequestException('附件类型或内容不符合限制');
    const storedName = `${randomUUID()}${extname(basename(file.originalname)).toLowerCase()}`;
    const storageKey = `pricing-rebate-proofs/${storedName}`;
    await mkdir(this.pricingRebateFolder(), { recursive: true });
    await writeFile(
      resolve(this.pricingRebateFolder(), storedName),
      file.buffer,
      {
        flag: 'wx',
      },
    );
    const asset = await this.prisma.db.fileAsset.create({
      data: {
        storageKey,
        originalName: basename(file.originalname),
        storedName,
        mimeType: file.mimetype,
        extension: extname(file.originalname).toLowerCase(),
        sizeBytes: BigInt(file.size),
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        category: 'PRICING_REBATE_PROOF',
        uploadedBy: user.id,
      },
    });
    return {
      id: asset.id,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes.toString(),
      uploadedAt: asset.uploadedAt,
    };
  }
  async saveDepositRefundProof(file: UploadedFile, user: AuthUser) {
    if (!file || !file.buffer)
      throw new BadRequestException('请上传押金退款凭证');
    if (file.size > (await this.configLimit()))
      throw new BadRequestException('附件超过允许大小');
    if (
      !this.allowedTypes().includes(file.mimetype) ||
      !signatures[file.mimetype]?.(file.buffer)
    )
      throw new BadRequestException('附件类型或内容不符合限制');
    const storedName = `${randomUUID()}${extname(basename(file.originalname)).toLowerCase()}`;
    const storageKey = `deposit-refund-proofs/${storedName}`;
    const folder = resolve(
      process.cwd(),
      '..',
      'uploads',
      'deposit-refund-proofs',
    );
    await mkdir(folder, { recursive: true });
    await writeFile(resolve(folder, storedName), file.buffer, { flag: 'wx' });
    const asset = await this.prisma.db.fileAsset.create({
      data: {
        storageKey,
        originalName: basename(file.originalname),
        storedName,
        mimeType: file.mimetype,
        extension: extname(file.originalname).toLowerCase(),
        sizeBytes: BigInt(file.size),
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        category: 'DEPOSIT_REFUND_PROOF',
        uploadedBy: user.id,
      },
    });
    return {
      id: asset.id,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes.toString(),
      uploadedAt: asset.uploadedAt,
    };
  }
  async saveTenantId(tenantId: number, file: UploadedFile, user: AuthUser) {
    if (!file || !file.buffer) throw new BadRequestException('请上传证件附件');
    if (file.size > (await this.configLimit()))
      throw new BadRequestException('附件超过允许大小');
    if (
      !this.allowedTypes().includes(file.mimetype) ||
      !signatures[file.mimetype]?.(file.buffer)
    )
      throw new BadRequestException('附件类型或内容不符合限制');
    const storedName = `${randomUUID()}${extname(basename(file.originalname)).toLowerCase()}`;
    const storageKey = `tenant-ids/${storedName}`;
    await mkdir(this.folder(), { recursive: true });
    await writeFile(resolve(this.folder(), storedName), file.buffer, {
      flag: 'wx',
    });
    const asset = await this.prisma.db.fileAsset.create({
      data: {
        storageKey,
        originalName: basename(file.originalname),
        storedName,
        mimeType: file.mimetype,
        extension: extname(file.originalname).toLowerCase(),
        sizeBytes: BigInt(file.size),
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        category: 'TENANT_ID',
        uploadedBy: user.id,
      },
    });
    await this.prisma.db.tenantFile.create({
      data: { tenantId, fileAssetId: asset.id },
    });
    return {
      id: asset.id,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes.toString(),
      uploadedAt: asset.uploadedAt,
    };
  }
  async listTenantFiles(tenantId: number) {
    return (
      await this.prisma.db.tenantFile.findMany({
        where: { tenantId },
        include: { fileAsset: true },
        orderBy: { createdAt: 'desc' },
      })
    ).map(({ fileAsset }) => ({
      id: fileAsset.id,
      originalName: fileAsset.originalName,
      mimeType: fileAsset.mimeType,
      sizeBytes: fileAsset.sizeBytes.toString(),
      uploadedAt: fileAsset.uploadedAt,
    }));
  }
  async downloadTenantFile(tenantId: number, fileId: number) {
    const item = await this.prisma.db.tenantFile.findUnique({
      where: { tenantId_fileAssetId: { tenantId, fileAssetId: fileId } },
      include: { fileAsset: true },
    });
    if (!item) throw new NotFoundException('附件不存在');
    const content = await readFile(
      resolve(this.folder(), item.fileAsset.storedName),
    );
    return { asset: item.fileAsset, content };
  }
}
