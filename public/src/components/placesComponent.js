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
                this._updatePlacesContent(places);
            }
        } catch (error) {
            console.error('Error fetching nearby places:', error);
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

    updatePlaces(places, config = {}) {
        console.log('📦 Places update from:', config.event, config.source);
        if (config.location) this._fetchNearbyPlaces(config.location);
    }

    // Split out the content update logic
    _updatePlacesContent(places) {
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

        // Get or create places-scroll container
        let placesScroll = this._container.querySelector('.places-scroll');
        if (!placesScroll) {
            console.log('📍 Creating new places-scroll container');
            placesScroll = document.createElement('div');
            placesScroll.className = 'places-scroll pb-2';
            placesScroll.innerHTML = '<div class="w-1" style="flex-shrink: 0;"></div>';
            this._container.appendChild(placesScroll);
        }

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
    }

    _createPlaceCard(place) {
        const card = document.createElement('div');
        card.className = 'place-card';
        card.dataset.placeId = place.place_id;
        card.style.flexShrink = '1';
        
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
        const card = document.querySelector(`.place-card[data-place-id="${placeId}"]`);
        const scrollContainer = document.querySelector('.places-scroll');
        if (!card || !scrollContainer) return;

        console.log('🔄 Starting programmatic scroll');
        
        this._isProgrammaticScroll = true;
        this._isTransitioning = true;
        this._lastScrollTime = Date.now();
        
        scrollContainer.scrollTo({
            behavior: 'smooth',
            left: card.getBoundingClientRect().left - 16 + scrollContainer.scrollLeft,
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

        this._scrollCardIntoView(place.place_id);
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

        // Only use intersection observer on mobile
        const isMobile = window.innerWidth < 1024;
        
        if (isMobile) {
            // Create new observer for mobile
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

            // Observe cards for mobile
            placesScroll.querySelectorAll('.place-card').forEach(card => {
                observer.observe(card);
            });

            this._currentIntersectionObserver = observer;
        }

        // Add click and hover handlers to cards
        placesScroll.querySelectorAll('.place-card').forEach(card => {
            // Add hover handlers for desktop
            if (!isMobile) {
                card.addEventListener('mouseenter', () => {
                    if (this._isUpdating) return;
                    this._isUpdating = true;
                    
                    const placeId = card.dataset.placeId;
                    document.querySelectorAll('.place-card').forEach(c => {
                        c.dataset.selected = (c.dataset.placeId === placeId).toString();
                    });
                    this._mapService.selectMarker(placeId);
                    
                    this._isUpdating = false;
                });

                // Add mouseleave to clear selection
                card.addEventListener('mouseleave', () => {
                    if (this._isUpdating) return;
                    this._isUpdating = true;
                    
                    document.querySelectorAll('.place-card').forEach(c => {
                        c.dataset.selected = "false";
                    });
                    this._mapService.selectMarker(null);
                    
                    this._isUpdating = false;
                });
            }
            
            // Add click handler for both mobile and desktop
            card.addEventListener('click', () => {
                if (this._isUpdating) return;
                this._isUpdating = true;
                
                const placeId = card.dataset.placeId;
                console.log('🎯 Card clicked:', placeId);
                this._mapService.selectMarker(placeId);
                
                this._scrollCardIntoView(placeId);
                
                const place = this._currentPlaces.find(p => p.place_id === placeId);
                if (place) {
                    this._showPlaceDetails(place);
                }
                
                this._isUpdating = false;
            });
        });
    }

    async _showPlaceDetails(place) {
        const card = document.querySelector(`.place-card[data-place-id="${place.place_id}"]`);
        if (!card) return;

        try {
            // Select this card and marker
            document.querySelectorAll('.place-card').forEach(c => {
                c.dataset.selected = (c === card).toString();
            });
            this._mapService.selectMarker(place.place_id);
            
            // Scroll card into view with a small delay for smooth transition
            setTimeout(() => {
                this._scrollCardIntoView(place.place_id);
            }, 250);

            // Fetch place details
            const response = await fetch('https://twxkuwesyfbvcywgnlfe.supabase.co/functions/v1/google-places-search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    placeId: place.place_id
                })
            });

            const detailsData = await response.json();
            const details = detailsData.result;

            if (!details) {
                throw new Error('No details returned');
            }

            // Get current day name in lowercase
            const today = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];
            
            // Show bottom sheet with the same formatted content we had in the expanded card
            const sheet = document.querySelector('.place-details-sheet');
            const detailsDiv = sheet.querySelector('.details');
            
            detailsDiv.innerHTML = `
                ${place.photos && place.photos.length > 0 ? `
                    <div class="place-image">
                        <img 
                            src="https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${place.photos[0].photo_reference}&key=${this._mapService._googleApiKey}"
                            alt="${place.name}"
                            loading="lazy"
                            class="w-full h-48 object-cover"
                        >
                    </div>
                ` : ''}
                
                <div class="p-4">
                    <div class="types-scroll nowrap mb-1">
                        ${(place.types || [])
                            .filter(type => !['point_of_interest', 'establishment'].includes(type))
                            .map(type => `
                                <span class="text-gray-500 text-xs">${type.replace(/_/g, ' ')}</span>
                            `).join('<span class="text-gray-300 text-xs mx-1">|</span>')}
                    </div>
                    
                    <h2 class="text-xl font-semibold">${place.name}</h2>
                    
                    <div class="flex items-center gap-2 mb-4">
                        <div class="status ${place.opening_hours?.open_now ? 'open' : 'closed'}">
                            ${place.opening_hours?.open_now ? 'OPEN' : 'CLOSED'}
                        </div>
                        ${place.price_level ? `
                            <div class="text-gray-500 text-xs">${'$'.repeat(place.price_level)}</div>
                        ` : ''}
                        ${place.formattedDistance ? `
                            <div class="text-gray-500 text-xs">${place.formattedDistance}</div>
                        ` : ''}
                    </div>

                    <div class="border-t border-gray-200 -mx-4"></div>
                </div>

                <div class="px-4 pb-4">
                    ${details.editorial_summary?.overview ? `
                        <div class="text-gray-900 text-sm mb-4">
                            ${details.editorial_summary.overview}
                        </div>
                    ` : ''}

                    <div class="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                        <div class="font-medium text-gray-400">NEIGHBORHOOD</div>
                        <div class="text-gray-900">${
                            details.address_components?.find(c => c.types.includes('neighborhood'))?.long_name || 
                            'Location not specified'
                        }</div>

                        <div class="font-medium text-gray-400">ADDRESS</div>
                        <div class="text-gray-900">${details.vicinity}</div>

                        <div class="font-medium text-gray-400">STATUS</div>
                        <div class="text-gray-900">
                            ${details.current_opening_hours?.open_now ? 
                                '<span class="text-green-600 font-medium">Open Now</span>' : 
                                '<span class="text-red-600 font-medium">Closed</span>'
                            }
                        </div>
                        ${details.current_opening_hours?.weekday_text.map(day => {
                            const [dayName, hours] = day.split(': ');
                            return `<div class="text-gray-400 justify-self-end">${dayName.slice(0,3)}</div>
                                    <div class="text-gray-900">${hours}</div>`;
                        }).join('')}

                        ${place.hours ? `
                            <div class="font-medium text-gray-400">HOURS</div>
                            <div class="text-gray-600 space-y-0.5">
                                ${Object.entries(place.hours).map(([day, ranges]) => {
                                    const timeRanges = ranges?.map(range => {
                                        const start = range.start.replace(/(\d{2})(\d{2})/, '$1:$2');
                                        const end = range.end.replace(/(\d{2})(\d{2})/, '$1:$2');
                                        return `${start}-${end}`;
                                    }).join(', ') || 'Closed';
                                    return `<div class="${day === today ? 'font-medium' : ''}">${day.slice(0,2).toUpperCase()}: ${timeRanges}</div>`;
                                }).join('')}
                            </div>
                        ` : ''}

                        ${details.serves_breakfast || details.serves_lunch || details.serves_dinner ? `
                            <div class="font-medium text-gray-400">SERVES</div>
                            <div class="flex flex-wrap gap-1">
                                ${details.serves_breakfast ? '<span class="text-gray-600">Breakfast</span>' : ''}
                                ${details.serves_lunch ? '<span class="text-gray-600">Lunch</span>' : ''}
                                ${details.serves_dinner ? '<span class="text-gray-600">Dinner</span>' : ''}
                                ${details.serves_brunch ? '<span class="text-gray-600">Brunch</span>' : ''}
                            </div>
                        ` : ''}

                        ${details.price_level ? `
                            <div class="font-medium text-gray-400">PRICE</div>
                            <div class="text-gray-900">${'$'.repeat(details.price_level)}</div>
                        ` : ''}

                        ${details?.formatted_phone_number ? `
                            <div class="font-medium text-gray-400">CONTACT</div>
                            <div>
                                <a href="tel:${details.formatted_phone_number}" class="text-blue-600 hover:text-blue-800">
                                    ${details.formatted_phone_number}
                                </a>
                            </div>
                        ` : ''}

                        ${details?.website ? `
                            <div class="font-medium text-gray-400">WEBSITE</div>
                            <div>
                                <a href="${details.website}" target="_blank" class="text-blue-600 hover:text-blue-800">
                                    ${new URL(details.website).hostname}
                                </a>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;

            // Show the bottom sheet
            sheet.classList.add('active');
            document.querySelector('.place-details-backdrop').classList.add('active');

        } catch (error) {
            console.error('Error fetching place details:', error);
            this._mapService.selectMarker(null);
        }
    }
} 