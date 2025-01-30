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
     * @param {string} [options.searchInput] - ID of search input element (optional)
     * @param {string} [options.searchInputLevel] - Level for search input (e.g. 'neighborhood', 'postcode', 'place')
     * @param {number} [options.initialZoom=13] - Initial map zoom level
     */
    constructor(locationService, { mapContainer, accessToken, searchInput, searchInputLevel, initialZoom = 13 }) {
        this._locationService = locationService;
        this._mapContainer = mapContainer;
        this._accessToken = accessToken;
        this._searchInput = searchInput;
        this._searchInputLevel = searchInputLevel;
        this._initialZoom = initialZoom;

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
            center: [initialCenter.lng, initialCenter.lat]
        });

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

        // Subscribe to user location updates
        this._locationUnsubscribe = this._locationService.onUserLocationChange((location) => {
            this._updateUserMarker(location);
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
        const geocoder = new MapboxGeocoder({
            accessToken: this._accessToken,
            mapboxgl: mapboxgl,
            marker: false,
            types: 'poi,place,address',  // Prioritize POIs and places over addresses
            countries: 'us',  // Keep US restriction
            proximity: this._locationService.getMapLocation() || this._defaultCenter,
            bbox: null,  // Remove NYC bounding box
            minLength: 1,  // Start searching after just 1 character
            limit: 15,  // Show more results
            fuzzyMatch: true,
            language: 'en',
            localGeocoder: (query) => {
                // If we have a current place, add it as a suggestion
                if (this._currentPlace) {
                    return [{
                        place_name: this._getSearchDisplayText(this._currentPlace),
                        center: [this._currentPlace.center[0], this._currentPlace.center[1]],
                        place_type: ['current'],
                        text: 'Current Location'
                    }];
                }
                return [];
            }
        });

        // Update proximity when map location changes
        this._locationService.onMapLocationChange(
            (location) => {
                if (location) {
                    geocoder.setProximity({ longitude: location.lng, latitude: location.lat });
                }
            },
            { realtime: false, debounceMs: 1000 }
        );

        // Add geocoder to the search input
        const searchElement = document.getElementById(this._searchInput);
        searchElement.appendChild(geocoder.onAdd(this._map));

        // Initialize search marker
        this._searchMarker = new mapboxgl.Marker({
            color: '#4668F2'
        });

        // Handle search results
        geocoder.on('result', (event) => {
            const [lng, lat] = event.result.center;
            const location = { lng, lat };
            
            // Update map marker and view
            this._mapMarker.setLngLat([lng, lat]).addTo(this._map);
            this._map.flyTo({
                center: [lng, lat],
                zoom: this._initialZoom
            });

            // Update only map location in LocationService
            this._locationService.setMapLocation(location);
        });

        // Clear marker when search is cleared
        geocoder.on('clear', () => {
            this._mapMarker.remove();
            this._locationService.resetMapLocation();
        });
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
        try {
            const response = await fetch(
                `https://api.mapbox.com/geocoding/v5/mapbox.places/${location.lng},${location.lat}.json?` + 
                new URLSearchParams({
                    access_token: this._accessToken,
                    types: 'address,poi,place',
                    limit: 1
                })
            );
            
            const data = await response.json();
            if (data.features && data.features.length > 0) {
                this._currentPlace = data.features[0];  // Store the full place data
            } else {
                this._currentPlace = null;
            }
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
}

export default MapService; 