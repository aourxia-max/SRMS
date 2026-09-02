import {
  BadRequestException,
  INestApplication,
  RequestMethod,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../app.module';
import type { AuthUser } from '../auth/auth-user.type';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ROLES_KEY } from '../authorization/roles.decorator';
import { RolesGuard } from '../authorization/roles.guard';
import { FilesService, type UploadedFile } from '../files/files.service';
import { FilesModule } from '../files/files.module';
import { SystemModule } from '../system/system.module';
import type { AppendPropertyAffairProgressDto } from './dto/append-property-affair-progress.dto';
import type { CreatePropertyAffairDto } from './dto/create-property-affair.dto';
import type { ListPropertyAffairsQueryDto } from './dto/list-property-affairs-query.dto';
import type { PropertyAffairVersionDto } from './dto/property-affair-version.dto';
import type { UpdatePropertyAffairDto } from './dto/update-property-affair.dto';
import { PropertyAffairsController } from './property-affairs.controller';
import { PropertyAffairsModule } from './property-affairs.module';
import { PropertyAffairsService } from './property-affairs.service';

type MockResponse = Pick<Response, 'send' | 'setHeader'>;

describe('PropertyAffairsController', () => {
  const admin: AuthUser = {
    id: 7,
    username: 'admin',
    displayName: '管理员',
    role: UserRole.ADMIN,
  };
  const propertyAffairs = {
    list: jest.fn(),
    listRecycleBin: jest.fn(),
    get: jest.fn(),
    categories: jest.fn(),
    responsibleUsers: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    appendProgress: jest.fn(),
    softDelete: jest.fn(),
    restore: jest.fn(),
    permanentDelete: jest.fn(),
  };
  const files = {
    saveAndLinkPropertyAffairFile: jest.fn(),
    readPropertyAffairFile: jest.fn(),
    unlinkPropertyAffairFile: jest.fn(),
    cleanupReleasedPropertyAffairFiles: jest.fn(),
  };

  const controller = () =>
    new PropertyAffairsController(
      propertyAffairs as unknown as PropertyAffairsService,
      files as unknown as FilesService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers controller-wide authentication and administrator role guards', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PropertyAffairsController)).toBe(
      'property-affairs',
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PropertyAffairsController),
    ).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, PropertyAffairsController)).toEqual([
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
    ]);
  });

  it('reserves permanent deletion for super administrators through method metadata', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        PropertyAffairsController.prototype.permanentDelete,
      ),
    ).toEqual([UserRole.SUPER_ADMIN]);
  });

  it('registers the complete route contract with the expected HTTP methods', () => {
    const routes = [
      ['list', '/', RequestMethod.GET],
      ['categories', 'categories', RequestMethod.GET],
      ['responsibleUsers', 'responsible-users', RequestMethod.GET],
      ['recycleBin', 'recycle-bin', RequestMethod.GET],
      ['get', ':id', RequestMethod.GET],
      ['create', '/', RequestMethod.POST],
      ['update', ':id', RequestMethod.PATCH],
      ['appendProgress', ':id/progress', RequestMethod.POST],
      ['softDelete', ':id', RequestMethod.DELETE],
      ['restore', ':id/restore', RequestMethod.POST],
      ['permanentDelete', ':id/permanent', RequestMethod.DELETE],
      ['upload', ':id/files', RequestMethod.POST],
      ['preview', ':id/files/:fileId/preview', RequestMethod.GET],
      ['download', ':id/files/:fileId/download', RequestMethod.GET],
      ['unlink', ':id/files/:fileId', RequestMethod.DELETE],
    ] as const;

    for (const [methodName, path, requestMethod] of routes) {
      const handler = PropertyAffairsController.prototype[methodName];
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(requestMethod);
    }
    expect(
      Reflect.getMetadata(
        INTERCEPTORS_METADATA,
        PropertyAffairsController.prototype.upload,
      ),
    ).toHaveLength(1);
  });

  it('dispatches static GET routes without colliding with the id route', async () => {
    propertyAffairs.categories.mockResolvedValue(['公共维修']);
    propertyAffairs.responsibleUsers.mockResolvedValue([
      { id: 7, displayName: '管理员', role: UserRole.ADMIN },
    ]);
    propertyAffairs.listRecycleBin.mockResolvedValue({ items: [], total: 0 });
    const moduleRef = await Test.createTestingModule({
      controllers: [PropertyAffairsController],
      providers: [
        { provide: PropertyAffairsService, useValue: propertyAffairs },
        { provide: FilesService, useValue: files },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app: INestApplication<App> = moduleRef.createNestApplication();
    await app.init();

    try {
      await request(app.getHttpServer())
        .get('/property-affairs/categories')
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toEqual(['公共维修']);
        });
      await request(app.getHttpServer())
        .get('/property-affairs/responsible-users')
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toEqual([
            { id: 7, displayName: '管理员', role: UserRole.ADMIN },
          ]);
        });
      await request(app.getHttpServer())
        .get('/property-affairs/recycle-bin')
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toEqual({ items: [], total: 0 });
        });
      expect(propertyAffairs.get).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('delegates read routes and wraps their data in the standard envelope', async () => {
    const query = { keyword: '维修', page: 2 } as ListPropertyAffairsQueryDto;
    propertyAffairs.list.mockResolvedValue({ items: [{ id: 1 }], total: 1 });
    propertyAffairs.listRecycleBin.mockResolvedValue({
      items: [{ id: 2 }],
      total: 1,
    });
    propertyAffairs.get.mockResolvedValue({ id: 3 });
    propertyAffairs.categories.mockResolvedValue(['公共维修']);
    propertyAffairs.responsibleUsers.mockResolvedValue([{ id: 7 }]);
    const instance = controller();

    await expect(instance.list(query)).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { items: [{ id: 1 }], total: 1 },
    });
    await expect(instance.recycleBin(query)).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { items: [{ id: 2 }], total: 1 },
    });
    await expect(instance.get(3)).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { id: 3 },
    });
    await expect(instance.categories()).resolves.toEqual({
      code: 200,
      message: 'success',
      data: ['公共维修'],
    });
    await expect(instance.responsibleUsers()).resolves.toEqual({
      code: 200,
      message: 'success',
      data: [{ id: 7 }],
    });
    expect(propertyAffairs.list).toHaveBeenCalledWith(query);
    expect(propertyAffairs.listRecycleBin).toHaveBeenCalledWith(query);
    expect(propertyAffairs.get).toHaveBeenCalledWith(3);
  });

  it('passes exact DTOs and the current user to create, update, and progress writes', async () => {
    const createDto = {
      title: '电梯维修',
      content: '联系维保单位',
    } as CreatePropertyAffairDto;
    const updateDto = {
      version: 2,
      title: '电梯检修',
    } as UpdatePropertyAffairDto;
    const progressDto = {
      version: 3,
      content: '师傅已到场',
    } as AppendPropertyAffairProgressDto;
    propertyAffairs.create.mockResolvedValue({ id: 11 });
    propertyAffairs.update.mockResolvedValue({ id: 11, version: 3 });
    propertyAffairs.appendProgress.mockResolvedValue({ id: 11, version: 4 });
    const instance = controller();

    await expect(instance.create(createDto, admin)).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { id: 11 },
    });
    await expect(instance.update(11, updateDto, admin)).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { id: 11, version: 3 },
    });
    await expect(
      instance.appendProgress(11, progressDto, admin),
    ).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { id: 11, version: 4 },
    });
    expect(propertyAffairs.create).toHaveBeenCalledWith(createDto, admin);
    expect(propertyAffairs.update).toHaveBeenCalledWith(11, updateDto, admin);
    expect(propertyAffairs.appendProgress).toHaveBeenCalledWith(
      11,
      progressDto,
      admin,
    );
  });

  it('extracts the version body for soft-delete and restore writes', async () => {
    const dto: PropertyAffairVersionDto = { version: 6 };
    propertyAffairs.softDelete.mockResolvedValue({ id: 11, version: 7 });
    propertyAffairs.restore.mockResolvedValue({ id: 11, version: 7 });
    const instance = controller();

    await expect(instance.softDelete(11, dto, admin)).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { id: 11, version: 7 },
    });
    await expect(instance.restore(11, dto, admin)).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { id: 11, version: 7 },
    });
    expect(propertyAffairs.softDelete).toHaveBeenCalledWith(11, 6, admin);
    expect(propertyAffairs.restore).toHaveBeenCalledWith(11, 6, admin);
  });

  it('uploads and unlinks attachments with exact affair, file, and user arguments', async () => {
    const file: UploadedFile = {
      originalname: '现场照片.png',
      mimetype: 'image/png',
      size: 8,
      buffer: Buffer.from('contents'),
    };
    files.saveAndLinkPropertyAffairFile.mockResolvedValue({
      id: 41,
      originalName: file.originalname,
    });
    files.unlinkPropertyAffairFile.mockResolvedValue({ id: 41 });
    const instance = controller();

    await expect(instance.upload(11, file, admin)).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { id: 41, originalName: '现场照片.png' },
    });
    await expect(instance.unlink(11, 41, admin)).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { id: 41 },
    });
    expect(files.saveAndLinkPropertyAffairFile).toHaveBeenCalledWith(
      11,
      file,
      admin,
    );
    expect(files.unlinkPropertyAffairFile).toHaveBeenCalledWith(11, 41, admin);
  });

  it.each([
    ['image/png', '现场 照片.png'],
    ['application/pdf', '维修单.pdf'],
  ])(
    'previews %s inline without returning storage metadata',
    async (mimeType, originalName) => {
      const content = Buffer.from('preview');
      files.readPropertyAffairFile.mockResolvedValue({
        asset: {
          id: 41,
          originalName,
          mimeType,
          storageKey: 'property-affairs/secret-key',
          storedName: 'secret-name',
        },
        content,
      });
      const response: MockResponse = {
        setHeader: jest.fn(),
        send: jest.fn(),
      };

      await expect(
        controller().preview(11, 41, response as Response),
      ).resolves.toBeUndefined();
      expect(files.readPropertyAffairFile).toHaveBeenCalledWith(11, 41);
      expect(response.setHeader).toHaveBeenCalledWith('Content-Type', mimeType);
      expect(response.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`,
      );
      expect(response.send).toHaveBeenCalledWith(content);
      expect(response.send).not.toHaveBeenCalledWith(
        expect.objectContaining({ storageKey: expect.anything() }),
      );
    },
  );

  it('rejects office-document preview with a Chinese download instruction', async () => {
    files.readPropertyAffairFile.mockResolvedValue({
      asset: {
        id: 42,
        originalName: '维修记录.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      content: Buffer.from('PK'),
    });
    const response: MockResponse = {
      setHeader: jest.fn(),
      send: jest.fn(),
    };

    await expect(
      controller().preview(11, 42, response as Response),
    ).rejects.toEqual(
      expect.objectContaining<Partial<BadRequestException>>({
        message: '该附件不支持在线预览，请下载后查看',
      }),
    );
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(response.send).not.toHaveBeenCalled();
  });

  it('downloads any authorized attachment with exact binary headers', async () => {
    const content = Buffer.from('PK');
    files.readPropertyAffairFile.mockResolvedValue({
      asset: {
        id: 42,
        originalName: '维修 记录.xlsx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        storageKey: 'property-affairs/secret-key',
        storedName: 'secret-name',
      },
      content,
    });
    const response: MockResponse = {
      setHeader: jest.fn(),
      send: jest.fn(),
    };

    await expect(
      controller().download(11, 42, response as Response),
    ).resolves.toBeUndefined();
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent('维修 记录.xlsx')}`,
    );
    expect(response.send).toHaveBeenCalledWith(content);
  });

  it('cleans released files only after permanent database deletion succeeds', async () => {
    const superAdmin = { ...admin, role: UserRole.SUPER_ADMIN };
    propertyAffairs.permanentDelete.mockResolvedValue([41, 42]);
    files.cleanupReleasedPropertyAffairFiles.mockResolvedValue({
      deletedFileIds: [41, 42],
    });

    await expect(
      controller().permanentDelete(11, { version: 8 }, superAdmin),
    ).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { id: 11 },
    });
    expect(propertyAffairs.permanentDelete).toHaveBeenCalledWith(
      11,
      8,
      superAdmin,
    );
    expect(files.cleanupReleasedPropertyAffairFiles).toHaveBeenCalledWith([
      41, 42,
    ]);
    expect(
      propertyAffairs.permanentDelete.mock.invocationCallOrder[0],
    ).toBeLessThan(
      files.cleanupReleasedPropertyAffairFiles.mock.invocationCallOrder[0],
    );
  });

  it('keeps permanent deletion successful when post-commit cleanup fails', async () => {
    const superAdmin = { ...admin, role: UserRole.SUPER_ADMIN };
    propertyAffairs.permanentDelete.mockResolvedValue([41]);
    files.cleanupReleasedPropertyAffairFiles.mockRejectedValue(
      new Error('C:\\secret\\storage failure'),
    );
    const instance = controller();
    const logger = (
      instance as never as { logger: { error: (message: string) => void } }
    ).logger;
    const logError = jest.spyOn(logger, 'error').mockImplementation();

    await expect(
      instance.permanentDelete(11, { version: 8 }, superAdmin),
    ).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { id: 11 },
    });
    expect(logError).toHaveBeenCalledWith('物业办事附件清理失败，需要稍后重试');
    expect(logError.mock.calls.flat().join(' ')).not.toContain('secret');
  });
});

describe('PropertyAffairsModule metadata', () => {
  it('provides the controller and service with file and audit dependencies and exports the service', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, PropertyAffairsModule),
    ).toEqual([FilesModule, SystemModule]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, PropertyAffairsModule),
    ).toEqual([PropertyAffairsController]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PropertyAffairsModule),
    ).toEqual([PropertyAffairsService]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, PropertyAffairsModule),
    ).toEqual([PropertyAffairsService]);
  });

  it('is registered exactly once by the application module', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AppModule,
    ) as unknown[];
    expect(
      imports.filter((item) => item === PropertyAffairsModule),
    ).toHaveLength(1);
  });
});
