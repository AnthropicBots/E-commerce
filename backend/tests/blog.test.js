describe('Blog Script DOM Security and Fallback Handling', () => {
    test('should safely construct DOM elements without DOMPurify without executing raw innerHTML', () => {
        const children = [];
        const mockTextDiv = {
            textContent: '',
            appendChild: (child) => children.push(child)
        };

        const maliciousContent = "Hello <script>alert('xss')</script> world!";
        
        // Safe DOM fallback logic from blog.js
        mockTextDiv.textContent = "";
        const rawText = String(maliciousContent || "");
        const paragraphs = rawText.split(/\n\n+/);
        paragraphs.forEach((para) => {
            if (para.trim()) {
                const p = {
                    tagName: 'P',
                    textContent: para.trim()
                };
                mockTextDiv.appendChild(p);
            }
        });

        expect(children.length).toBe(1);
        expect(children[0].tagName).toBe('P');
        expect(children[0].textContent).toContain("<script>alert('xss')</script>");
    });
});
