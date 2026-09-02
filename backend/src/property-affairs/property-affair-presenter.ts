import { Prisma } from '@prisma/client';

export const propertyAffairInclude = {
  buildings: true,
  rooms: true,
  tenants: true,
  contracts: true,
  progresses: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
  files: { include: { fileAsset: true } },
} satisfies Prisma.PropertyAffairInclude;

export type PropertyAffairLoaded = Prisma.PropertyAffairGetPayload<{
  include: typeof propertyAffairInclude;
}>;

type CurrentTarget = {
  label: string;
  status: string;
  available: boolean;
};

export type PropertyAffairCurrentRelations = {
  buildings: Map<number, CurrentTarget>;
  rooms: Map<number, CurrentTarget>;
  tenants: Map<number, CurrentTarget>;
  contracts: Map<number, CurrentTarget>;
};

function presentRelation(
  id: number,
  snapshotLabel: string,
  current: CurrentTarget | undefined,
) {
  return {
    id,
    snapshotLabel,
    currentLabel: current?.label ?? snapshotLabel,
    currentStatus: current?.status ?? null,
    exists: current !== undefined,
    available: current?.available ?? false,
  };
}

export function presentPropertyAffair(
  affair: PropertyAffairLoaded,
  current: PropertyAffairCurrentRelations,
) {
  return {
    ...affair,
    version: Number(affair.version),
    buildings: affair.buildings.map((link) =>
      presentRelation(
        link.buildingId,
        link.targetLabel,
        current.buildings.get(link.buildingId),
      ),
    ),
    rooms: affair.rooms.map((link) =>
      presentRelation(
        link.roomId,
        link.targetLabel,
        current.rooms.get(link.roomId),
      ),
    ),
    tenants: affair.tenants.map((link) =>
      presentRelation(
        link.tenantId,
        link.targetLabel,
        current.tenants.get(link.tenantId),
      ),
    ),
    contracts: affair.contracts.map((link) =>
      presentRelation(
        link.contractId,
        link.targetLabel,
        current.contracts.get(link.contractId),
      ),
    ),
    progresses: affair.progresses.map((progress) => ({ ...progress })),
    files: affair.files.map(({ fileAsset }) => ({
      id: fileAsset.id,
      originalName: fileAsset.originalName,
      mimeType: fileAsset.mimeType,
      extension: fileAsset.extension,
      sizeBytes: fileAsset.sizeBytes.toString(),
      uploadedAt: fileAsset.uploadedAt,
    })),
  };
}
