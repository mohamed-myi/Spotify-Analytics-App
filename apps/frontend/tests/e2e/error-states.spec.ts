import { test, expect } from '@playwright/test'

test.describe('Error Handling', () => {
    test('app handles network failure gracefully', async ({ page }) => {
        // Mock auth to pass
        await page.route('**/auth/me', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ id: '1', displayName: 'Test User' })
        }))

        // Mock stats endpoints to fail
        await page.route('**/me/stats/**', route => route.abort('failed'))
        await page.route('**/me/history**', route => route.abort('failed'))

        await page.goto('/dashboard')

        // App should not crash; navigation should still work
        await expect(page.getByText('MYI')).toBeVisible()
        await expect(page.getByText('Browse')).toBeVisible()
    })

    test('empty data displays loading message in hero', async ({ page }) => {
        await page.route('**/auth/me', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ id: '1', displayName: 'Test User' })
        }))

        // Return empty arrays
        await page.route('**/me/stats/top/artists**', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([])
        }))

        await page.route('**/me/stats/top/tracks**', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([])
        }))

        await page.route('**/me/history**', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ events: [] })
        }))

        await page.goto('/dashboard')

        // Main graphic shows "Loading..." as fallback when no top artist
        await expect(page.getByText('Loading...')).toBeVisible()
    })
})
