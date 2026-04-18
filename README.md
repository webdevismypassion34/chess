# Simple Chess Website

Browser-based multiplayer chess game

Made for school, since they blocked chess.com and every other chess website

Access at [https://webdevismypassion34.github.io/chess/](https://webdevismypassion34.github.io/chess/)

## Hosting

### Client

The client is static and can be hosted on:

- [GitHub Pages](https://pages.github.com/)
- [Vercel](https://vercel.com/)
- [Netlify](https://netlify.com/)

> Hosts that have a restrictive CSP (e.g. [Neocities](https://neocities.org/)) will block cross-origin WebSocket connections

### Server

1. Verify Node.js is installed: `node -v`. If not, [download it here](https://nodejs.org/en/download/).
2. Install dependencies: `npm install`
3. Start the server: `npm start`

To make the server public, use a tunnel:

```bash
# No account or anything required
npx localtunnel --port 9001 # https://completely-random-words.loca.lt
# If already used, falls back to a random one
npx localtunnel --port 9001 --subdomain my-chess-server # https://my-chess-server.loca.lt
```

Paste the resulting URL in the textbox labeled `server` on the website

## Credits

Chess piece SVGs from [greenchess.net](https://greenchess.net/info.php?item=downloads),
licensed under [Creative Commons Attribution-ShareAlike (CC BY-SA)](https://creativecommons.org/licenses/by-sa/4.0/).
