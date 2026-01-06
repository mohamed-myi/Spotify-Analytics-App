import { useState, useCallback, useEffect } from 'react';
import useSWR from 'swr';
import { api, fetcher } from '@/lib/api';
import type {
    ImportProgress,
    ImportJob,
    ImportJobsResponse,
    FileUploadState,
    JobStatus,
} from '@/lib/import-types';

const POLL_INTERVAL = 2000;

function isTerminalStatus(status: JobStatus): boolean {
    return status === 'COMPLETED' || status === 'FAILED';
}

export function useImport() {
    // Local queue of files waiting to be uploaded
    const [uploadQueue, setUploadQueue] = useState<File[]>([]);

    // Files currently being uploaded or processed (with their job state)
    const [uploads, setUploads] = useState<FileUploadState[]>([]);

    // Job IDs that are actively being polled
    const [activeJobIds, setActiveJobIds] = useState<string[]>([]);

    // Derived state: do we have jobs that need polling?
    const hasActiveJobs = activeJobIds.length > 0;

    // Track if we are in the middle of uploading files
    const [isUploading, setIsUploading] = useState(false);

    // SWR for fetching import job history (History tab)
    const {
        data: jobsData,
        mutate: mutateJobs,
        isLoading: isLoadingJobs,
    } = useSWR<ImportJobsResponse>('/me/import/jobs?limit=20', fetcher);

    // SWR poller for active job status
    // Uses conditional refreshInterval: polls when hasActiveJobs, stops otherwise
    const { data: statusData, mutate: mutateStatus } = useSWR<Record<string, ImportProgress>>(
        hasActiveJobs ? ['import-status', activeJobIds] : null,
        async () => {
            const results: Record<string, ImportProgress> = {};
            await Promise.all(
                activeJobIds.map(async (jobId) => {
                    try {
                        const res = await api.get<ImportProgress>(`/me/import/status?jobId=${jobId}`);
                        results[jobId] = res.data;
                    } catch {
                        // Job may have expired from Redis; mark as unknown
                        results[jobId] = {
                            status: 'FAILED',
                            totalRecords: 0,
                            processedRecords: 0,
                            addedRecords: 0,
                            skippedRecords: 0,
                            errorMessage: 'Status unavailable',
                        };
                    }
                })
            );
            return results;
        },
        {
            refreshInterval: hasActiveJobs ? POLL_INTERVAL : 0,
            revalidateOnFocus: false,
        }
    );

    // Update uploads state when status data changes
    useEffect(() => {
        if (!statusData) return;

        setUploads((prev) =>
            prev.map((upload) => {
                if (upload.jobId && statusData[upload.jobId]) {
                    return { ...upload, progress: statusData[upload.jobId] };
                }
                return upload;
            })
        );

        // Remove terminal jobs from activeJobIds to stop polling
        const stillActive = activeJobIds.filter((id) => {
            const progress = statusData[id];
            return progress && !isTerminalStatus(progress.status);
        });

        if (stillActive.length !== activeJobIds.length) {
            setActiveJobIds(stillActive);
            // Refresh history when jobs complete
            mutateJobs();
        }
    }, [statusData, activeJobIds, mutateJobs]);

    // Add files to upload queue
    const addFiles = useCallback((files: File[]) => {
        const jsonFiles = files.filter((f) => f.name.endsWith('.json'));
        setUploadQueue((prev) => [...prev, ...jsonFiles]);
    }, []);

    // Remove a file from upload queue (before upload starts)
    const removeFromQueue = useCallback((index: number) => {
        setUploadQueue((prev) => prev.filter((_, i) => i !== index));
    }, []);

    // Remove an upload from the active uploads list
    const removeUpload = useCallback((jobId: string) => {
        setUploads((prev) => prev.filter((u) => u.jobId !== jobId));
        setActiveJobIds((prev) => prev.filter((id) => id !== jobId));
    }, []);

    // Start uploading all files in queue (parallel with individual error handling)
    const startUpload = useCallback(async () => {
        if (uploadQueue.length === 0) return;

        setIsUploading(true);

        // Move queue to uploads with pending state
        const newUploads: FileUploadState[] = uploadQueue.map((file) => ({
            file,
            progress: {
                status: 'PENDING' as JobStatus,
                totalRecords: 0,
                processedRecords: 0,
                addedRecords: 0,
                skippedRecords: 0,
            },
        }));

        setUploads((prev) => [...prev, ...newUploads]);
        setUploadQueue([]);

        // Upload all files in parallel with individual try/catch
        const uploadPromises = newUploads.map(async (uploadState, index) => {
            const formData = new FormData();
            formData.append('file', uploadState.file);

            try {
                const res = await api.post<{ jobId: string; message: string }>(
                    '/me/import/spotify-history',
                    formData,
                    { headers: { 'Content-Type': 'multipart/form-data' } }
                );

                return { index, jobId: res.data.jobId, error: undefined };
            } catch (err) {
                const axiosError = err as { response?: { data?: { error?: string } }; message?: string };
                const errorMsg = axiosError.response?.data?.error || axiosError.message || 'Upload failed';
                return { index, jobId: undefined, error: errorMsg };
            }
        });

        const results = await Promise.all(uploadPromises);

        // Update uploads with job IDs or errors
        setUploads((prev) => {
            const updated = [...prev];
            const startIndex = prev.length - newUploads.length;

            results.forEach((result) => {
                const uploadIndex = startIndex + result.index;
                if (result.jobId) {
                    updated[uploadIndex] = {
                        ...updated[uploadIndex],
                        jobId: result.jobId,
                        progress: {
                            ...updated[uploadIndex].progress!,
                            status: 'PROCESSING',
                        },
                    };
                } else if (result.error) {
                    updated[uploadIndex] = {
                        ...updated[uploadIndex],
                        error: result.error,
                        progress: {
                            ...updated[uploadIndex].progress!,
                            status: 'FAILED',
                            errorMessage: result.error,
                        },
                    };
                }
            });

            return updated;
        });

        // Collect successful job IDs for polling
        const newJobIds = results
            .filter((r) => r.jobId)
            .map((r) => r.jobId!);

        if (newJobIds.length > 0) {
            setActiveJobIds((prev) => [...prev, ...newJobIds]);
        }

        setIsUploading(false);
    }, [uploadQueue]);

    // Clear completed/failed uploads from the list
    const clearCompleted = useCallback(() => {
        setUploads((prev) =>
            prev.filter((u) => {
                const status = u.progress?.status;
                return status && !isTerminalStatus(status);
            })
        );
    }, []);

    // Reset entire state (useful when modal closes)
    const reset = useCallback(() => {
        setUploadQueue([]);
        setUploads([]);
        setActiveJobIds([]);
    }, []);

    return {
        // Upload queue (files not yet sent)
        uploadQueue,
        addFiles,
        removeFromQueue,

        // Active uploads (with progress tracking)
        uploads,
        removeUpload,
        clearCompleted,

        // Upload actions
        startUpload,
        isUploading,
        hasActiveJobs,

        // History data
        jobs: jobsData?.jobs ?? [],
        totalJobs: jobsData?.pagination?.total ?? 0,
        isLoadingJobs,
        mutateJobs,

        // Cleanup
        reset,
    };
}

