import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportHistoryModal } from '../ImportHistoryModal';
import type { FileUploadState, ImportJob } from '@/lib/import-types';

// Mock the useImport hook
const mockAddFiles = jest.fn();
const mockRemoveFromQueue = jest.fn();
const mockRemoveUpload = jest.fn();
const mockClearCompleted = jest.fn();
const mockStartUpload = jest.fn();
const mockReset = jest.fn();
const mockMutateJobs = jest.fn();

interface MockUseImportReturn {
    uploadQueue: File[];
    addFiles: typeof mockAddFiles;
    removeFromQueue: typeof mockRemoveFromQueue;
    uploads: FileUploadState[];
    removeUpload: typeof mockRemoveUpload;
    clearCompleted: typeof mockClearCompleted;
    startUpload: typeof mockStartUpload;
    isUploading: boolean;
    hasActiveJobs: boolean;
    jobs: ImportJob[];
    totalJobs: number;
    isLoadingJobs: boolean;
    mutateJobs: typeof mockMutateJobs;
    reset: typeof mockReset;
}

const defaultMockState: MockUseImportReturn = {
    uploadQueue: [],
    addFiles: mockAddFiles,
    removeFromQueue: mockRemoveFromQueue,
    uploads: [],
    removeUpload: mockRemoveUpload,
    clearCompleted: mockClearCompleted,
    startUpload: mockStartUpload,
    isUploading: false,
    hasActiveJobs: false,
    jobs: [],
    totalJobs: 0,
    isLoadingJobs: false,
    mutateJobs: mockMutateJobs,
    reset: mockReset,
};

let mockUseImportReturn: MockUseImportReturn = { ...defaultMockState };

jest.mock('@/hooks/use-import', () => ({
    useImport: () => mockUseImportReturn,
}));

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
    Upload: () => <span data-testid="upload-icon">Upload</span>,
    X: () => <span data-testid="x-icon">X</span>,
    FileJson: () => <span data-testid="file-icon">FileJson</span>,
    Check: () => <span data-testid="check-icon">Check</span>,
    AlertCircle: () => <span data-testid="alert-icon">Alert</span>,
    Loader2: () => <span data-testid="loader-icon">Loader</span>,
    Trash2: () => <span data-testid="trash-icon">Trash</span>,
}));

// Mock cn utility
jest.mock('@/lib/utils', () => ({
    cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

describe('ImportHistoryModal', () => {
    const mockOnClose = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        mockUseImportReturn = { ...defaultMockState };
    });

    // Basic rendering tests
    describe('rendering', () => {
    it('renders nothing when isOpen is false', () => {
        const { container } = render(
            <ImportHistoryModal isOpen={false} onClose={mockOnClose} />
            );
            expect(container.firstChild).toBeNull();
        });

    it('renders modal when isOpen is true', () => {
            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);
            expect(screen.getByText('Import History')).toBeInTheDocument();
        });

        it('renders upload tab by default', () => {
            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);
            expect(screen.getByText('Drop files here or click to select')).toBeInTheDocument();
        });
    });

    // Tab switching tests
    describe('tab navigation', () => {
        it('renders both Upload and History tabs', () => {
            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);
            // Tab buttons are in the tab navigation section
            const tabButtons = screen.getAllByRole('button');
            const uploadTab = tabButtons.find(btn => btn.textContent === 'Upload');
            const historyTab = tabButtons.find(btn => btn.textContent === 'History');
            expect(uploadTab).toBeInTheDocument();
            expect(historyTab).toBeInTheDocument();
        });

        it('switches to History tab when clicked', () => {
            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            const historyTab = screen.getByRole('button', { name: /history/i });
            fireEvent.click(historyTab);

            // Should show history empty state
            expect(screen.getByText('No import history yet. Upload your first file!')).toBeInTheDocument();
        });

        it('switches back to Upload tab when clicked', () => {
            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            // Go to history
            fireEvent.click(screen.getByRole('button', { name: /history/i }));
            // Go back to upload
            fireEvent.click(screen.getByRole('button', { name: /upload/i }));

            expect(screen.getByText('Drop files here or click to select')).toBeInTheDocument();
        });

        it('shows badge count on Upload tab when files are queued', () => {
            mockUseImportReturn = {
                ...defaultMockState,
                uploadQueue: [new File(['{}'], 'test.json', { type: 'application/json' })],
            };

            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            // Should show count badge
            expect(screen.getByText('1')).toBeInTheDocument();
        });
    });

    // Multi-file selection tests
    describe('multi-file selection', () => {
        it('accepts multiple files via file input', () => {
            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            const file1 = new File(['{}'], 'endsong_0.json', { type: 'application/json' });
            const file2 = new File(['{}'], 'endsong_1.json', { type: 'application/json' });
            const input = document.querySelector('input[type="file"]') as HTMLInputElement;

            fireEvent.change(input, { target: { files: [file1, file2] } });

            expect(mockAddFiles).toHaveBeenCalledWith([file1, file2]);
        });

        it('renders queued files list', () => {
            mockUseImportReturn = {
                ...defaultMockState,
                uploadQueue: [
                    new File(['{}'], 'endsong_0.json', { type: 'application/json' }),
                    new File(['{}'], 'endsong_1.json', { type: 'application/json' }),
                ],
            };

            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            expect(screen.getByText('endsong_0.json')).toBeInTheDocument();
            expect(screen.getByText('endsong_1.json')).toBeInTheDocument();
            expect(screen.getByText('Ready to upload (2)')).toBeInTheDocument();
        });

        it('calls removeFromQueue when remove button clicked on queued file', () => {
            mockUseImportReturn = {
                ...defaultMockState,
                uploadQueue: [new File(['{}'], 'test.json', { type: 'application/json' })],
            };

            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            const removeButtons = screen.getAllByLabelText('Remove file');
            fireEvent.click(removeButtons[0]);

            expect(mockRemoveFromQueue).toHaveBeenCalledWith(0);
        });
    });

    // Upload action tests
    describe('upload actions', () => {
        it('calls startUpload when Upload button is clicked', () => {
            mockUseImportReturn = {
                ...defaultMockState,
                uploadQueue: [new File(['{}'], 'test.json', { type: 'application/json' })],
            };

            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            const uploadButton = screen.getByRole('button', { name: /upload \(1\)/i });
            fireEvent.click(uploadButton);

            expect(mockStartUpload).toHaveBeenCalled();
        });

        it('disables Upload button when queue is empty', () => {
            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            // Find the primary upload submit button in the footer (contains Upload icon + text)
            const allButtons = screen.getAllByRole('button');
            const uploadSubmitButton = allButtons.find(btn => 
                btn.classList.contains('bg-mint-600') && btn.textContent?.includes('Upload')
            );
            expect(uploadSubmitButton).toBeDisabled();
        });

        it('disables Upload button when already uploading', () => {
            mockUseImportReturn = {
                ...defaultMockState,
                uploadQueue: [new File(['{}'], 'test.json', { type: 'application/json' })],
                isUploading: true,
            };

            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            const uploadButton = screen.getByRole('button', { name: /uploading/i });
            expect(uploadButton).toBeDisabled();
        });

        it('shows uploading state on button', () => {
            mockUseImportReturn = {
                ...defaultMockState,
                isUploading: true,
            };

            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            expect(screen.getByText('Uploading...')).toBeInTheDocument();
        });
    });

    // Progress display tests
    describe('progress display', () => {
        it('renders upload items with progress bars', () => {
            mockUseImportReturn = {
                ...defaultMockState,
                uploads: [
                    {
                        file: new File(['{}'], 'test.json', { type: 'application/json' }),
                        jobId: 'job-123',
                        progress: {
                            status: 'PROCESSING' as const,
                            totalRecords: 1000,
                            processedRecords: 500,
                            addedRecords: 450,
                            skippedRecords: 50,
                        },
                    },
                ],
            };

            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            expect(screen.getByText('test.json')).toBeInTheDocument();
            expect(screen.getByText('Processing')).toBeInTheDocument();
            expect(screen.getByText('500 / 1,000')).toBeInTheDocument();
            expect(screen.getByText('50%')).toBeInTheDocument();
        });

        it('shows completion stats when job is completed', () => {
            mockUseImportReturn = {
                ...defaultMockState,
                uploads: [
                    {
                        file: new File(['{}'], 'test.json', { type: 'application/json' }),
                        jobId: 'job-123',
                        progress: {
                            status: 'COMPLETED' as const,
                            totalRecords: 1000,
                            processedRecords: 1000,
                            addedRecords: 950,
                            skippedRecords: 50,
                        },
                    },
                ],
            };

            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            expect(screen.getByText('Completed')).toBeInTheDocument();
            expect(screen.getByText('950 added')).toBeInTheDocument();
            expect(screen.getByText('50 skipped')).toBeInTheDocument();
        });

        it('shows error message when job fails', () => {
            mockUseImportReturn = {
                ...defaultMockState,
                uploads: [
                    {
                        file: new File(['{}'], 'test.json', { type: 'application/json' }),
                        jobId: 'job-123',
                        error: 'Invalid file format',
                        progress: {
                            status: 'FAILED' as const,
                            totalRecords: 0,
                            processedRecords: 0,
                            addedRecords: 0,
                            skippedRecords: 0,
                            errorMessage: 'Invalid file format',
                        },
                    },
                ],
            };

            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            expect(screen.getByText('Failed')).toBeInTheDocument();
            expect(screen.getByText('Invalid file format')).toBeInTheDocument();
        });
    });

    // Clear completed tests
    describe('clear completed', () => {
        it('shows Clear completed button when there are terminal uploads', () => {
            mockUseImportReturn = {
                ...defaultMockState,
                uploads: [
                    {
                        file: new File(['{}'], 'test.json', { type: 'application/json' }),
                        jobId: 'job-123',
                        progress: {
                            status: 'COMPLETED' as const,
                            totalRecords: 100,
                            processedRecords: 100,
                            addedRecords: 100,
                            skippedRecords: 0,
                        },
                    },
                ],
            };

            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            expect(screen.getByText('Clear completed')).toBeInTheDocument();
        });

        it('calls clearCompleted when button is clicked', () => {
            mockUseImportReturn = {
                ...defaultMockState,
                uploads: [
                    {
                        file: new File(['{}'], 'test.json', { type: 'application/json' }),
                        jobId: 'job-123',
                        progress: {
                            status: 'COMPLETED' as const,
                            totalRecords: 100,
                            processedRecords: 100,
                            addedRecords: 100,
                            skippedRecords: 0,
                        },
                    },
                ],
            };

            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            fireEvent.click(screen.getByText('Clear completed'));

            expect(mockClearCompleted).toHaveBeenCalled();
        });
    });

    // History tab tests
    describe('history tab', () => {
        it('shows loading state', () => {
            mockUseImportReturn = {
                ...defaultMockState,
                isLoadingJobs: true,
            };

            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);
            fireEvent.click(screen.getByRole('button', { name: /history/i }));

            expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
        });

        it('renders job history list', () => {
            mockUseImportReturn = {
                ...defaultMockState,
                jobs: [
                    {
                        id: 'job-1',
                        fileName: 'endsong_0.json',
                        status: 'COMPLETED' as const,
                        totalEvents: 5000,
                        processedEvents: 5000,
                        errorMessage: null,
                        createdAt: '2025-01-01T12:00:00Z',
                        startedAt: '2025-01-01T12:00:01Z',
                        completedAt: '2025-01-01T12:05:00Z',
                    },
                    {
                        id: 'job-2',
                        fileName: 'endsong_1.json',
                        status: 'FAILED' as const,
                        totalEvents: 0,
                        processedEvents: 0,
                        errorMessage: 'Parse error',
                        createdAt: '2025-01-02T12:00:00Z',
                        startedAt: null,
                        completedAt: null,
                    },
                ],
            };

            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);
            fireEvent.click(screen.getByRole('button', { name: /history/i }));

            expect(screen.getByText('endsong_0.json')).toBeInTheDocument();
            expect(screen.getByText('endsong_1.json')).toBeInTheDocument();
            expect(screen.getByText('5,000 events')).toBeInTheDocument();
            expect(screen.getByText('Parse error')).toBeInTheDocument();
        });

        it('shows empty state when no jobs', () => {
            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);
            fireEvent.click(screen.getByRole('button', { name: /history/i }));

            expect(screen.getByText('No import history yet. Upload your first file!')).toBeInTheDocument();
        });
    });

    // Modal close behavior
    describe('modal close', () => {
        it('calls onClose when backdrop clicked', () => {
            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            const backdrop = document.querySelector('.bg-black\\/80');
            fireEvent.click(backdrop!);

            expect(mockOnClose).toHaveBeenCalled();
        });

        it('calls onClose when X button clicked', () => {
            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            const closeButton = screen.getAllByTestId('x-icon')[0].closest('button');
            fireEvent.click(closeButton!);

            expect(mockOnClose).toHaveBeenCalled();
        });

    it('calls onClose when Cancel button clicked', () => {
            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            fireEvent.click(screen.getByText('Cancel'));

            expect(mockOnClose).toHaveBeenCalled();
        });

        it('shows Close button instead of Cancel when jobs are active', () => {
            mockUseImportReturn = {
                ...defaultMockState,
                hasActiveJobs: true,
            };

            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            expect(screen.getByText('Close')).toBeInTheDocument();
            expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
        });

        it('calls reset when closing without active jobs', () => {
            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            fireEvent.click(screen.getByText('Cancel'));

            expect(mockReset).toHaveBeenCalled();
        });

        it('does not call reset when closing with active jobs', () => {
            mockUseImportReturn = {
                ...defaultMockState,
                hasActiveJobs: true,
            };

            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            fireEvent.click(screen.getByText('Close'));

            expect(mockReset).not.toHaveBeenCalled();
        });
    });

    // Empty states
    describe('empty states', () => {
        it('shows empty state in upload tab when no files', () => {
            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            expect(screen.getByText('No files selected. Drop files above to get started.')).toBeInTheDocument();
        });
    });

    // Drag and drop tests
    describe('drag and drop', () => {
        it('handles file drop', () => {
            render(<ImportHistoryModal isOpen={true} onClose={mockOnClose} />);

            const dropZone = screen.getByText('Drop files here or click to select').closest('div');
            const file = new File(['{}'], 'dropped.json', { type: 'application/json' });

            const dataTransfer = {
                files: [file],
            };

            fireEvent.drop(dropZone!, { dataTransfer });

            expect(mockAddFiles).toHaveBeenCalledWith([file]);
        });
    });
});
