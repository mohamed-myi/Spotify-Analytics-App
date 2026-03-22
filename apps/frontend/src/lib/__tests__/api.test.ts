import { api, fetcher } from '../api'
import axios from 'axios'

// Mock axios
jest.mock('axios', () => ({
    create: jest.fn(() => ({
        get: jest.fn(),
        post: jest.fn(),
        interceptors: {
            response: {
                use: jest.fn()
            }
        }
    }))
}))

describe('api client', () => {
    it('creates axios instance with correct config', () => {
        expect(axios.create).toHaveBeenCalledWith(
            expect.objectContaining({
                withCredentials: true,
                headers: expect.objectContaining({
                    'Content-Type': 'application/json'
                })
            })
        )
    })

    it('registers a response interceptor', () => {
        const axiosInstance = (axios.create as jest.Mock).mock.results[0]?.value
        expect(axiosInstance.interceptors.response.use).toHaveBeenCalledWith(
            expect.any(Function),
            expect.any(Function)
        )
    })
})

describe('fetcher', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('returns response data on success', async () => {
        const mockData = { id: '1', name: 'Test' }
            ; (api.get as jest.Mock).mockResolvedValue({ data: mockData })

        const result = await fetcher('/test-url')

        expect(api.get).toHaveBeenCalledWith('/test-url')
        expect(result).toEqual(mockData)
    })

    it('throws on error response', async () => {
        const mockError = new Error('Network Error')
            ; (api.get as jest.Mock).mockRejectedValue(mockError)

        await expect(fetcher('/test-url')).rejects.toThrow('Network Error')
    })
})
