// The ids the navbar's account menu is built out of.
//
// auth.js and components.js look up #auth-link, #profile-dropdown and
// #logout-btn, and components.css and base.css style the last two in about
// fifty lines. None of them existed in any markup: navbar.html shipped only the
// "Sign In" anchor, so a signed-in shopper had no way to log out on any page,
// and the profile icon toggled a class on null (#1672).
//
// Nothing could catch that. check:assets resolves src/href references, not
// element ids; check:a11y looks at landmarks. The JS is written defensively
// (`dropdown?.classList`), so it never threw -- it just quietly did nothing.
//
// This pins the contract from both ends: the ids the scripts reach for exist in
// the component that is supposed to provide them, and the attribute the CSS
// keys the menu on is present to be flipped.

const fs = require("fs");
const path = require("path");

const frontend = (...parts) =>
    path.join(__dirname, "..", "..", "frontend", ...parts);

const navbar = fs.readFileSync(frontend("components", "navbar.html"), "utf8");
const authJs = fs.readFileSync(frontend("scripts", "auth.js"), "utf8");
const componentsJs = fs.readFileSync(frontend("scripts", "components.js"), "utf8");
const componentsCss = fs.readFileSync(frontend("styles", "components.css"), "utf8");

/** Does the markup declare an element with this id? */
const declaresId = (markup, id) =>
    new RegExp(`id=["']${id}["']`).test(markup);

describe("the account menu markup exists", () => {
    test.each(["auth-link", "profile-dropdown", "logout-btn"])(
        "navbar.html declares #%s",
        (id) => {
            expect(declaresId(navbar, id)).toBe(true);
        }
    );

    test("the menu sits inside .profile-wrapper", () => {
        // components.css positions #profile-dropdown absolutely against
        // .profile-wrapper and opens it on hover of that wrapper. Outside it,
        // the menu would be positioned against the page instead.
        const wrapper = navbar.match(
            /<li class="profile-wrapper">([\s\S]*?)<\/li>/
        );

        expect(wrapper).not.toBeNull();
        expect(wrapper[1]).toMatch(/id="profile-dropdown"/);
        expect(wrapper[1]).toMatch(/id="auth-link"/);
    });

    test("the logout control is inside the menu", () => {
        const menu = navbar.match(
            /<div id="profile-dropdown"[\s\S]*?<\/div>/
        );

        expect(menu).not.toBeNull();
        expect(menu[0]).toMatch(/id="logout-btn"/);
    });

    test("the logout control is a button, not a link", () => {
        // It ends a session rather than navigating, and components.css styles
        // `#profile-dropdown button` for exactly this element.
        expect(navbar).toMatch(/<button[^>]*id="logout-btn"/);
    });
});

describe("every id the scripts look up is provided", () => {
    // Collect the ids auth.js and components.js resolve, then check the ones
    // that belong to the navbar are actually in it. Scoped to this menu on
    // purpose: auth.js also looks up the signin and signup form fields, which
    // live on their own pages and are legitimately absent elsewhere.
    const NAVBAR_IDS = ["auth-link", "profile-dropdown", "logout-btn"];

    const lookupsIn = (source) =>
        new Set(
            [...source.matchAll(/getElementById\(\s*["']([\w-]+)["']\s*\)/g)].map(
                (match) => match[1]
            )
        );

    test("auth.js looks up the menu ids, and navbar.html has them", () => {
        const looked = lookupsIn(authJs);
        const wanted = NAVBAR_IDS.filter((id) => looked.has(id));

        expect(wanted).toEqual(NAVBAR_IDS);

        for (const id of wanted) {
            expect(declaresId(navbar, id)).toBe(true);
        }
    });

    test("components.js no longer resolves the menu at module load", () => {
        // loadComponent() injects navbar.html asynchronously, so a top-level
        // lookup runs before the element exists. The write has to wait for
        // componentsLoaded.
        const topLevel = componentsJs.slice(
            0,
            componentsJs.indexOf('document.addEventListener("componentsLoaded"')
        );

        expect(topLevel).not.toMatch(/getElementById\(\s*["']profile-dropdown["']/);
        expect(componentsJs).toMatch(/componentsLoaded/);
    });

    test("components.js reads the stored user through AppUtils", () => {
        // A bare JSON.parse(localStorage.getItem("user")) at the top level of
        // this file throws on a corrupt value and takes the rest of the module
        // -- including the navbar search combobox -- with it.
        expect(componentsJs).not.toMatch(
            /JSON\.parse\(\s*localStorage\.getItem\(\s*["']user["']/
        );
        expect(componentsJs).toMatch(/AppUtils\.getUser\(\)/);
    });
});

describe("the data-loggedin contract the CSS depends on", () => {
    test("components.css opens the menu on that attribute", () => {
        expect(componentsCss).toMatch(
            /#profile-dropdown\[data-loggedin="true"\]/
        );
    });

    test("navbar.html ships the attribute so it can be flipped", () => {
        expect(navbar).toMatch(/id="profile-dropdown"[^>]*data-loggedin=/);
    });

    test("something actually sets it", () => {
        // It was written in exactly one place before, on an element that did
        // not exist. If both writers disappear again the menu can never open
        // on hover, which is the desktop path.
        const written =
            /setAttribute\(\s*["']data-loggedin["']/.test(componentsJs) ||
            /setAttribute\(\s*["']data-loggedin["']/.test(authJs);

        expect(written).toBe(true);
    });
});

describe("the menu is announced properly", () => {
    test("the trigger declares its relationship to the menu", () => {
        const trigger = navbar.match(/<a[^>]*id="auth-link"[^>]*>/);

        expect(trigger).not.toBeNull();
        expect(trigger[0]).toMatch(/aria-haspopup="true"/);
        expect(trigger[0]).toMatch(/aria-expanded="false"/);
        expect(trigger[0]).toMatch(/aria-controls="profile-dropdown"/);
    });

    test("the menu carries a menu role and a label", () => {
        const menu = navbar.match(/<div id="profile-dropdown"[^>]*>/);

        expect(menu[0]).toMatch(/role="menu"/);
        expect(menu[0]).toMatch(/aria-labelledby="auth-link"/);
    });

    test("every item in the menu is a menuitem", () => {
        const menu = navbar.match(/<div id="profile-dropdown"[\s\S]*?<\/div>/)[0];
        const items = [...menu.matchAll(/<(?:a|button)\b[^>]*>/g)].map((m) => m[0]);

        expect(items.length).toBeGreaterThan(1);

        for (const item of items) {
            expect(item).toMatch(/role="menuitem"/);
        }
    });

    test("decorative icons are hidden from assistive technology", () => {
        const menu = navbar.match(/<div id="profile-dropdown"[\s\S]*?<\/div>/)[0];
        const icons = [...menu.matchAll(/<i\b[^>]*>/g)].map((m) => m[0]);

        expect(icons.length).toBeGreaterThan(0);

        for (const icon of icons) {
            expect(icon).toMatch(/aria-hidden="true"/);
        }
    });

    test("aria-expanded is kept in step when the menu toggles", () => {
        // The old handler only toggled a class, so the trigger always claimed
        // to be collapsed.
        expect(authJs).toMatch(/aria-expanded/);
    });
});

describe("the menu closes the ways a menu should", () => {
    test.each([
        ["on Escape", /Escape/],
        ["on a click outside", /document\.addEventListener\(\s*["']click["']/],
        ["after an item is chosen", /closest\(\s*["']a, button["']\s*\)/]
    ])("auth.js closes it %s", (_label, pattern) => {
        expect(authJs).toMatch(pattern);
    });

    test("logout is bound to a real handler", () => {
        expect(authJs).toMatch(/logoutBtn\?\.addEventListener/);
        expect(authJs).toMatch(/clearAuthSession\(\)/);
    });
});
