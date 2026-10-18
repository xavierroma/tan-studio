import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Button } from "@tan-studio/ui/components/button"
import { Input } from "@tan-studio/ui/components/input"
import { Label } from "@tan-studio/ui/components/label"
import { Badge } from "@tan-studio/ui/components/badge"
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@tan-studio/ui/components/card"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@tan-studio/ui/components/table"
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@tan-studio/ui/components/breadcrumb"
import { Check, ArrowLeft, MoreHorizontal } from "lucide-react"

const page = renderToStaticMarkup(
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>Tan / Component specimen</title>
      <link rel="stylesheet" href="component-specimen.css" />
    </head>
    <body>
      <main id="specimen" className="tan-brand-scope">
        <p className="specimen-label">
          Fictional component specimen / shadcn + Base UI
        </p>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#coffee">Coffees</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="#coffee">Keramo</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Roast 128</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="record-head">
          <div>
            <p className="record-id">Roast / 128</p>
            <h1>Keramo</h1>
          </div>
          <Badge variant="outline" data-variant="outline">
            <Check aria-hidden="true" size={14} />
            Completed
          </Badge>
        </div>
        <div className="actions">
          <Button>Save roast</Button>
          <Button variant="outline" data-variant="outline">
            Cancel
          </Button>
          <Button variant="destructive" data-variant="destructive">
            Delete
          </Button>
          <Button
            variant="outline"
            data-variant="outline"
            size="icon"
            data-size="icon"
            aria-label="More actions"
          >
            <MoreHorizontal size={16} />
          </Button>
          <Button disabled>Saving</Button>
        </div>
        <Card id="coffee">
          <CardHeader>
            <CardTitle>
              <h2>Coffee</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Process</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>
                    <a href="#coffee">Keramo / 17</a>
                  </TableCell>
                  <TableCell>Ethiopia</TableCell>
                  <TableCell>Washed</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <div className="form-field">
          <Label htmlFor="roast-note">Roast notes</Label>
          <Input
            id="roast-note"
            readOnly
            value="Even development; compare the next brew."
          />
        </div>
        <Card id="brew">
          <CardHeader>
            <CardTitle>
              <h2>Brews and tasting notes</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Brew</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Note excerpt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>
                    <a href="#brew">Brew 32</a>
                  </TableCell>
                  <TableCell>V60</TableCell>
                  <TableCell>Peach sweetness; bright, clean finish.</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Button variant="link" data-variant="link" className="back-link">
          <ArrowLeft size={16} aria-hidden="true" />
          Back to coffee
        </Button>
      </main>
    </body>
  </html>
)
await Bun.write(
  new URL("../docs/brand/components.html", import.meta.url),
  `<!doctype html>\n${page}\n`
)
console.log("Built brand component specimen from existing shadcn primitives.")
