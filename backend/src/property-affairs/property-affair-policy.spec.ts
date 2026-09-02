import { PropertyAffairStatus } from '@prisma/client';
import { assertPropertyAffairTransition } from './property-affair-policy';

describe('assertPropertyAffairTransition', () => {
  it.each([
    [PropertyAffairStatus.PENDING, PropertyAffairStatus.IN_PROGRESS],
    [PropertyAffairStatus.PENDING, PropertyAffairStatus.COMPLETED],
    [PropertyAffairStatus.PENDING, PropertyAffairStatus.CANCELLED],
    [PropertyAffairStatus.IN_PROGRESS, PropertyAffairStatus.COMPLETED],
    [PropertyAffairStatus.IN_PROGRESS, PropertyAffairStatus.CANCELLED],
    [PropertyAffairStatus.COMPLETED, PropertyAffairStatus.IN_PROGRESS],
    [PropertyAffairStatus.CANCELLED, PropertyAffairStatus.IN_PROGRESS],
  ])('allows %s -> %s', (from, to) => {
    expect(() => assertPropertyAffairTransition(from, to)).not.toThrow();
  });

  it.each(Object.values(PropertyAffairStatus))(
    'allows %s -> %s as a no-op',
    (status) => {
      expect(() =>
        assertPropertyAffairTransition(status, status),
      ).not.toThrow();
    },
  );

  it.each([
    [PropertyAffairStatus.IN_PROGRESS, PropertyAffairStatus.PENDING],
    [PropertyAffairStatus.COMPLETED, PropertyAffairStatus.PENDING],
    [PropertyAffairStatus.CANCELLED, PropertyAffairStatus.PENDING],
    [PropertyAffairStatus.COMPLETED, PropertyAffairStatus.CANCELLED],
    [PropertyAffairStatus.CANCELLED, PropertyAffairStatus.COMPLETED],
  ])('rejects %s -> %s with Chinese copy', (from, to) => {
    expect(() => assertPropertyAffairTransition(from, to)).toThrow(
      '事项状态不能这样变更',
    );
  });
});
