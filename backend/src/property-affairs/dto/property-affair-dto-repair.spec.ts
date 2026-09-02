import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppendPropertyAffairProgressDto } from './append-property-affair-progress.dto';
import { CreatePropertyAffairDto } from './create-property-affair.dto';
import { ListPropertyAffairsQueryDto } from './list-property-affairs-query.dto';
import { PropertyAffairVersionDto } from './property-affair-version.dto';
import { UpdatePropertyAffairDto } from './update-property-affair.dto';

async function invalidProperties(instance: object): Promise<string[]> {
  return (await validate(instance)).map((error) => error.property);
}

async function validationMessages(instance: object): Promise<string[]> {
  return (await validate(instance)).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

describe('property-affair DTO repair contract', () => {
  it('rejects explicit null for optional typed create, update, and progress fields', async () => {
    const create = plainToInstance(CreatePropertyAffairDto, {
      title: '有效标题',
      content: '有效内容',
      responsibleUserId: null,
    });
    const update = plainToInstance(UpdatePropertyAffairDto, {
      version: 1,
      priority: null,
      responsibleUserId: null,
      status: null,
    });
    const progress = plainToInstance(AppendPropertyAffairProgressDto, {
      version: 1,
      content: '有效进度',
      nextStatus: null,
    });

    await expect(invalidProperties(create)).resolves.toContain(
      'responsibleUserId',
    );
    const updateInvalid = await invalidProperties(update);
    expect(updateInvalid).toEqual(
      expect.arrayContaining(['priority', 'status']),
    );
    expect(updateInvalid).not.toContain('responsibleUserId');
    await expect(invalidProperties(progress)).resolves.toContain('nextStatus');
  });

  it('rejects explicit null for every typed list filter and pagination field', async () => {
    const query = plainToInstance(ListPropertyAffairsQueryDto, {
      status: null,
      priority: null,
      responsibleUserId: null,
      buildingId: null,
      roomId: null,
      tenantId: null,
      contractId: null,
      page: null,
      pageSize: null,
    });

    await expect(invalidProperties(query)).resolves.toEqual(
      expect.arrayContaining([
        'status',
        'priority',
        'responsibleUserId',
        'buildingId',
        'roomId',
        'tenantId',
        'contractId',
        'page',
        'pageSize',
      ]),
    );
  });

  it('returns Chinese messages for malformed affair input', async () => {
    const dto = plainToInstance(CreatePropertyAffairDto, {
      title: null,
      content: '有效内容',
      priority: 'LATER',
      responsibleUserId: null,
      buildingIds: [1, 1],
    });

    await expect(validationMessages(dto)).resolves.toEqual(
      expect.arrayContaining([
        '标题必须为文本',
        '标题长度必须为1至200个字符',
        '优先级无效',
        '负责人编号必须为整数',
        '楼栋编号不能重复',
      ]),
    );
  });

  it('uses a list pageSize default of 20', async () => {
    const query = plainToInstance(ListPropertyAffairsQueryDto, {});

    expect(query.pageSize).toBe(20);
    await expect(validate(query)).resolves.toHaveLength(0);
  });

  it('trims nonblank optional contact fields', async () => {
    const dto = plainToInstance(CreatePropertyAffairDto, {
      title: '有效标题',
      content: '有效内容',
      category: '  公共维修  ',
      externalHandlerName: '  物业公司  ',
      externalPhone: '  010-12345678  ',
      externalContact: '  张师傅（微信同号）  ',
    });

    expect(dto).toMatchObject({
      category: '公共维修',
      externalHandlerName: '物业公司',
      externalPhone: '010-12345678',
      externalContact: '张师傅（微信同号）',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    ['buildingIds', { buildingIds: [1, 1] }],
    ['roomIds', { roomIds: [0] }],
    ['tenantIds', { tenantIds: [1, 1] }],
    ['contractIds', { contractIds: [0] }],
  ])('rejects malformed %s relations', async (property, relation) => {
    const dto = plainToInstance(CreatePropertyAffairDto, {
      title: '有效标题',
      content: '有效内容',
      ...relation,
    });

    await expect(invalidProperties(dto)).resolves.toContain(property);
  });

  it('returns a Chinese validation message for an invalid version', async () => {
    const dto = plainToInstance(PropertyAffairVersionDto, { version: 0 });

    await expect(validationMessages(dto)).resolves.toContain(
      '版本号必须为正整数',
    );
  });
});
