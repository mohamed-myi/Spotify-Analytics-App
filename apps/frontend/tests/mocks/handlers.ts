import { http, HttpResponse } from 'msw'

// API requests go through Next.js proxy at /api/*
const API_URL = '/api'

// Default mock data
export const mockUser = {
    id: '1',
    displayName: 'Test User',
    image: 'https://example.com/user.jpg'
}

export const mockArtists = [
    {
        artist: {
            id: 'a1',
            name: 'Pink Floyd',
            images: [{ url: 'https://example.com/pf.jpg' }]
        },
        playCount: 100
    },
    {
        artist: {
            id: 'a2',
            name: 'Led Zeppelin',
            images: [{ url: 'https://example.com/lz.jpg' }]
        },
        playCount: 80
    }
]

export const mockTracks = [
    {
        track: {
            id: 't1',
            name: 'Comfortably Numb',
            artists: [{ artist: { name: 'Pink Floyd' } }],
            album: {
                name: 'The Wall',
                images: [{ url: 'https://example.com/wall.jpg' }]
            }
        },
        playCount: 50
    },
    {
        track: {
            id: 't2',
            name: 'Stairway to Heaven',
            artists: [{ artist: { name: 'Led Zeppelin' } }],
            album: {
                name: 'Led Zeppelin IV',
                images: [{ url: 'https://example.com/lz4.jpg' }]
            }
        },
        playCount: 45
    }
]

export const mockHistory = {
    events: [
        {
            id: 'e1',
            track: {
                name: 'Time',
                artists: [{ artist: { name: 'Pink Floyd' } }],
                album: { images: [{ url: 'https://example.com/dsotm.jpg' }] }
            },
            playedAt: new Date().toISOString()
        },
        {
            id: 'e2',
            track: {
                name: 'Money',
                artists: [{ artist: { name: 'Pink Floyd' } }],
                album: { images: [{ url: 'https://example.com/dsotm.jpg' }] }
            },
            playedAt: new Date(Date.now() - 3600000).toISOString()
        }
    ]
}

export const handlers = [
    // Auth endpoints
    http.get(`${API_URL}/auth/me`, () => {
        return HttpResponse.json(mockUser)
    }),

    http.post(`${API_URL}/auth/logout`, () => {
        return new HttpResponse(null, { status: 200 })
    }),

    // Stats endpoints
    http.get(`${API_URL}/me/stats/top/artists`, () => {
        return HttpResponse.json(mockArtists)
    }),

    http.get(`${API_URL}/me/stats/top/tracks`, () => {
        return HttpResponse.json(mockTracks)
    }),

    // History endpoint
    http.get(`${API_URL}/me/history`, () => {
        return HttpResponse.json(mockHistory)
    })
]

// Handler overrides for specific test scenarios
export const unauthenticatedHandler = http.get(`${API_URL}/auth/me`, () => {
    return new HttpResponse(null, { status: 401 })
})

export const emptyArtistsHandler = http.get(`${API_URL}/me/stats/top/artists`, () => {
    return HttpResponse.json([])
})

export const emptyTracksHandler = http.get(`${API_URL}/me/stats/top/tracks`, () => {
    return HttpResponse.json([])
})

export const emptyHistoryHandler = http.get(`${API_URL}/me/history`, () => {
    return HttpResponse.json({ events: [] })
})

export const networkErrorHandler = http.get(`${API_URL}/me/stats/top/artists`, () => {
    return HttpResponse.error()
})
