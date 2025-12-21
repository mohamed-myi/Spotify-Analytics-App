
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
        expect(historyLink).toHaveClass('text-white') // Active class

        const browseLink = screen.getByText('Browse')
        expect(browseLink).not.toHaveClass('text-white') // Inactive
    })

    it('handleLogout calls API and redirects', async () => {
        (api.post as jest.Mock).mockResolvedValue({})

        render(<AppLayout>Content</AppLayout>)

        // Click logout in nav
        const logoutBtn = screen.getByTitle('Logout')
        fireEvent.click(logoutBtn)

        // Click Yes in confirmation dialog
        const confirmBtn = screen.getByText('Yes')
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

        // Click Yes in confirmation dialog
        const confirmBtn = screen.getByText('Yes')
        fireEvent.click(confirmBtn)

        await waitFor(() => {
            expect(api.post).toHaveBeenCalled()
            expect(mockPush).not.toHaveBeenCalled()
        })

        consoleSpy.mockRestore()
    })
})
