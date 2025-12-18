"use client";

import { useState, useRef } from "react";
import { api } from "@/lib/api";

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
            setFile(null); // Clear file
        } catch (error: unknown) {
            console.error("Upload failed", error);
            const axiosError = error as { response?: { data?: { error?: string } }; message?: string };
            setStatus(`Error: ${axiosError.response?.data?.error || axiosError.message || 'Unknown error'}`);
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80">
            <div className="w-full max-w-md p-6 bg-[#121212] border border-[#333] rounded-xl shadow-2xl">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-white">Import History</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
                </div>

                <div className="space-y-4">
                    <div className="p-4 border-2 border-dashed border-[#333] rounded-lg text-center hover:border-[#A855F7] transition-colors cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                        <input
                            type="file"
                            accept=".json"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            className="hidden"
                        />
                        {file ? (
                            <p className="text-white font-medium">{file.name}</p>
                        ) : (
                            <p className="text-gray-400">Click to select endsong.json</p>
                        )}
                    </div>

                    {status && (
                        <div className={`p-3 rounded text-sm ${status.startsWith("Error") ? "bg-red-900/50 text-red-200" : "bg-green-900/50 text-green-200"}`}>
                            {status}
                        </div>
                    )}

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-gray-300 hover:text-white"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleUpload}
                            disabled={!file || uploading}
                            className="px-4 py-2 text-sm font-semibold text-black bg-[#A855F7] rounded hover:bg-[#9333ea] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {uploading ? "Uploading..." : "Import File"}
                        </button>
                    </div>

                    {jobId && (
                        <p className="text-xs text-center text-gray-500 mt-2">
                            You can check status at /api/me/import/status?jobId={jobId}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
