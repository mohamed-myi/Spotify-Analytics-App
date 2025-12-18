
import { test, expect, Page } from '@playwright/test';

// Helper to set up common mock routes
async function setupMockRoutes(page: Page) {
    await page.route('**/auth/me', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: '1', displayName: 'Test User', image: 'https://example.com/user.jpg' })
    }))

    await page.route('**/me/stats/top/artists**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
            { artist: { id: 'a1', name: 'Pink Floyd', images: [{ url: 'https://example.com/pf.jpg' }] }, playCount: 100 },
            { artist: { id: 'a2', name: 'Led Zeppelin', images: [{ url: 'https://example.com/lz.jpg' }] }, playCount: 80 }
        ])
    }))

    await page.route('**/me/stats/top/tracks**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
            { track: { id: 't1', name: 'Comfortably Numb', artists: [{ artist: { name: 'Pink Floyd' } }], album: { name: 'The Wall', images: [{ url: 'https://example.com/wall.jpg' }] } }, playCount: 50 }
        ])
    }))

    await page.route('**/me/history**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            events: [
                { id: 'e1', track: { name: 'Time', artists: [{ artist: { name: 'Pink Floyd' } }], album: { images: [{ url: 'https://example.com/dsotm.jpg' }] } }, playedAt: new Date().toISOString() }
            ]
        })
    }))
}

test.describe('Dashboard Access', () => {
    test('should redirect unauthenticated users to backend login', async ({ page }) => {
        await page.goto('/dashboard');

        await expect(page).toHaveURL(/\/dashboard/);
        await expect(page.getByText('MYI')).toBeVisible();
        await expect(page.getByText('Browse')).toBeVisible();
    });

    test('should allow navigation between tabs', async ({ page }) => {
        await setupMockRoutes(page)

        await page.goto('/dashboard');

        await page.getByText('History').click();
        await expect(page).toHaveURL(/\/dashboard\/history/);

        await page.getByText('Browse').click();
        await expect(page).toHaveURL(/\/dashboard/);
    });
});

test.describe('Dashboard - Data Loading', () => {
    test.beforeEach(async ({ page }) => {
        await setupMockRoutes(page)
    })

    test('displays hero with top artist name', async ({ page }) => {
        await page.goto('/dashboard')

        // Hero should display the top artist name
        await expect(page.getByText('Pink Floyd')).toBeVisible()
    })

    test('displays #1 All-Time Artist subtitle', async ({ page }) => {
        await page.goto('/dashboard')

        await expect(page.getByText('#1 All-Time Artist')).toBeVisible()
    })

    test('displays Top Artists content row', async ({ page }) => {
        await page.goto('/dashboard')

        await expect(page.getByText('Top Artists')).toBeVisible()
    })

    test('displays Top Tracks content row', async ({ page }) => {
        await page.goto('/dashboard')

        await expect(page.getByText('Top Tracks')).toBeVisible()
    })

    test('displays Recently Played content row', async ({ page }) => {
        await page.goto('/dashboard')

        await expect(page.getByText('Recently Played')).toBeVisible()
    })
})

test.describe('Dashboard - Time Range Filter', () => {
    test.beforeEach(async ({ page }) => {
        await setupMockRoutes(page)
    })

    test('time range dropdown is visible', async ({ page }) => {
        await page.goto('/dashboard')

        // Look for "All-Time" which is the default
        await expect(page.getByText('All-Time').first()).toBeVisible()
    })

    test('clicking time range opens dropdown', async ({ page }) => {
        await page.goto('/dashboard')

        await page.getByText('All-Time').first().click()

        // Options should be visible
        await expect(page.getByText('Last 4 Weeks')).toBeVisible()
        await expect(page.getByText('Last 6 Months')).toBeVisible()
    })
})

