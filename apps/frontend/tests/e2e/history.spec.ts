import { test, expect } from '@playwright/test'

test.describe('History Page', () => {
    test.beforeEach(async ({ page }) => {
        // Mock auth
        await page.route('**/auth/me', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ id: '1', displayName: 'Test User' })
        }))
    })

    test('displays grouped history sections', async ({ page }) => {
        const now = new Date()

        await page.route('**/me/history**', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                events: [
                    {
                        id: 'e1',
                        track: {
                            name: 'Today Track',
                            artists: [{ artist: { name: 'Today Artist' } }],
                            album: { images: [{ url: 'https://example.com/today.jpg' }] }
                        },
                        playedAt: now.toISOString()
                    }
                ],
                total: 1,
                page: 1,
                limit: 100
            })
        }))

        await page.goto('/dashboard/history')

        await expect(page.getByRole('heading', { name: 'History' })).toBeVisible()
        await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
        await expect(page.getByText('Today Track')).toBeVisible()
    })

    test('displays empty state when no history', async ({ page }) => {
        await page.route('**/me/history**', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ events: [], total: 0, page: 1, limit: 100 })
        }))

        await page.goto('/dashboard/history')

        await expect(page.getByText(/No listening history/i)).toBeVisible()
    })

    test('renders grid layout with items', async ({ page }) => {
        await page.route('**/me/history**', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                events: [
                    { id: 'e1', track: { name: 'Track 1', artists: [{ artist: { name: 'Artist 1' } }], album: { images: [{ url: 'https://example.com/t1.jpg' }] } }, playedAt: new Date().toISOString() },
                    { id: 'e2', track: { name: 'Track 2', artists: [{ artist: { name: 'Artist 2' } }], album: { images: [{ url: 'https://example.com/t2.jpg' }] } }, playedAt: new Date().toISOString() }
                ],
                total: 2,
                page: 1,
                limit: 100
            })
        }))

        await page.goto('/dashboard/history')

        await expect(page.getByText('Track 1')).toBeVisible()
        await expect(page.getByText('Track 2')).toBeVisible()
    })
})
