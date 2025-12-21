import axios from "axios";

// API requests now go through Next.js rewrites (/api/* -> backend)
// This ensures same-origin for cookies, fixing mobile browser issues
export const api = axios.create({
    baseURL: "/api",
    withCredentials: true, // Send cookies with requests
    headers: {
        "Content-Type": "application/json",
    },
});

export const fetcher = (url: string) => api.get(url).then((res) => res.data);

