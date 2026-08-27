'use strict';

/**
 * "Remember me" shipped as a complete implementation in auth.js -
 * saveRememberMe, clearRememberMe, loadRememberMe, an element handle and a
 * branch in the login success path - against a checkbox that existed in no
 * markup.
 *
 * The result was worse than a missing feature. With elements.rememberMe
 * permanently null, the login handler took the else branch every time and
 * erased the stored email on each sign-in, so the prefill could never find
 * anything to read back. saveRememberMe() was called from nowhere.
 *
 * These tests cover both halves: the markup now exists, and a missing control
 * expresses no preference rather than "forget me".
 */

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');

const signinHtml = fs.readFileSync(path.join(FRONTEND, 'signin.html'), 'utf8');
const authJs = fs.readFileSync(path.join(FRONTEND, 'scripts', 'auth.js'), 'utf8');
const authCss = fs.readFileSync(path.join(FRONTEND, 'styles', 'auth.css'), 'utf8');

/** The body of the sign-in form only, so assertions cannot match another form. */
function signinForm() {
    const start = signinHtml.indexOf('<form id="signin-form">');
    const end = signinHtml.indexOf('</form>', start);
    return signinHtml.slice(start, end);
}

/** The body of a named function declaration in auth.js. */
function functionBody(source, declaration) {
    const start = source.indexOf(declaration);
    if (start === -1) {
        return null;
    }

    const open = source.indexOf('{', start);
    let depth = 0;

    for (let i = open; i < source.length; i += 1) {
        if (source[i] === '{') {
            depth += 1;
        } else if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(open + 1, i);
            }
        }
    }

    return null;
}

describe('sign-in page markup', () => {
    const form = signinForm();

    it('renders the checkbox auth.js has always looked for', () => {
        expect(form).toMatch(/id="remember-me"/);
    });

    it('declares it as a checkbox rather than another input type', () => {
        expect(form).toMatch(/type="checkbox"\s+id="remember-me"/);
    });

    it('labels it, so it is reachable by keyboard and by screen reader', () => {
        expect(form).toMatch(/<label[^>]*for="remember-me"/);
        expect(form).toMatch(/Remember me/);
    });

    it('keeps the forgot-password link it now shares a row with', () => {
        expect(form).toMatch(/id="forgot-password-link"/);
        expect(form).toMatch(/Forgot Password\?/);
    });

    it('puts the two controls in one options row', () => {
        const row = form.slice(form.indexOf('class="signin-options"'));
        expect(row).toMatch(/id="remember-me"/);
        expect(row).toMatch(/id="forgot-password-link"/);
    });

    it('sits inside the sign-in form, not one of the password-reset forms', () => {
        const occurrences = signinHtml.match(/id="remember-me"/g) || [];
        expect(occurrences).toHaveLength(1);
        expect(signinForm()).toMatch(/id="remember-me"/);
    });
});

describe('sign-in options styling', () => {
    it('lays the row out rather than leaving the controls stacked', () => {
        expect(authCss).toMatch(/\.signin-options\s*\{/);
        expect(authCss).toMatch(/\.remember-me\s*\{/);
    });

    it('styles the checkbox itself', () => {
        expect(authCss).toMatch(/\.remember-me input\[type="checkbox"\]/);
    });

    it('stays readable in dark mode', () => {
        expect(authCss).toMatch(/body\.dark-theme \.remember-me/);
    });
});

describe('a missing control must not erase the stored email', () => {
    const body = functionBody(authJs, 'function applyRememberMePreference');

    it('extracts the preference decision into one place', () => {
        expect(body).not.toBeNull();
    });

    it('returns early when the checkbox is absent', () => {
        const guard = body.slice(0, body.indexOf('if (elements.rememberMe.checked)'));
        expect(guard).toMatch(/if\s*\(!elements\.rememberMe\)/);
        expect(guard).toMatch(/return;/);
    });

    it('clears only when the shopper actually unchecked it', () => {
        expect(body).toMatch(/if\s*\(elements\.rememberMe\.checked\)\s*\{[\s\S]*saveRememberMe\(email\)/);
        expect(body).toMatch(/else\s*\{[\s\S]*clearRememberMe\(\)/);
    });

    it('no longer clears from the login handler regardless of the control', () => {
        expect(authJs).not.toMatch(/if \(elements\.rememberMe && elements\.rememberMe\.checked\) \{[\s\S]*?\} else \{[\s\S]*?clearRememberMe\(\);/);
    });

    it('is the login success path\'s only remember-me call', () => {
        expect(authJs).toMatch(/applyRememberMePreference\(email\);/);
    });
});

describe('the round trip is now reachable', () => {
    it('still stores the email when the shopper opts in', () => {
        const body = functionBody(authJs, 'function saveRememberMe');
        expect(body).toMatch(/localStorage\.setItem\('rememberedEmail', email\)/);
    });

    it('still prefills the email field on a later visit', () => {
        const body = functionBody(authJs, 'function loadRememberMe');
        expect(body).toMatch(/localStorage\.getItem\('rememberedEmail'\)/);
        expect(body).toMatch(/elements\.signinEmail\.value = email/);
    });

    it('reflects the stored state back into the checkbox', () => {
        const body = functionBody(authJs, 'function loadRememberMe');
        expect(body).toMatch(/elements\.rememberMe\.checked = true/);
    });

    it('still reads the element the markup now provides', () => {
        expect(authJs).toMatch(/rememberMe: document\.getElementById\("remember-me"\)/);
    });

    it('still runs the prefill during page initialisation', () => {
        expect(authJs).toMatch(/\n\s*loadRememberMe\(\);/);
    });
});
