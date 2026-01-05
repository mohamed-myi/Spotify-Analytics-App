"use client";

import { useState, useRef } from "react";
import { api } from "@/lib/api";
import { Upload, X } from "lucide-react";

interface ImportHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ImportHistoryModal({ isOpen, onClose }: ImportHistoryModalProps) {
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [jobId, setJobId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!isOpen) return null;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setStatus(null);
        }
    };

    const handleUpload = async () => {
        if (!file) return;

        setUploading(true);
        setStatus("Uploading...");

        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await api.post("/me/import/spotify-history", formData, {
                headers: {
                    "Content-Type": "multipart/form-data",
                },
            });

            setStatus(`Upload complete! Job ID: ${res.data.jobId}`);
            setJobId(res.data.jobId);
            setFile(null);
        } catch (error: unknown) {
            console.error("Upload failed", error);
            const axiosError = error as { response?: { data?: { error?: string } }; message?: string };
            setStatus(`Error: ${axiosError.response?.data?.error || axiosError.message || 'Unknown error'}`);
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
            {/* Backdrop - Glassmorphic */}
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-md"
                onClick={onClose}
            />

            {/* Modal Content - Glassmorphic */}
            <div className="relative w-full max-w-md backdrop-blur-2xl bg-gradient-to-b from-white/10 to-white/5 border border-white/20 rounded-2xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/10">
                    <h2 className="text-xl font-semibold text-white">Import History</h2>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-full backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-all"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    {/* File Drop Zone */}
                    <div
                        className="p-8 border-2 border-dashed border-white/20 hover:border-mint-400/50 rounded-xl text-center transition-colors cursor-pointer backdrop-blur-md bg-white/5"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <input
                            type="file"
                            accept=".json"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            className="hidden"
                        />
                        <Upload className="w-10 h-10 mx-auto mb-3 text-white/40" />
                        {file ? (
                            <p className="text-white font-medium">{file.name}</p>
                        ) : (
                            <>
                                <p className="text-white/60">Click to select file</p>
                                <p className="text-xs text-white/40 mt-1">endsong.json from Spotify data export</p>
                            </>
                        )}
                    </div>

                    {/* Status Message */}
                    {status && (
                        <div className={`p-4 rounded-xl text-sm backdrop-blur-md ${status.startsWith("Error")
                            ? "bg-red-500/10 border border-red-400/30 text-red-300"
                            : "bg-green-500/10 border border-green-400/30 text-green-300"
                            }`}>
                            {status}
                        </div>
                    )}

                    {/* Job ID Info */}
                    {jobId && (
                        <p className="text-xs text-center text-white/40">
                            Job ID: {jobId}
                        </p>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="flex justify-end gap-3 p-6 pt-0">
                    <button
                        onClick={onClose}
                        className="px-6 py-3 rounded-xl backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-medium text-white transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleUpload}
                        disabled={!file || uploading}
                        className="px-6 py-3 rounded-xl bg-mint-600 hover:bg-mint-700 text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {uploading ? "Uploading..." : "Import File"}
                    </button>
                </div>
            </div>
        </div>
    );
}
