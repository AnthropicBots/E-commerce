---
name: semantic-html
description: Write well-considered semantic HTML that serves all users. Use when creating components, page structures, or reviewing markup. Emphasizes native HTML elements over ARIA. Treats proper document structure and accessibility as foundations rather than afterthoughts.
---

# Semantic HTML

Write HTML that conveys meaning, serves all users, and respects the web platform.

## When to Use This Skill

Use this skill when:

- Creating new components or page sections
- Reviewing markup for accessibility and semantics
- Deciding between native HTML elements and ARIA attributes
- Structuring documents with proper heading hierarchy
- Making interactive elements accessible
- Building forms with proper labelling and error handling
- Creating responsive tables

## Core Principles

### Content Realism

Design content is idealized. Real content is messy. Always account for:

- Long sentences and long words
- Images with varying aspect ratios and sizes
- Multi-language support (even if not planned—users can translate via browser)
- Dynamic content that changes in length and structure

Build components that handle real-world content gracefully, not just what looks good in design tools.

### Landmarks-First Planning

Before diving into individual components, consider the full page structure. This allows you to:

- Identify key landmarks for assistive technology users
- Plan heading hierarchy across the document
- Make informed decisions about element choice
- Avoid overusing landmarks (which diminishes their usefulness)

### Native Over ARIA

Follow the first rule of ARIA: if a native HTML element provides the semantics and behaviour you need, use it instead of adding ARIA to a generic element.

**Red flag:** High div count combined with high ARIA count on non-complex components signals reaching for patches rather than foundations.

#### Redundant ARIA

Adding ARIA to elements that already carry the correct semantics is noise—it clutters the code, can confuse assistive technology, and obscures genuine intent:

```html
<!-- Redundant: <ul> already has list semantics -->
<ul role="list">
  ...
</ul>

<!-- Redundant: alt="" already suppresses the accessible name -->
<img src="avatar.png" alt="" role="presentation" />

<!-- Redundant: aria-label duplicates visible text the AT will already read -->
<span aria-label="Most Popular">Most Popular</span>
```

#### Don't Override Native Semantics with role

ARIA `role` changes how assistive technology interprets an element. Applying a role that changes a native element's semantics introduces inconsistency—native behaviour (keyboard interaction, states, events) stays the same while the announced role changes:

```html
<!-- Wrong: role="switch" changes what AT announces, but the element still
     behaves like a checkbox. Use the native checkbox if switch toggle
     semantics aren't needed, or build a proper switch widget. -->
<input type="checkbox" role="switch" />

<!-- Right: native checkbox, no role override needed -->
<input type="checkbox" />
```

Only add a `role` attribute to a native element when you deliberately need different semantics and the element's behaviour genuinely matches that role.

### Separation of Visual and Semantic Hierarchy

Visual styling and semantic meaning are related but not coupled. CSS classes bridge the gap:

- Use the appropriate heading level based on document structure
- Apply CSS classes to control visual appearance (size, weight, colour)
- Create utility classes like `.u-Heading-XXL` for consistent visual treatment regardless of semantic level

## Document Structure

### Skip Navigation Links

Skip links let keyboard and screen reader users bypass repeated navigation blocks and jump directly to meaningful content. They are required on any page with a navigation block or other repeated content before the main content.

Place skip links as the **first focusable element** in `<body>`. They can be visually hidden and revealed on focus:

```html
<body>
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <!-- optional additional skip targets -->
  <a href="#search" class="skip-link">Skip to search</a>

  <header>...</header>
  <nav>...</nav>

  <main id="main-content" tabindex="-1">...</main>
</body>
```

```css
.skip-link {
  position: absolute;
  transform: translateY(-100%);
}
.skip-link:focus {
  transform: translateY(0);
}
```

**Why `tabindex="-1"` on `<main>`:** The `<main>` element is not natively focusable. Without `tabindex="-1"`, activating the skip link scrolls to the element but does not move keyboard focus there in all browsers. Adding `tabindex="-1"` makes it programmatically focusable (reachable via the skip link or `.focus()`) without adding it to the natural tab order.

**When to add more skip links:** If the page has a prominent search bar, a sidebar, or a long secondary navigation, consider skip links to those targets too. The goal is reducing the number of Tab presses to reach primary content.

**Sidebar layouts need a "skip to navigation" link:** When a sidebar navigation is placed away from the top of the DOM (e.g., after `<main>` in source order, or deep within the layout), add a skip link pointing to the `<nav>` so keyboard users can reach it without tabbing through all main content first.

**The primary skip link should target `<main>`:** The first skip link should always point to `<main id="main-content">`. Additional skip links can target other meaningful landmarks or controls—a `<search>` element, a sidebar `<nav>`, or a prominent form—depending on the page's complexity.

**Why this matters:** Without skip links, keyboard users must tab through every navigation item on every page load. On a nav with 12 links, that's 12 extra keystrokes — on every page.

### Landmark Elements

Use landmark elements to convey page structure:

| Element   | Use When                     | Notes                                                                            |
| --------- | ---------------------------- | -------------------------------------------------------------------------------- |
| `header`  | Page or section header       | Can appear multiple times in different contexts                                  |
| `footer`  | Page or section footer       | Contact info, copyright, related links                                           |
| `nav`     | Navigation sections          | Must be labelled; avoid "navigation" in the label (screen readers announce this) |
| `main`    | Primary content              | Only one per page; must contain the primary `<h1>`                               |
| `aside`   | Tangentially related content | Content removable without changing the page's main story (sidebars, ads)         |
| `search`  | Search functionality         | Contains the search form, not the results                                        |
| `form`    | User input                   | Only becomes a landmark when labelled via `aria-labelledby` or `aria-label`      |
| `article` | Self-contained content       | Would make sense syndicated or standalone                                        |
| `section` | Thematic grouping            | Only becomes a landmark when labelled                                            |

#### `<main>` must contain the primary `<h1>`

Screen reader users often jump directly to `<main>`. If the page `<h1>` sits in a `<div>` between `<header>` and `<main>`, these users land after the title and lose essential context. The `<h1>` (and any subtitle or intro copy introducing the page) belongs inside `<main>`:

```html
<!-- Wrong: h1 is outside main -->
<header>...</header>
<div class="page-header"><h1>FAQ</h1></div>
<main>
  <!-- screen reader users start here, after the title -->
</main>

<!-- Right: h1 is the first heading inside main -->
<header>...</header>
<main id="main-content" tabindex="-1">
  <h1>FAQ</h1>
  ...
</main>
```

### The Section Element

A `section` without an accessible name behaves like a `div` semantically. When using `section`:

- Associate it with a heading via `aria-labelledby`
- This transforms it into a valid landmark region
- If you cannot provide a meaningful label, question whether `section` is the right choice

### The Article Element

Think beyond blog posts. Use `article` for any self-contained content that would make sense on its own:

- Blog posts and news articles
- Comments on a post
- Product cards in a listing
- Social media posts in a feed
- Forum posts

**Test:** Would this content make sense if extracted and placed elsewhere with no surrounding context?

### The Address Element

Often misunderstood. From the HTML specification:

> The address element represents the contact information for its nearest article or body element ancestor.

Use for contact information about the author or owner—not for generic postal addresses. For postal addresses, use a standard `<p>` or structured markup appropriate to the context.

### `<aside>` vs `<section>`

**The test for `<aside>`:** Would this content make sense if it were removed from the page entirely? Would the main content still be complete?

- An advertisement, a related article link, or a biographical note about the author → `<aside>` (removing it doesn't change the main message)
- A "Still need help?" CTA on an FAQ page, a summary of key findings in an article, or a prominent signup prompt → `<section>` (removing it leaves the page feeling incomplete or breaks the intended flow)

When in doubt: if the content serves the primary purpose of the page, it belongs in a labelled `<section>`, not `<aside>`.

### The Aside Element and Pull Quotes

`<aside>` is appropriate for pull quotes—a typographic device that highlights text from the article. However, do not use `<blockquote>` for a pull quote drawn from the page's own content. `<blockquote>` signals an external or distinct quotation. For a pull quote that restates something from the same article, use `<p>` (or styled text) inside `<aside>`:

```html
<!-- Correct: pull quote from the article's own content -->
<aside aria-label="Pull quote">
  <p>
    "The biggest gains came not from new features, but from removing old ones."
  </p>
</aside>

<!-- Use blockquote for genuine external quotations -->
<blockquote cite="https://example.com/source">
  <p>Quote from an external source.</p>
</blockquote>
```

## Headings

### Heading Hierarchy

Maintain a logical heading structure:

- One `h1` per page (typically the main title)
- Don't skip levels (h1 → h3)
- Headings create an outline—ensure it makes sense when read in sequence

### Headings in Components

For reusable components containing headings:

1. **Make heading level configurable** — Components may appear in different contexts
2. **Provide sensible defaults** — Not all content authors understand heading hierarchy
3. **Consider inheritance** — Generic components become specific ones; heading config should flow through

**Example pattern:**

```
Card (generic) → heading level configurable, default h3
  └─ ProductCard (specific) → inherits config, may set default based on known context
       └─ Used in section with h2 → heading level set to h3
```

### Visual Heading Without Semantic Heading

Sometimes text looks like a heading but shouldn't be one semantically. Use CSS classes to apply heading-like styling without affecting document outline:

```html
<p class="u-Heading-L">This looks like a heading</p>
```

## Lists

### When to Use Lists

Lists are most useful when **knowing the number of items helps the user**:

- Navigation menus (how many options?)
- Search results (how many matches?)
- Image galleries (how many images?)
- Steps in a process

**Questions to ask:**

- Are these items genuinely peers?
- Would removing one make the others feel incomplete?
- Is there an implicit "here are N things" being communicated?

### List Types

| Type   | Use When                                 | Example                               |
| ------ | ---------------------------------------- | ------------------------------------- |
| `ul`   | Unordered collection where count matters | Nav items, search results             |
| `ol`   | Sequential steps or ranked items         | Recipes, instructions, top-10 lists   |
| `dl`   | Term-description pairs                   | Glossaries, metadata, key-value pairs |
| `menu` | Toolbar commands                         | Action buttons, not navigation        |

**Ordered list attributes:** Use `reversed` for countdown-style lists (e.g., a top 10 listed from 10 to 1). Use `start` to begin numbering from a specific value. Both are native HTML—no JavaScript required.

### Definition Lists

Often overlooked or confused with `details`/`summary`. Use `dl` for:

- Glossary definitions
- Metadata display (label: value pairs)
- Any term with one or more descriptions

Note: A single `dt` can have multiple `dd` elements for multiple related descriptions.

### Decorative List Separators

When using CSS `::before` or `::after` to inject visual separators (e.g., breadcrumb `›`), browsers automatically exclude generated content from the accessibility tree—no extra markup is required. Do **not** try to hide it with `aria-hidden: "true"` as a CSS property; that is invalid and has no effect. If injecting separators via HTML (not CSS), use `<span aria-hidden="true">` on the HTML element.

## Interactive Elements

### Buttons vs Links

**Traditional rule:** Buttons do things, links go places.

**Progressive enhancement lens:** If a URL provides a meaningful fallback when JavaScript fails, a link is valid even for action-like interactions.

| Interaction             | Default Choice | Consider Link When                            |
| ----------------------- | -------------- | --------------------------------------------- |
| Show more content       | `button`       | URL params could load the content server-side |
| Toggle view (grid/list) | `button`       | URL could preserve view preference            |
| Copy to clipboard       | `button`       | Copied content is a shareable URL             |
| Tab selection           | `button`       | URL could load specific tab content           |

**Key question:** What happens when JavaScript fails? If a URL provides graceful degradation, a link may be the better choice.

### Unique Accessible Names for Repeated Buttons

When the same action appears multiple times on a page (e.g., "Add to cart" on each product card, "Read more" on each article), each button needs a unique accessible name so screen reader users understand which item it acts on.

Approaches (choose the simplest):

```html
<!-- Option 1: aria-label with full context -->
<button aria-label="Add Nike Pegasus 41 to cart">Add to cart</button>

<!-- Option 2: visually hidden text -->
<button>
  Add to cart
  <span class="visually-hidden">Nike Pegasus 41</span>
</button>

<!-- Option 3: aria-describedby pointing to the product heading -->
<article>
  <h3 id="product-42">Nike Pegasus 41</h3>
  ...
  <button aria-describedby="product-42">Add to cart</button>
</article>
```

The visible label should stay as "Add to cart" (sighted users understand context from position); the accessible name adds the product name for users who navigate by button list.

### Disabling Controls

`aria-disabled="true"` communicates disabled state but does **not** prevent interaction. For buttons, `disabled` both communicates state and suppresses clicks and keyboard activation. For links, `aria-disabled="true"` alone is insufficient—it still receives focus and activates. Options:

- Use a `<button disabled>` instead of a link when the action is truly unavailable
- Remove the `href` attribute to prevent activation (link becomes non-interactive)
- Handle `keydown`/`click` events explicitly if you must keep the element focusable

### The Popover API for Lightweight Overlays

For user dropdowns, action menus, and non-modal overlays, the **Popover API** (`popover` attribute) is the preferred modern approach — not custom ARIA widget patterns.

```html
<!-- Trigger: button with popovertarget -->
<button popovertarget="user-menu">
  <img src="avatar.png" alt="" />
  <span>Alice</span>
</button>

<!-- Popover: browser manages show/hide, focus, and light-dismiss -->
<ul id="user-menu" popover>
  <li><a href="/profile">Profile</a></li>
  <li><a href="/settings">Settings</a></li>
  <li><button>Sign out</button></li>
</ul>
```

The browser automatically handles `aria-expanded` on the invoking button and `aria-details` when the popover isn't immediately adjacent in the DOM. No manual ARIA attributes are needed on the trigger.

**Why this is better than the ARIA menu pattern:**

- Browser handles keyboard interaction, focus management, and light-dismiss natively
- No `role="menu"`, `role="menuitem"`, or `role="none"` needed — the list remains a semantic `<ul>` of links and buttons
- ARIA menu patterns have strict interaction requirements (`Home`, `End`, character navigation) that are easy to implement incorrectly and unfamiliar to many users

**When ARIA menu patterns are appropriate:** Only when you are building a true application menu (menubar, menuitem, submenu) that mirrors desktop application behaviour. Most website navigation and user dropdowns should use the Popover API or a simple disclosure pattern instead.

### The Details/Summary Pattern

Use for progressive disclosure:

- FAQ sections
- Expandable content sections
- Collapsible navigation

**Not** a replacement for a `<button>`-controlled disclosure widget when ARIA roles (e.g., `role="menu"`, `role="dialog"`) are required. User dropdowns, menus, and modal triggers need `<button>` so that the correct ARIA pattern can be applied. `<details>/<summary>` has its own implicit semantics and cannot carry `aria-expanded` or menu roles meaningfully.

## Forms

### Grouping with Fieldset/Legend

Use `fieldset` and `legend` for **thematic grouping**, not layout:

- Address fields
- Personal information sections
- Privacy/consent checkboxes
- Payment details
- Settings sections (Profile, Notifications, Privacy)

**When section+heading isn't enough:** For groups of form controls, `<fieldset>/<legend>` provides grouping context to assistive technology that `<section>/<h2>` does not. Screen readers announce the legend before each field in the group, giving users persistent context. Use `<section>/<h2>` for non-form content regions; use `<fieldset>/<legend>` whenever the region contains a group of inputs.

Benefits:

- Enables progressive disclosure (reveal sections as user completes others)
- Reduces overwhelm (avoids "wall of form fields")
- Provides context for screen reader users

Legends can be visually hidden while still providing accessible names.

### Grouping Search and Filter Controls

`<search>` wraps the entire search/filter interface—not just the text input. If a toolbar contains a search input plus related filter selects, they belong together in one `<search>` or labelled `<form>`:

```html
<!-- Correct: all filter controls share a single search landmark -->
<search aria-label="Filter employees">
  <label for="q">Search</label>
  <input type="search" id="q" name="q" />

  <label for="dept">Department</label>
  <select id="dept" name="dept">
    ...
  </select>

  <label for="status">Status</label>
  <select id="status" name="status">
    ...
  </select>

  <button type="submit">Apply filters</button>
</search>

<!-- Wrong: only the text input is wrapped -->
<search>
  <input type="search" />
</search>
<select>
  ...
</select>
<!-- orphaned filter control -->
```

### Labels

**Always use a `label` element.** No exceptions.

- Visually hidden labels are acceptable when design requires it
- Never rely on placeholder text as a label substitute
- Never use `aria-label` when a proper `label` element works

**Why placeholders fail:**

- Disappear on input (problematic for cognitive challenges, stress, or distraction)
- Often have poor contrast
- Don't provide persistent identification

### Required Fields

HTML's `required` attribute communicates required state to assistive technology, but sighted users need a visual convention too. Always pair `required` with a visible indicator:

```html
<!-- Pattern: asterisk with legend explaining it -->
<fieldset>
  <legend>
    Contact details <span aria-hidden="true">*</span> required fields
  </legend>

  <label for="name">Full name <span aria-hidden="true">*</span></label>
  <input type="text" id="name" required />
</fieldset>
```

The `aria-hidden` on the asterisk prevents screen readers from announcing "asterisk"—they already get the required state from the `required` attribute. The legend or a page-level note explains the convention to sighted users.

### Hint Text

When inputs have format hints or helper text, associate them with the input via `aria-describedby`. This ensures screen readers announce the hint after the label, giving users the context they need before typing:

```html
<label for="email">Email address</label>
<p id="email-hint" class="hint">We'll only use this to send your receipt.</p>
<input type="email" id="email" aria-describedby="email-hint" />
```

Multiple associations are allowed—comma-separated IDs work for both hint and error:

```html
<input
  type="email"
  id="email"
  aria-invalid="true"
  aria-describedby="email-hint email-error"
/>
```

### Error Messages

Current best practice (due to browser support gaps with `aria-errormessage`):

1. Set `aria-invalid="true"` on the invalid input
2. Associate error message via `aria-describedby`
3. Ensure error message is actionable (state the problem AND guide the fix)
4. For dynamic errors (shown on blur), consider `aria-live` on the error container

```html
<label for="email">Email</label>
<input
  type="email"
  id="email"
  aria-invalid="true"
  aria-describedby="email-error"
/>
<p id="email-error" class="error">
  Enter a valid email address, like name@example.com
</p>
```

## Tables

### When to Use Tables

Use a table when data has **meaningful relationships in both dimensions**:

- Data must be presented as rows AND columns
- Clear association between headers and data
- Each row has the same columns
- Within each column, data is of the same type

### When NOT to Use Tables

- Simple lists (one dimension)
- Key-value pairs (use `dl`)
- Form layouts
- Hierarchical data (use nested lists)

### Table Semantics Baseline

Always include:

- `caption` — Describes the table's purpose
- `thead`, `tbody`, `tfoot` — Structural grouping
- `th` with `scope` — Identifies header cells and their direction

### Responsive Tables

In order of preference:

1. **Hide non-essential columns** — User still gets main takeaways; offer button to show full table
2. **Horizontal scroll** — Preserves semantics but may challenge users with motor difficulties
3. **Component duplication (cards on mobile)** — Last resort; maintain accessibility in both versions

Note: Modern browsers (including Safari) no longer strip table semantics when applying `display: grid` or `display: flex`, opening new responsive possibilities.

## Code Review Checklist

When reviewing markup, look for:

### Positive Signals

- [ ] Skip navigation link(s) present as first focusable element(s)
- [ ] Landmark elements used appropriately
- [ ] Logical heading hierarchy
- [ ] Native interactive elements (buttons, links) used correctly
- [ ] Repeated action buttons have unique accessible names
- [ ] Forms have proper labels, fieldsets, and hint associations
- [ ] Required fields visually indicated with a legend explaining the convention
- [ ] Tables have full semantic structure
- [ ] ARIA used sparingly and correctly

### Warning Signs

- [ ] No skip navigation link before a `<nav>` or repeated header content
- [ ] High div count in non-complex components
- [ ] ARIA attributes compensating for missing native semantics
- [ ] Redundant ARIA roles on native elements (`role="list"` on `<ul>`, `role="presentation"` on `<img alt="">`)
- [ ] `role` attribute changing a native element's semantics without matching behaviour
- [ ] `aria-label` duplicating visible text (AT would read it twice or render it confusing)
- [ ] ARIA menu pattern (`role="menu"`, `role="menuitem"`) used for a simple user dropdown (use Popover API instead)
- [ ] Placeholders used as labels
- [ ] Heading levels chosen for visual size rather than structure
- [ ] Generic elements with click handlers instead of buttons/links
- [ ] Tables used for layout
- [ ] Missing form labels
- [ ] Repeated buttons with identical accessible names ("Add to cart" × 6)
- [ ] `aria-disabled` on `<a>` elements without preventing keyboard activation
- [ ] Filter/search controls scattered outside a `<search>` or `<form>` grouping
- [ ] Settings form sections using `<section>/<h2>` instead of `<fieldset>/<legend>`

## Resources

- [HTML Living Standard: Sections](https://html.spec.whatwg.org/dev/sections.html)
- [HTML Living Standard: Grouping Content](https://html.spec.whatwg.org/dev/grouping-content.html)
- [HTML Living Standard: Forms](https://html.spec.whatwg.org/dev/forms.html)
- [HTML Living Standard: Tables](https://html.spec.whatwg.org/dev/tables.html)
- [MDN: ARIA](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA)

## References

See the `references/` directory for detailed guidance on specific topics:

- `element-decision-trees.md` — Quick decision frameworks for element selection
- `heading-patterns.md` — Component heading patterns and configuration strategies
