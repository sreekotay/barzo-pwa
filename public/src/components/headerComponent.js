export default class HeaderComponent {
    render() {
        return `
            <header class="bg-white shadow">
                <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div class="flex justify-between h-16">
                        <div class="flex">
                            <div class="flex-shrink-0 flex items-center">
                                <a href="#" class="text-xl font-bold text-gray-800">
                                    Barzo
                                </a>
                            </div>
                        </div>
                        <div class="flex items-center lg:hidden">
                            <a href="#" class="text-xl font-bold text-gray-800">
                                Barzo
                            </a>
                        </div>
                        <!-- ... rest of header ... -->
                    </div>
                </div>
            </header>
        `;
    }
} 