import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
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
  'image/webp': (content) =>
    content.length >= 12 &&
    content.subarray(0, 4).toString() === 'RIFF' &&
    content.subarray(8, 12).toString() === 'WEBP',
  'image/heic': (content) =>
    content.subarray(4, 12).toString().startsWith('ftyphei'),
};
const contractSignatures: Record<string, (content: Buffer) => boolean> = {
  ...signatures,
  'image/gif': (content) => {
    const header = content.subarray(0, 6).toString();
    return header === 'GIF87a' || header === 'GIF89a';
  },
};
const contractExtensions: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
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
  private contractVoidProofFolder() {
    return resolve(process.cwd(), '..', 'uploads', 'contract-void-proofs');
  }
  private folder() {
    return resolve(process.cwd(), '..', 'uploads', 'tenant-ids');
  }
  private pricingRebateFolder() {
    return resolve(process.cwd(), '..', 'uploads', 'pricing-rebate-proofs');
  }
  private paymentProofFolder() {
    return resolve(process.cwd(), '..', 'uploads', 'payment-proofs');
  }
  private contractFileFolder() {
    return resolve(process.cwd(), '..', 'uploads', 'contract-files');
  }

  async saveContractFile(file: UploadedFile, user: AuthUser) {
    if (!file || !file.buffer) throw new BadRequestException('请上传合同附件');
    const limit = await this.configLimit();
    if (file.size > limit || file.buffer.length > limit)
      throw new BadRequestException('附件超过允许大小');
    const originalName = basename(file.originalname);
    const extension = extname(originalName).toLowerCase();
    if (
      !contractExtensions[file.mimetype]?.includes(extension) ||
      !contractSignatures[file.mimetype]?.(file.buffer)
    )
      throw new BadRequestException('附件类型或内容不符合限制');

    const storedName = `${randomUUID()}${extension}`;
    const storageKey = `contract-files/${storedName}`;
    await mkdir(this.contractFileFolder(), { recursive: true });
    await writeFile(
      resolve(this.contractFileFolder(), storedName),
      file.buffer,
      { flag: 'wx' },
    );
    const asset = await this.prisma.db.fileAsset.create({
      data: {
        storageKey,
        originalName,
        storedName,
        mimeType: file.mimetype,
        extension,
        sizeBytes: BigInt(file.buffer.length),
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        category: 'CONTRACT',
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

  async saveAndLinkContractFile(
    contractId: number,
    file: UploadedFile,
    user: AuthUser,
  ) {
    const contract = await this.prisma.db.contract.findUnique({
      where: { id: contractId },
      select: { id: true },
    });
    if (!contract) throw new NotFoundException('合同不存在');
    const asset = await this.saveContractFile(file, user);
    await this.prisma.db.contractFile.create({
      data: { contractId, fileAssetId: asset.id },
    });
    return asset;
  }

  async listContractFiles(contractId: number) {
    return (
      await this.prisma.db.contractFile.findMany({
        where: { contractId, fileAsset: { category: 'CONTRACT' } },
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

  async downloadContractFile(contractId: number, fileId: number) {
    const item = await this.prisma.db.contractFile.findFirst({
      where: {
        contractId,
        fileAssetId: fileId,
        fileAsset: { category: 'CONTRACT' },
      },
      include: { fileAsset: true },
    });
    if (!item) throw new NotFoundException('合同附件不存在');
    const content = await readFile(
      resolve(this.contractFileFolder(), basename(item.fileAsset.storedName)),
    );
    return { asset: item.fileAsset, content };
  }

  async saveContractVoidProof(file: UploadedFile, user: AuthUser) {
    if (user.role !== UserRole.SUPER_ADMIN && user.role !== UserRole.ADMIN)
      throw new ForbiddenException('当前角色不能上传合同作废证明');
    if (!file || !file.buffer)
      throw new BadRequestException('请上传合同作废证明');
    const limit = await this.configLimit();
    if (file.size > limit || file.buffer.length > limit)
      throw new BadRequestException('附件超过允许大小');
    if (
      !this.allowedTypes().includes(file.mimetype) ||
      !signatures[file.mimetype]?.(file.buffer)
    )
      throw new BadRequestException('附件类型或内容不符合限制');

    const originalName = basename(file.originalname);
    const extension = extname(originalName).toLowerCase();
    const storedName = `${randomUUID()}${extension}`;
    const storageKey = `contract-void-proofs/${storedName}`;
    await mkdir(this.contractVoidProofFolder(), { recursive: true });
    await writeFile(
      resolve(this.contractVoidProofFolder(), storedName),
      file.buffer,
      { flag: 'wx' },
    );
    const asset = await this.prisma.db.fileAsset.create({
      data: {
        storageKey,
        originalName,
        storedName,
        mimeType: file.mimetype,
        extension,
        sizeBytes: BigInt(file.buffer.length),
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        category: 'CONTRACT_VOID_PROOF',
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
  async savePaymentProof(file: UploadedFile, user: AuthUser) {
    if (!file || !file.buffer) throw new BadRequestException('请上传收款凭证');
    if (file.size > (await this.configLimit()))
      throw new BadRequestException('附件超过允许大小');
    const allowedPaymentTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (
      !allowedPaymentTypes.includes(file.mimetype) ||
      !signatures[file.mimetype]?.(file.buffer)
    )
      throw new BadRequestException('附件类型或内容不符合限制');

    const storedName = `${randomUUID()}${extname(
      basename(file.originalname),
    ).toLowerCase()}`;
    const storageKey = `payment-proofs/${storedName}`;
    await mkdir(this.paymentProofFolder(), { recursive: true });
    await writeFile(
      resolve(this.paymentProofFolder(), storedName),
      file.buffer,
      { flag: 'wx' },
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
        category: 'PAYMENT_PROOF',
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

  async downloadPaymentProof(paymentId: number, fileId: number) {
    const item = await this.prisma.db.paymentFile.findUnique({
      where: {
        paymentId_fileAssetId: { paymentId, fileAssetId: fileId },
      },
      include: { fileAsset: true },
    });
    if (!item) throw new NotFoundException('收款凭证不存在');
    const content = await readFile(
      resolve(this.paymentProofFolder(), item.fileAsset.storedName),
    );
    return { asset: item.fileAsset, content };
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
  async downloadDepositRefundProof(refundId: number, fileId: number) {
    const item = await this.prisma.db.depositRefundFile.findFirst({
      where: {
        depositRefundId: refundId,
        fileAssetId: fileId,
        fileAsset: { category: 'DEPOSIT_REFUND_PROOF' },
      },
      include: { fileAsset: true },
    });
    if (!item) throw new NotFoundException('退款凭证不存在');
    const content = await readFile(
      resolve(
        process.cwd(),
        '..',
        'uploads',
        'deposit-refund-proofs',
        basename(item.fileAsset.storedName),
      ),
    );
    return { asset: item.fileAsset, content };
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
