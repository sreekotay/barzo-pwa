import PlacesComponent from '../components/placesComponent.js';
import locationService from '../services/locationService.js';

export default class HomePage {
    constructor(mapService) {
        this.mapService = mapService;
        this._carousels = new Map(); // Track all carousels
        this._intersectionObserver = null;
    }

    async render() {
        return `
            <div class="pt-4">
                <div class="flex px-4 mb-1 items-center" data-carousel-id="bars">
                    <h3 class="text-sm font-bold text-black-800">BARS & CLUBS</h3>
                    <div class="w-2 h-2 rounded-full bg-red-600 mx-2 opacity-0 transition-opacity duration-300" data-dot="bar"></div>
                </div>
                <div id="bar-container"></div>

                <div class="flex px-4 mb-1 items-center" data-carousel-id="restaurants">
                    <h3 class="text-sm font-bold text-black-800">RESTAURANTS</h3>
                    <div class="w-2 h-2 rounded-full bg-amber-600 mx-2 opacity-0 transition-opacity duration-300" data-dot="restaurant"></div>
                </div>
                <div id="restaurant-container"></div>

                <div class="flex px-4 mb-1 items-center" data-carousel-id="cigar">
                    <h3 class="text-sm font-bold text-black-800">CIGAR & HOOKAH</h3>
                    <div class="w-2 h-2 rounded-full bg-purple-600 mx-2 opacity-0 transition-opacity duration-300" data-dot="cigar"></div>
                </div>
                <div id="cigar-hookah-container"></div>

                <div class="flex px-4 mb-1 items-center" data-carousel-id="music">
                    <h3 class="text-sm font-bold text-black-800">KARAOKE & LIVE MUSIC</h3>
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

        // Wait for map to be ready before expanding all carousels
        if (this.mapService.isMapReady()) {
            this._expandAllCarousels();
        } else {
            this.mapService.onMapReady(() => {
                this._expandAllCarousels();
            });
        }

        // Set up intersection observer for carousel containers
        this._setupCarouselObserver();
    }

    _expandAllCarousels() {
        setTimeout(() => {
            const location = locationService.getUserLocationCached();
            if (location) {
                // Expand all carousels
                this._carousels.forEach((component, id) => {
                    console.log(`Initial expansion of carousel: ${id}`);
                    component._handleHeaderClick(true);
                });
            }
        }, 100);
    }

    _handleCarouselExpand(activeId) {
        console.log('Handling carousel expand:', activeId);
        // Don't collapse other carousels anymore
        // Just ensure markers are shown only for the topmost visible one
        this._intersectionObserver.takeRecords().forEach(entry => entry.target);
    }

    _setupCarouselObserver() {
        if (this._intersectionObserver) {
            this._intersectionObserver.disconnect();
        }

        // Get the scrolling container - this is where the overflow-y: auto is set
        const scrollContainer = document.querySelector('div#main-app');
        console.log('Setting up carousel observer with container:', scrollContainer);
        if (!scrollContainer) return;

        this._intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const carouselId = entry.target.getAttribute('data-carousel-id');
                if (!carouselId) return;

                const component = this._carousels.get(carouselId);
                if (!component) return;

                const intersectionRatio = entry.intersectionRatio;
                console.log(`Intersection for ${carouselId}:`, {
                    ratio: intersectionRatio,
                    isIntersecting: entry.isIntersecting,
                    boundingRect: entry.boundingClientRect
                });

                if (intersectionRatio > 0.3) {
                    component._markerManager.showMarkers();
                } else {
                    component._markerManager.hideMarkers();
                }
            });
        }, {
            root: scrollContainer,
            threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
            rootMargin: '0px'
        });

        // Observe the carousel headers
        const headers = document.querySelectorAll('.flex[data-carousel-id]');
        headers.forEach(header => {
            this._intersectionObserver.observe(header);
        });
    }

    // Clean up when page changes
    destroy() {
        if (this._intersectionObserver) {
            this._intersectionObserver.disconnect();
            this._intersectionObserver = null;
        }
    }
} 