import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockEnv = {
    SECURE_API_KEY_PLACES: 'test-api-key',
    GOOGLE_PLACES_API_KEY: 'google-api-key',
    MAPBOX_API_KEY: 'mapbox-api-key',
    RADAR_API_KEY: 'radar-api-key',
    PLACES_KV: {
        get: jest.fn(),
        put: jest.fn()
    }
};

// Mock fetch globally
global.fetch = jest.fn();

describe('Enhanced Places API', () => {
    beforeEach(() => {
        // Clear all mocks before each test
        jest.clearAllMocks();
        global.fetch.mockClear();
    });

    describe('Place Details', () => {
        it('should fetch place details by ID', async () => {
            const placeId = 'test-place-id';
            const mockPlaceDetails = {
                id: placeId,
                name: 'Test Place',
                regularOpeningHours: {
                    periods: [{
                        open: { day: 0, hour: 9, minute: 0 },
                        close: { day: 0, hour: 17, minute: 0 }
                    }]
                }
            };

            // Mock the fetch response
            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockPlaceDetails)
            });

            const request = new Request(
                `https://api.example.com/places?placeId=${placeId}`,
                {
                    headers: { 'X-API-Key': 'test-api-key' }
                }
            );

            const response = await handler.fetch(request, mockEnv);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.results).toBeDefined();
            expect(data.results.id).toBe(placeId);
        });

        it('should return cached place details when available', async () => {
            const placeId = 'cached-place-id';
            const cachedData = {
                id: placeId,
                name: 'Cached Place',
                cache_hit: true
            };

            mockEnv.PLACES_KV.get.mockResolvedValueOnce(JSON.stringify(cachedData));

            const request = new Request(
                `https://api.example.com/places?placeId=${placeId}`,
                {
                    headers: { 'X-API-Key': 'test-api-key' }
                }
            );

            const response = await handler.fetch(request, mockEnv);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.cache_hit).toBe(true);
            expect(data.results.name).toBe('Cached Place');
        });
    });

    describe('Nearby Search', () => {
        it('should search for nearby places', async () => {
            const mockNearbyResults = {
                places: [{
                    id: 'nearby-1',
                    name: 'Nearby Place 1'
                }]
            };

            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockNearbyResults)
            });

            const request = new Request(
                'https://api.example.com/places?lat=27.9506&lng=-82.4572&radius=500',
                {
                    headers: { 'X-API-Key': 'test-api-key' }
                }
            );

            const response = await handler.fetch(request, mockEnv);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.results).toBeDefined();
            expect(Array.isArray(data.results)).toBe(true);
        });
    });

    describe('Geocoding', () => {
        it('should perform forward geocoding', async () => {
            const mockGeocodeResults = {
                features: [{
                    place_name: 'Tampa, Florida',
                    center: [-82.4572, 27.9506]
                }]
            };

            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockGeocodeResults)
            });

            const request = new Request(
                'https://api.example.com/places?geocode=mapbox&name=Tampa',
                {
                    headers: { 'X-API-Key': 'test-api-key' }
                }
            );

            const response = await handler.fetch(request, mockEnv);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.result).toBeDefined();
            expect(data.result[0].place_name).toBe('Tampa, Florida');
        });

        it('should perform reverse geocoding', async () => {
            const mockReverseGeocodeResults = {
                features: [{
                    place_name: 'Tampa, Florida',
                    center: [-82.4572, 27.9506]
                }]
            };

            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockReverseGeocodeResults)
            });

            const request = new Request(
                'https://api.example.com/places?reverseGeocode=mapbox&lat=27.9506&lng=-82.4572',
                {
                    headers: { 'X-API-Key': 'test-api-key' }
                }
            );

            const response = await handler.fetch(request, mockEnv);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.result).toBeDefined();
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid coordinates', async () => {
            const request = new Request(
                'https://api.example.com/places?lat=invalid&lng=-82.4572&radius=500',
                {
                    headers: { 'X-API-Key': 'test-api-key' }
                }
            );

            const response = await handler.fetch(request, mockEnv);
            const data = await response.json();

            expect(response.status).toBe(400);
            expect(data.error).toBe('Invalid Parameters');
        });

        it('should handle unauthorized requests', async () => {
            const request = new Request(
                'https://api.example.com/places?placeId=test-id',
                {
                    headers: { 'X-API-Key': 'invalid-key' }
                }
            );

            const response = await handler.fetch(request, mockEnv);
            const data = await response.json();

            expect(response.status).toBe(403);
            expect(data.error).toBe('Unauthorized');
        });
    });
}); 