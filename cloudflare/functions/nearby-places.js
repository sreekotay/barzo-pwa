/**
 * Cloudflare Worker for Places API Integration
 * 
 * This worker provides a cached interface to various place data providers (primarily Google Places API)
 * with support for nearby search and place details. It includes coordinate grid-based caching to improve
 * cache hit rates and reduce API costs.
 * 
 * Core Features:
 * - Nearby place search with configurable radius and type
 * - Detailed place information lookup
 * - Grid-based coordinate caching
 * - Cache control with version-based invalidation
 * - Request rate limiting and error handling
 * 
 * Supported Providers:
 * - Google Places API (primary)
 * - Radar.io API (alternative)
 * 
 * API Endpoints:
 * 1. Nearby Search:
 *    GET /nearby-places?lat={latitude}&lng={longitude}&radius={meters}&type={place_type}
 *    Optional: &keyword={search terms}
 * 
 * 2. Place Details:
 *    GET /nearby-places?placeId={place_id}
 * 
 * Headers:
 * - X-API-Key: Required. Service authentication key
 * - X-Google-API-Key: Optional. Custom Google Places API key
 * 
 * Cache Control:
 * - no-cache: Set to 'true' to bypass cache
 * - cache-reset: Unix timestamp to ignore older cache entries
 * 
 * Response Headers:
 * - X-Cache-Hit: Indicates if response was served from cache
 * - X-Cache-Type: Type of cache entry (places_nearby or places_details)
 * 
 * Grid Configuration:
 * - Coordinates are rounded based on search radius
 * - Grid size adapts to maintain optimal cache hits
 * - Minimum radius enforced for consistency
 * 
 * Example Usage:
 * ```
 * // Nearby search
 * curl "https://api.example.com/nearby-places?lat=27.9506&lng=-82.4572&radius=500&type=restaurant" \
 *   -H "X-API-Key: your_api_key"
 * 
 * // Place details
 * curl "https://api.example.com/nearby-places?placeId=ChIJN1t_tDeuEmsRUsoyG83frY4" \
 *   -H "X-API-Key: your_api_key"
 * ```
 * 
 */

// Remove provider-related constants
const API_VERSION = 'v1.0.5';  // Increment version for cache invalidation

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Google-API-Key',
  'Access-Control-Max-Age': '86400',  // 24 hours
};

// Grid configuration
const GRID_SIZE_METERS = 100; // Base grid size
const GRID = {
    SIZE_METERS: GRID_SIZE_METERS,
    LAT_PRECISION: 5,               // 5 decimal places ≈ 1.1m precision
    LNG_PRECISION: 5,
    MIN_RADIUS: GRID_SIZE_METERS,   // Minimum 100m radius
    RADIUS_STEP: GRID_SIZE_METERS   // Round radius to nearest 100m
};

// Cache duration settings (in seconds)
const CACHE_DURATION = {
    PRODUCTION: {
        KV: 604800,      // 1 week for KV store
        BROWSER: 604800,  // 1 week for browser cache
        DETAILS: 604800   // 1 week for place details
    },
    DEVELOPMENT: {
        KV: 604800,         // 10 minutes for development
        BROWSER: 604800,    // 10 minutes for development
        DETAILS: 604800     // 10 minutes for development
    }
};

// Google Places API functions
async function nearbySearch(params) {
    const baseParams = new URLSearchParams({
        location: `${params.lat},${params.lng}`,
        radius: params.radius,
        type: params.type,
        key: params.apiKey
    });

    // If no keywords, make a single request
    if (!params.keywords?.length) {
        const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${baseParams}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(`Google Places API error: ${response.status} - ${data.error_message || 'Unknown error'}`);
        }
        
        return data.results;
    }

    // Make separate requests for each keyword
    const allResults = await Promise.all(params.keywords.map(async keyword => {
        const keywordParams = new URLSearchParams(baseParams);
        keywordParams.append('keyword', keyword);
        
        const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${keywordParams}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (!response.ok) {
            console.error(`Error fetching places for keyword ${keyword}:`, data.error_message);
            return [];
        }
        
        return data.results || [];
    }));

    // Merge and deduplicate results by place_id
    const seenPlaceIds = new Set();
    const mergedResults = allResults.flat().filter(place => {
        if (seenPlaceIds.has(place.place_id)) return false;
        seenPlaceIds.add(place.place_id);
        return true;
    });

    return mergedResults;
}

async function placeDetails(placeId, apiKey) {
    const searchParams = new URLSearchParams({
        place_id: placeId,
        key: apiKey,
        fields: [
            'place_id', 'name', 'geometry', 'formatted_address',
            'formatted_phone_number', 'website', 'opening_hours',
            'current_opening_hours', 'price_level', 'types',
            'editorial_summary', 'serves_breakfast', 'serves_lunch',
            'serves_dinner', 'serves_brunch', 'photos'
        ].join(',')
    });

    const url = `https://maps.googleapis.com/maps/api/place/details/json?${searchParams}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
        throw new Error(`Google Places Details API error: ${response.status} - ${data.error_message || 'Unknown error'}`);
    }
    
    return data.result;
}

// Cache key generation functions
function getNearbySearchCacheKey(lat, lng, radius, type, keywords = []) {
    const grid = getCoordinateGridSize(lat, lng, radius);
    const roundedLat = (Math.round(lat / grid.lat) * grid.lat).toFixed(5);
    const roundedLng = (Math.round(lng / grid.lng) * grid.lng).toFixed(5);
    const roundedRadius = Math.ceil(radius / getRadiusGridSize(radius)) * getRadiusGridSize(radius);
    const keywordString = keywords.length > 0 ? `:${keywords.sort().join('+')}` : '';
    return `${API_VERSION}:nearby:${roundedLat},${roundedLng}:${roundedRadius}:${type}${keywordString}`;
}

function getDetailsCacheKey(placeId) {
    return `${API_VERSION}:details:${placeId}`;
}

// Grid functions remain the same
function getCoordinateGridSize(lat, lng, radius) {
    let gridSize;
    if (radius <= 100)        gridSize = 0.0001;
    else if (radius <= 500)   gridSize = 0.0005;
    else if (radius <= 1000)  gridSize = 0.001;
    else                      gridSize = 0.002;
    const lngGridSize = gridSize / Math.cos(lat * Math.PI / 180);
    return {
        lat: gridSize,
        lng: lngGridSize
    };
}

function getRadiusGridSize(radius) {
    return Math.pow(2, Math.floor(Math.log2(radius/50))) * 50;
}

// Cache control helper
const shouldUseCache = async (cacheKey, noCache, cacheReset) => {
    if (noCache) return false;
    if (!cacheReset) return true;

    const resetTime = parseInt(cacheReset);
    if (!isNaN(resetTime)) {
        const metadata = await env.PLACES_KV.getWithMetadata(cacheKey);
        return metadata && metadata.metadata && metadata.metadata.timestamp > resetTime;
    }
    
    return false;
};

// Main request handler
export default {
    async fetch(request, env, ctx) {
        try {
            // Handle CORS preflight
            if (request.method === 'OPTIONS') {
                return new Response(null, {
                    headers: {
                        ...corsHeaders,
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Google-API-Key',
                        'Access-Control-Max-Age': '86400',
                    },
                    status: 200
                });
            }

            // Validate auth
            const authKey = request.headers?.get("X-API-Key") || '';
            if (!authKey || authKey !== env.SECURE_API_KEY_PLACES) {
                return new Response(JSON.stringify({ error: "Unauthorized" }), { 
                    status: 403,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json"
                    }
                });
            }

            const url = new URL(request.url);
            const userGoogleKey = request.headers?.get("X-Google-API-Key");
            
            // Route to appropriate handler
            if (url.searchParams.has("placeId")) {
                return this.handlePlaceDetails(request, env, userGoogleKey);
            } else {
                return this.handleNearbySearch(request, env, userGoogleKey);
            }
        } catch (error) {
            console.error('Error in fetch:', error);
            return new Response(JSON.stringify({
                error: "Internal Server Error",
                message: error.message
            }), { 
                status: 500,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json"
                }
            });
        }
    },

    async handlePlaceDetails(request, env, userGoogleKey) {
        const url = new URL(request.url);
        const placeId = url.searchParams.get("placeId");
        const cacheKey = getDetailsCacheKey(placeId);
        const noCache = url.searchParams.get("no-cache") === 'true';

        // Check cache
        if (!noCache) {
            const cachedData = await env.PLACES_KV.getWithMetadata(cacheKey, { type: "json" });
            if (cachedData?.value) {
                console.log(`Cache HIT with key: ${cacheKey}`);
                return new Response(JSON.stringify(cachedData.value), {
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                        "Cache-Control": `public, max-age=${CACHE_DURATION.PRODUCTION.DETAILS}`,
                        "X-Cache-Hit": "true",
                        "X-Cache-Type": "places_details"
                    }
                });
            }
        }

        console.log(`Cache MISS with key: ${cacheKey}`);

        try {
            const data = await placeDetails(placeId, userGoogleKey || env.GOOGLE_PLACES_API_KEY);

            if (data) {
                await env.PLACES_KV.put(cacheKey, JSON.stringify(data), {
                    expirationTtl: CACHE_DURATION.PRODUCTION.DETAILS,
                    metadata: { timestamp: Date.now() }
                });
            }

            return new Response(JSON.stringify(data), {
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                    "Cache-Control": `public, max-age=${CACHE_DURATION.PRODUCTION.DETAILS}`,
                    "X-Cache-Hit": "false",
                    "X-Cache-Type": "places_details"
                }
            });
        } catch (error) {
            return new Response(JSON.stringify({
                error: "Failed to fetch place details",
                message: error.message
            }), { 
                status: 500,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json"
                }
            });
        }
    },

    async handleNearbySearch(request, env, userGoogleKey) {
        const url = new URL(request.url);
        const lat = parseFloat(url.searchParams.get("lat"));
        const lng = parseFloat(url.searchParams.get("lng"));
        const radius = Math.max(GRID.MIN_RADIUS, parseInt(url.searchParams.get("radius") || "500"));
        const type = url.searchParams.get("type") || "restaurant";
        
        if (isNaN(lat) || isNaN(lng)) {
            return new Response("Invalid latitude or longitude", { 
                status: 400,
                headers: corsHeaders
            });
        }

        const cacheKey = getNearbySearchCacheKey(
            lat, 
            lng, 
            radius, 
            type,
            url.searchParams.getAll("keyword")
        );
        
        const isDevelopment = request.url.includes('localhost') || request.url.includes('127.0.0.1');
        const cacheDuration = isDevelopment ? CACHE_DURATION.DEVELOPMENT : CACHE_DURATION.PRODUCTION;
        const noCache = url.searchParams.get("no-cache") === 'true';

        // Common headers to use for both cache hit and miss
        const responseHeaders = {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${cacheDuration.BROWSER}`,
            "X-Cache-Key": cacheKey
        };

        // Check cache
        if (!noCache) {
            try {
                let cachedData = await env.PLACES_KV.getWithMetadata(cacheKey, { type: "json" });
                if (cachedData?.value) {
                    console.log(`Cache HIT with key: ${cacheKey}`);
                    return new Response(JSON.stringify(cachedData.value), {
                        headers: { 
                            ...responseHeaders,
                            "X-Cache-Hit": "true",
                            "X-Cache-Type": "places_nearby"
                        },
                    });
                }
            } catch (error) {
                // Silent fail on cache errors
            }
        }

        console.log(`Cache MISS with key: ${cacheKey}`);
        try {
            const data = await nearbySearch({
                lat,
                lng,
                radius,
                type,
                apiKey: userGoogleKey || env.GOOGLE_PLACES_API_KEY,
                keywords: url.searchParams.getAll("keyword")
            });

            if (data?.length > 0) {
                await env.PLACES_KV.put(cacheKey, JSON.stringify(data), { 
                    expirationTtl: cacheDuration.KV,
                    metadata: { timestamp: Date.now() }
                });
            }

            return new Response(JSON.stringify(data), {
                headers: {
                    ...responseHeaders,
                    "X-Cache-Hit": "false"
                }
            });
        } catch (error) {
            return new Response(JSON.stringify({
                error: "Failed to fetch nearby places",
                message: error.message
            }), { 
                status: 500,
                headers: responseHeaders
            });
        }
    }
};
