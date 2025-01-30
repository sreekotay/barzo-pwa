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
     * @param {number} [options.initialZoom=13] - Initial map zoom level
     */
    constructor(locationService, { mapContainer, accessToken, searchInput, initialZoom = 13 }) {
        this._locationService = locationService;
        this._mapContainer = mapContainer;
        this._accessToken = accessToken;
        this._searchInput = searchInput;
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
        
        // Initialize map with cached location or default center
        const cachedLocation = this._locationService.getUserLocationCached();
        const initialCenter = cachedLocation || this._defaultCenter;
        
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

        // Subscribe to map location updates
        this._mapLocationUnsubscribe = this._locationService.onMapLocationChange(
            (location) => {
                this._updateMapMarker(location);
            },
            { 
                realtime: true,    // Use realtime updates
                debounceMs: 0      // No debouncing
            }
        );

        // Set initial locations
        const initialUserLocation = this._locationService.getUserLocation();
        const initialMapLocation = this._locationService.getMapLocation();

        if (initialUserLocation) {
            this._updateUserMarker(initialUserLocation);
        }
        if (initialMapLocation) {
            this._updateMapMarker(initialMapLocation);
            this._map.setCenter([initialMapLocation.lng, initialMapLocation.lat]);
        }

        // Listen for map movement events
        this._map.on('move', () => {
            const center = this._map.getCenter();
            const location = {
                lng: center.lng,
                lat: center.lat
            };
            this._locationService.setMapLocation(location);
        });

        this._map.on('moveend', () => {
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
            types: 'poi,address,place',  // Include POIs and places
            countries: 'us',  // Limit to US for better relevance
            proximity: this._defaultCenter, // Bias results towards NYC
            bbox: [-74.0479, 40.6829, -73.9067, 40.8820], // NYC bounding box for better local results
            minLength: 3, // Start searching after 3 characters
            limit: 10, // Show more results
            fuzzyMatch: true,
            language: 'en'
        });

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
            
            // Update marker and map
            this._searchMarker.setLngLat([lng, lat]).addTo(this._map);
            this._map.flyTo({
                center: [lng, lat],
                zoom: this._initialZoom
            });

            // Update LocationService
            this._locationService.setMapLocation(location);
        });

        // Clear marker and reset map location when search is cleared
        geocoder.on('clear', () => {
            this._searchMarker.remove();
            this._locationService.resetMapLocation();
        });
    }

    /**
     * Update the user location marker position
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
     * Update the map location marker position
     * @private
     */
    _updateMapMarker(location) {
        if (location) {
            this._mapMarker
                .setLngLat([location.lng, location.lat])
                .addTo(this._map);
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
}

export default MapService; 