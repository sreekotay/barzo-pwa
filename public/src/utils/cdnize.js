export default class CDNize {
    static url(originalUrl, options = 'w=300&h=300&func=crop&org_if_sml=1') {
        if (!originalUrl) return '';
        return `https://czqhqqkowa.cloudimg.io/${originalUrl}?${options}`;
    }

    // Convenience method for common image operations
    static image(originalUrl) {
        return this.url(originalUrl);
    }

    // Convenience method for profile pictures
    static profile(originalUrl) {
        return this.url(originalUrl);
    }

    // Convenience method for banners
    static banner(originalUrl) {
        return this.url(originalUrl);
    }
} 