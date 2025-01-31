export default class EventsComponent {
    constructor(mapService, locationService) {
        this._mapService = mapService;
        this._locationService = locationService;
        this._container = document.querySelector('#events-container');
        this._currentEvents = [];
        this._eventbriteToken = mapService._eventBriteKey;  // Get from MapService

        // Bind methods
        this._handleLocationChange = this._handleLocationChange.bind(this);

        // Set up location change listener
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
            await this._fetchNearbyEvents(location);
        }
    }

    async _fetchNearbyEvents(location) {
        try {
            const radius = this._calculateRadius() * 2 / 3; // in meters
            const radiusMiles = Math.round(radius * 0.000621371); // convert to miles

            // Eventbrite API endpoint
            const endpoint = `https://www.eventbriteapi.com/v3/events/search/`;
            const params = new URLSearchParams({
                'location.latitude': location.lat,
                'location.longitude': location.lng,
                'location.within': `${radiusMiles}mi`,
                'expand': 'venue',
                'start_date.keyword': 'this_week'
            });

            const response = await fetch(`${endpoint}?${params}`, {
                headers: {
                    'Authorization': `Bearer ${this._eventbriteToken}`
                }
            });

            const data = await response.json();
            
            if (data.events) {
                const events = this._processEventsData(data.events);
                this._updateEventMarkers(events);
                this._updateEventsContent(events);
            }
        } catch (error) {
            console.error('Error fetching nearby events:', error);
        }
    }

    _processEventsData(events) {
        return events.map(event => ({
            id: event.id,
            name: event.name.text,
            description: event.description.text,
            start_date: new Date(event.start.local),
            end_date: new Date(event.end.local),
            url: event.url,
            venue: event.venue,
            geometry: {
                location: {
                    lat: parseFloat(event.venue.latitude),
                    lng: parseFloat(event.venue.longitude)
                }
            },
            image: event.logo?.url
        }));
    }

    _updateEventMarkers(events) {
        this._mapService.addPOIMarkers(events, {
            markerClass: 'event-marker',
            source: 'eventbrite',
            getMarkerColor: (event) => {
                const now = new Date();
                if (event.start_date > now) {
                    return '#4CAF50';  // Upcoming event
                } else if (event.end_date > now) {
                    return '#FFC107';  // Ongoing event
                } else {
                    return '#9E9E9E';  // Past event
                }
            }
        });
    }

    _calculateRadius() {
        const bounds = this._mapService.getMapBounds();
        const center = this._mapService.getMapCenter();
        const ne = bounds.getNorthEast();
        const radiusInMeters = center.distanceTo(ne);
        return Math.min(Math.max(radiusInMeters, 1), 50000);
    }

    _updateEventsContent(events) {
        // Similar to PlacesComponent's _updatePlacesContent
        // but with event-specific card layout
    }

    _createEventCard(event) {
        const card = document.createElement('div');
        card.className = 'event-card';
        card.dataset.eventId = event.id;
        
        card.innerHTML = `
            ${event.image ? `
                <div class="event-image">
                    <img src="${event.image}" alt="${event.name}" loading="lazy">
                </div>
            ` : ''}
            <div class="flex-1 px-2 pb-2">
                <div class="event-date text-sm text-gray-600">
                    ${event.start_date.toLocaleDateString()} at ${event.start_date.toLocaleTimeString()}
                </div>
                <h3 class="name">${event.name}</h3>
                <div class="venue text-sm text-gray-500">${event.venue.name}</div>
            </div>
        `;

        return card;
    }
} 