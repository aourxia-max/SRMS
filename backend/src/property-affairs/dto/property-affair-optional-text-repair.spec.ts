import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePropertyAffairDto } from './create-property-affair.dto';
import { ListPropertyAffairsQueryDto } from './list-property-affairs-query.dto';
import { UpdatePropertyAffairDto } from './update-property-affair.dto';

async function validationErrors(instance: object) {
  return validate(instance);
}

describe('property-affair optional text null contract', () => {
  it('rejects explicit null for every optional create text field with Chinese messages', async () => {
    const dto = plainToInstance(CreatePropertyAffairDto, {
      title: '有效标题',
      content: '有效内容',
      category: null,
      externalHandlerName: null,
      externalPhone: null,
      externalContact: null,
    });

    const errors = await validationErrors(dto);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'category',
        'externalHandlerName',
        'externalPhone',
        'externalContact',
      ]),
    );
    expect(
      errors.flatMap((error) => Object.values(error.constraints ?? {})),
    ).toEqual(
      expect.arrayContaining([
        '分类必须为文本',
        '外部处理人必须为文本',
        '外部联系电话必须为文本',
        '其他联系方式必须为文本',
      ]),
    );
  });

  it('rejects null for update required text while accepting clearable text', async () => {
    const dto = plainToInstance(UpdatePropertyAffairDto, {
      version: 1,
      title: null,
      category: null,
      content: null,
      externalHandlerName: null,
      externalPhone: null,
      externalContact: null,
    });

    const errors = await validationErrors(dto);

    expect(errors.map((error) => error.property).sort()).toEqual([
      'content',
      'title',
    ]);
  });

  it('rejects explicit null for optional list text filters', async () => {
    const dto = plainToInstance(ListPropertyAffairsQueryDto, {
      keyword: null,
      category: null,
    });

    const errors = await validationErrors(dto);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['keyword', 'category']),
    );
    expect(
      errors.flatMap((error) => Object.values(error.constraints ?? {})),
    ).toEqual(expect.arrayContaining(['关键词必须为文本', '分类必须为文本']));
  });
});
