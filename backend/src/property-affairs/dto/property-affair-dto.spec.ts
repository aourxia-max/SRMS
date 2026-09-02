import 'reflect-metadata';
import { PropertyAffairPriority, PropertyAffairStatus } from '@prisma/client';
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

describe('property-affair DTOs', () => {
  it('trims create fields, normalizes blank optionals, and applies defaults', async () => {
    const dto = plainToInstance(CreatePropertyAffairDto, {
      title: '  电梯异响  ',
      content: '  已通知维保单位  ',
      category: '  ',
      externalHandlerName: '  ',
      externalPhone: '  ',
      externalContact: '  ',
    });

    expect(dto).toMatchObject({
      title: '电梯异响',
      content: '已通知维保单位',
      category: undefined,
      externalHandlerName: undefined,
      externalPhone: undefined,
      externalContact: undefined,
      priority: PropertyAffairPriority.NORMAL,
      buildingIds: [],
      roomIds: [],
      tenantIds: [],
      contractIds: [],
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    ['title', { title: ' ', content: '有效内容' }],
    ['content', { title: '有效标题', content: ' ' }],
    ['title', { title: 'a'.repeat(201), content: '有效内容' }],
    ['content', { title: '有效标题', content: 'a'.repeat(5001) }],
  ])('rejects invalid required %s values', async (property, input) => {
    const dto = plainToInstance(CreatePropertyAffairDto, input);

    await expect(invalidProperties(dto)).resolves.toContain(property);
  });

  it.each([
    ['category', { category: 'a'.repeat(81) }],
    ['externalHandlerName', { externalHandlerName: 'a'.repeat(101) }],
    ['externalPhone', { externalPhone: 'a'.repeat(51) }],
    ['externalContact', { externalContact: 'a'.repeat(201) }],
  ])(
    'rejects optional text beyond the %s limit',
    async (property, optionalField) => {
      const dto = plainToInstance(CreatePropertyAffairDto, {
        title: '有效标题',
        content: '有效内容',
        ...optionalField,
      });

      await expect(invalidProperties(dto)).resolves.toContain(property);
    },
  );

  it('rejects invalid create priority and client-selected status', async () => {
    const priorityDto = plainToInstance(CreatePropertyAffairDto, {
      title: '有效标题',
      content: '有效内容',
      priority: 'LATER',
    });
    const statusDto = plainToInstance(CreatePropertyAffairDto, {
      title: '有效标题',
      content: '有效内容',
      status: PropertyAffairStatus.COMPLETED,
    });

    await expect(invalidProperties(priorityDto)).resolves.toContain('priority');
    await expect(
      validate(statusDto, { whitelist: true, forbidNonWhitelisted: true }),
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'status' })]),
    );
  });

  it('accepts numeric relation strings and rejects duplicate or non-positive relation IDs', async () => {
    const valid = plainToInstance(CreatePropertyAffairDto, {
      title: '有效标题',
      content: '有效内容',
      buildingIds: ['1'],
    });
    const invalid = plainToInstance(CreatePropertyAffairDto, {
      title: '有效标题',
      content: '有效内容',
      roomIds: [1, 1],
      tenantIds: [0],
      contractIds: [1.5],
    });

    expect(valid.buildingIds).toEqual([1]);
    await expect(validate(valid)).resolves.toHaveLength(0);
    await expect(invalidProperties(invalid)).resolves.toEqual(
      expect.arrayContaining(['roomIds', 'tenantIds', 'contractIds']),
    );
  });

  it('requires a positive version and validates editable update fields', async () => {
    const valid = plainToInstance(UpdatePropertyAffairDto, {
      version: '2',
      title: '  更新后的标题  ',
      status: PropertyAffairStatus.IN_PROGRESS,
      responsibleUserId: '3',
    });
    const invalid = plainToInstance(UpdatePropertyAffairDto, {
      version: 0,
      status: 'LATER',
      responsibleUserId: 0,
    });

    expect(valid).toMatchObject({
      version: 2,
      title: '更新后的标题',
      responsibleUserId: 3,
    });
    await expect(validate(valid)).resolves.toHaveLength(0);
    await expect(invalidProperties(invalid)).resolves.toEqual(
      expect.arrayContaining(['version', 'status', 'responsibleUserId']),
    );
  });

  it('keeps every update relation field truly optional when omitted', async () => {
    const dto = plainToInstance(UpdatePropertyAffairDto, {
      version: 2,
      title: '只修改标题',
    });

    expect(dto.buildingIds).toBeUndefined();
    expect(dto.roomIds).toBeUndefined();
    expect(dto.tenantIds).toBeUndefined();
    expect(dto.contractIds).toBeUndefined();
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('accepts null only for explicitly clearable update fields and keeps blanks as undefined', async () => {
    const clearable = plainToInstance(UpdatePropertyAffairDto, {
      version: 1,
      category: null,
      responsibleUserId: null,
      externalHandlerName: null,
      externalPhone: null,
      externalContact: null,
    });
    const blank = plainToInstance(UpdatePropertyAffairDto, {
      version: 1,
      category: '   ',
      externalHandlerName: '   ',
      externalPhone: '   ',
      externalContact: '   ',
    });
    const invalid = plainToInstance(UpdatePropertyAffairDto, {
      version: null,
      title: null,
      content: null,
      priority: null,
      status: null,
      buildingIds: null,
      roomIds: null,
      tenantIds: null,
      contractIds: null,
    });

    expect(clearable).toMatchObject({
      category: null,
      responsibleUserId: null,
      externalHandlerName: null,
      externalPhone: null,
      externalContact: null,
    });
    await expect(validate(clearable)).resolves.toHaveLength(0);
    expect(blank).toMatchObject({
      category: undefined,
      externalHandlerName: undefined,
      externalPhone: undefined,
      externalContact: undefined,
    });
    await expect(validate(blank)).resolves.toHaveLength(0);
    await expect(invalidProperties(invalid)).resolves.toEqual(
      expect.arrayContaining([
        'version',
        'title',
        'content',
        'priority',
        'status',
        'buildingIds',
        'roomIds',
        'tenantIds',
        'contractIds',
      ]),
    );
  });

  it('requires trimmed progress content, a positive version, and a valid next status', async () => {
    const valid = plainToInstance(AppendPropertyAffairProgressDto, {
      version: '3',
      content: '  已联系维修单位  ',
      nextStatus: PropertyAffairStatus.IN_PROGRESS,
    });
    const invalid = plainToInstance(AppendPropertyAffairProgressDto, {
      version: 0,
      content: ' ',
      nextStatus: 'LATER',
    });

    expect(valid).toMatchObject({ version: 3, content: '已联系维修单位' });
    await expect(validate(valid)).resolves.toHaveLength(0);
    await expect(invalidProperties(invalid)).resolves.toEqual(
      expect.arrayContaining(['version', 'content', 'nextStatus']),
    );
  });

  it.each([0, -1, 1.5, 'invalid'])(
    'rejects an invalid reusable version: %p',
    async (version) => {
      const dto = plainToInstance(PropertyAffairVersionDto, { version });

      await expect(invalidProperties(dto)).resolves.toContain('version');
    },
  );

  it('trims list search, normalizes blank search, and applies pagination defaults', async () => {
    const query = plainToInstance(ListPropertyAffairsQueryDto, {
      keyword: '  电梯  ',
      category: '  ',
      buildingId: '1',
      roomId: '2',
      tenantId: '3',
      contractId: '4',
      responsibleUserId: '5',
    });

    expect(query).toMatchObject({
      keyword: '电梯',
      category: undefined,
      page: 1,
      pageSize: 20,
      buildingId: 1,
      roomId: 2,
      tenantId: 3,
      contractId: 4,
      responsibleUserId: 5,
    });
    await expect(validate(query)).resolves.toHaveLength(0);
  });

  it.each([
    { keyword: 'a'.repeat(101) },
    { page: 0 },
    { page: 1.5 },
    { pageSize: 101 },
    { status: 'LATER' },
    { priority: 'LATER' },
    { responsibleUserId: 0 },
    { buildingId: 0 },
    { roomId: 0 },
    { tenantId: 0 },
    { contractId: 0 },
  ])('rejects invalid list query values: %o', async (input) => {
    const query = plainToInstance(ListPropertyAffairsQueryDto, input);

    await expect(validate(query)).resolves.not.toHaveLength(0);
  });
});
