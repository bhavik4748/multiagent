import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
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

  constructor(private readonly documents: DocumentService) {}

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
    const artifacts = await this.documents.createArtifacts(
      outputDirectory,
      'resume',
      run.finalResume,
    );
    const relativeArtifacts = this.relativeArtifacts(
      artifacts,
      outputDirectory,
    );
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
    await mkdir(outputDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        join(outputDirectory, relativeArtifacts.contentPath),
        artifacts.markdown,
        'utf8',
      ),
      writeFile(
        join(outputDirectory, relativeArtifacts.changeLogPath),
        run.finalResume.changeLog.join('\n'),
        'utf8',
      ),
      writeFile(
        join(outputDirectory, relativeArtifacts.reviewReportPath),
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
        join(outputDirectory, relativeArtifacts.metadataPath),
        JSON.stringify(metadata, null, 2),
        'utf8',
      ),
    ]);
    const manifest = await this.getManifest();
    manifest.unshift(metadata);
    await mkdir(resolve(this.manifestPath, '..'), { recursive: true });
    await writeFile(
      this.manifestPath,
      JSON.stringify(manifest, null, 2),
      'utf8',
    );
    return metadata;
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
      return JSON.parse(
        await readFile(this.manifestPath, 'utf8'),
      ) as ResumeVersionMetadata[];
    } catch {
      return [];
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

  private relativeArtifacts(
    artifacts: { docxPath: string; pdfPath: string },
    outputDirectory: string,
  ): ResumeVersionArtifacts {
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
}
