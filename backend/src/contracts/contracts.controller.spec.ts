import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { ContractsController } from './contracts.controller';
import type { CreateFixedContractDto } from './dto/create-fixed-contract.dto';

const admin: AuthUser = {
  id: 7,
  username: 'admin',
  displayName: 'Admin',
  role: UserRole.ADMIN,
};

describe('ContractsController', () => {
  it('rejects commission data from an admin before creating a fixed contract', async () => {
    const createFixedContract = jest.fn();
    const controller = new ContractsController(
      { createFixedContract } as never,
      {} as never,
    );
    const createFixed = controller.createFixed as unknown as (
      dto: CreateFixedContractDto,
      user: AuthUser,
    ) => Promise<unknown>;

    await expect(
      createFixed(
        {
          roomId: 1,
          startDate: '2026-08-05',
          endDate: '2027-08-04',
          monthlyRent: '3000',
          primaryTenantId: 2,
          commission: { recipientName: 'Broker', amount: '500' },
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(createFixedContract).not.toHaveBeenCalled();
  });
});
