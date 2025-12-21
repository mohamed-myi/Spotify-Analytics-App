import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContentRow } from '../content-row'

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
    ChevronLeft: () => <span data-testid="chevron-left">Left</span>,
    ChevronRight: () => <span data-testid="chevron-right">Right</span>,
    RefreshCw: () => <span data-testid="refresh-cw">Refresh</span>
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

            expect(screen.getByText('Pink Floyd')).toBeInTheDocument()
            expect(screen.getByText('Led Zeppelin')).toBeInTheDocument()
        })

        it('renders artist type with name display', () => {
            render(
                <ContentRow title="Top Artists" items={mockArtistItems} type="artist" />
            )

            // Artist type shows name below the card
            expect(screen.getByText('Pink Floyd')).toBeInTheDocument()
        })

        it('renders track type with artist subtitle', () => {
            render(
                <ContentRow title="Top Tracks" items={mockTrackItems} type="track" />
            )

            // Track type shows both track name and artist
            expect(screen.getByText('Comfortably Numb')).toBeInTheDocument()
            expect(screen.getByText('Pink Floyd')).toBeInTheDocument()
        })

        it('renders wide type cards', () => {
            render(
                <ContentRow title="Recently Played" items={mockWideItems} type="wide" />
            )

            expect(screen.getByText('Recently Played 1')).toBeInTheDocument()
        })

        it('renders empty state when no items', () => {
            render(
                <ContentRow title="Empty Row" items={[]} type="artist" />
            )

            expect(screen.getByText('Empty Row')).toBeInTheDocument()
            // No items should render
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

            fireEvent.click(screen.getByText('Pink Floyd'))

            expect(mockOnItemClick).toHaveBeenCalledWith(mockArtistItems[0])
        })

        it('scroll buttons are visible on hover', () => {
            render(
                <ContentRow title="Top Artists" items={mockArtistItems} type="artist" />
            )

            // Scroll buttons should exist (visible on group hover via CSS)
            expect(screen.getByTestId('chevron-left')).toBeInTheDocument()
            expect(screen.getByTestId('chevron-right')).toBeInTheDocument()
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

            // Open dropdown
            fireEvent.click(screen.getByText('Last 1 Year'))
            // Select new option
            fireEvent.click(screen.getByText('Last 4 Weeks'))

            expect(mockOnRangeChange).toHaveBeenCalledWith('4weeks')
        })
    })
})
