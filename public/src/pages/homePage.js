import PlacesComponent from '../components/placesComponent.js';
import locationService from '../services/locationService.js';

export default class HomePage {
    constructor(mapService) {
        this.mapService = mapService;
        this._carousels = new Map(); // Track all carousels
    }

    async render() {
        return `
            <div class="pt-4">
                <div class="flex px-4 mb-1 items-center">
                    <h3 class="text-sm font-medium text-gray-500">BARS & CLUBS</h3>
                    <div class="w-2 h-2 rounded-full bg-red-600 mx-2 opacity-0 transition-opacity duration-300" data-dot="bar"></div>
                </div>
                <div id="bar-container"></div>

                <div class="flex px-4 mb-1 items-center">
                    <h3 class="text-sm font-medium text-gray-500">RESTAURANTS</h3>
                    <div class="w-2 h-2 rounded-full bg-amber-600 mx-2 opacity-0 transition-opacity duration-300" data-dot="restaurant"></div>
                </div>
                <div id="restaurant-container"></div>

                <div class="flex px-4 mb-1 items-center">
                    <h3 class="text-sm font-medium text-gray-500">CIGAR & HOOKAH</h3>
                    <div class="w-2 h-2 rounded-full bg-purple-600 mx-2 opacity-0 transition-opacity duration-300" data-dot="cigar"></div>
                </div>
                <div id="cigar-hookah-container"></div>

                <div class="flex px-4 mb-1 items-center">
                    <h3 class="text-sm font-medium text-gray-500">KARAOKE & LIVE MUSIC</h3>
                    <div class="w-2 h-2 rounded-full bg-green-600 mx-2 opacity-0 transition-opacity duration-300" data-dot="music"></div>
                </div>
                <div id="music-container"></div>
            </div>
        `;
    }

    async afterRender() {
        // Initialize bars component
        const barsComponent = new PlacesComponent(
            this.mapService, 
            locationService, 
            '#bar-container',
            {
                placeTypes: ['bar', 'night_club'],
                maxResults: 30,
                endpoint: 'supabase',
                markerColors: {
                    open: '#DC2626',
                    closed: '#9CA3AF',
                    pulse: '#DC2626'
                },
                onExpand: () => this._handleCarouselExpand('bars')
            }
        );
        this._carousels.set('bars', barsComponent);

        // Initialize restaurants component
        const restaurantsComponent = new PlacesComponent(
            this.mapService, 
            locationService, 
            '#restaurant-container',
            {
                placeTypes: ['restaurant', 'cafe'],
                maxResults: 20,
                endpoint: 'supabase',
                markerColors: {
                    open: '#F59E0B',
                    closed: '#9CA3AF',
                    pulse: '#F59E0B'
                },
                onExpand: () => this._handleCarouselExpand('restaurants')
            }
        );
        this._carousels.set('restaurants', restaurantsComponent);

        // Initialize cigar and hookah component
        const cigarHookahComponent = new PlacesComponent(
            this.mapService,
            locationService,
            '#cigar-hookah-container',
            {
                placeTypes: ['bar'],
                maxResults: 15,
                endpoint: 'supabase',
                markerColors: {
                    open: '#9333EA',
                    closed: '#9CA3AF',
                    pulse: '#9333EA'
                },
                keywords: ['cigar', 'hookah', 'shisha'],
                onExpand: () => this._handleCarouselExpand('cigar')
            }
        );
        this._carousels.set('cigar', cigarHookahComponent);

        // Initialize karaoke and live music component
        const musicComponent = new PlacesComponent(
            this.mapService,
            locationService,
            '#music-container',
            {
                placeTypes: ['bar'],
                maxResults: 15,
                endpoint: 'supabase',
                markerColors: {
                    open: '#059669',
                    closed: '#9CA3AF',
                    pulse: '#059669'
                },
                keywords: ['karaoke', 'live music'],
                onExpand: () => this._handleCarouselExpand('music')
            }
        );
        this._carousels.set('music', musicComponent);

        // Store components in window for debugging
        window.barsComponent = barsComponent;
        window.restaurantsComponent = restaurantsComponent;
        window.cigarHookahComponent = cigarHookahComponent;
        window.musicComponent = musicComponent;

        // Wait for map to be ready before expanding bars carousel
        if (this.mapService.isMapReady()) {
            this._expandBarsCarousel();
        } else {
            this.mapService.onMapReady(() => {
                this._expandBarsCarousel();
            });
        }
    }

    _expandBarsCarousel() {
        setTimeout(() => {
            const location = locationService.getUserLocationCached();
            if (location) {
                const barsComponent = this._carousels.get('bars');
                if (barsComponent) {
                    // Pass true to indicate this is initial load
                    barsComponent._handleHeaderClick(true);
                }
            }
        }, 100);
    }

    _handleCarouselExpand(activeId) {
        console.log('Handling carousel expand:', activeId);
        // Just collapse other carousels - markers will be handled by collapse callback
        this._carousels.forEach((component, id) => {
            if (id !== activeId) {
                console.log('Collapsing carousel:', id);
                component._carousel.collapse();
            }
        });
    }

    _setupPlacesComponents() {
        // ... existing setup code ...

        // When one expands, collapse others
        const handleExpand = (expandedComponent) => {
            this._placesComponents.forEach(component => {
                if (component !== expandedComponent) {
                    component.handleExternalCollapse();
                }
            });
        };

        // Create components with onExpand handler
        this._placesComponents = [
            new PlacesComponent('#restaurants-carousel', this._locationService, this._mapService, {
                type: 'restaurant',
                onExpand: () => handleExpand(this._placesComponents[0])
            }),
            new PlacesComponent('#bars-carousel', this._locationService, this._mapService, {
                type: 'bar',
                onExpand: () => handleExpand(this._placesComponents[1])
            }),
            new PlacesComponent('#cafes-carousel', this._locationService, this._mapService, {
                type: 'cafe',
                onExpand: () => handleExpand(this._placesComponents[2])
            })
        ];
    }
} 