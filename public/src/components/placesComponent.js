import MarkerManager from '../services/markerManager.js';
import CarouselComponent from './carouselComponent.js';
import { getApiUrl } from '../services/apiService.js';

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

        this._setupComponent();
    }

    _setupComponent() {
        // Get current container using selector
        this._container = document.querySelector(this._containerSelector);
        if (!this._container) {
            console.warn(`Container not found: ${this._containerSelector}`);
            return;
        }

        // Initialize properties
        this._markerManager = new MarkerManager(this._mapService);
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
    }

    async _handleLocationChange(location) {
        // Add distance check before fetching
        const lastLocation = this._lastFetchLocation;
        const shouldFetch = !lastLocation || this._calculateDistance(
            lastLocation.lat,
            lastLocation.lng,
            location.lat,
            location.lng
        ) > 50; // 50 meters threshold

        if (location && !this._mapService._pendingSearch && shouldFetch) {
            this._lastFetchLocation = location; // Store location of last fetch
            await this._fetchNearbyPlaces(location);
        }
    }

    async _fetchNearbyPlaces(location) {
        try {
            const radius = this._calculateRadius() * 2 / 3;
            const roundedLocation = {
                lat: Math.round(location.lat * 10000) / 10000,
                lng: Math.round(location.lng * 10000) / 10000
            };

            const response = await fetch(`${PLACES_API_URL}/nearby-places?lat=${roundedLocation.lat}&lng=${roundedLocation.lng}&radius=${Math.floor(radius / 100) * 100}&type=${this._config.placeTypes[0]}`, {
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

            const places = await response.json();
            if (places) {
                const userLocation = this._locationService.getUserLocationCached();
                const processedPlaces = this._processPlacesData(places, userLocation);
                this._markerManager.updateMarkers(processedPlaces, this._config.markerColors);
                this._updatePlacesContent(processedPlaces);
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

    _updatePlacesContent(places) {
        const container = this._getContainer();
        if (!container) return;

        if (!places?.length) {
            // Just update the container directly if no places
            container.innerHTML = `
                <div class="no-places-message">
                    No places found nearby
                </div>
            `;
            return;
        }

        // Remove only the "no places" message if it exists
        const noPlacesMessage = container.querySelector('.no-places-message');
        if (noPlacesMessage) {
            noPlacesMessage.remove();
        }

        this._currentPlaces = places;
        let placesScroll = this._carousel.getOrCreateScrollContainer();

        // Get existing cards and create a map of placeId -> card
        const existingCards = new Map();
        placesScroll.querySelectorAll('.place-card').forEach(card => {
            existingCards.set(card.dataset.placeId, card);
        });

        // Update or create cards
        places.forEach(place => {
            let card = existingCards.get(place.place_id);
            if (card) {
                this._updatePlaceCard(card, place);
                existingCards.delete(place.place_id);
            } else {
                card = this._createPlaceCard(place);
                placesScroll.appendChild(card);
            }
        });

        // Remove any cards that weren't reused
        existingCards.forEach(card => card.remove());

        // Update observers and event handlers
        this._setupCardObserversAndHandlers(placesScroll);

        if (places?.length > 0) {
            this._carousel.expand();
        }

        // After UI is updated, notify map service
        this._mapService.onPlacesUpdate(places);
    }

    _createPlaceCard(place) {
        const card = document.createElement('div');
        card.className = 'place-card';
        card.dataset.placeId = place.place_id;
        card.dataset.selected = 'false';
        
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
                <div class="types-scroll nowrap"></div>
                <h3 class="name"></h3>
                <div class="flex" style="align-items: baseline;">
                    <div class="status"></div>
                    <div class="price-level text-gray-500 text-xs ml-2"></div>
                    <div class="flex-1"></div>
                    <div class="text-gray-500 text-xs pr-1"></div>
                </div>
            </div>
        `;

        this._updatePlaceCard(card, place);
        return card;
    }

    _updatePlaceCard(card, place) {
        // Add custom property for highlight color
        card.style.setProperty('--highlight-color', this._config.markerColors.open);

        // Update photo if it exists
        const existingImage = card.querySelector('.place-image img');
        if (place.photos && place.photos.length > 0) {
            const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${place.photos[0].photo_reference}&key=${this.serverKey || this._mapService._googleApiKey}`;
            if (existingImage) {
                if (existingImage.src !== photoUrl) {
                    existingImage.src = photoUrl;
                }
            } else {
                const imageDiv = document.createElement('div');
                imageDiv.className = 'place-image';
                imageDiv.innerHTML = `<img src="${photoUrl}" alt="${place.name}" loading="lazy">`;
                card.insertBefore(imageDiv, card.firstChild);
            }
        } else if (existingImage) {
            existingImage.parentElement.remove();
        }

        // Update types
        const typesDiv = card.querySelector('.types-scroll');
        const types = (place.types || [])
            .filter(type => !['point_of_interest', 'establishment'].includes(type))
            .map((type, index, array) => `
                <span class="text-gray-500 text-xs">${type.replace(/_/g, ' ')}</span>${index < array.length - 1 ? '<span class="text-gray-300"> | </span>' : ''}
            `).join('');
        if (typesDiv) {
            typesDiv.innerHTML = types;
        }

        // Update name
        const nameEl = card.querySelector('.name');
        if (nameEl) {
            nameEl.textContent = place.name;
        }

        // Update status
        const statusEl = card.querySelector('.status');
        if (statusEl) {
            statusEl.className = `status ${place.opening_hours?.open_now ? 'open' : 'closed'}`;
            statusEl.textContent = place.opening_hours?.open_now ? 'OPEN' : 'CLOSED';
        }

        // Update price level
        const priceEl = card.querySelector('.price-level');
        if (priceEl) {
            priceEl.textContent = place.price_level ? '$'.repeat(place.price_level) : '';
        }

        // Update distance
        const distanceEl = card.querySelector('.text-gray-500.text-xs.pr-1');
        if (distanceEl) {
            distanceEl.textContent = place.formattedDistance;
        }
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
        const container = this._getContainer();
        if (!container) return;

        // Create new intersection observer
        const observer = this._carousel.setupIntersectionObserver((mostVisibleCard) => {
            if (this._isUpdating) return;
            
            const placeId = mostVisibleCard.dataset.placeId;
            this._carousel.selectCard(placeId);
            this._markerManager.selectMarker(placeId);
        });

        // Add click and hover handlers to cards
        placesScroll.querySelectorAll('.place-card').forEach(card => {
            // Add hover handlers for desktop
            if (!this._carousel.isMobile()) {
                card.addEventListener('mouseenter', () => {
                    if (this._isUpdating) return;
                    
                    const placeId = card.dataset.placeId;
                    this._carousel.selectCard(placeId);
                    this._markerManager.selectMarker(placeId);
                });

                // Add mouseleave to clear selection
                card.addEventListener('mouseleave', () => {
                    if (this._isUpdating) return;
                    
                    this._carousel.clearSelection();
                    this._markerManager.selectMarker(null);
                });
            }
            
            // Add click handler for both mobile and desktop
            card.addEventListener('click', () => {
                if (this._isUpdating) return;
                
                const placeId = card.dataset.placeId;
                console.log('🎯 Card clicked:', placeId);
                this._markerManager.selectMarker(placeId);
                
                this._scrollCardIntoView(placeId);
                
                const place = this._currentPlaces.find(p => p.place_id === placeId);
                if (place) {
                    this.handlePlaceClick(place);
                }
            });
        });
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
        const details = await this._fetchPlaceDetails(place.place_id);
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

    async _fetchPlaceDetails(placeId) {
        try {
            const response = await fetch(`${PLACES_API_URL}/nearby-places?placeId=${placeId}`, {
                headers: {
                    'X-API-Key': 'TESTING_KEY_wNTrO9zYD8cU__Pzmbs0fid80_EIqzhp7tW_FCpADDo',
                    'Content-Type': 'application/json'
                },
                mode: 'cors'
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('Places Details API Error:', {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorData
                });
                throw new Error(errorData.error || errorData.message || 'Failed to fetch place details');
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Error fetching place details:', error);
            return null;
        }
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
