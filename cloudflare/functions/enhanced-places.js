/**
 * Enhanced Places API
 * Combines Radar Places API with Google Places API, with caching
 * 
 * Detail Levels:
 * 1. basic
 *    - Uses Radar for all place details (name, location, categories)
 *    - Only fetches place_id from Google (minimal API usage)
 *    - Returns data in Google Places API format
 *    - Cached for 1 week using radar_id + detail level as key
 * 
 * 2. full
 *    - Uses Radar for base place data
 *    - Fetches full details from Google (place_id, name, address, phone, etc)
 *    - Returns both Radar and Google data
 *    - Cached for 1 week using radar_id + detail level as key
 * 
 * Cache Strategy:
 * - Key format: `place:{radar_id}:{detail_level}`
 * - TTL: 1 week
 * - Separate cache entries for basic/full to optimize response size
 * 
 * TODO: When returning cached Google place details, we need to:
 * 1. Update opening_hours.open_now based on current time and periods
 * 2. Update current_opening_hours.open_now to match
 * 3. Remove opening_hours field entirely if no periods data exists
 * 4. Handle proper timezone based on place location (currently assuming EST)
 */

const API_VERSION = 'v1.2.9';  // Update: Added Radar categories, fallback place_id, and cache types

const CACHE_KEYS = {
    PREFIX: 'place',
    LEVELS: {
        BASIC: 'basic',
        FULL: 'full'
    }
};

const GRID = {
    // Less aggressive grid sizes than nearby-places
    MIN_RADIUS: 100,  // Minimum 100m radius
    getCoordinatePrecision(radius) {
        // Returns decimal places to round to based on radius
        if (radius <= 100) return 4;        // ~11m precision
        if (radius <= 500) return 3;        // ~111m precision
        if (radius <= 2000) return 2;       // ~1.1km precision
        return 1;                           // ~11km precision
    },
    roundRadius(radius) {
        // Round to nearest power of 2, but only above 500m
        if (radius <= 500) return radius;
        return Math.pow(2, Math.ceil(Math.log2(radius)));
    }
};

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Radar-Key, X-Google-API-Key',
    'Access-Control-Max-Age': '86400',
};

// Type to Radar categories (using only leaf categories from Radar's list)
const TYPE_TO_RADAR_CATEGORIES = {
    // Food & Beverage
    'restaurant': ['restaurant'],
    'cafe': ['cafe'],
    'bar': ['bar', 'brewery'],
    'night_club': ['night-club'],
    'bakery': ['bakery'],
    'grocery_or_supermarket': ['supermarket'],
    'convenience_store': ['convenience-store'],
    'liquor_store': ['liquor-store'],
    
    // Shopping & Retail
    'clothing_store': ['clothing-store'],
    'shoe_store': ['shoe-store'],
    'jewelry_store': ['jewelry-store'],
    'shopping_mall': ['shopping-mall'],
    'department_store': ['department-store'],
    'electronics_store': ['electronics-store'],
    'furniture_store': ['furniture-store'],
    // Entertainment & Recreation
    'movie_theater': ['movie-theatre'],
    'casino': ['casino'],
    'bowling_alley': ['bowling-alley'],
    'gym': ['gym'],
    
    // Services
    'beauty_salon': ['beauty-salon', 'hair-salon'],
    'hair_care': ['hair-salon'],
    'spa': ['spa']
};

// Keyword to Radar categories (using only leaf categories)
const KEYWORD_TO_RADAR_CATEGORIES = {
    'pizza': ['pizza-place'],
    'sushi': ['sushi-restaurant'],
    'coffee': ['cafe', 'coffee-shop'],
    'ice cream': ['ice-cream-parlor'],
    'brewery': ['brewery'],
    'wine': ['wine-bar', 'winery'],
    'sports': ['sports-bar'],
    'thai': ['thai-restaurant'],
    'chinese': ['chinese-restaurant'],
    'mexican': ['mexican-restaurant']
};

// At the top with other constants
const PLACE_DETAIL_FIELDS = [
    'place_id',
    'name', 
    'geometry',
    'formatted_address',
    'formatted_phone_number',
    'website',
    'opening_hours',
    'current_opening_hours',
    'price_level',
    'types',
    'rating',
    'user_ratings_total',
    'editorial_summary',
    'serves_breakfast',
    'serves_lunch',
    'serves_dinner',
    'serves_brunch',
    'photos',
    'utc_offset'  // Add UTC offset for proper timezone handling
].sort(); // Sort for consistent ordering

// Simple hash function
const FIELDS_HASH = PLACE_DETAIL_FIELDS.join(',').split('').reduce((hash, char) => {
    return ((hash << 5) - hash) + char.charCodeAt(0) | 0;
}, 0).toString(36);

// Add at top with other constants
const CACHE_TTL = {
    BASIC: 60 * 60 * 24 * 14,  // 2 weeks for basic mapping
    FULL: 60 * 60 * 24 * 7,    // 1 week for full details
    RADAR: 60 * 60 * 24 * 7,    // 1 week for radar results
    NEARBY: 60 * 60 * 24 * 7     // 1 week for nearby search results
};

function getRadarCacheKey(params, derivedCategories) {
    const precision = GRID.getCoordinatePrecision(params.radius);
    const roundedLat = Number(params.lat).toFixed(precision);
    const roundedLng = Number(params.lng).toFixed(precision);
    const roundedRadius = GRID.roundRadius(params.radius);
    const limit = params.limit || 20;

    // Use derived categories instead of input params
    const categoriesStr = `:cats=${derivedCategories.sort().join('+')}`;
    const limitStr = `:limit=${limit}`;

    return `${API_VERSION}:radar:${roundedLat},${roundedLng}:${roundedRadius}${categoriesStr}${limitStr}`;
}

async function searchRadarPlaces(params, radarKey, env) {
    // Determine categories first
    let categories;
    let unmapped = {
        keywords: [],
        types: []
    };

    if (params.keywords?.length > 0) {
        const keywordCategories = params.keywords.flatMap(keyword => 
            KEYWORD_TO_RADAR_CATEGORIES[keyword] || []
        );
        categories = keywordCategories.length > 0 ? 
            [...new Set(keywordCategories)] : ['food-beverage'];

        // Track unmapped keywords
        unmapped.keywords = params.keywords.filter(k => !KEYWORD_TO_RADAR_CATEGORIES[k]);
    } else {
        const typeCategories = params.type ? 
            TYPE_TO_RADAR_CATEGORIES[params.type] || [] : [];
        categories = typeCategories.length > 0 ? 
            typeCategories : ['food-beverage'];

        // Track unmapped type
        if (params.type && !TYPE_TO_RADAR_CATEGORIES[params.type]) {
            unmapped.types.push(params.type);
        }
    }

    const cacheKey = getRadarCacheKey(params, categories);
    
    try {
        const cached = await env.PLACES_KV.get(cacheKey);
        if (cached) {
            const results = JSON.parse(cached);
            return {
                places: results.radar,  // Raw radar places
                categories: results.categories,
                unmapped: results.unmapped
            };
        }
    } catch (error) {
        console.error('Cache read error:', error);
    }

    // If not in cache, do the search
    const searchParams = new URLSearchParams({
        near: `${params.lat},${params.lng}`,
        radius: params.radius,
        limit: params.limit || 20,
        categories: categories.join(',')
    });

    console.log('Radar cache miss, fetching with params:', {
        cacheKey,
        categories,
        from: {
            type: params.type,
            keywords: params.keywords
        }
    });

    const response = await fetch(`https://api.radar.io/v1/search/places?${searchParams}`, {
        headers: {
            'Authorization': `${radarKey}`
        }
    });

    if (!response.ok) {
        const data = await response.json();
        throw new Error(`Radar API error: ${response.status} - ${JSON.stringify(data)}`);
    }

    const data = await response.json();
    const places = data.places || [];

    // Cache the raw Radar results
    try {
        const cacheData = {
            radar: places,  // Store raw radar places
            categories,
            unmapped,
            metadata: {
                lat: params.lat,
                lng: params.lng,
                radius: params.radius,
                timestamp: new Date().toISOString()
            }
        };
        
        await env.PLACES_KV.put(cacheKey, JSON.stringify(cacheData), {
            expirationTtl: CACHE_TTL.RADAR
        });
        console.log('Cached raw Radar results for:', cacheKey);

        // Still cache basic details for each place
        await Promise.all(places.map(async place => {
            const basicCacheKey = `${API_VERSION}:${CACHE_KEYS.PREFIX}:${place._id}:${CACHE_KEYS.LEVELS.BASIC}`;
            const basicDetails = await getUncachedGooglePlace(place, detailLevel, env.GOOGLE_PLACES_API_KEY);
            await env.PLACES_KV.put(basicCacheKey, JSON.stringify(basicDetails), {
                expirationTtl: CACHE_TTL.BASIC
            });
        }));
    } catch (error) {
        console.error('Cache write error:', error);
    }

    return {
        places,          // Return raw places for processing
        categories,
        unmapped
    };
}

// Update findGooglePlace to add detailed logging
async function findGooglePlace(radarPlace, detailLevel, googleKey) {
    console.log("findGooglePlace called for:", {
        placeName: radarPlace.name,
        detailLevel,
        coordinates: radarPlace.location.coordinates,
        requestedFields: detailLevel === CACHE_KEYS.LEVELS.BASIC ? 
            'place_id' : 
            PLACE_DETAIL_FIELDS.join(',')
    });

    const fields = detailLevel === CACHE_KEYS.LEVELS.BASIC ? 
        'place_id' : 
        PLACE_DETAIL_FIELDS.join(',');

    const [lng, lat] = radarPlace.location.coordinates;
    
    // First try to find the place
    const findParams = new URLSearchParams({
        input: `${radarPlace.name} ${radarPlace.formattedAddress || ''}`.trim(),
        inputtype: 'textquery',
        locationbias: `point:${lat},${lng}`,
        key: googleKey,
        fields: 'place_id'  // Only get place_id in find request
    });

    try {
        const findUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?${findParams}`;
        console.log('Google Places Find API request:', findUrl.replace(googleKey, 'REDACTED'));

        const findResponse = await fetch(findUrl);
        const findData = await findResponse.json();

        console.log('Google Places Find API response:', {
            status: findData.status,
            candidates: findData.candidates?.length || 0,
            error_message: findData.error_message
        });

        if (findData.status !== 'OK' || !findData.candidates?.[0]?.place_id) {
            console.log(`No Google Place match found for: ${radarPlace.name}`);
            return null;
        }

        // If we only need basic details, return just the place_id
        if (detailLevel === CACHE_KEYS.LEVELS.BASIC) {
            return { place_id: findData.candidates[0].place_id };
        }

        // For full details, make a details request
        const detailsParams = new URLSearchParams({
            place_id: findData.candidates[0].place_id,
            fields: fields,
            key: googleKey
        });

        const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?${detailsParams}`;
        console.log('Google Places Details API request:', detailsUrl.replace(googleKey, 'REDACTED'));

        const detailsResponse = await fetch(detailsUrl);
        const detailsData = await detailsResponse.json();

        console.log('Google Places Details API response:', {
            status: detailsData.status,
            error_message: detailsData.error_message
        });

        if (detailsData.status === 'OK' && detailsData.result) {
            // Add detailed logging for details response
            if (detailLevel === CACHE_KEYS.LEVELS.FULL && detailsData?.result) {
                console.log('Details response fields received:', {
                    place: radarPlace.name,
                    fields: Object.keys(detailsData.result),
                    sample: {
                        name: detailsData.result.name,
                        address: detailsData.result.formatted_address,
                        phone: detailsData.result.formatted_phone_number,
                        rating: detailsData.result.rating
                    }
                });
            }
            return detailsData.result;
        }

        throw new Error(`Details request failed: ${detailsData.status} - ${detailsData.error_message || 'Unknown error'}`);

    } catch (error) {
        console.error('Error in findGooglePlace:', error);
        throw error;
    }
}

// Add helper function to convert Radar place to Google-like format
function radarToGoogleFormat(radarPlace) {
    return {
        place_id: null, // Will be filled in if matched
        name: radarPlace.name,
        geometry: {
            location: {
                lat: radarPlace.location.coordinates[1],
                lng: radarPlace.location.coordinates[0]
            }
        },
        radar_id: radarPlace._id,
        types: radarPlace.categories
    };
}

// Add this helper function at the top
function safeJSONStringify(obj) {
    try {
        return JSON.stringify(obj);
    } catch (error) {
        console.error('JSON stringify error:', error);
        return JSON.stringify({
            error: 'Data serialization error',
            message: error.message
        });
    }
}

function formatResults(places, detailLevel) {
    if (detailLevel === CACHE_KEYS.LEVELS.BASIC) {
        return {
            radar: places.map(place => ({
                id: place.radar._id,
                name: place.radar.name,
                geometry: {
                    location: {
                        lat: place.radar.location.coordinates[1],
                        lng: place.radar.location.coordinates[0]
                    }
                },
                categories: place.radar.categories,
                error: place.error,
                cache_hit: place.cache_hit
            })),
            google: places.map(place => ({
                placeId_google: place.google?.place_id,
                radar_id: place.radar._id,
                name: place.radar.name,
                geometry: {
                    location: {
                        lat: place.radar.location.coordinates[1],
                        lng: place.radar.location.coordinates[0]
                    }
                },
                types: place.radar.categories,
                error: place.error,
                cache_hit: place.cache_hit
            }))
        };
    }

    // Full detail format
    const radarFormatted = places.map(place => ({
        id: place.radar._id,
        name: place.radar.name,
        location: {
            lat: place.radar.location.latitude,
            lng: place.radar.location.longitude
        },
        address: place.radar.formattedAddress,
        categories: place.radar.categories,
        chain: place.radar.chain,
        metadata: place.radar.metadata || {},
        cache_hit: place.cache_hit
    }));

    const googleFormatted = places
        .filter(place => place.google && place.matched)
        .map(place => ({
            placeId_google: place.google.placeId_google,
            radar_id: place.radar._id,
            ...place.google.details,
            cache_hit: place.cache_hit
        }));

    return {
        radar: radarFormatted,
        google: googleFormatted
    };
}

function updateOpenNowStatus(place) {
    if (!place?.opening_hours?.periods) {
        delete place.opening_hours;
        delete place.current_opening_hours;
        return place;
    }

    // Use place's UTC offset instead of hardcoding EST
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const localTime = new Date(utc + (place.utc_offset * 60000));

    const dayOfWeek = localTime.getDay();
    const currentTime = localTime.getHours().toString().padStart(2, '0') + 
                       localTime.getMinutes().toString().padStart(2, '0');

    // Check if it's open 24/7
    if (place.opening_hours.periods.length === 1 && 
        place.opening_hours.periods[0].open.time === "0000" && 
        !place.opening_hours.periods[0].close) {
        place.opening_hours.open_now = true;
        if (place.current_opening_hours) {
            place.current_opening_hours.open_now = true;
        }
        return place;
    }

    let isOpen = false;
    for (const period of place.opening_hours.periods) {
        const openDay = period.open.day;
        const openTime = period.open.time;
        const closeDay = period.close?.day;
        const closeTime = period.close?.time;

        if (!closeDay || !closeTime) continue;

        if (openDay === dayOfWeek && currentTime >= openTime) {
            if (closeDay === dayOfWeek) {
                isOpen = currentTime < closeTime;
            } else {
                isOpen = true; // Still open if closing is tomorrow
            }
        } else if (closeDay === dayOfWeek && currentTime < closeTime) {
            if (openDay === (dayOfWeek + 6) % 7) {
                isOpen = true; // Opened yesterday, still open
            }
        }

        if (isOpen) break;
    }

    place.opening_hours.open_now = isOpen;
    if (place.current_opening_hours) {
        place.current_opening_hours.open_now = isOpen;
    }

    return place;
}

// Update getCachedGooglePlace to use Google place_id for caching
async function getCachedGooglePlace(radarPlace, detailLevel, googleKey, env, noCache = false) {
    console.log(`getCachedGooglePlace for ${radarPlace.name}:`, {
        detailLevel,
        noCache
    });
    
    // First get the Google place_id
    const googlePlace = await findGooglePlace(radarPlace, detailLevel, googleKey);
    if (!googlePlace?.place_id) {
        return {
            radar: radarPlace,
            google: null,
            matched: false,
            cache_hit: false
        };
    }

    // Now use the Google place_id for caching
    if (detailLevel === CACHE_KEYS.LEVELS.BASIC) {
        return {
            radar: radarPlace,
            google: {
                place_id: googlePlace.place_id
            },
            matched: true,
            cache_hit: false
        };
    }

    // For full details, use getPlaceDetailsFromGoogleId which handles its own caching
    const details = await getPlaceDetailsFromGoogleId(googlePlace.place_id, googleKey, env, detailLevel);
    
    return {
        radar: radarPlace,
        google: {
            place_id: googlePlace.place_id,
            details: details
        },
        matched: true,
        cache_hit: details.cache_hit
    };
}

// Update getUncachedGooglePlace to properly handle full details
async function getUncachedGooglePlace(radarPlace, detailLevel, googleKey) {
    try {
        const googlePlace = await findGooglePlace(radarPlace, detailLevel, googleKey);
        
        if (googlePlace) {
            // For basic level, only store place_id
            if (detailLevel === CACHE_KEYS.LEVELS.BASIC) {
                return {
                    radar: radarPlace,
                    google: {
                        place_id: googlePlace.place_id
                    },
                    matched: true,
                    cache_hit: false
                };
            } else {
                // For full level, store complete details and update open_now status
                const details = updateOpenNowStatus(googlePlace);
                return {
                    radar: radarPlace,
                    google: {
                        place_id: googlePlace.place_id,
                        details: details
                    },
                    matched: true,
                    cache_hit: false
                };
            }
        } else {
            // No Google match found
            return {
                radar: radarPlace,
                google: null,
                matched: false,
                cache_hit: false
            };
        }
    } catch (error) {
        console.error(`Error processing place ${radarPlace.name}:`, error);
        return {
            radar: radarPlace,
            google: null,
            error: error.message,
            matched: false,
            cache_hit: false
        };
    }
}

// Add this function to get full details from a Google Place ID
async function getPlaceDetailsFromGoogleId(placeId, googleKey, env, detailLevel = 'full') {
    const cacheKey = `${API_VERSION}:${CACHE_KEYS.PREFIX}:${placeId}:${detailLevel}`;
    
    // Try cache first
    try {
        const cached = await env.PLACES_KV.get(cacheKey);
        if (cached) {
            const result = JSON.parse(cached);
            result.cache_hit = true;
            if (detailLevel === CACHE_KEYS.LEVELS.FULL) {
                return updateOpenNowStatus(result);
            }
            return result;
        }
    } catch (error) {
        console.error('Cache read error:', error);
    }

    // If not in cache or basic details requested, fetch from Google
    const fields = detailLevel === CACHE_KEYS.LEVELS.BASIC ? 
        'place_id' : 
        PLACE_DETAIL_FIELDS.join(',');

    const searchParams = new URLSearchParams({
        place_id: placeId,
        fields,
        key: googleKey
    });

    console.log('Fetching place details:', { placeId, detailLevel, fields });

    const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?${searchParams}`
    );

    if (!response.ok) {
        throw new Error(`Google Places API error: ${response.status}`);
    }

    const data = await response.json();
    if (data.status !== 'OK') {
        throw new Error(`Google Places API error: ${data.status} - ${data.error_message || 'Unknown error'}`);
    }

    const result = detailLevel === CACHE_KEYS.LEVELS.BASIC ? 
        { place_id: data.result.place_id } : 
        updateOpenNowStatus(data.result);

    // Cache the result
    try {
        await env.PLACES_KV.put(cacheKey, JSON.stringify(result), {
            expirationTtl: detailLevel === CACHE_KEYS.LEVELS.BASIC ? CACHE_TTL.BASIC : CACHE_TTL.FULL
        });
    } catch (error) {
        console.error('Cache write error:', error);
    }

    return {
        ...result,
        cache_hit: false,
        cache_type: 'google_fresh'
    };
}

// Instead, move the response formatting into the fetch handler where we have access to the variables
export default {
    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            // Basic auth check
            const authKey = request.headers.get('X-API-Key');
            if (false) //debugging
            if (!authKey || authKey !== env.SECURE_API_KEY_PLACES) {
                return new Response(JSON.stringify({
                    error: 'Unauthorized',
                    message: 'Missing or invalid API Key',
                    status: 403
                }), {
                    status: 403,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            const url = new URL(request.url);
            const placeId = url.searchParams.get('placeId');
            const noCache = url.searchParams.get('noCache') === 'true'; //debugging

            if (placeId) {
                // Handle place details request
                const detailLevel = url.searchParams.get('detailLevel') || 'full';
                const details = await getPlaceDetailsFromGoogleId(placeId, env.GOOGLE_PLACES_API_KEY, env, detailLevel);
                return new Response(JSON.stringify({
                    status: 'success',
                    cache_hit: details.cache_hit,
                    result: details
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            const lat = parseFloat(url.searchParams.get('lat'));
            const lng = parseFloat(url.searchParams.get('lng'));
            const radius = parseFloat(url.searchParams.get('radius') || '500');
            const detailLevel = url.searchParams.get('detailLevel') || 'full';
            const type = url.searchParams.get('type');
            const keywords = url.searchParams.getAll('keyword');
            const limit = parseInt(url.searchParams.get('limit') || '10');

            console.log('Search params:', {
                lat,
                lng,
                radius,
                detailLevel,
                type,
                keywords,
                limit
            });

            if (isNaN(lat) || isNaN(lng) || isNaN(radius)) {
                return new Response(JSON.stringify({
                    error: 'Invalid Parameters',
                    message: 'latitude, longitude, and radius must be valid numbers',
                    status: 400,
                    params: { lat, lng, radius }
                }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // Get Radar places with error handling
            const searchResult = await searchRadarPlaces(
                { lat, lng, radius, type, keywords, limit }, 
                env.RADAR_API_KEY,
                env
            );

            // Ensure we have valid places array
            const radarPlaces = searchResult?.places || [];
            const categories = searchResult?.categories || [];
            const unmapped = searchResult?.unmapped || { keywords: [], types: [] };

            // Only process if we have places
            if (radarPlaces.length > 0) {
                // Replace the single result test with batch processing
                const results = await Promise.all(radarPlaces.map(radarPlace => {
                    console.log(`Processing place ${radarPlace.name} with detailLevel: ${detailLevel}`);
                    return getCachedGooglePlace(radarPlace, detailLevel, env.GOOGLE_PLACES_API_KEY, env, noCache);
                }));

                const responseBody = {
                    metadata: {
                        lat: lat,
                        lng: lng,
                        radius: radius,
                        categories: categories,
                        total_results: results.length,
                        cache_hits: results.filter(r => r.cache_hit).length,
                        timestamp: new Date().toISOString()
                    },
                    radar: [],
                    google: results.map(r => {
                        // Create composite ID that includes both Google and Radar IDs when available
                        return {
                            name: r.radar.name,
                            geometry: {
                                location: {
                                    lat: r.radar.location.coordinates[1],
                                    lng: r.radar.location.coordinates[0]
                                }
                            },
                            types: r.radar.categories,
                            place_id: r.google?.place_id,
                            radar_id: r.radar._id,  // Always include the Radar ID separately
                            ...(r.google?.details || {}),
                            cache_hit: r.cache_hit,
                            cache_type: r.google ? (r.cache_hit ? 'google' : 'google_fresh') : 'radar_only'
                        };
                    }).filter(Boolean)
                };

                try {
                    const responseString = safeJSONStringify(responseBody);
                    return new Response(responseString, {
                        status: 200,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                } catch (error) {
                    console.error('Response creation error:', error);
                    return new Response(JSON.stringify({
                        status: 'error',
                        error: 'Response Creation Error',
                        message: error.message
                    }), {
                        status: 500,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
            } else {
                // Return empty results if no places found
                return new Response(JSON.stringify({
                    metadata: {
                        lat: lat,
                        lng: lng,
                        radius: radius,
                        categories: categories,
                        total_results: 0,
                        cache_hits: 0,
                        timestamp: new Date().toISOString()
                    },
                    radar: [],
                    google: []
                }), {
                    status: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

        } catch (error) {
            console.error('Error details:', error);
            return new Response(JSON.stringify({
                status: 'error',
                error: 'Internal Server Error',
                message: error.message || 'Unknown error',
                details: error.toString(),
                timestamp: new Date().toISOString()
            }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }
};
