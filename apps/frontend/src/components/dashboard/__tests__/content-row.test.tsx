/* eslint-disable @next/next/no-img-element */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContentRow } from '../content-row'

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
    ChevronRight: () => <span data-testid="chevron-right">Right</span>,
    ChevronLeft: () => <span data-testid="chevron-left">Left</span>,
    RefreshCw: ({ className }: { className?: string }) => <span data-testid="refresh-cw" className={className}>Refresh</span>
}))

// Mock next/image
jest.mock('next/image', () => ({
    __esModule: true,
    default: ({ src, alt, fill, className }: { src: string; alt: string; fill?: boolean; className?: string }) => (
        <img src={src} alt={alt} className={className} data-fill={fill} />
    )
}))

const mockArtistItems = [
    { id: 'a1', name: 'Pink Floyd', image: 'http://img.com/pf.jpg' },
    { id: 'a2', name: 'Led Zeppelin', image: 'http://img.com/lz.jpg' }
]

const mockTrackItems = [
    { id: 't1', name: 'Comfortably Numb', artist: 'Pink Floyd', image: 'http://img.com/wall.jpg' },
    { id: 't2', name: 'Stairway', artist: 'Led Zeppelin', image: 'http://img.com/lz4.jpg' }
]

const mockWideItems = [
    { id: 'w1', name: 'Recently Played 1', image: 'http://img.com/rp1.jpg' },
    { id: 'w2', name: 'Recently Played 2', image: 'http://img.com/rp2.jpg' }
]

describe('ContentRow', () => {
    describe('Rendering', () => {
        it('renders title correctly', () => {
            render(
                <ContentRow title="Top Artists" items={mockArtistItems} type="artist" />
            )
            expect(screen.getByText('Top Artists')).toBeInTheDocument()
        })

        it('renders correct number of items', () => {
            render(
                <ContentRow title="Top Artists" items={mockArtistItems} type="artist" />
            )
            // Items appear in both desktop and mobile layouts
            expect(screen.getAllByText('Pink Floyd').length).toBeGreaterThan(0)
            expect(screen.getAllByText('Led Zeppelin').length).toBeGreaterThan(0)
        })

        it('renders artist type with name display', () => {
            render(
                <ContentRow title="Top Artists" items={mockArtistItems} type="artist" />
            )
            expect(screen.getAllByText('Pink Floyd').length).toBeGreaterThan(0)
        })

        it('renders track type with artist subtitle', () => {
            render(
                <ContentRow title="Top Tracks" items={mockTrackItems} type="track" />
            )
            expect(screen.getAllByText('Comfortably Numb').length).toBeGreaterThan(0)
            expect(screen.getAllByText('Pink Floyd').length).toBeGreaterThan(0)
        })

        it('renders wide type cards', () => {
            render(
                <ContentRow title="Recently Played" items={mockWideItems} type="wide" />
            )
            expect(screen.getAllByText('Recently Played 1').length).toBeGreaterThan(0)
        })

        it('renders empty state when no items', () => {
            render(
                <ContentRow title="Empty Row" items={[]} type="artist" />
            )
            expect(screen.getByText('Empty Row')).toBeInTheDocument()
        })

        it('shows rank for artists when showRank is true', () => {
            render(
                <ContentRow title="Top Artists" items={mockArtistItems} type="artist" showRank={true} />
            )
            expect(screen.getByText('Rank #1')).toBeInTheDocument()
            expect(screen.getByText('Rank #2')).toBeInTheDocument()
        })
    })

    describe('Interactions', () => {
        it('calls onItemClick when item is clicked', () => {
            const mockOnItemClick = jest.fn()

            render(
                <ContentRow
                    title="Top Artists"
                    items={mockArtistItems}
                    type="artist"
                    onItemClick={mockOnItemClick}
                />
            )

            // Click the first Pink Floyd element (may be in desktop or mobile view)
            fireEvent.click(screen.getAllByText('Pink Floyd')[0])
            expect(mockOnItemClick).toHaveBeenCalledWith(mockArtistItems[0])
        })

        it('calls onRefresh when refresh button is clicked', () => {
            const mockOnRefresh = jest.fn()

            render(
                <ContentRow
                    title="Top Artists"
                    items={mockArtistItems}
                    type="artist"
                    onRefresh={mockOnRefresh}
                />
            )

            fireEvent.click(screen.getByTestId('refresh-cw').closest('button')!)
            expect(mockOnRefresh).toHaveBeenCalled()
        })

        it('shows spinning animation when refreshing', () => {
            render(
                <ContentRow
                    title="Top Artists"
                    items={mockArtistItems}
                    type="artist"
                    onRefresh={jest.fn()}
                    isRefreshing={true}
                />
            )

            expect(screen.getByTestId('refresh-cw')).toHaveClass('animate-spin')
        })
    })

    describe('Time Range Dropdown', () => {
        it('shows time range when showTimeRange is true', () => {
            render(
                <ContentRow
                    title="Top Artists"
                    items={mockArtistItems}
                    type="artist"
                    showTimeRange={true}
                    selectedRange="year"
                />
            )

            expect(screen.getByText('Last 1 Year')).toBeInTheDocument()
        })

        it('hides time range when showTimeRange is false', () => {
            render(
                <ContentRow
                    title="Top Artists"
                    items={mockArtistItems}
                    type="artist"
                    showTimeRange={false}
                />
            )

            expect(screen.queryByText('Last 1 Year')).not.toBeInTheDocument()
        })

        it('opens dropdown on click', () => {
            render(
                <ContentRow
                    title="Top Artists"
                    items={mockArtistItems}
                    type="artist"
                    showTimeRange={true}
                    selectedRange="year"
                    onRangeChange={jest.fn()}
                />
            )

            fireEvent.click(screen.getByText('Last 1 Year'))

            expect(screen.getByText('Last 4 Weeks')).toBeInTheDocument()
            expect(screen.getByText('Last 6 Months')).toBeInTheDocument()
        })

        it('shows All Time option when hasImportedHistory is true', () => {
            render(
                <ContentRow
                    title="Top Artists"
                    items={mockArtistItems}
                    type="artist"
                    showTimeRange={true}
                    selectedRange="year"
                    onRangeChange={jest.fn()}
                    hasImportedHistory={true}
                />
            )

            fireEvent.click(screen.getByText('Last 1 Year'))
            expect(screen.getByText('All Time')).toBeInTheDocument()
        })

        it('changes selection and closes dropdown', () => {
            const mockOnRangeChange = jest.fn()

            render(
                <ContentRow
                    title="Top Artists"
                    items={mockArtistItems}
                    type="artist"
                    showTimeRange={true}
                    selectedRange="year"
                    onRangeChange={mockOnRangeChange}
                />
            )

            fireEvent.click(screen.getByText('Last 1 Year'))
            fireEvent.click(screen.getByText('Last 4 Weeks'))

            expect(mockOnRangeChange).toHaveBeenCalledWith('4weeks')
        })
    })
})
