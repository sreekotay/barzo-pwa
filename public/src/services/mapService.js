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
        initialZoom = 14, 
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

        this._onAutocompleteSelect = onAutocompleteSelect;
        this._onMapDrag = onMapDrag;
        this._lastAutocompletePlace = null;

        /** @type {Function[]} */
        this._mapReadyCallbacks = [];
        this._mapInitialized = false;  // Add this flag

        this._autocompletePlaceCallbacks = [];

        this._placesLoadCallbacks = [];

        this._pendingSearch = null; // Will store {place, moveComplete, searchText}

        // Add property to track manual mode
        this._isManualMode = false;

        // Subscribe to map location updates
        this._mapLocationUnsubscribe = this._locationService.onMapLocationChange(
            async (mapLocation) => {
                if (!this._map) return;
                
                // Update marker
                this._updateMapMarker(mapLocation);
                
                // Compare map center with user location to determine if center button should show
                const userLocation = this._locationService.getUserLocation();
                const mapCenter = this._map.getCenter();
                const centerButton = document.getElementById('center-button');
                
                if (centerButton) {
                    // Always show the button for now
                    centerButton.style.display = 'block';
                    
                    if (userLocation) {
                        const isOffCenter = Math.abs(mapCenter.lat - userLocation.lat) > 0.0001 || 
                                          Math.abs(mapCenter.lng - userLocation.lng) > 0.0001;
                        // Log state changes
                        console.log('Center button would be:', isOffCenter ? 'shown' : 'hidden', {
                            mapCenter: mapCenter,
                            userLocation: userLocation,
                            diff: {
                                lat: Math.abs(mapCenter.lat - userLocation.lat),
                                lng: Math.abs(mapCenter.lng - userLocation.lng)
                            }
                        });
                        this._isManualMode = isOffCenter;
                    } else {
                        console.log('No user location available');
                        this._isManualMode = false;
                    }
                }

                // Handle reverse geocoding
                await this._reverseGeocode(mapLocation);
                if (this._searchInput && this._currentPlace && 
                    (!this._lastAutocompletePlace || !this._locationService.isManualMode())) {
                    this.updateSearchText(this._getSearchDisplayText(this._currentPlace));
                }
            },
            { 
                realtime: true,
                debounceMs: 100
            }
        );

        // Subscribe to user location changes
        this._userLocationUnsubscribe = this._locationService.onUserLocationChange(
            (userLocation) => {
                if (userLocation) {
                    this._updateUserMarker(userLocation);
                }
            },
            16  // Just pass the debounceMs number directly
        );

        this._geocodedLocation = null;

        this.debugMode = localStorage.getItem('mapDebug') === 'true';
    }

    /**
     * Initialize the map and optional search
     */
    async initialize() {
        await this._loadMapboxGL();
        
        // Get cached location
        const cachedLocation = this._locationService.getUserLocationCached();
        const initialCenter = cachedLocation || this._defaultCenter;
        
        // Check if we should do the animation
        const lastAnimation = localStorage.getItem('lastGlobeAnimation');
        const shouldAnimate = !lastAnimation || 
            (Date.now() - parseInt(lastAnimation) > 4 * 60 * 60 * 1000); // 4 hours in milliseconds

        // Initialize map
        mapboxgl.accessToken = this._accessToken;
        this._map = new mapboxgl.Map({
            container: this._mapContainer,
            style: 'mapbox://styles/mapbox/light-v11',
            zoom: shouldAnimate ? 1 : this._initialZoom,
            center: shouldAnimate ? [138.2529, 36.2048] : [initialCenter.lng, initialCenter.lat],
            attributionControl: false,
            logoPosition: 'bottom-right',
            projection: 'globe',
            pitch: 45,
            bearing: 0,
            scrollZoom: {
                around: 'center'
            }
        });
        document.getElementById(this._mapContainer).classList.add('map-loaded');

        // Create a promise that resolves when both style and map are loaded
        new Promise(resolve => {
            let styleLoaded = false;
            let mapLoaded = false;

            const checkBothLoaded = () => {
                if (styleLoaded && mapLoaded) {
                    // Now safe to set fog and continue with initialization
                    this._map.setFog({
                        'color': 'rgb(186, 210, 235)',
                        'high-color': 'rgb(36, 92, 223)',
                        'horizon-blend': 0.02,
                        'space-color': 'rgb(11, 11, 25)',
                        'star-intensity': 0.6
                    });

                    // Run callbacks after fog is set
                    console.log('Map loaded, running callbacks...');
                    this._mapInitialized = true;
                    this._mapReadyCallbacks.forEach(callback => callback());
                    this._mapReadyCallbacks = [];

                    resolve();
                }
            };

            this._map.on('style.load', () => {
                styleLoaded = true;
                checkBothLoaded();
            });

            this._map.on('load', () => {
                mapLoaded = true;
                checkBothLoaded();
            });
        });

        // Only animate if enough time has passed
        if (shouldAnimate && cachedLocation) {
            setTimeout(() => {
                this._map.flyTo({
                    center: [cachedLocation.lng, cachedLocation.lat],
                    zoom: this._initialZoom,
                    duration: 3000,  // 3 seconds animation
                    essential: true
                });
                // Store the animation time
                localStorage.setItem('lastGlobeAnimation', Date.now().toString());
            }, 1000);
        }

        // Set up the center function
        window.centerOnUserLocation = () => {
            const userLocation = this._locationService.getUserLocation();
            if (!userLocation) {
                console.log('No user location, requesting...');
                this._locationService.requestGeoLocation();
                return;
            }

            console.log('Centering map on:', userLocation);
            this._isManualMode = false;
            this._locationService.setMapLocation(userLocation);
            this._map.flyTo({
                center: [userLocation.lng, userLocation.lat],
                zoom: this._initialZoom,
                duration: 1000
            });
        };

        // Add controls to bottom-left
        this._map.addControl(new mapboxgl.NavigationControl({
            showCompass: false  // This will hide the compass/orientation control
        }), 'bottom-left');

        // Initialize user marker (green dot)
        this._createUserMarker();

        // Initialize map marker (red pin)
        this._createMapMarker();

        // Subscribe to user location changes to handle initial location
        this._locationUnsubscribe = this._locationService.onUserLocationChange((location) => {
            // Only fly to location if:
            // 1. We started with default location (no cached location)
            // 2. We're not in manual map mode
            if (!cachedLocation && !this._isManualMode && location) {
                this._map.flyTo({
                    center: [location.lng, location.lat],
                    zoom: this._initialZoom
                });
            }
        });

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
            this._isManualMode = false; // this is KEY - but this block is bogus
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

            // Only update location service if this was a user drag
            if (this._map.dragPan.isActive()) {
                this._lastAutocompletePlace = false;  // Clear the flag on manual drag
                if (this._onMapDrag) {
                    this._onMapDrag();
                }
                this._locationService.setMapLocation(location);
            }
            
            // Always notify callbacks about the map movement
            this._notifyCallbacks([], {
                event: 'map_moved',
                source: 'map_interaction',
                location: location,
                bounds: this._map.getBounds(),
                zoom: this._map.getZoom()
            });
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
        // Create search container first
        const searchContainer = document.getElementById(this._searchInput);
        searchContainer.className = 'search-container body';

        // Add search icon
        const searchIcon = document.createElement('div');
        searchIcon.className = 'search-icon';
        searchIcon.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
        `;
        searchContainer.appendChild(searchIcon);

        // Create search input
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Where do you want to go?';
        searchInput.className = 'google-places-input';
        
        // Add focus handler to select all text
        searchInput.addEventListener('focus', function() {
            setTimeout(() => {
                this.setSelectionRange(0, this.value.length);
            }, 0);
        });
        
        searchContainer.appendChild(searchInput);

        // Initialize appropriate search provider
        if (this._googleApiKey) {
            await this._initializeGoogleSearch(searchInput);
        } else {
            await this._initializeMapboxSearch();
        }
    }

    /**
     * Initialize Google Places search
     * @private
     */
    async _initializeGoogleSearch(searchInput) {
        await this._loadGooglePlaces();
        
        const autocomplete = new google.maps.places.Autocomplete(searchInput, {
            types: ['establishment', 'geocode'],
            componentRestrictions: { country: 'us' },
            fields: ['geometry', 'name', 'formatted_address', 'address_components']
        });

        autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (!place.geometry) return;

            const location = {
                lat: place.geometry.location.lat(),
                lng: place.geometry.location.lng()
            };

            // Do this first to preload the destination location
            this._locationService.setMapLocation(location);
            
            // Notify callbacks about the map movement
            this._notifyCallbacks([], {
                event: 'place_changed',
                source: 'map_interaction',
                location: location,
                bounds: this._map.getBounds(),
                zoom: this._map.getZoom()
            });
            // Store all search-related state in one object
            this._pendingSearch = {
                place: {
                    name: place.name,
                    location,
                    formatted_address: place.formatted_address
                },
                moveComplete: new Promise(resolve => {
                    this._map.once('moveend', resolve);
                }),
                searchText: searchInput.value
            };

            // Move map
            this._map.flyTo({
                center: [place.geometry.location.lng(), place.geometry.location.lat()],
                zoom: this._initialZoom
            });
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
        // Initialize marker if it doesn't exist
        if (!this._userMarker && this._map) {
            this._createUserMarker();
        }

        if (!this._userMarker) return; // Exit if map isn't ready yet

        if (location) {
            this._userMarker
                .setLngLat([location.lng, location.lat])
                .addTo(this._map);
        } else {
            this._userMarker?.remove();
        }
    }

    /**
     * Update the map location marker position with animation
     * @private
     */
    _updateMapMarker(location) {
        // Initialize marker if it doesn't exist
        if (!this._mapMarker && this._map) {
            this._createMapMarker();
        }

        if (!this._mapMarker) return; // Exit if map isn't ready yet

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
            this._mapMarker?.remove();
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
        if (this._userLocationUnsubscribe) {
            this._userLocationUnsubscribe();
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
     * Reverse geocode using Mapbox API
     * @private
     */
    async _reverseGeocodeMapbox(location) {
        try {
            const response = await fetch(
                `https://api.mapbox.com/geocoding/v5/mapbox.places/${location.lng},${location.lat}.json?access_token=${this._accessToken}`
            );

            if (!response.ok) throw new Error('Geocoding failed');
            
            const data = await response.json();
            const feature = data.features[0];

            // Find city and state from context
            const city = feature.context?.find(c => c.id.startsWith('place'))?.text;
            const state = feature.context?.find(c => c.id.startsWith('region'))?.text;
            
            this._currentPlace = feature;
            return feature;
        } catch (error) {
            console.warn('Reverse geocoding failed:', error);
            return null;
        }
    }

    /**
     * Reverse geocode a location to an address
     * @private
     */
    async _reverseGeocode(location) {
        if (this._lastAutocompletePlace && this._locationService.isManualMode()) {
            return;
        }

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
        this._clearPlaceMarkers();

        places.forEach((place) => {
            if (place.geometry && place.geometry.location) {
                const el = document.createElement('div');
                el.className = 'place-marker';
                el.style.width = '16px';
                el.style.height = '16px';
                el.style.borderRadius = '50%';
                el.style.backgroundColor = place.opening_hours?.open_now ? '#E31C5F' : '#9CA3AF';
                el.style.border = '2px solid white';
                el.style.boxShadow = '0 0 4px rgba(0,0,0,0.3)';
                el.style.cursor = 'pointer';

                const marker = new mapboxgl.Marker({
                    element: el
                })
                .setLngLat([
                    place.geometry.location.lng,
                    place.geometry.location.lat
                ])
                .addTo(this._map);

                marker.placeId = place.place_id;
                marker.placeData = place;

                el.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.selectMarker(place.place_id);
                    this._markerClickCallbacks.forEach(callback => callback(place));
                });

                el.addEventListener('touchstart', (e) => {
                    e.preventDefault();
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
            //console.log('Fetching places for location:', location, 'radius:', radius);
            
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
                    types: ['restaurant', 'cafe', 'bar'],
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
                    //places    ((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
                }
                
                console.log('Processed places with distances:', places);
                this._addPlaceMarkers(places);
                
                // Notify all callbacks of the places update
                this._notifyCallbacks(places, { 
                    event: 'location_change',
                    source: 'nearby_search'
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

    selectMarker(placeId) {
        this._placeMarkers.forEach(marker => {
            const markerEl = marker.getElement();
            if (markerEl) {
                markerEl.classList.toggle('selected', marker.placeId === placeId);
            }
        });
    }

    updateSearchText(text) {
        const searchInput = document.querySelector(`#${this._searchInput} input`);
        // Only update if the input doesn't have focus
        if (searchInput && !document.activeElement.isSameNode(searchInput)) {
            searchInput.value = text;
            searchInput.setSelectionRange(0, searchInput.value.length);
        }
    }

    getMapBounds() {
        return this._map.getBounds();
    }

    getMapCenter() {
        return this._map.getCenter();
    }

    // Add new method to call callbacks with config
    _notifyCallbacks(places, config = {}) {
        this._placesChangeCallbacks.forEach(callback => {
            callback(places, {
                event: config.event || 'unknown',
                source: config.source || 'unknown',
                ...config
            });
        });
    }

    isMapReady() {
        return this._map !== null && this._map !== undefined && this._map.loaded();
    }

    onMapReady(callback) {
        if (this.isMapReady()) {
            callback();
        } else {
            this._mapReadyCallbacks.push(callback);
        }
    }

    // Add method to handle autocomplete selection
    handleAutocompleteSelection(place) {
        this._lastAutocompletePlace = {
            name: place.name,
            location: place.geometry?.location,
            vicinity: place.formatted_address
        };
    }

    // Update map move handler
    _setupMapMoveHandler() {
        this._map.on('moveend', () => {
            if (this._lastAutocompletePlace) {
                // Notify callbacks with special flag
                this._notifyCallbacks([], {
                    event: 'place_match',
                    source: 'autocomplete',
                    shouldHighlight: true
                });
                this._lastAutocompletePlace.nextTime = true; //clear it on next places update - settle's the races
                this._lastAutocompletePlace = null;
            }
        });
    }

    _isNearby(loc1, loc2, threshold) {
        const R = 6371e3; // Earth's radius in meters
        const lat1 = loc1.lat * Math.PI/180;
        const lat2 = loc2.lat * Math.PI/180;
        const dlat = (loc2.lat - loc1.lat) * Math.PI/180;
        const dlon = (loc2.lng - loc1.lng) * Math.PI/180;

        const a = Math.sin(dlat/2) * Math.sin(dlat/2) +
                Math.cos(lat1) * Math.cos(lat2) *
                Math.sin(dlon/2) * Math.sin(dlon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const d = R * c;

        return d <= threshold;
    }

    onAutocompletePlaceMatch(callback) {
        this._autocompletePlaceCallbacks.push(callback);
    }

    // Generic method to notify when places are loaded
    onPlacesLoad(callback) {
        this._placesLoadCallbacks.push(callback);
    }

    // Add method to check for pending search
    async onPlacesUpdate(places) {
        if (this._pendingSearch) {
            let pendingPlace = this._pendingSearch.place;
            await this._pendingSearch.moveComplete;
            
            const matchingPlace = places.find(place => {
                const nameMatch = place.name.toLowerCase() === pendingPlace.name.toLowerCase();
                const locationMatch = this._isNearby(
                    place.geometry.location,
                    pendingPlace.location,
                    50
                );
                return nameMatch && locationMatch;
            });

            if (matchingPlace) {
                this._placesLoadCallbacks.forEach(callback => {
                    callback(pendingPlace, 'autocomplete');
                });
            }
            
            this._pendingSearch = null;
        }
    }

    // Add method to toggle center icon visibility
    setManualMode(isManual) {
        if (this._centerIcon) {
            this._centerIcon.classList.toggle('visible', isManual);
        }
    }

    centerOnCurrentLocation() {
        this._locationService.resetMapLocation();
        const location = this._locationService.getMapLocation();
        if (location) {
            this._map.flyTo({
                center: [location.lng, location.lat],
                zoom: this._initialZoom
            });
        }
    }

    // Add method to get/cache reverse geocoded location
    async getReverseGeocodedLocation() {
        const location = this._locationService.getUserLocation();
        if (!location) return 'Location Unknown';

        // Return cached value if we have it
        if (this._geocodedLocation) return this._geocodedLocation;

        try {
            const response = await fetch(
                `https://api.mapbox.com/geocoding/v5/mapbox.places/${location.lng},${location.lat}.json?access_token=${this._accessToken}`
            );

            if (!response.ok) throw new Error('Geocoding failed');
            
            const data = await response.json();
            const feature = data.features[0];

            // Find city and state from context
            const city = feature.context?.find(c => c.id.startsWith('place'))?.text;
            const state = feature.context?.find(c => c.id.startsWith('region'))?.text;
            
            this._geocodedLocation = city && state ? 
                `${city}, ${state}` : 
                (feature.place_name ? feature.place_name.split(',').slice(0, 2).join(',') : 'Location Unknown');

            return this._geocodedLocation;
        } catch (error) {
            console.error('Error getting location data:', error);
            return 'Location Unknown';
        }
    }

    // Clear cache when location changes significantly
    _onLocationChange(location) {
        this._geocodedLocation = null; // Clear cached location
        // ... rest of existing location change handling
    }

    setDebugMode(enabled) {
        this.debugMode = enabled;
        if (enabled) {
            console.log('Map Debug Mode Enabled');
            // Add any debug-specific initialization
        }
    }

    async searchNearbyPlaces(location, radius = 500) {
        const apiUrl = this.debugMode ? 'http://localhost:8787' : 'https://nearby-places-worker.sree-35c.workers.dev';
        // ... rest of method
    }

    fitToBounds(bounds) {
        if (!bounds) return;

        this._map.fitBounds(bounds, {
            padding: {
                top: 50,
                bottom: 200,  // More padding at bottom for carousel
                left: 50,
                right: 50
            },
            maxZoom: 16,  // Don't zoom in too far
            duration: 1000  // Smooth animation
        });
    }

    // Keep this method for backward compatibility
    fitMarkersToView(places) {
        if (!places?.length) return;

        const bounds = new mapboxgl.LngLatBounds();
        places.forEach(place => {
            if (place.geometry?.location) {
                bounds.extend([
                    place.geometry.location.lng,
                    place.geometry.location.lat
                ]);
            }
        });

        this.fitToBounds(bounds);
    }

    _createUserMarker() {
        // Create pin marker for user location
        const el = document.createElement('div');
        el.className = 'user-marker';
        el.innerHTML = `
            <svg width="24" height="32" viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 20 12 20s12-11 12-20c0-6.63-5.37-12-12-12zm0 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" 
                      fill="#059669" fill-opacity="0.8"
                      stroke="#FFFFFF" stroke-width="2"/>
            </svg>
        `;

        this._userMarker = new mapboxgl.Marker({
            element: el,
            anchor: 'bottom'
        });
    }

    _createMapMarker() {
        // Create simple circle marker for map location
        const el = document.createElement('div');
        el.className = 'map-marker';
        el.style.width = '16px';
        el.style.height = '16px';
        el.style.borderRadius = '50%';
        el.style.backgroundColor = '#059669';  // Change to green
        el.style.border = '3px solid white';
        el.style.boxShadow = '0 0 0 2px rgba(0,0,0,0.1)';

        this._mapMarker = new mapboxgl.Marker({
            element: el,
            anchor: 'center'
        });
    }
}

export default MapService; 