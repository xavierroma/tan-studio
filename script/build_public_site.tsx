import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"

const html = renderToStaticMarkup(
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="theme-color" content="#f6edda" />
      <title>Vibed Tan Coffee</title>
      <meta name="description" content="Vibed Tan Coffee." />
      <link rel="canonical" href="https://tan.coffee/" />
      <link rel="icon" type="image/png" href="/assets/tan-studio-logo.png" />
      <link
        rel="preload"
        href="/assets/fonts/SpecialElite-Regular.ttf"
        as="font"
        type="font/ttf"
        crossOrigin="anonymous"
      />
      <link rel="stylesheet" href="/landing.css" />
    </head>
    <body>
      <div className="page">
        <main>
          <section className="hero" aria-labelledby="hero-title">
            <img
              className="coffee-branch"
              src="/assets/coffee-branch.webp"
              alt="Coffee cherries and leaves, stamped in green and burnt orange ink"
              width="480"
              height="480"
            />
            <h1 id="hero-title">
              Vibed <br />
              Tan <br />
              Coffee
            </h1>
          </section>
        </main>
        <footer>
          <img
            className="brand-icon"
            src="/assets/tan-studio-logo.png"
            alt="Tan"
            width="44"
            height="44"
          />
        </footer>
      </div>
    </body>
  </html>
)

await Bun.write(
  new URL("../sites/share/index.html", import.meta.url),
  `<!doctype html>\n${html}\n`
)
console.log("Built sites/share/index.html.")
