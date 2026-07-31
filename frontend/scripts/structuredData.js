// frontend/scripts/structuredData.js

/**
 * Inject JSON-LD structured data into product page
 */
function injectProductStructuredData(product) {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": product.name,
        "description": product.description || product.shortDescription || "",
        "image": product.imageUrl || product.images?.[0] || "",
        "sku": product.sku || product.id,
        "mpn": product.mpn || product.id,
        "brand": {
            "@type": "Brand",
            "name": product.brand || "AnthropicBots"
        },
        "offers": {
            "@type": "Offer",
            "url": `${window.location.origin}/product/${product.id}`,
            "priceCurrency": "INR",
            "price": product.price,
            "priceValidUntil": new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
            "availability": product.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            "seller": {
                "@type": "Organization",
                "name": "AnthropicBots E-Commerce"
            }
        },
        "category": product.category,
        "aggregateRating": product.avgRating ? {
            "@type": "AggregateRating",
            "ratingValue": product.avgRating,
            "reviewCount": product.reviewCount || 0
        } : undefined
    });
    document.head.appendChild(script);
}

/**
 * Inject organization structured data
 */
function injectOrganizationStructuredData() {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "AnthropicBots E-Commerce",
        "url": window.location.origin,
        "logo": `${window.location.origin}/assets/images/logo.png`,
        "description": "AnthropicBots - Your trusted e-commerce platform.",
        "contactPoint": {
            "@type": "ContactPoint",
            "contactType": "customer service",
            "availableLanguage": ["English", "Hindi"]
        }
    });
    document.head.appendChild(script);
}

/**
 * Inject breadcrumb structured data
 */
function injectBreadcrumbStructuredData(items) {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": items.map((item, index) => ({
            "@type": "ListItem",
            "position": index + 1,
            "name": item.name,
            "item": item.url
        }))
    });
    document.head.appendChild(script);
}

/**
 * Inject website structured data
 */
function injectWebSiteStructuredData() {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": "AnthropicBots E-Commerce",
        "url": window.location.origin,
        "potentialAction": {
            "@type": "SearchAction",
            "target": `${window.location.origin}/search?q={search_term_string}`,
            "query-input": "required name=search_term_string"
        }
    });
    document.head.appendChild(script);
}

// Export functions
window.StructuredData = {
    injectProductStructuredData,
    injectOrganizationStructuredData,
    injectBreadcrumbStructuredData,
    injectWebSiteStructuredData
};