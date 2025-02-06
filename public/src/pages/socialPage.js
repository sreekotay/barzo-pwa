import CDNize from '../utils/cdnize.js';

export default class SocialPage {
    constructor(mapService) {
        this._mapService = mapService;
        this._socialService = window.socialService;
        this.currentPage = 0;
        this.pageSize = 20;
        this.loading = false;
        this.hasMore = true;
    }

    async initialize() {
        const { data: personas, error } = await this._mapService._supabase
            .from('personas')
            .select('*')
            .eq('type', 'user')
            .order('created_at', { ascending: false })
            .range(0, this.pageSize - 1);

        if (error) {
            console.error('Error loading users:', error);
            return this._renderError('Error loading users:', error.message);
        }

        this.hasMore = personas.length === this.pageSize;
        return this._renderMainLayout(personas);
    }

    _renderMainLayout(personas) {
        return `
            <div class="p-4">
                <div class="bg-white rounded-lg shadow p-4">
                    <h1 class="text-2xl font-bold mb-4">Social</h1>
                    ${this._renderSearchAndFilters()}
                    ${this._renderResultsList(personas)}
                    ${this._renderLoadMoreButton()}
                </div>
            </div>
        `;
    }

    _renderSearchAndFilters() {
        return `
            <div class="mb-6">
                <input type="text" 
                    placeholder="Search people..." 
                    class="w-full p-2 border rounded-lg"
                    id="social-search">
                <div class="flex gap-2 mt-2">
                    <button class="px-3 py-1 bg-gray-100 rounded-full text-sm" data-filter="all">All</button>
                    <button class="px-3 py-1 bg-gray-100 rounded-full text-sm" data-filter="following">Following</button>
                    <button class="px-3 py-1 bg-gray-100 rounded-full text-sm" data-filter="blocked">Blocked</button>
                </div>
            </div>
        `;
    }

    _renderResultsList(personas) {
        return `
            <div id="social-results" class="space-y-4">
                ${this._renderPersonas(personas)}
            </div>
        `;
    }

    _renderLoadMoreButton() {
        return this.hasMore ? `
            <div class="text-center mt-4">
                <button id="load-more" class="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200">
                    Load More
                </button>
            </div>
        ` : '';
    }

    _renderError(title, message) {
        return `
            <div class="text-red-500 p-4">
                ${title} ${message}
            </div>
        `;
    }

    _renderLoadingSpinner() {
        return `
            <div class="flex justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
            </div>
        `;
    }

    _renderNoResults(query = '') {
        return `
            <div class="text-gray-500 p-4 text-center">
                No users found ${query ? `matching "${query}"` : ''}.
            </div>
        `;
    }

    async render() {
        const html = await this.initialize();
        return html;
    }

    async afterRender() {
        // Initialize search and filters
        const searchInput = document.getElementById('social-search');
        const filterButtons = document.querySelectorAll('[data-filter]');
        const loadMoreButton = document.getElementById('load-more');
        
        // Set up event listeners
        searchInput?.addEventListener('input', (e) => this._handleSearch(e.target.value));
        filterButtons.forEach(button => {
            button.addEventListener('click', () => this._handleFilter(button.dataset.filter));
        });
        loadMoreButton?.addEventListener('click', () => this._loadMore());

        // Set up infinite scroll
        this._setupInfiniteScroll();
    }

    async _handleSearch(query) {
        // Debounce this in production
        await this._loadResults(query);
    }

    async _handleFilter(filter) {
        // Update active filter button
        document.querySelectorAll('[data-filter]').forEach(btn => {
            btn.classList.toggle('bg-red-500', btn.dataset.filter === filter);
            btn.classList.toggle('text-white', btn.dataset.filter === filter);
            btn.classList.toggle('bg-gray-100', btn.dataset.filter !== filter);
        });

        await this._loadResults(null, filter);
    }

    async _loadResults(query = '', filter = 'all') {
        const resultsContainer = document.getElementById('social-results');
        if (!resultsContainer) return;

        if (!window.socialService) {
            resultsContainer.innerHTML = this._renderError('Please log in to view social features.');
            return;
        }

        try {
            resultsContainer.innerHTML = this._renderLoadingSpinner();

            const personas = await window.socialService.searchPersonas({
                query,
                type: 'user',
                filter
            });

            if (!personas.length) {
                resultsContainer.innerHTML = this._renderNoResults(query);
                return;
            }

            resultsContainer.innerHTML = this._renderPersonas(personas);

        } catch (error) {
            console.error('Error loading results:', error);
            resultsContainer.innerHTML = this._renderError('Error loading results:', error.message);
        }
    }

    _setupInfiniteScroll() {
        const options = {
            root: null,
            rootMargin: '100px',
            threshold: 0.1
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && this.hasMore && !this.loading) {
                    this._loadMore();
                }
            });
        }, options);

        const loadMoreButton = document.getElementById('load-more');
        if (loadMoreButton) {
            observer.observe(loadMoreButton);
        }
    }

    _renderPersonas(personas) {
        return personas.map(persona => {
            const initials = (persona.metadata?.profile?.first_name?.[0] || '') + 
                           (persona.metadata?.profile?.last_name?.[0] || '');
            
            const avatarHtml = persona.avatar_url ? 
                `<img src="${CDNize.profile(persona.avatar_url)}" 
                      class="w-12 h-12 rounded-full object-cover"
                      alt="${persona.handle}">` :
                `<div class="w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 text-xl font-medium">
                    ${initials || persona.handle?.[0]?.toUpperCase() || '?'}
                </div>`;

            return `
                <div class="flex items-center py-1 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                     onclick="window.location.hash = 'profile?id=${persona.metadata?.profile?.id || 'MISSING-ID'}##'">
                    <div class="flex items-center gap-3">
                        ${avatarHtml}
                        <div>
                            <h3 class="font-medium">
                                ${persona.metadata?.profile?.first_name || ''} 
                                ${persona.metadata?.profile?.last_name || ''}
                                ${!persona.metadata?.profile?.first_name ? persona.handle : ''}
                            </h3>
                            <p class="text-sm text-gray-500">@${persona.handle}</p>
                            ${persona.metadata?.profile?.bio ? 
                                `<p class="text-sm text-gray-600 mt-1">${persona.metadata.profile.bio}</p>` 
                                : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    async _loadMore() {
        if (this.loading || !this.hasMore) return;
        
        this.loading = true;
        this.currentPage++;
        
        const start = this.currentPage * this.pageSize;
        const end = start + this.pageSize - 1;

        try {
            const { data: personas, error } = await this._mapService._supabase
                .from('personas')
                .select('*')
                .eq('type', 'user')
                .order('created_at', { ascending: false })
                .range(start, end);

            if (error) throw error;

            const resultsContainer = document.getElementById('social-results');
            resultsContainer.insertAdjacentHTML('beforeend', this._renderPersonas(personas));
            
            this.hasMore = personas.length === this.pageSize;
            const loadMoreButton = document.getElementById('load-more');
            if (loadMoreButton) {
                loadMoreButton.style.display = this.hasMore ? 'block' : 'none';
            }
        } catch (error) {
            console.error('Error loading more results:', error);
        } finally {
            this.loading = false;
        }
    }

    destroy() {
        // Clean up any event listeners or subscriptions
    }
} 