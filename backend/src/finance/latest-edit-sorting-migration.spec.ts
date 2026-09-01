import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('latest edited sorting migration', () => {
  const migration = readFileSync(
    resolve(
      __dirname,
      '../../prisma/migrations/20260901100000_add_latest_edit_sorting/migration.sql',
    ),
    'utf8',
  );

  it('backfills only rows that existed before the migration started', () => {
    const tables = [
      'export_tasks',
      'rent_bills',
      'payments',
      'payment_refunds',
      'checkout_settlements',
      'deposit_refunds',
    ];

    for (const table of tables) {
      expect(migration).toContain(`@srms_${table}_high_water_id`);
      expect(migration).toMatch(
        new RegExp(
          `UPDATE[\\s\\S]*?${table}[\\s\\S]*?id[\\s\\S]*?<=\\s*@srms_${table}_high_water_id`,
          'i',
        ),
      );
    }
  });
});
