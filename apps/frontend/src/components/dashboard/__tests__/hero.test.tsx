import React from 'react'
import { render, screen } from '@testing-library/react'
import { Hero } from '../hero'

interface MockMotionProps {
    children?: React.ReactNode;
    className?: string;
}

// Mock framer-motion to avoid animation issues in tests
jest.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: MockMotionProps) => <div {...props}>{children}</div>,
        span: ({ children, ...props }: MockMotionProps) => <span {...props}>{children}</span>,
        h1: ({ children, ...props }: MockMotionProps) => <h1 {...props}>{children}</h1>,
        p: ({ children, ...props }: MockMotionProps) => <p {...props}>{children}</p>
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
    Music: () => <span data-testid="music-icon">♫</span>,
    User: () => <span data-testid="user-icon">👤</span>
}))

// Mock background mode context
jest.mock('@/contexts/background-mode-context', () => ({
    useBackgroundMode: () => ({
        mode: 'top-artist',
        currentLabel: 'Top Artist',
        next: jest.fn(),
        previous: jest.fn()
    })
}))

const defaultProps = {
    title: 'Pink Floyd',
    subtitle: '#1 Artist',
    description: 'Your favorite artist over the last year.',
    image: 'http://img.com/pf.jpg'
}

describe('Hero', () => {
    it('renders title prop', () => {
        render(<Hero {...defaultProps} />)
        expect(screen.getByText('Pink Floyd')).toBeInTheDocument()
    })

    it('renders subtitle badge', () => {
        render(<Hero {...defaultProps} />)
        // In top-artist mode, it ignores subtitle prop and shows "Your Top Artist"
        expect(screen.getByText('Your Top Artist')).toBeInTheDocument()
    })

    it('renders description text', () => {
        render(<Hero {...defaultProps} />)
        // In top-artist mode, it ignores description prop
        expect(screen.getByText('Your most listened artist this year')).toBeInTheDocument()
    })

    it('renders the current top-artist CTA link', () => {
        render(<Hero {...defaultProps} />)
        expect(screen.getByRole('link', { name: /view artist/i })).toBeInTheDocument()
    })
})
