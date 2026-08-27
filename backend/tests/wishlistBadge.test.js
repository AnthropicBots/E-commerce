'use strict';

/**
 * The wishlist counter was fully implemented in script and fully styled in two
 * stylesheets, and the <span id="wishlist-badge"> it needed existed in no
 * markup in the repository. updateWishlistCount() therefore returned early on
 * every call and the shopper never saw how many items they had saved, while
 * the cart badge beside it in the same nav worked.
 *
 * These tests pin the markup, the styling contract and the refresh path so the
 * three cannot drift apart again.
 */

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');

const navbar = fs.readFileSync(path.join(FRONTEND, 'components', 'navbar.html'), 'utf8');
const componentsCss = fs.readFileSync(path.join(FRONTEND, 'styles', 'components.css'), 'utf8');
const baseCss = fs.readFileSync(path.join(FRONTEND, 'styles', 'base.css'), 'utf8');
const uiJs = fs.readFileSync(path.join(FRONTEND, 'scripts', 'ui.js'), 'utf8');
const utilsJs = fs.readFileSync(path.join(FRONTEND, 'scripts', 'utils.js'), 'utf8');

/** Extract the body of a CSS rule by selector. */
function ruleFor(css, selector) {
    const index = css.indexOf(selector);
    if (index === -1) {
        return null;
    }

    const open = css.indexOf('{', index);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
}

describe('desktop wishlist badge markup', () => {
    it('declares the badge the script updates', () => {
        expect(navbar).toMatch(/id="wishlist-badge"/);
    });

    it('sits inside the wishlist link, not somewhere else in the nav', () => {
        const link = navbar.slice(
            navbar.indexOf('class="wishlist-link"'),
            navbar.indexOf('class="cart-link"')
        );

        expect(link).toMatch(/id="wishlist-badge"/);
        expect(link).toMatch(/wishlist\.html/);
    });

    it('is wrapped in a positioning context like the cart badge is', () => {
        expect(navbar).toMatch(/class="wishlist-icon-wrapper"/);
        expect(ruleFor(componentsCss, '.wishlist-icon-wrapper')).toMatch(/position:\s*relative/);
    });

    it('keeps an accessible label', () => {
        expect(navbar).toMatch(/id="wishlist-badge"\s+aria-label="Wishlist items count"/);
    });

    it('does not disturb the cart badge next to it', () => {
        expect(navbar).toMatch(/id="cart-badge"/);
        expect(navbar).toMatch(/class="cart-icon-wrapper"/);
    });
});

describe('mobile wishlist badge markup', () => {
    it('declares a badge in the mobile drawer, as the cart row already had', () => {
        expect(navbar).toMatch(/id="mobile-wishlist-badge"/);
        expect(navbar).toMatch(/id="mobile-cart-badge"/);
    });

    it('reuses the existing mobile-badge class rather than inventing styling', () => {
        expect(navbar).toMatch(/id="mobile-wishlist-badge"\s+class="mobile-badge"/);
        expect(componentsCss).toMatch(/\.mobile-badge\s*\{/);
    });
});

describe('badge styling contract', () => {
    const badgeRule = ruleFor(componentsCss, '#wishlist-badge');
    const cartRule = ruleFor(componentsCss, '#cart-badge');

    it('is positioned rather than left in normal flow', () => {
        expect(badgeRule).toMatch(/position:\s*absolute/);
    });

    it('anchors at the same offset as the cart badge', () => {
        for (const property of ['top', 'right']) {
            const badgeValue = badgeRule.match(new RegExp(`${property}:\\s*([^;]+);`))[1].trim();
            const cartValue = cartRule.match(new RegExp(`${property}:\\s*([^;]+);`))[1].trim();
            expect(badgeValue).toBe(cartValue);
        }
    });

    it('stays legible in dark mode, on both surfaces', () => {
        const darkRule = baseCss.slice(baseCss.indexOf('body.dark-theme #cart-badge'));
        expect(darkRule).toMatch(/body\.dark-theme #wishlist-badge/);
        expect(darkRule).toMatch(/body\.dark-theme #mobile-wishlist-badge/);
    });

    it('does not swallow clicks meant for the wishlist link', () => {
        expect(badgeRule).toMatch(/pointer-events:\s*none/);
    });
});

describe('badge refresh path', () => {
    it('updates the mobile badge as well as the desktop one', () => {
        const fn = uiJs.slice(
            uiJs.indexOf('function updateWishlistCount'),
            uiJs.indexOf('let uiInitialized')
        );

        expect(fn).toMatch(/mobile-wishlist-badge/);
        expect(fn).toMatch(/"wishlist-badge"/);
    });

    it('hides the badge at zero and shows it above zero', () => {
        const fn = uiJs.slice(
            uiJs.indexOf('function updateWishlistCount'),
            uiJs.indexOf('let uiInitialized')
        );

        expect(fn).toMatch(/total\s*>\s*0/);
        expect(fn).toMatch(/"none"/);
    });

    it('refreshes from the single wishlist mutation choke point', () => {
        const fn = utilsJs.slice(
            utilsJs.indexOf('const saveWishlist'),
            utilsJs.indexOf('const getSkeletonCardHTML')
        );

        expect(fn).toMatch(/updateWishlistCount/);
    });

    it('guards the refresh so utils.js stays usable without ui.js', () => {
        const fn = utilsJs.slice(
            utilsJs.indexOf('const saveWishlist'),
            utilsJs.indexOf('const getSkeletonCardHTML')
        );

        expect(fn).toMatch(/typeof window !== "undefined"/);
        expect(fn).toMatch(/typeof window\.updateWishlistCount === "function"/);
    });

    it('is still called during UI initialisation', () => {
        expect(uiJs).toMatch(/updateCartCount\(\);\s*\n\s*updateWishlistCount\(\);/);
    });

    it('is still exposed globally for the mutation path to reach', () => {
        expect(uiJs).toMatch(/window\.updateWishlistCount\s*=/);
    });
});
