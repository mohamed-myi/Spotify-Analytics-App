
import { render, screen } from '@testing-library/react'
import { ProcessingScreen } from '../processing-screen'

// Mock Image component since it's Next.js specific
jest.mock('next/image', () => ({
    __esModule: true,
    default: ({ unoptimized, ...props }: any) => <img {...props} />
}))

describe('ProcessingScreen Component', () => {
    it('renders with default message', () => {
        render(<ProcessingScreen />)

        expect(screen.getByText('Analyzing your music taste...')).toBeInTheDocument()
    })

    it('render with custom message', () => {
        render(<ProcessingScreen message="Custom loading message..." />)

        expect(screen.getByText('Custom loading message...')).toBeInTheDocument()
    })

    it('renders logo and branding', () => {
        render(<ProcessingScreen />)

        expect(screen.getByAltText('MYI')).toBeInTheDocument()
        expect(screen.getByText(/Syncing Account/i)).toBeInTheDocument()
        expect(screen.getByText(/MYI • Your Music Intelligence/i)).toBeInTheDocument()
    })
})
