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
     * @param {Function} [options.onAutocompleteSelect] - Callback function to handle autocomplete selection
     * @param {Function} [options.onMapDrag] - Callback function to handle map drag
     */
    constructor(locationService, { 
        mapContainer, 
        accessToken, 
        googleApiKey, 
        searchInput, 
        searchInputLevel, 
        initialZoom = 13, 
        nearbyPlaces = false,
        placesEndpoint = 'supabase',
        onAutocompleteSelect,
        onMapDrag
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

        this._placesChangeCallbacks = [];
        this._markerClickCallbacks = [];
        this._markerSelectCallbacks = [];
        this._selectedMarkerId = null;

        this._onAutocompleteSelect = onAutocompleteSelect;
        this._onMapDrag = onMapDrag;
        this._isManualFromAutocomplete = false;  // Add new flag
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
                if (this._searchInput && this._currentPlace && 
                    (!this._isManualFromAutocomplete || !this._locationService.isManualMode())) {
                    const searchInput = document.querySelector('.google-places-input');
                    if (searchInput) {
                        searchInput.value = this._getSearchDisplayText(this._currentPlace);
                    }
                }
            },
            {
                realtime: false,
                debounceMs: 1000
            }
        );

        // Subscribe to map location updates for nearby places
        if (this._nearbyPlaces) {
            this._locationService.onMapLocationChange(
                location => {
                    console.log('Location update received:', location);
                    if (location) {
                        this._handleNearbyPlaces(location);
                    }
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
            this._isManualMap = false; // this is KEY - but this block is bogus
        }
        /**/

        // Update marker position during movement - only for the map marker
        this._map.on('move', () => {
            const center = this._map.getCenter();
            if (this._mapMarker) {  // Only update the map marker
                this._mapMarker.setLngLat([center.lng, center.lat]);
            }
        });

        // Update location service and handle manual drag
        this._map.on('moveend', () => {
            const center = this._map.getCenter();
            const location = {
                lng: center.lng,
                lat: center.lat
            };

            // Check if this was a user drag (not programmatic)
            if (this._map.dragPan.isActive()) {
                this._isManualFromAutocomplete = false;  // Clear the flag on manual drag
                if (this._onMapDrag) {
                    this._onMapDrag();
                }
            }

            this._locationService.setMapLocation(location);
            this._handleNearbyPlaces(location); //poke it because of zoom change
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
        searchInput.placeholder = 'Where do you want to go?';
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

            // Set flags when selecting from autocomplete
            this._isManualFromAutocomplete = true;
            this._locationService.setManualMode(true);  // Use proper method

            if (this._onAutocompleteSelect) {
                this._onAutocompleteSelect();
            }

            // Update map marker and view
            this._mapMarker.setLngLat([location.lng, location.lat]).addTo(this._map);
            this._map.flyTo({
                center: [location.lng, location.lat],
                zoom: this._initialZoom
            });

            // Store place data and update location service
            this._currentPlace = this._convertGooglePlace(place);
            this._locationService.setMapLocation(location);
        });

        // Update the dragstart handler to clear both flags
        this._map.on('dragstart', () => {
            this._isManualFromAutocomplete = false;
            // Don't clear _isManualMap here as we want to stay in manual mode when dragging
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
        // Use proper method to check manual mode
        if (this._isManualFromAutocomplete && this._locationService.isManualMode()) {
            return;
        }

        // Proceed with normal reverse geocoding
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
        // Clear existing markers
        this._clearPlaceMarkers();

        places.forEach((place, index) => {
            if (place.geometry && place.geometry.location) {
                // Create marker element
                const el = document.createElement('div');
                el.className = `place-marker${index === 2 ? ' selected' : ''}`;
                el.style.width = '16px';
                el.style.height = '16px';
                el.style.borderRadius = '50%';
                el.style.backgroundColor = place.opening_hours?.open_now ? '#E31C5F' : '#666666';
                el.style.border = '2px solid white';
                el.style.boxShadow = '0 0 4px rgba(0,0,0,0.3)';
                el.style.cursor = 'pointer';

                // Create and add marker
                const marker = new mapboxgl.Marker({
                    element: el
                })
                .setLngLat([
                    place.geometry.location.lng,
                    place.geometry.location.lat
                ])
                .addTo(this._map);

                // Store the place data with the marker
                marker.placeId = place.place_id;
                marker.placeData = place;

                // Simplified click handler - just select marker
                el.addEventListener('click', (e) => {
                    e.preventDefault(); // Prevent any default handling
                    console.log('🗺️ Marker clicked:', place.name, '(', place.place_id, ')');
                    this.selectMarker(place.place_id);
                    this._markerClickCallbacks.forEach(callback => callback(place));
                });

                // Add touch handlers
                el.addEventListener('touchstart', (e) => {
                    e.preventDefault(); // Prevent map pan/zoom
                    console.log('🗺️ Marker touched:', place.name, '(', place.place_id, ')');
                    this.selectMarker(place.place_id);
                    this._markerClickCallbacks.forEach(callback => callback(place));
                }, { passive: false });

                this._placeMarkers.push(marker);
            }
        });
    }

    /**
     * Calculate distance between two points in meters
     * @private
     */
    _calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // Earth's radius in meters
        const φ1 = lat1 * Math.PI/180;
        const φ2 = lat2 * Math.PI/180;
        const Δφ = (lat2-lat1) * Math.PI/180;
        const Δλ = (lon2-lon1) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c; // Distance in meters
    }

    /**
     * Format distance in a human-readable way
     * @private
     */
    _formatDistance(meters) {
        const miles = meters * 0.000621371; // Convert meters to miles
        if (miles < 0.1) {
            return `${Math.round(miles * 5280)}ft`; // Show in feet if less than 0.1 miles
        } else {
            return `${miles.toFixed(1)}mi`;
        }
    }

    /**
     * Search for nearby places when map location changes
     * @private
     */
    async _handleNearbyPlaces(location) {
        if (!this._nearbyPlaces) {
            console.log('Nearby places disabled');
            return;
        }
        
        try {
            const radius = this._calculateRadius() * 2 / 3;
            console.log('Fetching places for location:', location, 'radius:', radius);
            
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
                endpoint = 'https://twxkuwesyfbvcywgnlfe.supabase.co/functions/v1/google-places-search';
                requestBody = {
                    latitude: location.lat,
                    longitude: location.lng,
                    radius: radius,
                    types: ['bar']
                };
            }
            
            console.log('Fetching from endpoint:', endpoint, 'with body:', requestBody);
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();
            console.log('Places API response:', data);
            
            if (data.results) {
                // Get current user location for distance calculation
                const userLocation = this._locationService.getUserLocationCached();
                
                const places = data.results.map(place => {
                    // Calculate distance if we have user location
                    let distance = null;
                    let formattedDistance = null;
                    if (userLocation && place.geometry && place.geometry.location) {
                        distance = this._calculateDistance(
                            userLocation.lat,
                            userLocation.lng,
                            place.geometry.location.lat,
                            place.geometry.location.lng
                        );
                        formattedDistance = this._formatDistance(distance);
                    }

                    return {
                        // Basic info
                        place_id: place.place_id,
                        name: place.name,
                        vicinity: place.vicinity,
                        formatted_address: place.formatted_address,
                        
                        // Location and distance
                        geometry: place.geometry,
                        plus_code: place.plus_code,
                        distance,           // Distance in meters
                        formattedDistance, // Formatted distance string
                        
                        // Business details
                        business_status: place.business_status,
                        opening_hours: place.opening_hours,
                        price_level: place.price_level,
                        rating: place.rating,
                        user_ratings_total: place.user_ratings_total,
                        
                        // Types and categories
                        types: place.types,
                        
                        // Visual elements
                        icon: place.icon,
                        icon_background_color: place.icon_background_color,
                        icon_mask_base_uri: place.icon_mask_base_uri,
                        photos: place.photos,
                        
                        // Additional data
                        html_attributions: place.html_attributions,
                        scope: place.scope,
                        reference: place.reference,

                        // Store the raw response too in case we need it
                        raw_response: place
                    };
                });
                
                // Sort places by distance if available
                if (userLocation) {
                    places.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
                }
                
                console.log('Processed places with distances:', places);
                this._addPlaceMarkers(places);
                
                // Notify all callbacks of the places update
                this._placesChangeCallbacks.forEach(callback => {
                    console.log('Calling places change callback');
                    callback(places);
                });
            } else {
                console.log('No results in places response');
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

    onPlacesChange(callback) {
        this._placesChangeCallbacks.push(callback);
    }

    onMarkerClick(callback) {
        this._markerClickCallbacks.push(callback);
    }

    onMarkerSelect(callback) {
        this._markerSelectCallbacks.push(callback);
    }

    selectMarker(placeId) {
        this._selectedMarkerId = placeId;
        this._placeMarkers.forEach(marker => {
            const markerEl = marker.getElement();
            if (markerEl) {
                markerEl.classList.toggle('selected', marker.placeId === placeId);
            }
        });
        
        // Create and dispatch a new event each time
        const event = new CustomEvent('markerSelect', {
            bubbles: true,
            detail: placeId
        });
        this._map.getContainer().dispatchEvent(event);
    }

    // Replace _fetchNearbyPlaces with a generic method to add POI markers
    addPOIMarkers(pois, options = {}) {
        // Clear existing markers
        this._clearPlaceMarkers();

        pois.forEach((poi, index) => {
            if (poi.geometry && poi.geometry.location) {
                // Create marker element with optional type-specific styling
                const el = document.createElement('div');
                el.className = `poi-marker ${options.markerClass || ''} ${index === 2 ? 'selected' : ''}`;
                el.style.width = '16px';
                el.style.height = '16px';
                el.style.borderRadius = '50%';
                el.style.backgroundColor = options.getMarkerColor?.(poi) || '#666666';
                el.style.border = '2px solid white';
                el.style.boxShadow = '0 0 4px rgba(0,0,0,0.3)';
                el.style.cursor = 'pointer';

                // Create and add marker
                const marker = new mapboxgl.Marker({
                    element: el
                })
                .setLngLat([
                    poi.geometry.location.lng,
                    poi.geometry.location.lat
                ])
                .addTo(this._map);

                // Store the POI data with the marker
                marker.poiId = poi.id;
                marker.poiData = poi;

                // Inside addPOIMarkers method, update the event handling
                el.addEventListener('click', (e) => {
                    e.preventDefault();
                    console.log('🗺️ POI marker clicked:', poi.name, '(', poi.id, ')');
                    this.selectMarker(poi.id);
                    this._markerClickCallbacks.forEach(callback => callback(poi));
                });

                el.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    console.log('🗺️ POI marker touched:', poi.name, '(', poi.id, ')');
                    this.selectMarker(poi.id);
                    this._markerClickCallbacks.forEach(callback => callback(poi));
                }, { passive: false });

                this._placeMarkers.push(marker);
            }
        });

        // Notify callbacks of the POI update
        this._placesChangeCallbacks.forEach(callback => callback(pois));
    }

    updateSearchText(text) {
        const searchInput = document.querySelector(this._searchInputSelector);
        // Only update if the input doesn't have focus
        if (searchInput && !document.activeElement.isSameNode(searchInput)) {
            searchInput.value = text;
        }
    }
}

export default MapService; 