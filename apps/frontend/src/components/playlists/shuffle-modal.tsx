"use client";

import { UI } from "@/constants/ui";
import { useState, useRef } from "react";
import { useUserPlaylists, validateShuffle, createShufflePlaylist } from "@/hooks/use-playlists";
import { SlidePanel } from "./slide-panel";
import { useDemoMode } from "@/hooks/use-demo-mode";
import { AlertCircle, Check, Loader2, ImageIcon, X, Shuffle, Music } from "lucide-react";
import Image from "next/image";

interface ShuffleModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface ValidationData {
    trackCount: number;
    confirmationToken: string;
    warnings: string[];
}

interface ApiError {
    response?: {
        data?: {
            error?: string;
        };
    };
}

export function ShuffleModal({ isOpen, onClose }: ShuffleModalProps) {
    const [step, setStep] = useState<'input' | 'validating' | 'confirm' | 'creating' | 'success'>('input');
    const [selectedPlaylistId, setSelectedPlaylistId] = useState("");
    const [shuffleMode, setShuffleMode] = useState<'truly_random' | 'less_repetition'>('truly_random');
    const [playlistName, setPlaylistName] = useState("");
    const [coverImage, setCoverImage] = useState<string | null>(null);
    const [coverPreview, setCoverPreview] = useState<string | null>(null);
    const [useOriginalCover, setUseOriginalCover] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [validationData, setValidationData] = useState<ValidationData | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const { isDemo } = useDemoMode();

    const { playlists, isLoading: isLoadingPlaylists } = useUserPlaylists();

    const selectedPlaylist = playlists.find(p => p.id === selectedPlaylistId);

    const resetState = () => {
        setStep('input');
        setSelectedPlaylistId("");
        setShuffleMode('truly_random');
        setPlaylistName("");
        setCoverImage(null);
        setCoverPreview(null);
        setUseOriginalCover(false);
        setError(null);
        setValidationData(null);
    };

    const handleClose = () => {
        onClose();
        setTimeout(resetState, 300);
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 256 * 1024) {
            setError("Image must be less than 256KB");
            return;
        }

        setUseOriginalCover(false);
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result as string;
            setCoverPreview(base64);
            setCoverImage(base64.split(',')[1]);
        };
        reader.readAsDataURL(file);
    };

    const handleUseOriginalCover = async () => {
        if (!selectedPlaylist?.imageUrl) return;

        setUseOriginalCover(true);
        setCoverPreview(selectedPlaylist.imageUrl);

        // Fetch and convert to base64
        try {
            const response = await fetch(selectedPlaylist.imageUrl);
            const blob = await response.blob();
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = (reader.result as string).split(',')[1];
                setCoverImage(base64);
            };
            reader.readAsDataURL(blob);
        } catch {
            setError("Failed to load original cover image");
            setUseOriginalCover(false);
        }
    };

    const handleValidate = async () => {
        if (!selectedPlaylistId) {
            setError("Please select a source playlist");
            return;
        }

        setStep('validating');
        setError(null);

        try {
            const data = await validateShuffle(selectedPlaylistId, shuffleMode);
            setValidationData(data);

            if (!playlistName && selectedPlaylist) {
                setPlaylistName(`Shuffled: ${selectedPlaylist.name}`);
            }

            setStep('confirm');
        } catch (err: unknown) {
            const apiError = err as ApiError;
            setError(apiError.response?.data?.error || "Failed to validate playlist");
            setStep('input');
        }
    };

    const handleCreate = async () => {
        if (!validationData || !playlistName) return;

        setStep('creating');
        setError(null);

        try {
            await createShufflePlaylist({
                name: playlistName,
                sourcePlaylistId: selectedPlaylistId,
                shuffleMode,
                confirmationToken: validationData.confirmationToken,
                coverImageBase64: coverImage || undefined,
                isPublic: false
            });
            setStep('success');
        } catch (err: unknown) {
            const apiError = err as ApiError;
            setError(apiError.response?.data?.error || "Failed to create playlist");
            setStep('confirm');
        }
    };



    // ... (helper checks/handlers)

    const renderFooter = () => {
        if (step === 'success') {
            return (
                <button
                    onClick={handleClose}
                    className="w-full px-6 py-3 rounded-lg bg-mint-500 text-black font-bold hover:bg-mint-400 transition-colors"
                >
                    {UI.PLAYLIST.COMMON.ACTIONS.DONE}
                </button>
            );
        }

        return (
            <div className="flex justify-end gap-3">
                <button
                    onClick={step === 'confirm' ? () => setStep('input') : handleClose}
                    className="px-4 py-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                    disabled={step === 'validating' || step === 'creating'}
                >
                    {step === 'confirm' ? UI.PLAYLIST.COMMON.ACTIONS.BACK : UI.PLAYLIST.COMMON.ACTIONS.CANCEL}
                </button>

                {step === 'input' && (
                    <button
                        onClick={handleValidate}
                        disabled={!selectedPlaylistId || isLoadingPlaylists || isDemo}
                        className={`px-6 py-3 rounded-lg font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDemo
                            ? 'bg-neutral-800 text-white/40'
                            : 'bg-mint-500 text-black hover:bg-mint-400'
                            }`}
                    >
                        {isDemo ? "Demo Unavailable" : UI.PLAYLIST.COMMON.ACTIONS.CONTINUE}
                    </button>
                )}

                {step === 'confirm' && (
                    <button
                        onClick={handleCreate}
                        disabled={!playlistName || isDemo}
                        className="px-6 py-3 rounded-lg bg-mint-500 text-black font-bold hover:bg-mint-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isDemo ? "Demo Unavailable" : UI.PLAYLIST.COMMON.ACTIONS.CREATE}
                    </button>
                )}
            </div>
        );
    };

    return (
        <SlidePanel
            isOpen={isOpen}
            onClose={handleClose}
            title={UI.PLAYLIST.SHUFFLE.TITLE}
            footer={renderFooter()}
        >
            {/* Title Section */}
            <div className="mb-6 pb-6 border-b border-white/10">
                <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 rounded-lg bg-mint-500/20">
                        <Shuffle className="w-5 h-5 text-mint-400" />
                    </div>
                    <span className="text-base font-medium text-white/90">{UI.PLAYLIST.SHUFFLE.SUBTITLE}</span>
                </div>
                <p className="text-white/60 text-sm leading-relaxed">
                    {UI.PLAYLIST.SHUFFLE.DESCRIPTION}
                </p>
            </div>

            <div className="space-y-6">
                {step === 'input' && (
                    <div className="space-y-6">
                        {/* Visual Playlist Selector */}
                        <div>
                            <label className="block text-sm font-medium text-white/60 mb-3">{UI.PLAYLIST.SHUFFLE.INPUT.SELECT_SOURCE_LABEL}</label>

                            {isDemo ? (
                                <div className="h-[320px] rounded-xl bg-neutral-800/50 border border-white/10 flex flex-col items-center justify-center p-6 text-center">
                                    <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
                                        <Shuffle className="w-8 h-8 text-white/20" />
                                    </div>
                                    <h3 className="text-lg font-medium text-white mb-2">Feature Unavailable</h3>
                                    <p className="text-white/40 max-w-[280px]">
                                        Creating new shuffle playlists is disabled in demo mode. Sign in to your account to use this feature.
                                    </p>
                                </div>
                            ) : isLoadingPlaylists ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="w-6 h-6 text-mint-500 animate-spin" />
                                </div>
                            ) : (
                                <>
                                    <div className="h-[320px] overflow-y-auto rounded-xl bg-neutral-800/50 border border-white/10 p-2 space-y-1">
                                        {playlists.map((playlist, index) => (
                                            <button
                                                key={playlist.id}
                                                onClick={() => setSelectedPlaylistId(playlist.id)}
                                                className={`w-full flex items-center gap-3 p-2 rounded-lg transition-all ${selectedPlaylistId === playlist.id
                                                    ? 'bg-mint-500/20 border border-mint-500/50'
                                                    : 'hover:bg-white/5 border border-transparent'
                                                    }`}
                                            >
                                                <span className="text-xs text-white/40 w-5 text-center shrink-0">
                                                    {index + 1}
                                                </span>
                                                {playlist.imageUrl ? (
                                                    <Image
                                                        src={playlist.imageUrl}
                                                        alt={playlist.name}
                                                        width={40}
                                                        height={40}
                                                        className="w-10 h-10 rounded object-cover shrink-0"
                                                    />
                                                ) : (
                                                    <div className="w-10 h-10 rounded bg-neutral-700 flex items-center justify-center shrink-0">
                                                        <Music className="w-5 h-5 text-white/40" />
                                                    </div>
                                                )}
                                                <div className="flex-1 text-left min-w-0">
                                                    <p className={`text-sm font-medium truncate ${selectedPlaylistId === playlist.id ? 'text-mint-400' : 'text-white'
                                                        }`}>
                                                        {playlist.name}
                                                    </p>
                                                    <p className="text-xs text-white/40">{playlist.trackCount} tracks</p>
                                                </div>
                                                {selectedPlaylistId === playlist.id && (
                                                    <Check className="w-4 h-4 text-mint-500 shrink-0" />
                                                )}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Selected Playlist Display */}
                                    {selectedPlaylist && (
                                        <div className="mt-3 p-3 rounded-lg bg-mint-500/10 border border-mint-500/20 flex items-center gap-3">
                                            {selectedPlaylist.imageUrl ? (
                                                <Image
                                                    src={selectedPlaylist.imageUrl}
                                                    alt={selectedPlaylist.name}
                                                    width={48}
                                                    height={48}
                                                    className="w-12 h-12 rounded object-cover"
                                                />
                                            ) : (
                                                <div className="w-12 h-12 rounded bg-neutral-700 flex items-center justify-center">
                                                    <Music className="w-6 h-6 text-white/40" />
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-mint-200 truncate">Selected: {selectedPlaylist.name}</p>
                                                <p className="text-xs text-mint-200/60">{selectedPlaylist.trackCount} tracks</p>
                                            </div>
                                            <button
                                                onClick={() => setSelectedPlaylistId("")}
                                                className="p-1 rounded hover:bg-white/10 text-mint-200/60 hover:text-white transition-colors"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Shuffle Mode */}
                        <div>
                            <label className="block text-sm font-medium text-white/60 mb-2">{UI.PLAYLIST.SHUFFLE.INPUT.SHUFFLE_MODE_LABEL}</label>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => setShuffleMode('truly_random')}
                                    className={`p-3 rounded-lg border text-sm font-medium transition-all ${shuffleMode === 'truly_random'
                                        ? 'bg-mint-500/20 border-mint-500 text-mint-400'
                                        : 'bg-neutral-800 border-transparent text-white/60 hover:bg-neutral-700'
                                        }`}
                                >
                                    {UI.PLAYLIST.SHUFFLE.MODES.RANDOM.LABEL}
                                </button>
                                <button
                                    onClick={() => setShuffleMode('less_repetition')}
                                    className={`p-3 rounded-lg border text-sm font-medium transition-all ${shuffleMode === 'less_repetition'
                                        ? 'bg-mint-500/20 border-mint-500 text-mint-400'
                                        : 'bg-neutral-800 border-transparent text-white/60 hover:bg-neutral-700'
                                        }`}
                                >
                                    {UI.PLAYLIST.SHUFFLE.MODES.SMART.LABEL}
                                </button>
                            </div>
                            <p className="text-xs text-white/40 mt-2">
                                {shuffleMode === 'truly_random'
                                    ? UI.PLAYLIST.SHUFFLE.MODES.RANDOM.DESCRIPTION
                                    : UI.PLAYLIST.SHUFFLE.MODES.SMART.DESCRIPTION}
                            </p>
                        </div>
                    </div>
                )}

                {(step === 'validating' || step === 'creating') && (
                    <div className="flex flex-col items-center justify-center py-12 text-center animate-fade-in">
                        <Loader2 className="w-12 h-12 text-mint-500 animate-spin mb-4" />
                        <p className="text-white/60">
                            {step === 'validating' ? UI.PLAYLIST.COMMON.STATUS.VALIDATING.SHUFFLE : UI.PLAYLIST.COMMON.STATUS.CREATING.SHUFFLE}
                        </p>
                    </div>
                )}

                {step === 'confirm' && validationData && (
                    <div className="space-y-4 animate-fade-in">
                        <div className="bg-mint-500/10 border border-mint-500/20 rounded-lg p-4 flex items-start gap-3">
                            <Check className="w-5 h-5 text-mint-500 shrink-0 mt-0.5" />
                            <div>
                                <p className="font-medium text-mint-200">{UI.PLAYLIST.COMMON.STATUS.READY.SHUFFLE}</p>
                                <p className="text-sm text-mint-200/60">Found {validationData.trackCount} tracks available.</p>
                            </div>
                        </div>

                        {validationData.warnings.length > 0 && (
                            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 text-sm text-yellow-200">
                                <p className="font-medium mb-1">Warnings:</p>
                                <ul className="list-disc list-inside opacity-80">
                                    {validationData.warnings.map((w, i) => <li key={i}>{w}</li>)}
                                </ul>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-white/60 mb-2">{UI.PLAYLIST.COMMON.LABELS.NEW_PLAYLIST_NAME}</label>
                            <input
                                type="text"
                                value={playlistName}
                                onChange={(e) => setPlaylistName(e.target.value)}
                                className="w-full bg-neutral-800 border border-white/10 rounded-lg p-3 text-white focus:ring-2 focus:ring-mint-500 outline-none"
                            />
                        </div>

                        {/* Cover Image Options */}
                        <div>
                            <label className="block text-sm font-medium text-white/60 mb-3">
                                {UI.PLAYLIST.COMMON.LABELS.COVER_IMAGE} <span className="text-white/40">{UI.PLAYLIST.COMMON.LABELS.OPTIONAL_HINT}</span>
                            </label>
                            <input
                                type="file"
                                ref={fileInputRef}
                                accept="image/jpeg,image/png"
                                onChange={handleImageUpload}
                                className="hidden"
                            />

                            <div className="flex gap-3">
                                {/* Use Original Cover Option */}
                                {selectedPlaylist?.imageUrl && (
                                    <div className="relative group">
                                        <button
                                            onClick={handleUseOriginalCover}
                                            className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-all ${useOriginalCover
                                                ? 'bg-mint-500/20 border-mint-500'
                                                : 'bg-neutral-800 border-white/10 hover:bg-neutral-700'
                                                }`}
                                        >
                                            <Image
                                                src={selectedPlaylist.imageUrl}
                                                alt="Original cover"
                                                width={64}
                                                height={64}
                                                className="w-16 h-16 rounded object-cover"
                                            />
                                            <span className="text-xs text-white/60">{UI.PLAYLIST.COMMON.LABELS.ORIGINAL}</span>
                                        </button>
                                        {useOriginalCover && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setUseOriginalCover(false);
                                                    setCoverImage(null);
                                                    setCoverPreview(null);
                                                }}
                                                className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <X className="w-3 h-3 text-white" />
                                            </button>
                                        )}
                                    </div>
                                )}

                                {/* Upload Custom Cover */}
                                {coverPreview && !useOriginalCover ? (
                                    <div className="relative group">
                                        <Image
                                            src={coverPreview}
                                            alt="Cover preview"
                                            width={88}
                                            height={88}
                                            className="w-[88px] h-[88px] rounded-lg object-cover"
                                        />
                                        <button
                                            onClick={() => { setCoverImage(null); setCoverPreview(null); }}
                                            className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <X className="w-3 h-3 text-white" />
                                        </button>
                                    </div>
                                ) : !useOriginalCover && (
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="flex flex-col items-center justify-center gap-2 w-[88px] h-[88px] rounded-lg bg-neutral-800 border border-white/10 border-dashed hover:bg-neutral-700 transition-colors text-white/60 hover:text-white"
                                    >
                                        <ImageIcon className="w-5 h-5" />
                                        <span className="text-xs">{UI.PLAYLIST.COMMON.LABELS.UPLOAD_BUTTON}</span>
                                    </button>
                                )}
                            </div>
                            <p className="text-xs text-white/40 mt-2">{UI.PLAYLIST.COMMON.LABELS.IMAGE_REQUIREMENTS}</p>
                        </div>
                    </div>
                )}

                {step === 'success' && (
                    <div className="text-center py-12 animate-fade-in">
                        <div className="w-16 h-16 bg-mint-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Check className="w-8 h-8 text-mint-500" />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">{UI.PLAYLIST.COMMON.STATUS.SUCCESS.TITLE.STARTED}</h3>
                        <p className="text-white/60">
                            {UI.PLAYLIST.COMMON.STATUS.SUCCESS.DESCRIPTION.BACKGROUND}
                        </p>
                    </div>
                )}

                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center gap-3 animate-fade-in">
                        <AlertCircle className="w-5 h-5 text-red-500" />
                        <p className="text-sm text-red-200">{error}</p>
                    </div>
                )}
            </div>
        </SlidePanel>
    );
}
