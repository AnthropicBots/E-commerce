# Security Policy

## Supported Versions

Security updates are currently provided for the latest code available on the `main` branch.

| Version | Supported |
| ------- | --------- |
| main    | ✅ Yes    |

## Contact Details

To report a security vulnerability in **E-commerce**, please use one of the following private channels:

- 📧 Security Email: anthropicbots@gmail.com
- 👤 Organization Profile: [Github](https://github.com/AnthropicBots)
- 💬 Contact the maintainers through any social links listed on the organization profile

> Please **do not** open a public GitHub issue for security vulnerabilities.

## Expected Response Time

| Action | Timeframe |
| ------- | --------- |
| Acknowledgement of report | Within 48 hours |
| Status update | Within 7 days |
| Patch / fix release | Within 30 days |

## Responsible Disclosure Policy

We follow a **responsible disclosure** policy:

- Please report vulnerabilities privately before any public disclosure
- We request an embargo period of 30 days to investigate and patch the issue
- After a fix is released, you are welcome to publish your findings
- We will credit reporters in release notes unless anonymity is requested
- We deeply appreciate the efforts of security researchers and contributors who help keep the project secure 🙏

## What to Include in Your Report

- A clear description of the vulnerability
- Steps to reproduce the issue
- Affected versions or components
- Potential impact assessment
- Proof of concept, screenshots, or logs (if applicable)
- Any suggested fix (optional but appreciated)

## References

- E-commerce Repository: https://github.com/AnthropicBots/E-commerce
- GitHub Security Advisories: https://docs.github.com/en/code-security/security-advisories
- OWASP Vulnerability Disclosure Cheat Sheet: https://owasp.org/www-community/Vulnerability_Disclosure_Cheat_Sheet
- Adding a Security Policy to Your Repository: https://docs.github.com/en/code-security/getting-started/adding-a-security-policy-to-your-repository

# 🔒 Security Update: Agent Impersonation Protection

## Implemented Fix: Issue #384

### Changes Made:

1. **Cryptographic Signature Verification**
   - Added HMAC-SHA256 signature verification for ClaudeBot requests
   - Environment variable: `CLAUDE_WEBHOOK_SECRET`

2. **Behavioral CAPTCHA**
   - Rate limiting for sensitive endpoints
   - Bot pattern detection
   - Request fingerprinting

3. **Zero-Trust Policy**
   - No longer trusts User-Agent header alone
   - Multi-factor verification for critical operations

### Updated Middleware:
- `backend/middleware/authMiddleware.js` - Enhanced verification
- `backend/middleware/behavioralCaptcha.js` - New behavioral checks
- `backend/utils/signatureVerification.js` - Signature utilities

### Testing:
```bash
# Run tests
npm test tests/signatureVerification.test.js