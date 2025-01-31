export default class PlacesComponent {
    constructor(mapService, locationService) {
        this._mapService = mapService;
        this._locationService = locationService;
        this._container = document.querySelector('#places-container');
        console.log('📦 Places container found:', this._container);
        this._currentPlaces = [];
        this._currentIntersectionObserver = null;
        this._isUpdating = false;
        this._lastScrollTime = 0;
        this._isProgrammaticScroll = false;
        this._isTransitioning = false;
        this._nearbyPlaces = 30;
        this._placesEndpoint = 'supabase';

        // Bind methods
        this.updatePlaces = this.updatePlaces.bind(this);
        this._handleMarkerClick = this._handleMarkerClick.bind(this);
        this._handleLocationChange = this._handleLocationChange.bind(this);

        // Set up listeners
        this._mapService.onPlacesChange(this.updatePlaces);
        this._mapService.onMarkerClick(this._handleMarkerClick);
        this._locationService.onMapLocationChange(
            this._handleLocationChange,
            {
                realtime: false,
                debounceMs: 1000
            }
        );
    }

    async _handleLocationChange(location) {
        if (location) {
            await this._fetchNearbyPlaces(location);
        }
    }

    async _fetchNearbyPlaces(location) {
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
                    maxResults: this._nearbyPlaces
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
            
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();
            
            if (data.results) {
                const userLocation = this._locationService.getUserLocationCached();
                const places = this._processPlacesData(data.results, userLocation);
                this._mapService.updateMarkers(places);
                this.updatePlaces(places);
            }
        } catch (error) {
            console.error('Error fetching nearby places:', error);
        }
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

            return {
                ...place,
                distance,
                formattedDistance
            };
        }).sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
    }

    _calculateRadius() {
        const bounds = this._mapService.getMapBounds();
        const center = this._mapService.getMapCenter();
        const ne = bounds.getNorthEast();
        const radiusInMeters = center.distanceTo(ne);
        return Math.min(Math.max(radiusInMeters, 1), 50000);
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

    updatePlaces(places) {
        this._container = document.querySelector('#places-container');
        console.log('📦 Updating places container:', this._container, 'with', places?.length, 'places');

        if (!this._container) {
            console.log('No places container found');
            return;
        }

        if (!places || places.length === 0) {
            console.log('No places data received');
            this._container.style.height = '0';
            this._container.innerHTML = '<p>No places found nearby</p>';
            return;
        }

        this._currentPlaces = places;
        console.log('📍 Updating places container with', places.length, 'places');

        let placesScroll = this._container.querySelector('.places-scroll');
        if (!placesScroll) {
            console.log('📍 Creating new places-scroll container');
            placesScroll = document.createElement('div');
            placesScroll.className = 'places-scroll pb-2';
            placesScroll.innerHTML = '<div class="w-1" style="flex-shrink: 0;"></div>';
            this._container.innerHTML = '';
            this._container.appendChild(placesScroll);
        }

        // Get existing cards and create a map of placeId -> card
        const existingCards = new Map();
        placesScroll.querySelectorAll('.place-card').forEach(card => {
            existingCards.set(card.dataset.placeId, card);
        });
        console.log('📍 Found', existingCards.size, 'existing cards');

        // Update or create cards
        places.forEach(place => {
            let card = existingCards.get(place.place_id);
            if (card) {
                console.log('📍 Updating existing card for', place.name);
                this._updatePlaceCard(card, place);
                existingCards.delete(place.place_id);
            } else {
                console.log('📍 Creating new card for', place.name);
                card = this._createPlaceCard(place);
                placesScroll.appendChild(card);
            }
        });

        // Remove any cards that weren't reused
        existingCards.forEach(card => {
            console.log('📍 Removing unused card', card.dataset.placeId);
            card.remove();
        });

        // Update observers and event handlers
        this._setupCardObserversAndHandlers(placesScroll);
    }

    _createPlaceCard(place) {
        const card = document.createElement('div');
        card.className = 'place-card';
        card.dataset.placeId = place.place_id;
        
        // Create the basic structure
        card.innerHTML = `
            ${place.photos && place.photos.length > 0 ? `
                <div class="place-image">
                    <img 
                        src="https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${place.photos[0].photo_reference}&key=${this._mapService._googleApiKey}"
                        alt="${place.name}"
                        loading="lazy"
                    >
                </div>
            ` : ''}
            <div class="flex-1 px-2 pb-2">
                <div class="types-scroll nowrap"></div>
                <h3 class="name"></h3>
                <div class="flex" style="align-items: baseline;">
                    <div class="status"></div>
                    <div class="flex-1"></div>
                    <div class="text-gray-500 text-xs pr-1"></div>
                </div>
            </div>
        `;

        this._updatePlaceCard(card, place);
        return card;
    }

    _updatePlaceCard(card, place) {
        // Update photo if it exists
        const existingImage = card.querySelector('.place-image img');
        if (place.photos && place.photos.length > 0) {
            const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${place.photos[0].photo_reference}&key=${this._mapService._googleApiKey}`;
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

        // Update distance
        const distanceEl = card.querySelector('.text-gray-500.text-xs.pr-1');
        if (distanceEl) {
            distanceEl.textContent = place.formattedDistance;
        }
    }

    _handleMarkerClick(place) {
        if (this._isUpdating) return;
        this._isUpdating = true;

        // Disconnect observer before any changes
        if (this._currentIntersectionObserver) {
            this._currentIntersectionObserver.disconnect();
        }

        // Update card borders and scroll
        document.querySelectorAll('.place-card').forEach(card => {
            card.dataset.selected = (card.dataset.placeId === place.place_id).toString();
        });

        const card = document.querySelector(`.place-card[data-place-id="${place.place_id}"]`);
        if (card) {
            this._lastScrollTime = Date.now();
            this._scrollIntoViewWithOffset(card, document.querySelector('.places-scroll'), 16);
        }

        this._mapService.selectMarker(place.place_id);

        // Re-observe after a delay
        setTimeout(() => {
            if (this._currentIntersectionObserver) {
                document.querySelectorAll('.place-card').forEach(card => {
                    this._currentIntersectionObserver.observe(card);
                });
            }
            this._isUpdating = false;
        }, 100);
    }

    _setupCardObserversAndHandlers(placesScroll) {
        // Cleanup any existing observer
        if (this._currentIntersectionObserver) {
            this._currentIntersectionObserver.disconnect();
        }

        // Create new observer
        const observer = new IntersectionObserver(
            (entries) => {
                if (this._isProgrammaticScroll || this._isTransitioning) return;
                const now = Date.now();
                if (now - this._lastScrollTime < 2000) return;

                let maxRatio = 0;
                let mostVisibleCard = null;

                entries.forEach(entry => {
                    if (entry.intersectionRatio > maxRatio) {
                        maxRatio = entry.intersectionRatio;
                        mostVisibleCard = entry.target;
                    }
                });

                if (mostVisibleCard && maxRatio > 0.5) {
                    const placeId = mostVisibleCard.dataset.placeId;
                    console.log('👁️ Observer selecting:', placeId);
                    
                    this._isUpdating = true;
                    document.querySelectorAll('.place-card').forEach(card => {
                        card.dataset.selected = (card.dataset.placeId === placeId).toString();
                    });
                    this._mapService.selectMarker(placeId);
                    this._isUpdating = false;
                }
            },
            {
                root: placesScroll,
                threshold: [0, 0.25, 0.5, 0.75, 1],
                rootMargin: '-10% 0px -10% 0px'
            }
        );

        // Add click handlers and observe cards
        placesScroll.querySelectorAll('.place-card').forEach(card => {
            observer.observe(card);
            
            card.addEventListener('click', () => {
                if (this._isUpdating) return;
                this._isUpdating = true;
                
                const placeId = card.dataset.placeId;
                console.log('🎯 Card clicked:', placeId);
                this._mapService.selectMarker(placeId);
                
                this._scrollIntoViewWithOffset(card, placesScroll, 16);
                
                const place = this._currentPlaces.find(p => p.place_id === placeId);
                if (place) {
                    this._showPlaceDetails(place);
                }
                
                this._isUpdating = false;
            });
        });

        this._currentIntersectionObserver = observer;
    }

    _scrollIntoViewWithOffset(el, scrollContainer, offset) {
        console.log('🔄 Starting programmatic scroll');
        
        this._isProgrammaticScroll = true;
        this._isTransitioning = true;
        this._lastScrollTime = Date.now();
        
        scrollContainer.scrollTo({
            behavior: 'smooth',
            left: el.getBoundingClientRect().left - offset + scrollContainer.scrollLeft,
        });
        
        const checkScrollEnd = () => {
            const currentScroll = scrollContainer.scrollLeft;
            
            setTimeout(() => {
                if (currentScroll === scrollContainer.scrollLeft) {
                    console.log('🔄 Ending programmatic scroll');
                    this._isProgrammaticScroll = false;
                    
                    setTimeout(() => {
                        this._isTransitioning = false;
                    }, 500);
                } else {
                    checkScrollEnd();
                }
            }, 50);
        };
        
        checkScrollEnd();
    }

    _showPlaceDetails(place) {
        const sheet = document.querySelector('.place-details-sheet');
        const backdrop = document.querySelector('.place-details-backdrop');
        const detailsDiv = sheet.querySelector('.details');
        
        // Format types for display
        const formattedTypes = (place.types || [])
            .filter(type => !['point_of_interest', 'establishment'].includes(type))
            .map(type => type.replace(/_/g, ' '))
            .join(', ') || 'Business';
        
        // Build the content HTML
        let contentHTML = `
            ${place.photos && place.photos.length > 0 ? `
                <div class="photos">
                    <div class="photo-grid">
                        ${place.photos.map(photo => `
                            <img 
                                src="https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${photo.photo_reference}&key=${this._mapService._googleApiKey}"
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

        detailsDiv.innerHTML = contentHTML;
        sheet.classList.add('active');
        backdrop.classList.add('active');
    }
} 