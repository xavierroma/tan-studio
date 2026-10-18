import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@tan-studio/ui/components/card"
import { Separator } from "@tan-studio/ui/components/separator"
import recipes from "../sites/share/recipes.json"

function Recipe({ recipe }: { recipe: (typeof recipes)[number] }) {
  const selectedTick = Math.round(recipe.grindScale.position * 4)
  return (
    <Card
      className="recipe"
      role="article"
      aria-labelledby={`${recipe.id}-title`}
    >
      <div className="recipe-top">
        <CardHeader>
          <CardTitle>
            <h3 id={`${recipe.id}-title`}>{recipe.name}</h3>
          </CardTitle>
          <CardDescription>{recipe.serves}</CardDescription>
        </CardHeader>
        <figure>
          <img
            src={`/${recipe.image}`}
            alt={`${recipe.name} brewer in a hand-carved rubber stamp style`}
            width="360"
            height="270"
          />
          <figcaption>
            {recipe.name}
            <br />
            No. {recipe.no}
            <br />
            Pour / Bloom / Filter
          </figcaption>
        </figure>
      </div>
      <CardContent>
        <dl className="metrics">
          {[
            ["Coffee", recipe.coffee],
            ["Water", recipe.water],
            ["Temp", recipe.temperature],
            ["Time", recipe.time],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div
          className={`grind grind-${recipe.id}`}
          role="img"
          aria-label={`Grind: ${recipe.grind}, on a scale from fine to coarse.`}
        >
          <div className="grind-label-row" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((tick) => (
              <span key={tick}>
                {tick === selectedTick ? (
                  <span className="grind-label">
                    {recipe.grind}
                    <b>▼</b>
                  </span>
                ) : null}
              </span>
            ))}
          </div>
          <div className="grind-axis" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((tick) => (
              <span key={tick} />
            ))}
          </div>
          <div className="grind-ends" aria-hidden="true">
            <span>Fine</span>
            <span>Coarse</span>
          </div>
        </div>
        <ol className="steps">
          {recipe.steps.map(([number, label, text]) => (
            <li key={number}>
              <strong>{label}:</strong>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

const html = renderToStaticMarkup(
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="theme-color" content="#f6edda" />
      <title>Tan Studio — Good vibed coffee</title>
      <meta
        name="description"
        content="Tan Roasts. Good vibed coffee, with V60 and Chemex recipes."
      />
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
          <Separator />
          <section className="recipes" aria-labelledby="recipes-title">
            <h2 id="recipes-title">Recipes</h2>
            <div className="recipe-grid">
              {recipes.map((recipe) => (
                <Recipe key={recipe.id} recipe={recipe} />
              ))}
            </div>
          </section>
        </main>
        <footer>
          <Separator />
          <p>Tan Roasts</p>
        </footer>
      </div>
    </body>
  </html>
)

await Bun.write(
  new URL("../sites/share/index.html", import.meta.url),
  `<!doctype html>\n${html}\n`
)
console.log(
  "Built sites/share/index.html with the shared shadcn Card and Separator components."
)
