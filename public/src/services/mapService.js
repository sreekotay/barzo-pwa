/**
 * MapService
 * 
 * A service that manages a Mapbox map instance and optionally an autocomplete search.
 * Integrates with LocationService for user location tracking.
 * 
 * Usage:
 * ```js
 * import MapService from './mapService';
 * import locationService from './locationService';
 * 
 * const mapService = new MapService(locationService, {
 *     mapContainer: 'map',
 *     accessToken: 'your-mapbox-token',
 *     searchInput: 'search-input', // optional
 *     searchInputLevel: 'neighborhood',  // e.g. 'neighborhood', 'postcode', 'place'
 *     initialZoom: 13
 * });
 * 
 * await mapService.initialize();
 * ```
 */

class MapService {
    /**
     * @param {import('./locationService').default} locationService
     * @param {Object} options
     * @param {string} options.mapContainer - ID of the map container element
     * @param {string} options.accessToken - Mapbox access token
     * @param {string} [options.googleApiKey] - Google Places API key
     * @param {string} [options.searchInput] - ID of search input element (optional)
     * @param {string} [options.searchInputLevel] - Level for search input (e.g. 'neighborhood', 'postcode', 'place')
     * @param {number} [options.initialZoom=13] - Initial map zoom level
     * @param {number|boolean} [options.nearbyPlaces=false] - Number of nearby places to fetch, or false to disable
     * @param {string} [options.placesEndpoint='supabase'] - Which endpoint to use for places API ('supabase' or 'cloudflare')
     */
    constructor(locationService, { 
        mapContainer, 
        accessToken, 
        googleApiKey, 
        searchInput, 
        searchInputLevel, 
        initialZoom = 13, 
        nearbyPlaces = false,
        placesEndpoint = 'supabase'
    }) {
        this._locationService = locationService;
        this._mapContainer = mapContainer;
        this._accessToken = accessToken;
        this._googleApiKey = googleApiKey;
        this._searchInput = searchInput;
        this._searchInputLevel = searchInputLevel;
        this._initialZoom = initialZoom;
        this._nearbyPlaces = nearbyPlaces;
        this._placesEndpoint = placesEndpoint;

        /** @type {mapboxgl.Map} */
        this._map = null;
        /** @type {mapboxgl.Marker} */
        this._userMarker = null;
        /** @type {mapboxgl.Marker} */
        this._mapMarker = null;
        /** @type {Function|null} */
        this._locationUnsubscribe = null;
        /** @type {Function|null} */
        this._mapLocationUnsubscribe = null;

        /** @type {Object|null} */
        this._currentPlace = null;  // Store the full place data

        // Default center (Times Square, NYC)
        this._defaultCenter = {
            lng: -73.9855,
            lat: 40.7580
        };

        /** @type {Promise|null} */
        this._googlePlacesLoading = null;  // Track loading state of Google Places API

        /** @type {mapboxgl.Marker[]} */
        this._placeMarkers = [];  // Array to store place markers
    }

    /**
     * Initialize the map and optional search
     */
    async initialize() {
        // Load Mapbox GL JS
        await this._loadMapboxGL();
        
        // Get cached location
        const cachedLocation = this._locationService.getUserLocationCached();
        const initialCenter = cachedLocation || this._defaultCenter;
        
        // Initialize map
        mapboxgl.accessToken = this._accessToken;
        this._map = new mapboxgl.Map({
            container: this._mapContainer,
            style: 'mapbox://styles/mapbox/streets-v12',
            zoom: this._initialZoom,
            center: [initialCenter.lng, initialCenter.lat],
            attributionControl: false,  // Remove attribution
            logoPosition: 'bottom-right',  // Position logo (will hide with CSS)
            scrollZoom: {
                around: 'center'
              }
        });
        document.getElementById(this._mapContainer).classList.add('map-loaded');


        // Add controls
        this._map.addControl(new mapboxgl.NavigationControl());

        // Add custom center control
        const centerControl = new mapboxgl.NavigationControl({
            showCompass: false,
            showZoom: false,
            visualizePitch: false
        });

        // Add custom center button
        const centerButton = document.createElement('button');
        centerButton.className = 'mapboxgl-ctrl-icon mapboxgl-ctrl-geolocate';
        centerButton.setAttribute('aria-label', 'Center map on your location');
        centerButton.addEventListener('click', () => {
            this._locationService.resetMapLocation();
            const location = this._locationService.getMapLocation();
            if (location) {
                this._map.flyTo({
                    center: [location.lng, location.lat],
                    zoom: this._initialZoom
                });
            }
        });

        // Add the button to a control container
        const container = document.createElement('div');
        container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
        container.appendChild(centerButton);
        this._map.addControl({
            onAdd: () => container,
            onRemove: () => container.remove()
        });

        // Initialize user marker (green dot)
        const userMarkerElement = document.createElement('div');
        userMarkerElement.className = 'user-location-marker';
        userMarkerElement.style.width = '12px';
        userMarkerElement.style.height = '12px';
        userMarkerElement.style.borderRadius = '50%';
        userMarkerElement.style.backgroundColor = '#4CAF50';
        userMarkerElement.style.border = '2px solid white';
        userMarkerElement.style.boxShadow = '0 0 2px rgba(0,0,0,0.3)';

        this._userMarker = new mapboxgl.Marker({
            element: userMarkerElement
        });

        // Initialize map marker (red pin)
        this._mapMarker = new mapboxgl.Marker({
            color: '#FF0000'
        });

        // Subscribe to user location changes to handle initial location
        this._locationUnsubscribe = this._locationService.onUserLocationChange((location) => {
            // Only fly to location if:
            // 1. We started with default location (no cached location)
            // 2. We're not in manual map mode
            if (!cachedLocation && !this._isManualMap && location) {
                this._map.flyTo({
                    center: [location.lng, location.lat],
                    zoom: this._initialZoom
                });
            }
        });

        // Subscribe to map location updates for marker
        this._mapLocationUnsubscribe = this._locationService.onMapLocationChange(
            (location) => {
                this._updateMapMarker(location);
            },
            { 
                realtime: true,    // Use realtime updates for marker
                debounceMs: 0      // No debouncing for marker
            }
        );

        // Subscribe to map location updates for reverse geocoding
        this._locationService.onMapLocationChange(
            async (location) => {
                await this._reverseGeocode(location);
                // Update search input if it exists
                if (this._searchInput && this._currentPlace) {
                    const searchInput = document.querySelector('.mapboxgl-ctrl-geocoder input');
                    if (searchInput) {
                        searchInput.value = this._getSearchDisplayText(this._currentPlace);
                    }
                }
            },
            {
                realtime: false,    // Don't need realtime for geocoding
                debounceMs: 1000    // Debounce to avoid too many API calls
            }
        );

        // Subscribe to map location updates for nearby places
        if (this._nearbyPlaces) {
            this._locationService.onMapLocationChange(
                async (location) => {
                    await this._handleNearbyPlaces(location);
                },
                {
                    realtime: false,
                    debounceMs: 1000 // Debounce to avoid too many API calls
                }
            );
        }

        // Set initial locations
        if (cachedLocation) {
            // Update both user and map markers with cached location
            this._updateUserMarker(cachedLocation);
            this._updateMapMarker(cachedLocation);
            // Set initial map location in service
            this._locationService.setMapLocation(cachedLocation);
        }

        // Remove the moveend listener since we're using callbacks
        this._map.on('move', () => {
            const center = this._map.getCenter();
            const location = {
                lng: center.lng,
                lat: center.lat
            };
            this._locationService.setMapLocation(location);
        });

        // Initialize search if requested
        if (this._searchInput) {
            await this._initializeSearch();
        }
    }

    /**
     * Load Mapbox GL JS and Geocoder scripts
     * @private
     */
    async _loadMapboxGL() {
        if (window.mapboxgl) return;

        // Load Mapbox GL JS
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);

            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css';
            document.head.appendChild(link);
        });

        // Load Geocoder if search is enabled
        if (this._searchInput) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-geocoder/v5.0.0/mapbox-gl-geocoder.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);

                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = 'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-geocoder/v5.0.0/mapbox-gl-geocoder.css';
                document.head.appendChild(link);
            });
        }
    }

    /**
     * Initialize the search functionality
     * @private
     */
    async _initializeSearch() {
        if (this._googleApiKey) {
            await this._initializeGoogleSearch();
        } else {
            await this._initializeMapboxSearch();
        }
    }

    /**
     * Initialize Google Places search
     * @private
     */
    async _initializeGoogleSearch() {
        await this._loadGooglePlaces();
        
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search places...';
        searchInput.className = 'google-places-input';
        
        const searchContainer = document.getElementById(this._searchInput);
        searchContainer.appendChild(searchInput);

        const autocomplete = new google.maps.places.Autocomplete(searchInput, {
            types: ['establishment', 'geocode'],
            componentRestrictions: { country: 'us' },
            fields: ['geometry', 'name', 'formatted_address', 'address_components']
        });

        autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (!place.geometry) return;

            const location = {
                lng: place.geometry.location.lng(),
                lat: place.geometry.location.lat()
            };

            // Update map marker and view
            this._mapMarker.setLngLat([location.lng, location.lat]).addTo(this._map);
            this._map.flyTo({
                center: [location.lng, location.lat],
                zoom: this._initialZoom
            });

            // Store place data in similar format to Mapbox
            this._currentPlace = this._convertGooglePlace(place);

            // Update LocationService
            this._locationService.setMapLocation(location);
        });

        // Clear button functionality
        searchInput.addEventListener('input', (e) => {
            if (!e.target.value) {
                this._mapMarker.remove();
                this._locationService.resetMapLocation();
            }
        });
    }

    /**
     * Convert Google Place to Mapbox-like format
     * @private
     */
    _convertGooglePlace(googlePlace) {
        const getAddressComponent = (type) => {
            const component = googlePlace.address_components?.find(
                comp => comp.types.includes(type)
            );
            return component?.long_name;
        };

        return {
            id: `google.${googlePlace.place_id}`,
            type: 'Feature',
            place_type: ['poi'],
            text: googlePlace.name,
            place_name: googlePlace.formatted_address,
            center: [
                googlePlace.geometry.location.lng(),
                googlePlace.geometry.location.lat()
            ],
            context: [
                { id: 'neighborhood', text: getAddressComponent('neighborhood') },
                { id: 'postcode', text: getAddressComponent('postal_code') },
                { id: 'place', text: getAddressComponent('locality') },
                { id: 'region', text: getAddressComponent('administrative_area_level_1') },
                { id: 'country', text: getAddressComponent('country') }
            ].filter(item => item.text) // Remove undefined components
        };
    }

    /**
     * Load Google Places API if not already loaded
     * @private
     */
    async _loadGooglePlaces() {
        // Return existing promise if already loading
        if (this._googlePlacesLoading) {
            return this._googlePlacesLoading;
        }

        // Return immediately if already loaded
        if (window.google?.maps?.places) {
            return Promise.resolve();
        }

        // Create new loading promise
        this._googlePlacesLoading = new Promise((resolve, reject) => {
            // Check if script is already in the process of loading
            const existingScript = document.querySelector(
                `script[src^="https://maps.googleapis.com/maps/api/js?key=${this._googleApiKey}"]`
            );

            if (existingScript) {
                // If script exists but not loaded, wait for it
                existingScript.addEventListener('load', resolve);
                existingScript.addEventListener('error', reject);
                return;
            }

            // Create and load new script
            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=${this._googleApiKey}&libraries=places`;
            script.async = true;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });

        try {
            await this._googlePlacesLoading;
            return Promise.resolve();
        } catch (error) {
            this._googlePlacesLoading = null; // Reset loading state on error
            throw error;
        }
    }

    /**
     * Update the user location marker position with animation
     * @private
     */
    _updateUserMarker(location) {
        if (location) {
            this._userMarker
                .setLngLat([location.lng, location.lat])
                .addTo(this._map);
        } else {
            this._userMarker.remove();
        }
    }

    /**
     * Update the map location marker position with animation
     * @private
     */
    _updateMapMarker(location) {
        if (location) {
            const startingPoint = this._mapMarker.getLngLat();
            if (!startingPoint) {
                this._mapMarker
                    .setLngLat([location.lng, location.lat])
                    .addTo(this._map);
                
                const el = this._mapMarker.getElement();
                el.classList.add('marker-drop');
                
                // Remove animation class after it completes
                el.addEventListener('animationend', () => {
                    el.classList.remove('marker-drop');
                }, { once: true });
            } else {
                this._mapMarker.setLngLat([location.lng, location.lat]);
            }
        } else {
            this._mapMarker.remove();
        }
    }

    /**
     * Clean up resources
     */
    destroy() {
        if (this._locationUnsubscribe) {
            this._locationUnsubscribe();
        }
        if (this._mapLocationUnsubscribe) {
            this._mapLocationUnsubscribe();
        }
        if (this._map) {
            this._map.remove();
        }
    }

    /**
     * Get the underlying Mapbox map instance
     * @returns {mapboxgl.Map}
     */
    getMap() {
        return this._map;
    }

    /**
     * Get the raw place data from the last reverse geocode
     * @returns {Object|null} The full place data from Mapbox
     */
    getRawPlace() {
        return this._currentPlace;
    }

    /**
     * Reverse geocode a location to an address
     * @private
     */
    async _reverseGeocode(location) {
        if (this._googleApiKey) {
            await this._reverseGeocodeGoogle(location);
        } else {
            await this._reverseGeocodeMapbox(location);
        }
    }

    async _reverseGeocodeGoogle(location) {
        try {
            await this._loadGooglePlaces();
            const geocoder = new google.maps.Geocoder();
            
            const result = await new Promise((resolve, reject) => {
                geocoder.geocode(
                    { location: { lat: location.lat, lng: location.lng } },
                    (results, status) => {
                        if (status === 'OK' && results[0]) {
                            resolve(results[0]);
                        } else {
                            reject(new Error(`Geocoding failed: ${status}`));
                        }
                    }
                );
            });

            this._currentPlace = this._convertGooglePlace(result);
        } catch (error) {
            console.warn('Reverse geocoding failed:', error);
            this._currentPlace = null;
        }
    }

    /**
     * Get display text for search input based on configured level
     * @private
     */
    _getSearchDisplayText(feature) {
        if (!this._searchInputLevel) {
            return feature.place_name;  // Default to full place name
        }

        // If level matches the feature's own type, use its text
        if (feature.id?.startsWith(this._searchInputLevel)) {
            return feature.text;
        }

        // Look for matching level in context
        const contextMatch = feature.context?.find(
            item => item.id?.startsWith(this._searchInputLevel)
        );
        
        if (contextMatch) {
            return contextMatch.text;
        }

        // Fallback to place_name if no match found
        return feature.place_name;
    }

    /**
     * Calculate radius based on map bounds
     * @private
     * @returns {number} radius in meters
     */
    _calculateRadius() {
        const bounds = this._map.getBounds();
        const center = this._map.getCenter();
        
        // Get the northeast corner
        const ne = bounds.getNorthEast();
        
        // Calculate the distance from center to corner (roughly half the viewport)
        const radiusInMeters = center.distanceTo(ne);
        
        // Ensure radius is within Google Places API limits (0-50000 meters)
        return Math.min(Math.max(radiusInMeters, 1), 50000);
    }

    /**
     * Clear existing place markers from the map
     * @private
     */
    _clearPlaceMarkers() {
        this._placeMarkers.forEach(marker => marker.remove());
        this._placeMarkers = [];
    }

    /**
     * Add markers for places on the map
     * @private
     * @param {Array} places - Array of place results from Google Places API
     */
    _addPlaceMarkers(places) {
        // Create a map of existing markers by place ID
        const existingMarkers = new Map(
            this._placeMarkers.map(marker => [marker.placeId, marker])
        );

        // Create a set of new place IDs
        const newPlaceIds = new Set(places.map(place => place.place_id));

        // Remove markers that are no longer in the results
        this._placeMarkers = this._placeMarkers.filter(marker => {
            if (!newPlaceIds.has(marker.placeId)) {
                marker.remove();
                return false;
            }
            return true;
        });

        // Add or update markers
        places.forEach(place => {
            if (place.geometry && place.geometry.location) {
                const existingMarker = existingMarkers.get(place.place_id);
                
                if (existingMarker) {
                    // Update existing marker position if needed
                    existingMarker.setLngLat([
                        place.geometry.location.lng,
                        place.geometry.location.lat
                    ]);
                } else {
                    // Create new marker
                    const el = document.createElement('div');
                    el.className = 'place-marker';
                    el.style.width = '25px';
                    el.style.height = '25px';
                    el.style.backgroundImage = 'url(https://maps.google.com/mapfiles/ms/icons/red-dot.png)';
                    el.style.backgroundSize = 'contain';
                    el.style.cursor = 'pointer';

                    // Create popup
                    const popup = new mapboxgl.Popup({ offset: 25 })
                        .setHTML(`
                            <h3>${place.name}</h3>
                            <p>${place.vicinity || ''}</p>
                            ${place.rating ? `<p>Rating: ${place.rating} ⭐️</p>` : ''}
                        `);

                    // Create and add marker
                    const marker = new mapboxgl.Marker(el)
                        .setLngLat([
                            place.geometry.location.lng,
                            place.geometry.location.lat
                        ])
                        .setPopup(popup)
                        .addTo(this._map);

                    // Store the place ID with the marker
                    marker.placeId = place.place_id;
                    this._placeMarkers.push(marker);
                }
            }
        });
    }

    /**
     * Search for nearby places when map location changes
     * @private
     */
    async _handleNearbyPlaces(location) {
        if (!this._nearbyPlaces) return;
        
        try {
            const radius = this._calculateRadius();
            
            let endpoint, requestBody;
            
            if (this._placesEndpoint === 'cloudflare') {
                endpoint = 'https://nearby-places-worker.sree-35c.workers.dev';
                requestBody = {
                    latitude: location.lat,
                    longitude: location.lng,
                    radius: radius,
                    types: ['restaurant', 'cafe', 'bar'],
                    maxResults: typeof this._nearbyPlaces === 'number' ? this._nearbyPlaces : 20
                };
            } else {
                // Default to Supabase
                endpoint = 'https://twxkuwesyfbvcywgnlfe.supabase.co/functions/v1/google-places-search';
                requestBody = {
                    latitude: location.lat,
                    longitude: location.lng,
                    radius: radius,
                    types: ['bar']
                };
            }
            
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();
            
            if (data.results) {
                // Convert the places data to match the format expected by _addPlaceMarkers
                const places = data.results.map(place => ({
                    place_id: place.place_id,
                    name: place.name,
                    vicinity: place.vicinity,
                    rating: place.rating,
                    geometry: {
                        location: {
                            lng: place.geometry.location.lng,
                            lat: place.geometry.location.lat
                        }
                    }
                }));
                
                this._addPlaceMarkers(places);
            }

            // Emit an event with the places data
            const event = new CustomEvent('nearbyPlacesUpdated', { 
                detail: data 
            });
            this._map.getContainer().dispatchEvent(event);
        } catch (error) {
            console.error('Error fetching nearby places:', error);
        }
    }
}

export default MapService; 