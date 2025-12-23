/* eslint-disable @next/next/no-img-element */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AppLayout } from '../app-layout'
import { api } from '@/lib/api'
import { useRouter, usePathname } from 'next/navigation'

// Mocks
jest.mock('next/navigation', () => ({
    useRouter: jest.fn(),
    usePathname: jest.fn()
}))

jest.mock('@/lib/api', () => ({
    api: {
        post: jest.fn()
    }
}))

jest.mock('@/hooks/use-dashboard', () => ({
    useUser: jest.fn(() => ({
        user: { id: '1', displayName: 'Test User', image: null },
        isLoading: false,
        isAuthenticated: true
    })),
    useTopArtists: jest.fn(() => ({
        artists: [{ id: 'a1', name: 'Pink Floyd', image: 'https://example.com/pf.jpg' }],
        isLoading: false
    }))
}))

jest.mock('@/hooks/use-song-of-the-day', () => ({
    useSongOfTheDay: jest.fn(() => ({
        track: { name: 'Test Song', artist: 'Test Artist' },
        image: 'https://example.com/song.jpg',
        isLoading: false
    }))
}))

// Mock next/image
jest.mock('next/image', () => ({
    __esModule: true,
    default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />
}))

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
    LogOut: () => <span data-testid="logout-icon">Logout</span>,
    Upload: () => <span data-testid="upload-icon">Upload</span>,
    Menu: () => <span data-testid="menu-icon">Menu</span>,
    X: () => <span data-testid="x-icon">X</span>,
    ChevronLeft: () => <span data-testid="chevron-left-icon">ChevronLeft</span>,
    ChevronRight: () => <span data-testid="chevron-right-icon">ChevronRight</span>
}))

describe('AppLayout', () => {
    const mockPush = jest.fn()

    beforeEach(() => {
        (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
        (usePathname as jest.Mock).mockReturnValue('/dashboard');
        jest.clearAllMocks();
    })

    it('renders children and navigation', () => {
        render(
            <AppLayout>
                <div data-testid="child-content">Child Content</div>
            </AppLayout>
        )

        expect(screen.getByTestId('child-content')).toBeInTheDocument()
        expect(screen.getByAltText('MYI')).toBeInTheDocument()
        expect(screen.getByText('Browse')).toBeInTheDocument()
        expect(screen.getByText('History')).toBeInTheDocument()
    })

    it('highlights active link', () => {
        (usePathname as jest.Mock).mockReturnValue('/dashboard/history')

        render(<AppLayout>Content</AppLayout>)

        const historyLink = screen.getByText('History')
        expect(historyLink).toHaveClass('text-white/90')

        const browseLink = screen.getByText('Browse')
        expect(browseLink).toHaveClass('text-white/60')
    })

    it('handleLogout calls API and redirects', async () => {
        (api.post as jest.Mock).mockResolvedValue({})

        render(<AppLayout>Content</AppLayout>)

        // Click logout in nav
        const logoutBtn = screen.getByTitle('Logout')
        fireEvent.click(logoutBtn)

        // Click Sign Out in confirmation dialog  
        const confirmBtn = screen.getByText('Sign Out')
        fireEvent.click(confirmBtn)

        await waitFor(() => {
            expect(api.post).toHaveBeenCalledWith('/auth/logout')
            expect(mockPush).toHaveBeenCalledWith('/')
        })
    })

    it('handleLogout handles errors', async () => {
        (api.post as jest.Mock).mockRejectedValue(new Error('Logout failed'))
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        render(<AppLayout>Content</AppLayout>)

        // Click logout in nav
        const logoutBtn = screen.getByTitle('Logout')
        fireEvent.click(logoutBtn)

        // Click Sign Out in confirmation dialog
        const confirmBtn = screen.getByText('Sign Out')
        fireEvent.click(confirmBtn)

        await waitFor(() => {
            expect(api.post).toHaveBeenCalled()
            expect(mockPush).not.toHaveBeenCalled()
        })

        consoleSpy.mockRestore()
    })

    it('renders footer with sync status', () => {
        render(<AppLayout>Content</AppLayout>)

        expect(screen.getByText(/SYNC STATUS:/)).toBeInTheDocument()
        expect(screen.getByText('v3.0.0')).toBeInTheDocument()
    })

    it('renders hamburger menu button on mobile', () => {
        render(<AppLayout>Content</AppLayout>)

        // Hamburger should be visible (hidden via CSS on desktop, but rendered)
        expect(screen.getByTestId('menu-icon')).toBeInTheDocument()
    })

    it('opens mobile menu when hamburger clicked', () => {
        render(<AppLayout>Content</AppLayout>)

        const hamburgerBtn = screen.getByTestId('menu-icon').closest('button')
        fireEvent.click(hamburgerBtn!)

        // Menu should show close icon
        expect(screen.getByTestId('x-icon')).toBeInTheDocument()
    })

    it('shows navigation links in mobile menu', () => {
        render(<AppLayout>Content</AppLayout>)

        const hamburgerBtn = screen.getByTestId('menu-icon').closest('button')
        fireEvent.click(hamburgerBtn!)

        // All links should be visible in mobile menu
        expect(screen.getAllByText('Browse').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText('History').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText('Stats').length).toBeGreaterThanOrEqual(1)
    })

    it('closes mobile menu when close button clicked', () => {
        render(<AppLayout>Content</AppLayout>)

        // Open menu
        const hamburgerBtn = screen.getByTestId('menu-icon').closest('button')
        fireEvent.click(hamburgerBtn!)

        expect(screen.getByTestId('x-icon')).toBeInTheDocument()

        // Close menu
        const closeBtn = screen.getByTestId('x-icon').closest('button')
        fireEvent.click(closeBtn!)

        // Back to hamburger
        expect(screen.getByTestId('menu-icon')).toBeInTheDocument()
    })
})
