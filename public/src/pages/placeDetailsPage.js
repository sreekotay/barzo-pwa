import sheetComponent from '../components/sheetComponent.js';

const PLACES_API_URL = 'https://nearby-places-worker.sree-35c.workers.dev'; // prod
//const PLACES_API_URL = 'http://localhost:8787'; // debug

export default class PlaceDetailsPage {
    constructor(mapService) {
        this.mapService = mapService;

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
    }

    async getPlaceDetails(placeId) {
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

            return await response.json();
        } catch (error) {
            console.error('Error fetching place details:', error);
            throw error;
        }
    }

    async render(placeId) {
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
                window.router.closeSheet();
                
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
        const details = await this.getPlaceDetails(placeId);
        if (!details) {
            console.error('Failed to fetch place details');
            return;
        }

        // Get current day name in lowercase
        const today = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];
        
        // Update content
        detailsDiv.innerHTML = `
            ${details.photos && details.photos.length > 0 ? `
                <div class="place-image">
                    <img 
                        src="https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${details.photos[0].photo_reference}&key=${this.mapService._googleApiKey}"
                        alt="${details.name}"
                        loading="lazy"
                        class="w-full h-48 object-cover"
                    >
                </div>
            ` : ''}
            
            <div class="p-4">
                <div class="types-scroll nowrap mb-1">
                    ${(details.types || [])
                        .filter(type => !['point_of_interest', 'establishment'].includes(type))
                        .map(type => `
                            <span class="text-gray-500 text-xs">${type.replace(/_/g, ' ')}</span>
                        `).join('<span class="text-gray-300 text-xs mx-1">|</span>')}
                </div>
                
                <h2 class="text-xl font-semibold">${details.name}</h2>
                
                <div class="flex items-center gap-2 mb-4">
                    <div class="status ${details.current_opening_hours?.open_now ? 'open' : 'closed'}">
                        ${details.current_opening_hours?.open_now ? 'OPEN' : 'CLOSED'}
                    </div>
                    ${details.price_level ? `
                        <div class="text-gray-500 text-xs">${'$'.repeat(details.price_level)}</div>
                    ` : ''}
                    ${details.formattedDistance ? `
                        <div class="text-gray-500 text-xs">${details.formattedDistance}</div>
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
                    <div class="text-gray-900">${details.formatted_address || details.vicinity}</div>

                    <div class="font-medium text-gray-400">STATUS</div>
                    <div class="text-gray-900">
                        ${details.current_opening_hours?.open_now ? 
                            '<span class="text-green-600 font-medium">Open Now</span>' : 
                            '<span class="text-red-600 font-medium">Closed</span>'
                        }
                    </div>
                    ${details.current_opening_hours?.weekday_text?.map(day => {
                        const [dayName, hours] = day.split(': ');
                        return `<div class="text-gray-400 justify-self-end">${dayName.slice(0,3)}</div>
                                <div class="text-gray-900">${hours}</div>`;
                    }).join('')}

                    ${details.hours ? `
                        <div class="font-medium text-gray-400">HOURS</div>
                        <div class="text-gray-600 space-y-0.5">
                            ${Object.entries(details.hours).map(([day, ranges]) => {
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

        // Reset animation state without triggering close handler
        sheet.classList.remove('active');
        backdrop.classList.remove('active');

        // Force reflow
        void sheet.offsetHeight;

        // Show the sheet again
        requestAnimationFrame(() => {
            sheet.classList.add('active');
            backdrop.classList.add('active');
        });
    }
} 