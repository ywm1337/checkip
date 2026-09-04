# CheckIP

Fast IP & domain lookup tool. Look up any IP or domain instantly — get location, ISP, coordinates, DNS records, related IPs, and ping checks.

Faster than CheckHost. No ads, no tracking, no bs.

## Features

- Instant IP/domain lookup
- Geolocation + ISP + ASN data
- Related IPs (same /24 range)
- DNS records (A, AAAA, MX, NS, TXT)
- Multi-location ping check
- Dark theme, zero dependencies

## Run locally

```
python3 -m http.server 8000
```

Open http://localhost:8000

## Tech

- Vanilla HTML + CSS + JS
- ip-api.com (geolocation)
- Google DNS-over-HTTPS
- No frameworks, no build step

## License

MIT
