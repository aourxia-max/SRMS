import { assertContractVoidMutationDatabaseSafety } from './support/contract-void-mutation-database-guard';

describe('contract void mutation database safety', () => {
  it('拒绝在共享持久测试库运行 mutation proof', () => {
    expect(() =>
      assertContractVoidMutationDatabaseSafety(
        'mysql://user:secret@127.0.0.1:13306/srms_docker',
        true,
      ),
    ).toThrow('合同纠错 mutation 只能运行在本机一次性数据库');
  });

  it('拒绝名称合规但不在本机的 mutation 数据库', () => {
    expect(() =>
      assertContractVoidMutationDatabaseSafety(
        'mysql://user:secret@database.example/srms_contract_void_mutation_round2',
        true,
      ),
    ).toThrow('合同纠错 mutation 只能运行在本机一次性数据库');
  });

  it('允许本机唯一命名的一次性 mutation 数据库', () => {
    expect(() =>
      assertContractVoidMutationDatabaseSafety(
        'mysql://user:secret@localhost:13306/srms_contract_void_mutation_round2',
        true,
      ),
    ).not.toThrow();
  });

  it('普通 GREEN E2E 不要求一次性数据库', () => {
    expect(() =>
      assertContractVoidMutationDatabaseSafety(
        'mysql://user:secret@127.0.0.1:13306/srms_docker',
        false,
      ),
    ).not.toThrow();
  });
});
