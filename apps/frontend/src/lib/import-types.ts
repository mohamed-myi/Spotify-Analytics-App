// Import Types: Matches backend response shapes from apps/backend/src/types/import.ts

export type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface ImportProgress {
    status: JobStatus;
    totalRecords: number;
    processedRecords: number;
    addedRecords: number;
    skippedRecords: number;
    errorMessage?: string;
}

export interface ImportJob {
    id: string;
    fileName: string;
    status: JobStatus;
    totalEvents: number;
    processedEvents: number;
    errorMessage?: string | null;
    createdAt: string;
    startedAt?: string | null;
    completedAt?: string | null;
}

export interface ImportJobsResponse {
    jobs: ImportJob[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
    };
}

export interface FileUploadState {
    file: File;
    jobId?: string;
    progress?: ImportProgress;
    error?: string;
}

