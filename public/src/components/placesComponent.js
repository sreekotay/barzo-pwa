import MarkerManager from '../services/markerManager.js';
import CarouselComponent from './carouselComponent.js';
import { getApiUrl } from '../services/apiService.js';
import PlaceDetailsPage from '../pages/placeDetailsPage.js';

const PLACES_API_URL = getApiUrl();
//const PLACES_API_URL = 'http://localhost:8787'; // debug

export default class PlacesComponent {
    constructor(mapService, locationService, containerSelector, config = {}) {
        this._mapService = mapService;
        this._locationService = locationService;
        this._containerSelector = containerSelector;
        this._config = {
            placeTypes: ['bar'],
            maxResults: 30,
            endpoint: 'supabase',
            markerColors: {
                open: '#E31C5F',
                closed: '#9CA3AF',
                pulse: '#E31C5F'
            },
            onExpand: null,
            fitMapOnExpand: false,
            ...config
        };

        // Add sheet template
        this.sheetTemplate = `
            <div class="place-details-backdrop"></div>
            <div class="place-details-sheet">
                <button class="close-button absolute right-4 top-4 w-8 h-8 flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-100">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
                <div class="details">
                    <!-- Details will be injected here -->
                </div>
            </div>
        `;

        this._dotElement = null;
        this._markersVisible = false;
        this._setupComponent();
    }

    _setupComponent() {
        // Get current container using selector
        this._container = document.querySelector(this._containerSelector);
        if (!this._container) {
            console.warn(`Container not found: ${this._containerSelector}`);
            return;
        }

        // Ensure container has minimum height
        this._container.style.minHeight = '100px';

        // Get component name from container ID for logging
        const componentName = this._containerSelector.replace('#', '').replace('-container', '');

        // Initialize properties
        this._markerManager = new MarkerManager(this._mapService, componentName, {
            showPopups: false  // Already false by default
        });
        this._currentPlaces = [];
        this._currentIntersectionObserver = null;
        this._isUpdating = false;
        this._lastScrollTime = 0;
        this._isProgrammaticScroll = false;
        this._isTransitioning = false;
        this._carousel = new CarouselComponent(this._container);

        // Bind methods
        this.updatePlaces = this.updatePlaces.bind(this);
        this._handleMarkerClick = this._handleMarkerClick.bind(this);
        this._handleLocationChange = this._handleLocationChange.bind(this);

        // Set up listeners
        this._mapService.onPlacesChange(this.updatePlaces);
        this._markerManager.onMarkerClick(this._handleMarkerClick);
        this._locationService.onMapLocationChange(
            this._handleLocationChange,
            {
                realtime: false,
                debounceMs: 1000
            }
        );

        // Listen for autocomplete matches
        this._mapService.onAutocompletePlaceMatch((place) => {
            this._handleMarkerClick(place);
        });

        // Listen for places loads
        this._mapService.onPlacesLoad((searchPlace, source) => {
            console.log('📥 Received places load event:', { searchPlace, source });
            if (source === 'autocomplete' && this._currentPlaces.length > 0) {
                console.log('🔎 Current places:', this._currentPlaces.length);
                const matchingPlace = this._findMatchingPlace(searchPlace);
                console.log('🎯 Matching place found:', matchingPlace?.name);
                if (matchingPlace) {
                    this._handleMarkerClick(matchingPlace);
                }
            }
        });

        // Wait for map to be ready before initial fetch
        if (this._mapService.isMapReady()) {
            const location = this._locationService.getMapLocation();
            if (location) {
                this._fetchNearbyPlaces(location);
            }
        } else {
            this._mapService.onMapReady(() => {
                const location = this._locationService.getMapLocation();
                if (location) {
                    this._fetchNearbyPlaces(location);
                }
            });
        }

        // Add header click handler setup
        this._setupHeaderClickHandler();

        // Add collapse handler - only hide markers if explicitly collapsed
        this._carousel.onCollapse(() => {
            console.log(`[${this._containerSelector}] Carousel collapsed, hiding markers`);
            this._markerManager.hideMarkers();
            this._markersVisible = false;
            // Update dot opacity
            if (this._dotElement) {
                this._dotElement.style.opacity = '0';
            }
            // Force clear any lingering pulse states
            this._markerManager.setPulsing(false);
            // Clear marker selection
            this._markerManager.selectMarker(null);
        });
    }

    _setupHeaderClickHandler() {
        const container = document.querySelector(this._containerSelector);
        if (!container) return;

        const parent = container.parentElement;
        if (!parent) return;

        const header = Array.from(parent.children).find(child => {
            return child.classList.contains('flex') && 
                   child.nextElementSibling === container;
        });
        
        if (header) {
            // Find the dot element
            this._dotElement = header.querySelector('[data-dot]');
            
            // Make the entire header clickable
            header.style.cursor = 'pointer';
            header.addEventListener('click', (e) => {
                // If clicking the dot
                if (e.target === this._dotElement) {
                    e.stopPropagation();
                    if (this._dotElement.style.opacity === '0') {
                        // If dot is invisible, fetch data without expanding
                        const location = this._locationService.getMapLocation();
                        if (location) {
                            this._fetchNearbyPlaces(location, false, true);
                        }
                    } else {
                        // If dot is visible, just toggle markers
                        this._toggleMarkers();
                    }
                    return;
                }
                
                console.log('Header clicked for:', this._containerSelector);
                this._handleHeaderClick();
            });
        }
    }

    _toggleMarkers() {
        if (this._markersVisible) {
            this._markerManager.hideMarkers();
            this._dotElement.style.opacity = '0.5';
            this._markersVisible = false;
        } else {
            this._markerManager.showMarkers();
            this._dotElement.style.opacity = '1';
            this._markersVisible = true;
        }
    }

    _handleHeaderClick() {
        console.log(`[${this._containerSelector}] Handling header click, carousel expanded:`, this._carousel._isExpanded);
        if (!this._carousel._isExpanded) {
            // If collapsed, fetch data first without expanding
            const location = this._locationService.getMapLocation();
            if (location) {
                console.log(`[${this._containerSelector}] Fetching places before expansion`);
                // Notify parent about expansion
                if (this._config.onExpand) {
                    this._config.onExpand();
                }
                // Fetch places and expand
                this._fetchNearbyPlaces(location, true);
            }
        } else {
            // If expanded, just collapse this carousel
            console.log(`[${this._containerSelector}] Collapsing carousel`);
            this._carousel.collapse();
        }
    }

    // Add method to handle external collapse request
    handleExternalCollapse() {
        // Only collapse if currently expanded
        if (this._carousel._isExpanded) {
            console.log(`[${this._containerSelector}] External collapse request, hiding markers`);
            this._carousel.collapse();
        }
    }

    // Call this when switching tabs/routes
    reset() {
        // Clean up existing resources
        if (this._carousel) {
            this._carousel.destroy();
        }
        if (this._markerManager) {
            this._markerManager.clear();
        }
        
        // NOTE: Do not clear container innerHTML - it causes flicker
        // if (this._container) {
        //     this._container.innerHTML = '';
        // }
        
        // Re-setup the component
        this._setupComponent();
        
        // Re-fetch places if map is ready and we have a location
        if (this._mapService.isMapReady()) {
            const location = this._locationService.getMapLocation();
            if (location) {
                this._fetchNearbyPlaces(location);
            }
        }

        // Reset dot state and hide markers
        if (this._dotElement) {
            this._dotElement.style.opacity = '0';
            this._markerManager.hideMarkers();
            this._markerManager.setPulsing(false);
        }
        this._markersVisible = false;
    }

    async _handleLocationChange(location) {
        if (this._carousel._isExpanded) {
            this._fetchNearbyPlaces(location);
        }
    }

    async _fetchNearbyPlaces(location, fromHeaderClick = false, fromDotClick = false) {
        // Don't fetch if collapsed (unless it's from a header click or dot click)
        if (!this._carousel._isExpanded && !fromHeaderClick && !fromDotClick) {
            return;
        }

        try {
            // Calculate radius but cap it at 10km (10000m) for Radar API
            const calculatedRadius = this._calculateRadius() * 2 / 3;
            const radius = Math.min(Math.floor(calculatedRadius / 100) * 100, 10000);
            
            const roundedLocation = {
                lat: Math.round(location.lat * 10000) / 10000,
                lng: Math.round(location.lng * 10000) / 10000
            };

            // Build URL with all parameters including keywords
            const url = new URL(`${PLACES_API_URL}/nearby?detailLevel=basic`);
            url.searchParams.set('lat', roundedLocation.lat);
            url.searchParams.set('lng', roundedLocation.lng);
            url.searchParams.set('radius', radius);  // Now using capped radius
            url.searchParams.set('type', this._config.placeTypes[0]);
            
            // Add keywords if they exist in config
            if (this._config.keywords) {
                this._config.keywords.forEach(keyword => {
                    url.searchParams.append('keyword', keyword);
                });
            }

            console.log('Fetching places with radius:', radius, 'meters');
            
            const response = await fetch(url.toString(), {
                headers: {
                    'X-API-Key': 'TESTING_KEY_wNTrO9zYD8cU__Pzmbs0fid80_EIqzhp7tW_FCpADDo',
                    'Content-Type': 'application/json'
                },
                mode: 'cors'
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('Places API Error:', {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorData
                });
                throw new Error(errorData.error || errorData.message || 'Failed to fetch places');
            }

            let places = await response.json();
            if (places) {
                // Extract Google places from response
                const googlePlaces = places.google || places;
                const mapLocation = this._locationService.getMapLocation();
                const processedPlaces = this._processPlacesData(googlePlaces, mapLocation);
                
                // Update markers but don't automatically show them
                this._markerManager.updateMarkers(processedPlaces, this._config.markerColors);
                if (this._dotElement) {
                    this._dotElement.style.opacity = '1';
                    // Don't automatically show markers
                    this._markersVisible = false;
                }
                
                // Only expand if this was from a header click
                if (fromHeaderClick) {
                    this._carousel.expand();
                }
                
                // Only update content if we're expanded or this was a header click
                if (this._carousel._isExpanded || fromHeaderClick) {
                    this._updatePlacesContent(processedPlaces, fromHeaderClick);
                }
            }
        } catch (error) {
            console.error('Error fetching nearby places:', error);
            // Optionally show user-friendly error message
            // this._showError('Unable to fetch nearby places. Please try again later.');
        }
    }

    _normalizeHours(hoursArray) {
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const normalized = {};

        dayNames.forEach((day, index) => {
            const dayData = hoursArray?.find(h => h.name === index);
            normalized[day] = dayData?.hours || [];
        });

        return normalized;
    }

    _processPlacesData(places, userLocation) {
        return places.map(place => {
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

            // Normalize hours if they exist
            const normalizedHours = place.hours ? this._normalizeHours(place.hours) : null;

            return {
                ...place,
                hours: normalizedHours,
                distance,
                formattedDistance
            };
        })//.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
    }

    _calculateRadius() {
        const bounds = this._mapService.getMapBounds();
        const center = this._mapService.getMapCenter();
        const ne = bounds.getNorthEast();
        const radiusInMeters = center.distanceTo(ne);
        
        // Round down to nearest 100m for better caching
        const roundedRadius = Math.floor(radiusInMeters / 100) * 100;
        
        // Ensure radius is between 1m and 50km
        return Math.min(Math.max(roundedRadius, 1), 50000);
    }

    _calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3;
        const φ1 = lat1 * Math.PI/180;
        const φ2 = lat2 * Math.PI/180;
        const Δφ = (lat2-lat1) * Math.PI/180;
        const Δλ = (lon2-lon1) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    }

    _formatDistance(meters) {
        const miles = meters * 0.000621371;
        if (miles < 0.1) {
            return `${Math.round(miles * 5280)}ft`;
        } else {
            return `${miles.toFixed(1)}mi`;
        }
    }

    _getContainer() {
        this._container = document.querySelector(this._containerSelector);
        if (!this._container) {
            console.warn(`Container not found: ${this._containerSelector}`);
            return null;
        }
        return this._container;
    }

    updatePlaces(places, config = {}) {
        if (!this._getContainer()) return;
        
        //console.log('📦 Places update from:', config.event, config.source);
        if (config.location) {
            this._fetchNearbyPlaces(config.location);
        } else {
            this._markerManager.updateMarkers(places, this._config.markerColors);
            this._updatePlacesContent(places);
        }
    }

    _updatePlacesContent(places, fromHeaderClick = false) {
        const container = this._getContainer();
        if (!container) return;

        if (!places?.length) {
            // Keep existing content if no places yet
            return;
        }

        // Store new places data
        this._currentPlaces = places;
        let placesScroll = this._carousel.getOrCreateScrollContainer();

        // Create new cards
        places.forEach(place => {
            const existingCard = placesScroll.querySelector(`[data-place-id="${place.place_id}"]`);
            if (!existingCard) {
                const card = this._createPlaceCard(place);
                placesScroll.appendChild(card);
            }
        });

        // Update observers and event handlers
        this._setupCardObserversAndHandlers(placesScroll);

        // Only expand if we have places and this wasn't from a header click
        if (places.length > 0 && !fromHeaderClick) {
            this._carousel.expand();
        }

        // After UI is updated, notify map service
        this._mapService.onPlacesUpdate(places);
    }

    _createPlaceCard(place) {
        const card = document.createElement('div');
        card.className = 'place-card mb-4 cursor-pointer hover:bg-gray-50';
        card.dataset.placeId = place.place_id;
        
        // Add custom property for highlight color
        card.style.setProperty('--highlight-color', this._config.markerColors.open);

        // Create the basic structure
        card.innerHTML = `
            ${place.photos && place.photos.length > 0 ? `
                <div class="place-image">
                    <img 
                        src="https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${place.photos[0].photo_reference}&key=${this.serverKey || this._mapService._googleApiKey}"
                        alt="${place.name}"
                        loading="lazy"
                        class="w-full h-48 object-cover"
                    >
                </div>
            ` : ''}
            <div class="flex-1 px-2 pb-2">
                <div class="types-scroll nowrap body">
                    ${(place.types || [])
                        .filter(type => !['point_of_interest', 'establishment'].includes(type))
                        .map((type, index, array) => `
                            <span class="text-gray-500 text-xs">${type.replace(/_/g, ' ')}</span>${index < array.length - 1 ? '<span class="text-gray-300"> | </span>' : ''}
                        `).join('')}
                </div>
                <h3 class="name" style="position:relative; top:-2px">${place.name}</h3>
                <div class="flex" style="align-items: baseline;">
                    <div class="status ${place.opening_hours ? `pc-status ${place.opening_hours.open_now ? 'open' : 'closed'}` : ''}">
                        ${place.opening_hours ? (place.opening_hours.open_now ? 'OPEN' : 'CLOSED') : '...'}
                    </div>
                    <div class="price-level text-gray-500 text-xs ml-2">
                        ${place.price_level ? '$'.repeat(place.price_level) : ''}
                    </div>
                    <div class="flex-1"></div>
                    <div class="text-gray-500 text-xs pr-1">${place.formattedDistance || ''}</div>
                </div>
            </div>
        `;

        // Add click handler for place details
        card.addEventListener('click', (e) => {
            e.preventDefault();
            this.handlePlaceClick(place);
        });

        // Add hover handlers for desktop
        if (!this._carousel.isMobile()) {
            card.addEventListener('mouseenter', () => {
                if (this._isUpdating) return;
                this._markerManager.selectMarker(place.place_id);
                this._carousel.selectCard(place.place_id);
            });

            card.addEventListener('mouseleave', () => {
                if (this._isUpdating) return;
                this._markerManager.selectMarker(null);
                this._carousel.clearSelection();
            });
        }

        return card;
    }

    _scrollCardIntoView(placeId) {
        this._carousel.scrollCardIntoView(placeId);
    }

    _handleMarkerClick(place) {
        const container = this._getContainer();
        if (!container) return;

        this._isUpdating = true;

        if (this._currentIntersectionObserver) {
            this._currentIntersectionObserver.disconnect();
        }

        this._carousel.selectCard(place.place_id);

        this._scrollCardIntoView(place.place_id);
        this._markerManager.selectMarker(place.place_id);

        setTimeout(() => {
            if (this._currentIntersectionObserver) {
                container.querySelectorAll('.place-card').forEach(card => {
                    this._currentIntersectionObserver.observe(card);
                });
            }
            this._isUpdating = false;
        }, 100);
    }

    
    _setupCardObserversAndHandlers(placesScroll) {
        // Disconnect any existing observer
        if (this._currentIntersectionObserver) {
            this._currentIntersectionObserver.disconnect();
        }
    
        // Only set up intersection observer on mobile
        if (this._carousel.isMobile()) {
            // Create new observer
            this._currentIntersectionObserver = new IntersectionObserver(
                async (entries) => {
                    // Only process if carousel is expanded
                    if (!this._carousel._isExpanded) {
                        return;
                    }
    
                    for (const entry of entries) {
                        const card = entry.target;
                        const placeId = card.dataset.placeId;
                        
                        if (entry.isIntersecting) {
                            // Only highlight if carousel is expanded
                            if (this._carousel._isExpanded) {
                                this._markerManager.selectMarker(placeId);
                                this._carousel.selectCard(placeId);

                                // Find the place in currentPlaces
                                const place = this._currentPlaces.find(p => p.place_id === placeId);
                                
                                // Check if we only have basic details
                                if (place && !place.detailsFetched) {
                                    try {
                                        // Use PlaceDetailsPage.getPlaceDetails instead of direct fetch
                                        const details = await PlaceDetailsPage.getPlaceDetails(placeId);
                                        if (details) {
                                            // Update the place in currentPlaces with full details
                                            Object.assign(place, details.result);
                                            place.detailsFetched = true;

                                            // Update the card with new details
                                            const updatedCard = this._createPlaceCard(place);
                                            card.replaceWith(updatedCard);
                                            
                                            // Re-observe the new card
                                            this._currentIntersectionObserver.observe(updatedCard);
                                        }
                                    } catch (error) {
                                        console.error('Error fetching place det
                                            ails:', error);
                                    }
                                }
                            }
                        } else {
                            // When card scrolls out of view, remove highlight from both marker and card
                            const el = this._markerManager._markers.get(placeId)?.getElement();
                            if (el) {
                                el.classList.remove('selected');
                            }
                            this._carousel.clearSelection(placeId);
                        }
                    }
                },
                {
                    root: placesScroll,
                    threshold: 0.5
                }
            );
    
            // Observe all cards
            placesScroll.querySelectorAll('.place-card').forEach(card => {
                this._currentIntersectionObserver.observe(card);
            });
        }
    
        // For desktop, we'll rely on hover/click handlers which are already set up
    }

    handlePlaceClick(place) {
        // Just use the place route without appending current route
        window.location.hash = `place?id=${place.place_id}##`;
    }

    async _showPlaceDetails(place) {
        // Remove any existing sheets first
        const existingSheet = document.querySelector('.place-details-sheet');
        const existingBackdrop = document.querySelector('.place-details-backdrop');
        if (existingSheet) existingSheet.parentElement.removeChild(existingSheet);
        if (existingBackdrop) existingBackdrop.parentElement.removeChild(existingBackdrop);

        // Create new sheet
        document.body.insertAdjacentHTML('beforeend', this.sheetTemplate);

        // Get sheet and details container
        const sheet = document.querySelector('.place-details-sheet');
        const backdrop = document.querySelector('.place-details-backdrop');
        const detailsDiv = sheet.querySelector('.details');

        // Add close handlers if they don't exist
        if (!sheet.closeHandlersAdded) {
            const closeButton = sheet.querySelector('.close-button');
            
            const closeSheet = () => {
                sheet.classList.remove('active');
                backdrop.classList.remove('active');
                
                // Remove the elements after animation
                setTimeout(() => {
                    sheet.parentElement.removeChild(sheet);
                    backdrop.parentElement.removeChild(backdrop);
                }, 300);
            };

            [closeButton, backdrop].forEach(el => {
                el.addEventListener('click', closeSheet);
            });

            sheet.closeHandlersAdded = true;
        }

        // Fetch the detailed place data first
        const details = await PlaceDetailsPage.getPlaceDetails(place.place_id);
        if (!details) {
            console.error('Failed to fetch place details');
            return;
        }

        // Update content
        detailsDiv.innerHTML = `
            ${place.photos && place.photos.length > 0 ? `
                <div class="place-image">
                    <img 
                        src="https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${place.photos[0].photo_reference}&key=${this.serverKey || this._mapService._googleApiKey}"
                        alt="${place.name}"
                        loading="lazy"
                        class="w-full h-48 object-cover"
                    >
                </div>
            ` : ''}
            <!-- Rest of the content -->
        `;
    }

    // Add method to update configuration
    updateConfig(newConfig) {
        this._config = {
            ...this._config,
            ...newConfig
        };
        
        // Refetch places with new config if we have a location
        const location = this._locationService.getMapLocation();
        if (location) {
            this._fetchNearbyPlaces(location);
        }
    }

    _findMatchingPlace(searchPlace) {
        return this._currentPlaces.find(place => {
            const nameMatch = place.name.toLowerCase() === searchPlace.name.toLowerCase();
            const locationMatch = this._isNearby(
                place.geometry.location,
                searchPlace.location,
                50 // meters threshold
            );
            return nameMatch && locationMatch;
        });
    }

    _isNearby(placeLocation, searchLocation, threshold) {
        const distance = this._calculateDistance(
            placeLocation.lat,
            placeLocation.lng,
            searchLocation.lat,
            searchLocation.lng
        );
        return distance <= threshold;
    }

    async initialize() {
        // Set up intersection observer
        this._setupIntersectionObserver();
        
        // ... rest of initialization ...
    }

    _setupIntersectionObserver() {
        // Clean up existing observer if it exists
        if (this._currentIntersectionObserver) {
            this._currentIntersectionObserver.disconnect();
        }

        this._currentIntersectionObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const placeId = entry.target.dataset.placeId;
                        if (placeId) {
                            this._mapService.selectMarker(placeId);
                        }
                    }
                });
            },
            {
                root: null,
                rootMargin: '0px',
                threshold: 0.5
            }
        );

        // Observe all place cards
        document.querySelectorAll('.place-card').forEach(card => {
            this._currentIntersectionObserver.observe(card);
        });
    }

    destroy() {
        // Clean up observer when component is destroyed
        if (this._currentIntersectionObserver) {
            this._currentIntersectionObserver.disconnect();
            this._currentIntersectionObserver = null;
        }
    }
} 

// Export showPlaceDetails for use by other components
export function showPlaceDetails(place) {
    const formattedTypes = (place.types || [])
        .filter(type => !['point_of_interest', 'establishment'].includes(type))
        .map(type => type.replace(/_/g, ' '))
        .join(', ') || 'Business';

    const content = `
        ${place.photos && place.photos.length > 0 ? `
        <div class="photos">
            <div class="photo-grid">
                ${place.photos.map(photo => `
                    <img 
                        src="https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${photo.photo_reference}&key=${mapService._googleApiKey}"
                        alt="${place.name}"
                        loading="lazy"
                    >
                `).join('')}
            </div>
        </div>
        ` : ''}
        <div class="content-grid">
            <div class="main-info">
                <div class="place-type">${formattedTypes}</div>
                <h2 class="name">${place.name || 'Unnamed Location'}</h2>
            </div>

            <div class="info-row">
                <span class="material-icons">schedule</span>
                ${place.opening_hours?.open_now !== undefined
                    ? `<span class="${place.opening_hours.open_now ? 'open' : 'closed'}">${place.opening_hours.open_now ? 'OPEN' : 'CLOSED'}</span>`
                    : `<span class="unknown">Status unknown</span>`
                }
            </div>

            <div class="info-row">
                <span class="material-icons">place</span>
                <span>${place.vicinity || 'Address not available'}</span>
            </div>

            ${place.rating ? `
                <div class="info-row">
                    <span class="material-icons">star</span>
                    <span>${place.rating} ⭐️ (${place.user_ratings_total || 0})</span>
                </div>
            ` : ''}
        </div>
    `;

    sheetComponent.show(content, {
        maxHeight: '90vh',
        closeOnSwipe: true,
        closeOnBackdrop: true,
        className: 'place-details-sheet'
    });
}
