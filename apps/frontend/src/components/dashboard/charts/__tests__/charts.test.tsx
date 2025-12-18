import React from 'react';
import { render, screen } from '@testing-library/react';
import { MoodChart } from '../mood-chart';
import { DailyDoseChart } from '../daily-dose-chart';
import { OnRepeatList } from '../on-repeat-list';
import useSWR from 'swr';

// Mock SWR
jest.mock('swr', () => ({
    __esModule: true,
    default: jest.fn(),
}));

// Mock ResizeObserver for Recharts
global.ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
}));

describe('Charts Components', () => {
    beforeEach(() => {
        (useSWR as jest.Mock).mockClear();
    });

    describe('MoodChart', () => {
        it('renders loading state initially', () => {
            (useSWR as jest.Mock).mockReturnValue({
                data: undefined,
                isLoading: true
            });
            const { container } = render(<MoodChart />);
            expect(container.firstChild).toHaveClass('animate-pulse');
        });

        it('renders chart title when data is loaded', () => {
            (useSWR as jest.Mock).mockReturnValue({
                data: [{ date: '2025-01-01', valence: 0.5, energy: 0.5 }],
                isLoading: false
            });
            render(<MoodChart />);
            expect(screen.getByText('Mood Model')).toBeInTheDocument();
            expect(screen.getByText('Your music\'s emotional timeline over the last 30 days.')).toBeInTheDocument();
        });
    });

    describe('DailyDoseChart', () => {
        it('renders loading state', () => {
            (useSWR as jest.Mock).mockReturnValue({ data: undefined, isLoading: true });
            const { container } = render(<DailyDoseChart />);
            expect(container.firstChild).toHaveClass('animate-pulse');
        });

        it('renders title and data', () => {
            (useSWR as jest.Mock).mockReturnValue({
                data: { hourly: [{ hour: 12, playCount: 5 }] },
                isLoading: false
            });
            render(<DailyDoseChart />);
            expect(screen.getByText('Daily Dose')).toBeInTheDocument();
        });
    });

    describe('OnRepeatList', () => {
        it('renders loading state', () => {
            (useSWR as jest.Mock).mockReturnValue({ data: undefined, isLoading: true });
            const { container } = render(<OnRepeatList />);
            expect(container.firstChild).toHaveClass('animate-pulse');
        });

        it('renders list of tracks', () => {
            (useSWR as jest.Mock).mockReturnValue({
                data: [
                    {
                        id: '1',
                        name: 'Test Song',
                        artists: [{ name: 'Test Artist' }],
                        totalMs: '60000', // 1 min
                        playCount: 5,
                        album: { imageUrl: 'test.jpg' }
                    }
                ],
                isLoading: false
            });
            render(<OnRepeatList />);
            expect(screen.getByText('On Repeat (Real Deal)')).toBeInTheDocument();
            expect(screen.getByText('Test Song')).toBeInTheDocument();
            expect(screen.getByText('Test Artist')).toBeInTheDocument();
            expect(screen.getByText('1m')).toBeInTheDocument(); // Formatted time
        });

        it('renders empty state', () => {
            (useSWR as jest.Mock).mockReturnValue({
                data: [],
                isLoading: false
            });
            render(<OnRepeatList />);
            expect(screen.getByText('No listening history found yet.')).toBeInTheDocument();
        });
    });
});
