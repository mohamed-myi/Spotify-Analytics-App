/* eslint-disable @next/next/no-img-element */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { ProfileHeader } from '../profile-header'

interface MockMotionProps {
    children?: React.ReactNode;
    className?: string;
}

// Mock framer-motion
jest.mock('framer-motion', () => ({
    motion: {
        div: ({ children, className }: MockMotionProps) => <div className={className}>{children}</div>
    }
}))

// Mock next/image
jest.mock('next/image', () => ({
    __esModule: true,
    default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />
}))

// Mock lucide-react
jest.mock('lucide-react', () => ({
    Calendar: () => <span data-testid="calendar-icon">Calendar</span>,
    MapPin: () => <span data-testid="map-icon">MapPin</span>
}))

const mockProps = {
    displayName: 'John Doe',
    spotifyId: 'johndoe123',
    imageUrl: 'https://example.com/avatar.jpg',
    country: 'US',
    memberSince: '2023-06-15T00:00:00Z'
}

describe('ProfileHeader', () => {
    it('renders display name', () => {
        render(<ProfileHeader {...mockProps} />)
        expect(screen.getByText('John Doe')).toBeInTheDocument()
    })

    it('renders spotify ID', () => {
        render(<ProfileHeader {...mockProps} />)
        expect(screen.getByText('@johndoe123')).toBeInTheDocument()
    })

    it('renders member since date', () => {
        render(<ProfileHeader {...mockProps} />)
        expect(screen.getByText(/Member since/)).toBeInTheDocument()
        // Date format may vary by locale, just check year is present
        expect(screen.getByText(/2023/)).toBeInTheDocument()
    })

    it('renders country when provided', () => {
        render(<ProfileHeader {...mockProps} />)
        expect(screen.getByText('US')).toBeInTheDocument()
        expect(screen.getByTestId('map-icon')).toBeInTheDocument()
    })

    it('hides country when not provided', () => {
        render(<ProfileHeader {...mockProps} country={null} />)
        expect(screen.queryByTestId('map-icon')).not.toBeInTheDocument()
    })

    it('renders avatar image when provided', () => {
        render(<ProfileHeader {...mockProps} />)
        const avatar = screen.getByAltText('John Doe')
        expect(avatar).toBeInTheDocument()
        expect(avatar).toHaveAttribute('src', 'https://example.com/avatar.jpg')
    })

    it('renders fallback initial when no image', () => {
        render(<ProfileHeader {...mockProps} imageUrl={null} />)
        expect(screen.getByText('J')).toBeInTheDocument()
    })

    it('renders calendar icon for member since', () => {
        render(<ProfileHeader {...mockProps} />)
        expect(screen.getByTestId('calendar-icon')).toBeInTheDocument()
    })
})
