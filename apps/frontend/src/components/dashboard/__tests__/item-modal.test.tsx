import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ItemModal } from '../item-modal'

interface MockMotionDivProps {
    children?: React.ReactNode;
    onClick?: () => void;
    className?: string;
}

interface MockAnimatePresenceProps {
    children?: React.ReactNode;
}

// Mock framer-motion
jest.mock('framer-motion', () => ({
    motion: {
        div: ({ children, onClick, className }: MockMotionDivProps) => (
            <div onClick={onClick} className={className} data-testid={className?.includes('backdrop') ? 'backdrop' : undefined}>
                {children}
            </div>
        )
    },
    AnimatePresence: ({ children }: MockAnimatePresenceProps) => <>{children}</>
}))

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
    X: () => <span data-testid="close-icon">×</span>,
    Play: () => <span>▶</span>,
    Heart: () => <span>♥</span>,
    Share2: () => <span>↗</span>
}))

const mockItem = {
    id: 't1',
    name: 'Comfortably Numb',
    artist: 'Pink Floyd',
    image: 'http://img.com/wall.jpg'
}

describe('ItemModal', () => {
    const mockOnClose = jest.fn()

    beforeEach(() => {
        jest.clearAllMocks()
        document.body.style.overflow = 'unset'
    })

    it('renders nothing when item is null', () => {
        const { container } = render(
            <ItemModal isOpen={true} onClose={mockOnClose} item={null} />
        )

        expect(container.firstChild).toBeNull()
    })

    it('renders nothing when isOpen is false', () => {
        const { container } = render(
            <ItemModal isOpen={false} onClose={mockOnClose} item={mockItem} />
        )

        // AnimatePresence + isOpen false should not render content
        expect(screen.queryByText('Comfortably Numb')).not.toBeInTheDocument()
    })

    it('renders modal content when open with item', () => {
        render(
            <ItemModal isOpen={true} onClose={mockOnClose} item={mockItem} />
        )

        expect(screen.getByText('Comfortably Numb')).toBeInTheDocument()
    })

    it('displays item name in modal', () => {
        render(
            <ItemModal isOpen={true} onClose={mockOnClose} item={mockItem} />
        )

        expect(screen.getByText('Comfortably Numb')).toBeInTheDocument()
    })

    it('displays artist when available', () => {
        render(
            <ItemModal isOpen={true} onClose={mockOnClose} item={mockItem} />
        )

        expect(screen.getByText(/Pink Floyd/)).toBeInTheDocument()
    })

    it('calls onClose when X button clicked', () => {
        render(
            <ItemModal isOpen={true} onClose={mockOnClose} item={mockItem} />
        )

        const closeButton = screen.getByTestId('close-icon').parentElement
        fireEvent.click(closeButton!)

        expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('sets body overflow hidden when open', () => {
        render(
            <ItemModal isOpen={true} onClose={mockOnClose} item={mockItem} />
        )

        expect(document.body.style.overflow).toBe('hidden')
    })

    it('restores body overflow on close', () => {
        const { rerender } = render(
            <ItemModal isOpen={true} onClose={mockOnClose} item={mockItem} />
        )

        expect(document.body.style.overflow).toBe('hidden')

        rerender(
            <ItemModal isOpen={false} onClose={mockOnClose} item={mockItem} />
        )

        expect(document.body.style.overflow).toBe('unset')
    })

    it('cleans up body overflow on unmount', () => {
        const { unmount } = render(
            <ItemModal isOpen={true} onClose={mockOnClose} item={mockItem} />
        )

        expect(document.body.style.overflow).toBe('hidden')

        unmount()

        expect(document.body.style.overflow).toBe('unset')
    })
})
