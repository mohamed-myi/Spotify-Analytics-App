
import { renderHook, act } from '@testing-library/react'
import { useUser, useTopArtists, useTopTracks, useRecentHistory, useInfiniteHistory } from '../use-dashboard'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'

// Mock SWR
jest.mock('swr', () => ({
    __esModule: true,
    default: jest.fn()
}))

// Mock SWR Infinite
jest.mock('swr/infinite', () => ({
    __esModule: true,
    default: jest.fn()
}))

// Mock API fetcher
jest.mock('@/lib/api', () => ({
    fetcher: jest.fn(),
    api: { post: jest.fn() }
}))

describe('useUser Hook', () => {
    it('returns user data when authenticated', () => {
        (useSWR as jest.Mock).mockReturnValue({
            data: { id: '1', displayName: 'Test User' },
            error: null,
            isLoading: false
        })

        const { result } = renderHook(() => useUser())

        expect(result.current.user).toEqual({ id: '1', displayName: 'Test User' })
        expect(result.current.isAuthenticated).toBe(true)
        expect(result.current.isLoading).toBe(false)
    })

    it('handles unauthenticated state', () => {
        (useSWR as jest.Mock).mockReturnValue({
            data: null,
            error: { status: 401 },
            isLoading: false
        })

        const { result } = renderHook(() => useUser())

        expect(result.current.user).toBeNull()
        expect(result.current.isAuthenticated).toBe(false)
        expect(result.current.isError).toBeTruthy()
    })

    it('handles loading state', () => {
        (useSWR as jest.Mock).mockReturnValue({
            data: undefined,
            error: null,
            isLoading: true
        })

        const { result } = renderHook(() => useUser())

        expect(result.current.isLoading).toBe(true)
        expect(result.current.isAuthenticated).toBe(false)
    })
})

describe('useTopArtists Hook', () => {
    it('maps Spotify top artists data correctly', () => {
        const mockBackendData = [
            {
                id: 'a1',
                spotifyId: 'spotify:a1',
                name: 'Pink Floyd',
                imageUrl: 'http://img.com/pf.jpg',
                rank: 1
            }
        ];

        (useSWR as jest.Mock).mockReturnValue({
            data: mockBackendData,
            error: null,
            isLoading: false
        })

        const { result } = renderHook(() => useTopArtists('4weeks'))

        expect(result.current.artists).toHaveLength(1)
        expect(result.current.artists?.[0]).toEqual({
            id: 'a1',
            spotifyId: 'spotify:a1',
            name: 'Pink Floyd',
            image: 'http://img.com/pf.jpg',
            rank: 1
        })
    })

    it('handles empty data', () => {
        (useSWR as jest.Mock).mockReturnValue({
            data: [],
            error: null,
            isLoading: false
        })

        const { result } = renderHook(() => useTopArtists())

        expect(result.current.artists).toEqual([])
    })

    it('handles missing images gracefully', () => {
        const mockBackendData = [
            {
                id: 'a1',
                spotifyId: 'spotify:a1',
                name: 'Artist Without Image',
                imageUrl: null,
                rank: 1
            }
        ];

        (useSWR as jest.Mock).mockReturnValue({
            data: mockBackendData,
            error: null,
            isLoading: false
        })

        const { result } = renderHook(() => useTopArtists('4weeks'))

        expect(result.current.artists?.[0]?.image).toBe('')
    })

    it('falls back to index-based rank if rank is missing', () => {
        const mockBackendData = [
            { id: 'a1', name: 'Artist 1', imageUrl: null },
            { id: 'a2', name: 'Artist 2', imageUrl: null }
        ];

        (useSWR as jest.Mock).mockReturnValue({
            data: mockBackendData,
            error: null,
            isLoading: false
        })

        const { result } = renderHook(() => useTopArtists())

        expect(result.current.artists?.[0]?.rank).toBe(1)
        expect(result.current.artists?.[1]?.rank).toBe(2)
    })
})

describe('useTopTracks Hook', () => {
    it('maps Spotify top tracks data correctly', () => {
        // Backend now returns Spotify's actual top tracks with rank
        const mockBackendData = [
            {
                id: 't1',
                spotifyId: 'spotify:t1',
                name: 'Comfortably Numb',
                artists: [{ artist: { name: 'Pink Floyd', spotifyId: 'spotify:pf' } }],
                album: {
                    name: 'The Wall',
                    imageUrl: 'http://img.com/wall.jpg'
                },
                rank: 1
            }
        ];

        (useSWR as jest.Mock).mockReturnValue({
            data: mockBackendData,
            error: null,
            isLoading: false
        })

        const { result } = renderHook(() => useTopTracks('4weeks'))

        expect(result.current.tracks).toHaveLength(1)
        expect(result.current.tracks?.[0]).toEqual({
            id: 't1',
            spotifyId: 'spotify:t1',
            name: 'Comfortably Numb',
            artist: 'Pink Floyd',
            artistSpotifyId: 'spotify:pf',
            album: 'The Wall',
            image: 'http://img.com/wall.jpg',
            rank: 1
        })
    })

    it('handles empty data', () => {
        (useSWR as jest.Mock).mockReturnValue({
            data: [],
            error: null,
            isLoading: false
        })

        const { result } = renderHook(() => useTopTracks())

        expect(result.current.tracks).toEqual([])
    })

    it('handles missing artist gracefully', () => {
        const mockBackendData = [
            {
                id: 't1',
                name: 'Mystery Track',
                artists: [],
                album: { name: 'Album', imageUrl: null },
                rank: 1
            }
        ];

        (useSWR as jest.Mock).mockReturnValue({
            data: mockBackendData,
            error: null,
            isLoading: false
        })

        const { result } = renderHook(() => useTopTracks())

        expect(result.current.tracks?.[0]?.artist).toBe('Unknown')
    })

    it('handles loading state', () => {
        (useSWR as jest.Mock).mockReturnValue({
            data: undefined,
            error: null,
            isLoading: true
        })

        const { result } = renderHook(() => useTopTracks())

        expect(result.current.isLoading).toBe(true)
        expect(result.current.tracks).toBeUndefined()
    })

    it('handles error state', () => {
        (useSWR as jest.Mock).mockReturnValue({
            data: undefined,
            error: new Error('Network error'),
            isLoading: false
        })

        const { result } = renderHook(() => useTopTracks())

        expect(result.current.isError).toBeTruthy()
    })
})

describe('useRecentHistory Hook', () => {
    it('maps nested event data correctly', () => {
        const mockBackendData = {
            events: [
                {
                    id: 'e1',
                    track: {
                        spotifyId: 'spotify:t1',
                        name: 'Time',
                        artists: [{ artist: { name: 'Pink Floyd', spotifyId: 'spotify:pf' } }],
                        album: { imageUrl: 'http://img.com/dsotm.jpg' }
                    },
                    playedAt: '2025-12-18T00:00:00Z'
                }
            ]
        };

        (useSWR as jest.Mock).mockReturnValue({
            data: mockBackendData,
            error: null,
            isLoading: false
        })

        const { result } = renderHook(() => useRecentHistory(50))

        expect(result.current.history).toHaveLength(1)
        expect(result.current.history?.[0]).toEqual({
            id: 'e1',
            spotifyId: 'spotify:t1',
            name: 'Time',
            artist: 'Pink Floyd',
            artistSpotifyId: 'spotify:pf',
            image: 'http://img.com/dsotm.jpg',
            playedAt: '2025-12-18T00:00:00Z'
        })
    })

    it('handles empty events array', () => {
        (useSWR as jest.Mock).mockReturnValue({
            data: { events: [] },
            error: null,
            isLoading: false
        })

        const { result } = renderHook(() => useRecentHistory())

        expect(result.current.history).toEqual([])
    })

    it('handles missing image gracefully', () => {
        const mockBackendData = {
            events: [
                {
                    id: 'e1',
                    track: {
                        spotifyId: 'spotify:t1',
                        name: 'Track',
                        artists: [{ artist: { name: 'Artist', spotifyId: 'spotify:a1' } }],
                        album: { imageUrl: null }
                    },
                    playedAt: '2025-12-18T00:00:00Z'
                }
            ]
        };

        (useSWR as jest.Mock).mockReturnValue({
            data: mockBackendData,
            error: null,
            isLoading: false
        })

        const { result } = renderHook(() => useRecentHistory())

        expect(result.current.history?.[0]?.image).toBe('')
    })

    it('handles undefined data', () => {
        (useSWR as jest.Mock).mockReturnValue({
            data: undefined,
            error: null,
            isLoading: true
        })

        const { result } = renderHook(() => useRecentHistory())

        expect(result.current.history).toBeUndefined()
        expect(result.current.isLoading).toBe(true)
    })
})

describe('useInfiniteHistory Hook', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('maps paginated history data correctly', () => {
        const mockSetSize = jest.fn();

        (useSWRInfinite as jest.Mock).mockReturnValue({
            data: [
                {
                    events: [
                        {
                            id: 'e1',
                            track: {
                                spotifyId: 'spotify:t1',
                                name: 'Time',
                                artists: [{ artist: { name: 'Pink Floyd', spotifyId: 'spotify:pf' } }],
                                album: { imageUrl: 'http://img.com/dsotm.jpg' }
                            },
                            playedAt: '2025-12-18T00:00:00Z'
                        }
                    ],
                    total: 100,
                    page: 1,
                    limit: 100
                }
            ],
            error: null,
            isLoading: false,
            isValidating: false,
            size: 1,
            setSize: mockSetSize
        })

        const { result } = renderHook(() => useInfiniteHistory(100))

        expect(result.current.history).toHaveLength(1)
        expect(result.current.history[0]).toEqual({
            id: 'e1',
            spotifyId: 'spotify:t1',
            name: 'Time',
            artist: 'Pink Floyd',
            artistSpotifyId: 'spotify:pf',
            image: 'http://img.com/dsotm.jpg',
            playedAt: '2025-12-18T00:00:00Z'
        })
        expect(result.current.total).toBe(100)
        expect(result.current.hasMore).toBe(true)
    })

    it('handles empty history', () => {
        const mockSetSize = jest.fn();

        (useSWRInfinite as jest.Mock).mockReturnValue({
            data: [{ events: [], total: 0, page: 1, limit: 100 }],
            error: null,
            isLoading: false,
            isValidating: false,
            size: 1,
            setSize: mockSetSize
        })

        const { result } = renderHook(() => useInfiniteHistory())

        expect(result.current.history).toEqual([])
        expect(result.current.hasMore).toBe(false)
    })

    it('flattens multiple pages of data', () => {
        const mockSetSize = jest.fn();

        (useSWRInfinite as jest.Mock).mockReturnValue({
            data: [
                {
                    events: [
                        { id: 'e1', track: { spotifyId: 's1', name: 'Track 1', artists: [], album: {} }, playedAt: '2025-12-18T00:00:00Z' }
                    ],
                    total: 200,
                    page: 1,
                    limit: 100
                },
                {
                    events: [
                        { id: 'e2', track: { spotifyId: 's2', name: 'Track 2', artists: [], album: {} }, playedAt: '2025-12-17T00:00:00Z' }
                    ],
                    total: 200,
                    page: 2,
                    limit: 100
                }
            ],
            error: null,
            isLoading: false,
            isValidating: false,
            size: 2,
            setSize: mockSetSize
        })

        const { result } = renderHook(() => useInfiniteHistory())

        expect(result.current.history).toHaveLength(2)
        expect(result.current.history[0].name).toBe('Track 1')
        expect(result.current.history[1].name).toBe('Track 2')
    })

    it('calls setSize when loadMore is invoked', () => {
        const mockSetSize = jest.fn();

        (useSWRInfinite as jest.Mock).mockReturnValue({
            data: [{ events: [{ id: 'e1', track: { spotifyId: 's1', name: 'Track 1', artists: [], album: {} }, playedAt: '2025-12-18T00:00:00Z' }], total: 200, page: 1, limit: 100 }],
            error: null,
            isLoading: false,
            isValidating: false,
            size: 1,
            setSize: mockSetSize
        })

        const { result } = renderHook(() => useInfiniteHistory())

        act(() => {
            result.current.loadMore()
        })

        expect(mockSetSize).toHaveBeenCalledWith(2)
    })

    it('handles loading state', () => {
        (useSWRInfinite as jest.Mock).mockReturnValue({
            data: undefined,
            error: null,
            isLoading: true,
            isValidating: false,
            size: 1,
            setSize: jest.fn()
        })

        const { result } = renderHook(() => useInfiniteHistory())

        expect(result.current.isLoading).toBe(true)
        expect(result.current.history).toEqual([])
    })

    it('handles error state', () => {
        (useSWRInfinite as jest.Mock).mockReturnValue({
            data: undefined,
            error: new Error('Network error'),
            isLoading: false,
            isValidating: false,
            size: 1,
            setSize: jest.fn()
        })

        const { result } = renderHook(() => useInfiniteHistory())

        expect(result.current.isError).toBeTruthy()
    })

    it('reports hasMore as false when all data loaded', () => {
        const mockSetSize = jest.fn();

        (useSWRInfinite as jest.Mock).mockReturnValue({
            data: [{ events: [{ id: 'e1', track: { spotifyId: 's1', name: 'Track 1', artists: [], album: {} }, playedAt: '2025-12-18T00:00:00Z' }], total: 1, page: 1, limit: 100 }],
            error: null,
            isLoading: false,
            isValidating: false,
            size: 1,
            setSize: mockSetSize
        })

        const { result } = renderHook(() => useInfiniteHistory())

        expect(result.current.hasMore).toBe(false)
    })
})
