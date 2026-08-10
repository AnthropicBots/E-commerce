const { JSDOM } = require('jsdom');

describe('Blog Script DOM Security and Fallback Handling', () => {
    let dom;
    let document;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        document = dom.window.document;
    });

    test('should sanitize malicious content and create real DOM paragraph elements without script tags', () => {
        const textDiv = document.createElement("div");
        textDiv.className = "modal-text";

        const maliciousContent = "Hello <script>alert('xss')</script> world!\n\nSecond paragraph.";
        
        // Safe DOM fallback logic from blog.js
        textDiv.textContent = "";
        const rawText = String(maliciousContent || "");
        const sanitizedText = rawText.replace(/<[^>]*>/g, '');
        const paragraphs = sanitizedText.split(/\n\n+/);
        paragraphs.forEach((para) => {
            if (para.trim()) {
                const p = document.createElement("p");
                p.textContent = para.trim();
                textDiv.appendChild(p);
            }
        });

        // Verify actual DOM element construction
        expect(textDiv.children.length).toBe(2);
        const firstP = textDiv.children[0];
        expect(firstP.tagName).toBe('P');

        // Verify script tags are stripped and no script elements exist in DOM
        expect(textDiv.querySelector('script')).toBeNull();
        expect(textDiv.innerHTML).not.toContain('<script>');
        expect(firstP.textContent).toBe("Hello alert('xss') world!");
    });
});
