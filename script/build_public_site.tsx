import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Separator } from "@tan-studio/ui/components/separator"

const html = renderToStaticMarkup(
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="theme-color" content="#f6edda" />
      <title>Tan Studio — Good vibed coffee</title>
      <meta name="description" content="Tan Roasts. Good vibed coffee." />
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
        <header className="masthead">
          <img
            src="/assets/tan-studio-logo.png"
            alt="Tan"
            width="58"
            height="58"
          />
          <Separator orientation="vertical" />
          <span>Tan Studio</span>
        </header>
        <Separator />
        <main>
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-copy">
              <h1 id="hero-title">
                Good <br />
                <span>
                  <em>vibed</em> coffee
                </span>
              </h1>
              <p>Tan Roasts.</p>
            </div>
            <img
              className="coffee-branch"
              src="/assets/coffee-branch.webp"
              alt="Coffee cherries and leaves, stamped in green and burnt orange ink"
              width="480"
              height="480"
            />
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
console.log(
  "Built sites/share/index.html with the shared shadcn Separator component."
)
