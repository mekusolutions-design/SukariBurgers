import { ProjectionRebuildProcessor } from './projection-rebuild.processor';

describe('ProjectionRebuildProcessor safety', () => {
  it('refuses a full rebuild before deleting projections or replaying events', async () => {
    const prisma = {
      inventoryProjection: { deleteMany: jest.fn() },
      wasteProjection: { deleteMany: jest.fn() },
      salesProjection: { deleteMany: jest.fn() },
      event: { findMany: jest.fn() },
    };
    const projectionEngine = { updateProjections: jest.fn() };
    const processor = new ProjectionRebuildProcessor(
      prisma as never,
      projectionEngine as never,
    );

    await expect(
      processor.handleRebuildAll({ data: { shopId: '1' } } as never),
    ).rejects.toThrow(
      'Full projection rebuild is disabled until stock mutations are separated from projection replay.',
    );

    expect(prisma.inventoryProjection.deleteMany).not.toHaveBeenCalled();
    expect(prisma.wasteProjection.deleteMany).not.toHaveBeenCalled();
    expect(prisma.salesProjection.deleteMany).not.toHaveBeenCalled();
    expect(prisma.event.findMany).not.toHaveBeenCalled();
    expect(projectionEngine.updateProjections).not.toHaveBeenCalled();
  });
});
