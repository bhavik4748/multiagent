import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, join, resolve, sep } from 'node:path';
import type {
  ResumeVersionArtifacts,
  ResumeVersionMetadata,
  ResumeVersionType,
  TailoringRunResult,
} from '@resume-tweak/contracts';
import { DocumentService } from './document.service';

@Injectable()
export class VersionService {
  private readonly versionsRoot = resolve(__dirname, '../../../data/versions');
  private readonly manifestPath = resolve(
    __dirname,
    '../../../data/manifests/resume-versions.json',
  );
  private manifestWrite: Promise<void> = Promise.resolve();

  constructor(private readonly documents: DocumentService) { }

  async createApprovedVersion(
    run: TailoringRunResult,
    options: {
      versionType: ResumeVersionType;
      track?: string;
      company?: string;
    },
  ): Promise<ResumeVersionMetadata> {
    if (!run.finalResume || !run.jobProfile || !run.approvedAt) {
      throw new Error(
        'A reviewed and approved run is required to create a version.',
      );
    }
    const versionId = `version-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const roleSlug = this.slugify(run.jobProfile.targetRole) || 'resume';
    const date = createdAt.slice(0, 10);
    const outputDirectory = this.outputDirectory(
      options,
      roleSlug,
      date,
      versionId,
    );
    const temporaryDirectory = `${outputDirectory}.tmp-${randomUUID()}`;
    try {
      const artifacts = await this.documents.createArtifacts(
        temporaryDirectory,
        'resume',
        run.finalResume,
      );
      const relativeArtifacts = this.relativeArtifacts(artifacts);
      const metadata: ResumeVersionMetadata = {
        versionId,
        versionType: options.versionType,
        track: options.track?.trim() || undefined,
        sourceResumeId: run.resumeId,
        tailoringRunId: run.runId,
        targetRole: run.jobProfile.targetRole,
        company: options.company?.trim() || undefined,
        createdAt,
        jobDescriptionHash: this.documents.hashText(
          JSON.stringify(run.jobProfile),
        ),
        modelProfileId: run.modelProfileId,
        deployment: run.deployment,
        includedKeywords: run.jobProfile.keywords,
        unresolvedGaps: run.finalResume.unresolvedGaps,
        artifacts: relativeArtifacts,
        approvedAt: run.approvedAt,
      };
      if (!this.isValidMetadata(metadata)) {
        throw new BadRequestException('Generated version metadata is invalid.');
      }
      await Promise.all([
        writeFile(
          join(temporaryDirectory, relativeArtifacts.contentPath),
          artifacts.markdown,
          'utf8',
        ),
        writeFile(
          join(temporaryDirectory, relativeArtifacts.changeLogPath),
          run.finalResume.changeLog.join('\n'),
          'utf8',
        ),
        writeFile(
          join(temporaryDirectory, relativeArtifacts.reviewReportPath),
          JSON.stringify(
            {
              ats: run.atsReview,
              readability: run.readabilityReview,
              decisions: run.finalResume.decisions,
            },
            null,
            2,
          ),
          'utf8',
        ),
        writeFile(
          join(temporaryDirectory, relativeArtifacts.metadataPath),
          JSON.stringify(metadata, null, 2),
          'utf8',
        ),
      ]);
      await mkdir(resolve(outputDirectory, '..'), { recursive: true });
      await rename(temporaryDirectory, outputDirectory);
      await this.updateManifest(metadata);
      return metadata;
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      await rm(outputDirectory, { recursive: true, force: true });
      await this.removeEmptyParents(resolve(outputDirectory, '..'));
      throw error;
    }
  }

  async listVersions(): Promise<ResumeVersionMetadata[]> {
    return this.getManifest();
  }

  async getVersion(versionId: string): Promise<ResumeVersionMetadata> {
    const version = (await this.getManifest()).find(
      (entry) => entry.versionId === versionId,
    );
    if (!version)
      throw new NotFoundException(
        `Resume version '${versionId}' was not found.`,
      );
    return version;
  }

  async getArtifact(
    versionId: string,
    kind: 'docx' | 'pdf',
  ): Promise<{ path: string; filename: string }> {
    const version = await this.getVersion(versionId);
    const directory = this.outputDirectoryFor(version);
    const relativePath =
      kind === 'docx' ? version.artifacts.docxPath : version.artifacts.pdfPath;
    const path = resolve(directory, relativePath);
    if (!path.startsWith(directory))
      throw new NotFoundException('Version artifact was not found.');
    try {
      await access(path);
    } catch {
      throw new NotFoundException('Version artifact was not found.');
    }
    return {
      path,
      filename: `${this.slugify(version.targetRole) || 'resume'}-${version.createdAt.slice(0, 10)}.${kind}`,
    };
  }

  async getSourceResumeId(versionId: string): Promise<string> {
    const version = await this.getVersion(versionId);
    if (!version.sourceResumeId) {
      throw new BadRequestException(
        'The saved version has no reusable factual profile.',
      );
    }
    return version.sourceResumeId;
  }

  private async getManifest(): Promise<ResumeVersionMetadata[]> {
    try {
      const manifest = JSON.parse(
        await readFile(this.manifestPath, 'utf8'),
      ) as ResumeVersionMetadata[];
      if (
        !Array.isArray(manifest) ||
        !manifest.every((entry) => this.isValidMetadata(entry))
      ) {
        throw new Error('The version manifest contains invalid metadata.');
      }
      return manifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new BadRequestException(
        'The version manifest is unavailable or invalid and was not modified.',
      );
    }
  }

  private async updateManifest(metadata: ResumeVersionMetadata): Promise<void> {
    const previousWrite = this.manifestWrite;
    let release!: () => void;
    this.manifestWrite = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previousWrite;
    try {
      const manifest = await this.getManifest();
      manifest.unshift(metadata);
      await mkdir(resolve(this.manifestPath, '..'), { recursive: true });
      const temporaryManifest = `${this.manifestPath}.tmp-${randomUUID()}`;
      await writeFile(
        temporaryManifest,
        JSON.stringify(manifest, null, 2),
        'utf8',
      );
      await rename(temporaryManifest, this.manifestPath);
    } finally {
      release();
    }
  }

  private outputDirectory(
    options: {
      versionType: ResumeVersionType;
      track?: string;
      company?: string;
    },
    roleSlug: string,
    date: string,
    versionId: string,
  ): string {
    if (options.versionType === 'general')
      return join(this.versionsRoot, 'general', versionId);
    if (options.versionType === 'targeted')
      return join(
        this.versionsRoot,
        'targeted',
        this.slugify(options.track ?? 'general') || 'general',
        versionId,
      );
    return join(
      this.versionsRoot,
      'job-specific',
      `${this.slugify(options.company ?? 'company') || 'company'}-${roleSlug}-${date}`,
      versionId,
    );
  }

  private outputDirectoryFor(version: ResumeVersionMetadata): string {
    return this.outputDirectory(
      {
        versionType: version.versionType,
        track: version.track,
        company: version.company,
      },
      this.slugify(version.targetRole) || 'resume',
      version.createdAt.slice(0, 10),
      version.versionId,
    );
  }

  private relativeArtifacts(artifacts: {
    docxPath: string;
    pdfPath: string;
  }): ResumeVersionArtifacts {
    return {
      docxPath: basename(artifacts.docxPath),
      pdfPath: basename(artifacts.pdfPath),
      contentPath: 'resume-content.md',
      metadataPath: 'metadata.json',
      changeLogPath: 'change-log.md',
      reviewReportPath: 'review-report.json',
    };
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  private isValidMetadata(value: unknown): value is ResumeVersionMetadata {
    if (!value || typeof value !== 'object') return false;
    const metadata = value as Partial<ResumeVersionMetadata>;
    return (
      typeof metadata.versionId === 'string' &&
      ['general', 'targeted', 'job-specific'].includes(
        metadata.versionType ?? '',
      ) &&
      typeof metadata.sourceResumeId === 'string' &&
      typeof metadata.tailoringRunId === 'string' &&
      typeof metadata.targetRole === 'string' &&
      typeof metadata.createdAt === 'string' &&
      typeof metadata.jobDescriptionHash === 'string' &&
      typeof metadata.modelProfileId === 'string' &&
      typeof metadata.deployment === 'string' &&
      Array.isArray(metadata.includedKeywords) &&
      Array.isArray(metadata.unresolvedGaps) &&
      typeof metadata.approvedAt === 'string' &&
      Boolean(
        metadata.artifacts &&
        typeof metadata.artifacts.docxPath === 'string' &&
        typeof metadata.artifacts.pdfPath === 'string' &&
        typeof metadata.artifacts.contentPath === 'string' &&
        typeof metadata.artifacts.metadataPath === 'string' &&
        typeof metadata.artifacts.changeLogPath === 'string' &&
        typeof metadata.artifacts.reviewReportPath === 'string',
      )
    );
  }

  private async removeEmptyParents(directory: string): Promise<void> {
    let current = directory;
    while (
      current !== this.versionsRoot &&
      current.startsWith(`${this.versionsRoot}${sep}`)
    ) {
      try {
        await rmdir(current);
      } catch {
        return;
      }
      current = resolve(current, '..');
    }
  }
}
