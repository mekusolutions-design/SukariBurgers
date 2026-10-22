// apps/api/src/jobs/projection-rebuild.processor.ts
import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectionEngineService } from '../core/projection-engine.service';

@Processor('projection-rebuild')
@Injectable()
export class ProjectionRebuildProcessor {
  private readonly logger = new Logger(ProjectionRebuildProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectionEngine: ProjectionEngineService,
  ) {}

  @Process('rebuild-all')
  async handleRebuildAll(job: Job<{ shopId?: string }>) {
    const { shopId = '1' } = job.data || {};

    // SAFETY: updateProjections replays events through handlers that can consume
    // physical FEFO batches. A full replay is therefore not projection-only.
    // Refuse before deleting projections or reading/replaying events; otherwise a
    // queued rebuild can consume stock a second time or leave projections partial.
    const message =
      'Full projection rebuild is disabled until stock mutations are separated from projection replay.';
    this.logger.error(
      `Projection rebuild refused for shop ${shopId}: replay may mutate physical stock. No data was changed by this job.`,
    );
    throw new Error(message);
  }
}
