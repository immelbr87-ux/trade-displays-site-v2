# Link & Routing Audit

This release adds shared header/footer includes and normalizes internal routing to avoid dead ends.

## Redirect aliases added
- /how-it-works → /what.html
- /what → /what.html
- /for-showrooms → /for-showrooms.html
- /pilot → /pilot-program.html
- /trust → /condition-standards.html
- /market → /market.html
- /listing-details → /listing-details.html
- /reserve-confirmation → /reserve-confirmation.html
- /pickup-confirmation → /pickup-confirmation.html
- /list-a-display → /list-a-display.html
- /faq → /faq.html
- /contact → /contact.html
- /terms → /terms.html
- /brand-compliance → /brand-compliance.html
- /kohler-compliance → /kohler-compliance.html

## Internal link check
- Scanned href targets across all HTML pages in /site.
- No broken internal hrefs detected after alias updates.

## Shared layout
- Added /site/shared/header.html, /site/shared/footer.html, /site/shared/include.js
- All pages now render global nav/footer via placeholders:
  - <div id="bb-header"></div>
  - <div id="bb-footer"></div>
- Added supporting CSS for shared chrome to app.css
