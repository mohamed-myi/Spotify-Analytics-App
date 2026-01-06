"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, X, FileJson, Check, AlertCircle, Loader2, Trash2, Download, Search, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { useImport } from "@/hooks/use-import";
import type { JobStatus, FileUploadState, ImportJob, UnresolvedTrack, ImportProgress } from "@/lib/import-types";

interface ImportHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type TabType = "upload" | "history";

const statusStyles: Record<JobStatus, string> = {
    PENDING: "bg-white/10 text-white/60",
    PROCESSING: "bg-mint-500/20 text-mint-300",
    COMPLETED: "bg-green-500/10 text-green-300",
    FAILED: "bg-red-500/10 text-red-300",
};

const statusLabels: Record<JobStatus, string> = {
    PENDING: "Pending",
    PROCESSING: "Processing",
    COMPLETED: "Completed",
    FAILED: "Failed",
};

function formatNumber(num: number): string {
    return num.toLocaleString();
}

function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function ProgressBar({ progress, total, label }: { progress: number; total: number; label?: string }) {
    const percentage = total > 0 ? Math.round((progress / total) * 100) : 0;

    return (
        <div className="space-y-1">
            {label && (
                <div className="text-xs text-white/60 mb-1">{label}</div>
            )}
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                    className="h-full bg-mint-500 transition-all duration-300 ease-out"
                    style={{ width: `${percentage}%` }}
                />
            </div>
            <div className="flex justify-between text-xs text-white/40">
                <span>{formatNumber(progress)} / {formatNumber(total)}</span>
                <span>{percentage}%</span>
            </div>
        </div>
    );
}

function TwoPhaseProgress({ progress }: { progress: ImportProgress }) {
    const phase = progress.phase;
    const isResolving = phase === 'resolving';

    // Calculate combined progress percentage for the overall bar
    const resolveWeight = 0.6; // Track resolution is ~60% of the work
    const createWeight = 0.4;  // Event creation is ~40%

    let overallPercentage = 0;
    if (phase === 'resolving' && progress.totalUniqueTracks) {
        overallPercentage = Math.round(((progress.resolvedTracks || 0) / progress.totalUniqueTracks) * resolveWeight * 100);
    } else if (phase === 'creating' && progress.totalRecords) {
        overallPercentage = Math.round(resolveWeight * 100) +
            Math.round((progress.processedRecords / progress.totalRecords) * createWeight * 100);
    }

    return (
        <div className="space-y-3">
            {/* Phase Indicator */}
            <div className="flex items-center gap-2 text-xs">
                <div className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded-full",
                    isResolving ? "bg-mint-500/20 text-mint-300" : "bg-white/10 text-white/40"
                )}>
                    <Search className="w-3 h-3" />
                    <span>Resolving</span>
                </div>
                <div className="w-4 h-px bg-white/20" />
                <div className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded-full",
                    !isResolving ? "bg-mint-500/20 text-mint-300" : "bg-white/10 text-white/40"
                )}>
                    <Database className="w-3 h-3" />
                    <span>Creating</span>
                </div>
            </div>

            {/* Overall Progress */}
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                    className="h-full bg-mint-500 transition-all duration-300 ease-out"
                    style={{ width: `${overallPercentage}%` }}
                />
            </div>

            {/* Phase-specific stats */}
            {isResolving && progress.totalUniqueTracks && (
                <div className="text-xs text-white/60">
                    Resolving tracks: {formatNumber(progress.resolvedTracks || 0)} / {formatNumber(progress.totalUniqueTracks)}
                </div>
            )}
            {!isResolving && progress.totalRecords > 0 && (
                <div className="text-xs text-white/60">
                    Creating events: {formatNumber(progress.processedRecords)} / {formatNumber(progress.totalRecords)}
                </div>
            )}
        </div>
    );
}

function UnresolvedReport({ tracks, jobId }: { tracks: UnresolvedTrack[]; jobId?: string }) {
    const handleDownload = useCallback(() => {
        // Generate CSV content
        const headers = ['Track Name', 'Artist Name', 'Occurrences'];
        const rows = tracks.map(t => [
            `"${t.trackName.replace(/"/g, '""')}"`,
            `"${t.artistName.replace(/"/g, '""')}"`,
            t.occurrences.toString()
        ]);
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

        // Create download
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `unresolved-tracks-${jobId || 'export'}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [tracks, jobId]);

    if (tracks.length === 0) return null;

    return (
        <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-amber-300 text-xs font-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {tracks.length} track{tracks.length !== 1 ? 's' : ''} could not be matched
                </div>
                <button
                    onClick={handleDownload}
                    className="flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200 transition-colors"
                >
                    <Download className="w-3 h-3" />
                    Export CSV
                </button>
            </div>
            <div className="max-h-24 overflow-y-auto space-y-1">
                {tracks.slice(0, 5).map((track, i) => (
                    <div key={i} className="text-xs text-white/60 truncate">
                        {track.trackName} — {track.artistName}
                        <span className="text-white/30 ml-1">({track.occurrences}x)</span>
                    </div>
                ))}
                {tracks.length > 5 && (
                    <div className="text-xs text-white/40">
                        ...and {tracks.length - 5} more
                    </div>
                )}
            </div>
        </div>
    );
}

function QueuedFileItem({
    file,
    onRemove,
}: {
    file: File;
    onRemove: () => void;
}) {
    return (
        <div className="flex items-center gap-3 p-3 rounded-xl backdrop-blur-md bg-white/5 border border-white/10">
            <FileJson className="w-5 h-5 text-mint-400 flex-shrink-0" />
            <span className="flex-1 text-sm text-white truncate">{file.name}</span>
            <span className="text-xs text-white/40">
                {(file.size / 1024 / 1024).toFixed(1)} MB
            </span>
            <button
                onClick={onRemove}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-red-500/20 flex items-center justify-center transition-colors"
                aria-label="Remove file"
            >
                <X className="w-3.5 h-3.5" />
            </button>
        </div>
    );
}

function UploadItem({
    upload,
    onRemove,
}: {
    upload: FileUploadState;
    onRemove: () => void;
}) {
    const status = upload.progress?.status ?? "PENDING";
    const isTerminal = status === "COMPLETED" || status === "FAILED";
    const hasTwoPhaseProgress = upload.progress?.phase !== undefined;

    return (
        <div className="p-4 rounded-xl backdrop-blur-md bg-white/5 border border-white/10 space-y-3">
            <div className="flex items-start gap-3">
                <FileJson className="w-5 h-5 text-mint-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-white truncate">{upload.file.name}</span>
                        <span className={cn(
                            "px-2 py-0.5 rounded-full text-xs font-medium",
                            statusStyles[status]
                        )}>
                            {statusLabels[status]}
                        </span>
                    </div>
                    {upload.error && (
                        <p className="text-xs text-red-400 mt-1">{upload.error}</p>
                    )}
                </div>
                {isTerminal && (
                    <button
                        onClick={onRemove}
                        className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                        aria-label="Remove"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>

            {status === "PROCESSING" && upload.progress && (
                hasTwoPhaseProgress ? (
                    <TwoPhaseProgress progress={upload.progress} />
                ) : (
                    <ProgressBar
                        progress={upload.progress.processedRecords}
                        total={upload.progress.totalRecords}
                    />
                )
            )}

            {status === "COMPLETED" && upload.progress && (
                <>
                    <div className="flex items-center gap-4 text-xs">
                        <span className="text-green-400 flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" />
                            {formatNumber(upload.progress.addedRecords)} added
                        </span>
                        <span className="text-white/40">
                            {formatNumber(upload.progress.skippedRecords)} skipped
                        </span>
                    </div>
                    {upload.progress.unresolvedTracks && upload.progress.unresolvedTracks.length > 0 && (
                        <UnresolvedReport
                            tracks={upload.progress.unresolvedTracks}
                            jobId={upload.jobId}
                        />
                    )}
                </>
            )}
        </div>
    );
}

function JobItem({ job }: { job: ImportJob }) {
    return (
        <div className="p-4 rounded-xl backdrop-blur-md bg-white/5 border border-white/10">
            <div className="flex items-start gap-3">
                <FileJson className="w-5 h-5 text-white/40 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-white truncate">{job.fileName}</span>
                        <span className={cn(
                            "px-2 py-0.5 rounded-full text-xs font-medium",
                            statusStyles[job.status]
                        )}>
                            {statusLabels[job.status]}
                        </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-white/40">
                        <span>{formatDate(job.createdAt)}</span>
                        {job.status === "COMPLETED" && (
                            <span>{formatNumber(job.processedEvents)} events</span>
                        )}
                    </div>
                    {job.errorMessage && (
                        <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {job.errorMessage}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-12 text-white/40">
            <Icon className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">{message}</p>
        </div>
    );
}

export function ImportHistoryModal({ isOpen, onClose }: ImportHistoryModalProps) {
    const [activeTab, setActiveTab] = useState<TabType>("upload");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragOver, setIsDragOver] = useState(false);

    const {
        uploadQueue,
        addFiles,
        removeFromQueue,
        uploads,
        removeUpload,
        clearCompleted,
        startUpload,
        isUploading,
        hasActiveJobs,
        jobs,
        isLoadingJobs,
        reset,
    } = useImport();

    const handleClose = useCallback(() => {
        // Only reset if no active jobs
        if (!hasActiveJobs && !isUploading) {
            reset();
        }
        onClose();
    }, [hasActiveJobs, isUploading, reset, onClose]);

    const handleFileChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            if (e.target.files) {
                addFiles(Array.from(e.target.files));
            }
            // Reset input so same file can be selected again
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        },
        [addFiles]
    );

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setIsDragOver(false);
            if (e.dataTransfer.files) {
                addFiles(Array.from(e.dataTransfer.files));
            }
        },
        [addFiles]
    );

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
    }, []);

    const hasCompletedUploads = uploads.some(
        (u) => u.progress?.status === "COMPLETED" || u.progress?.status === "FAILED"
    );

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-md"
                onClick={handleClose}
            />

            <div className="relative w-full max-w-lg backdrop-blur-2xl bg-gradient-to-b from-white/10 to-white/5 border border-white/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                <div className="flex items-center justify-between p-6 border-b border-white/10">
                    <h2 className="text-xl font-semibold text-white">Import History</h2>
                    <button
                        onClick={handleClose}
                        className="w-9 h-9 rounded-full backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-all"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex gap-2 px-6 py-3 border-b border-white/10">
                    <button
                        onClick={() => setActiveTab("upload")}
                        className={cn(
                            "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                            activeTab === "upload"
                                ? "bg-white/10 text-white"
                                : "text-white/60 hover:text-white hover:bg-white/5"
                        )}
                    >
                        Upload
                        {(uploadQueue.length > 0 || uploads.length > 0) && (
                            <span className="ml-2 px-1.5 py-0.5 rounded-full bg-mint-500/20 text-mint-300 text-xs">
                                {uploadQueue.length + uploads.length}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab("history")}
                        className={cn(
                            "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                            activeTab === "history"
                                ? "bg-white/10 text-white"
                                : "text-white/60 hover:text-white hover:bg-white/5"
                        )}
                    >
                        History
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {activeTab === "upload" && (
                        <div className="space-y-4">
                            <div
                                className={cn(
                                    "p-8 border-2 border-dashed rounded-xl text-center transition-colors cursor-pointer backdrop-blur-md",
                                    isDragOver
                                        ? "border-mint-400 bg-mint-500/10"
                                        : "border-white/20 hover:border-mint-400/50 bg-white/5"
                                )}
                                onClick={() => fileInputRef.current?.click()}
                                onDrop={handleDrop}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                            >
                                <input
                                    type="file"
                                    accept=".json"
                                    multiple
                                    ref={fileInputRef}
                                    onChange={handleFileChange}
                                    className="hidden"
                                />
                                <Upload className="w-10 h-10 mx-auto mb-3 text-white/40" />
                                <p className="text-white/60">
                                    Drop files here or click to select
                                </p>
                                <p className="text-xs text-white/40 mt-1">
                                    Supports endsong.json and StreamingHistory_music.json
                                </p>
                            </div>

                            {/* Queued Files */}
                            {uploadQueue.length > 0 && (
                                <div className="space-y-2">
                                    <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider">
                                        Ready to upload ({uploadQueue.length})
                                    </h3>
                                    {uploadQueue.map((file, index) => (
                                        <QueuedFileItem
                                            key={`${file.name}-${index}`}
                                            file={file}
                                            onRemove={() => removeFromQueue(index)}
                                        />
                                    ))}
                                </div>
                            )}

                            {uploads.length > 0 && (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider">
                                            Uploads ({uploads.length})
                                        </h3>
                                        {hasCompletedUploads && (
                                            <button
                                                onClick={clearCompleted}
                                                className="text-xs text-white/40 hover:text-white flex items-center gap-1 transition-colors"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                                Clear completed
                                            </button>
                                        )}
                                    </div>
                                    {uploads.map((upload) => (
                                        <UploadItem
                                            key={upload.jobId || upload.file.name}
                                            upload={upload}
                                            onRemove={() => upload.jobId && removeUpload(upload.jobId)}
                                        />
                                    ))}
                                </div>
                            )}

                            {uploadQueue.length === 0 && uploads.length === 0 && (
                                <EmptyState
                                    icon={FileJson}
                                    message="No files selected. Drop files above to get started."
                                />
                            )}
                        </div>
                    )}

                    {activeTab === "history" && (
                        <div className="space-y-2">
                            {isLoadingJobs ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
                                </div>
                            ) : jobs.length > 0 ? (
                                jobs.map((job) => <JobItem key={job.id} job={job} />)
                            ) : (
                                <EmptyState
                                    icon={FileJson}
                                    message="No import history yet. Upload your first file!"
                                />
                            )}
                        </div>
                    )}
                </div>

                {activeTab === "upload" && (
                    <div className="flex justify-end gap-3 p-6 pt-0 border-t border-white/10 mt-auto">
                        <button
                            onClick={handleClose}
                            className="px-6 py-3 rounded-xl backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-medium text-white transition-all"
                        >
                            {hasActiveJobs ? "Close" : "Cancel"}
                        </button>
                        <button
                            onClick={startUpload}
                            disabled={uploadQueue.length === 0 || isUploading}
                            className="px-6 py-3 rounded-xl bg-mint-600 hover:bg-mint-700 text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {isUploading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Uploading...
                                </>
                            ) : (
                                <>
                                    <Upload className="w-4 h-4" />
                                    Upload {uploadQueue.length > 0 && `(${uploadQueue.length})`}
                                </>
                            )}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
