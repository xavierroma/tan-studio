import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"

const html = renderToStaticMarkup(
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="theme-color" content="#d6b98e" />
      <title>Vibed Tan Coffee</title>
      <meta name="description" content="Vibed Tan Coffee." />
      <link rel="canonical" href="https://tan.coffee/" />
      <link rel="icon" type="image/png" href="/assets/tan-favicon.png?v=2ink" />
      <link rel="apple-touch-icon" href="/assets/tan-touch-icon.png?v=2ink" />
      <link
        rel="preload"
        href="/assets/fonts/CourierPrime-Regular.ttf"
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
              className="tan-logo"
              src="/assets/tan-logo.webp"
              alt="Tan — coffee branch in black and red"
              width="1389"
              height="1132"
            />
            <h1 id="hero-title">
              Vibed <br />
              <span className="red-ink">Tan</span> <br />
              Coffee
            </h1>
          </section>
        </main>
      </div>
    </body>
  </html>
)

await Bun.write(
  new URL("../sites/share/index.html", import.meta.url),
  `<!doctype html>\n${html}\n`
)
console.log("Built sites/share/index.html.")
