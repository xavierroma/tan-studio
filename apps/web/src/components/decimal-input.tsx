import type { ComponentProps } from "react"
import { Input } from "@tan-studio/ui/components/input"

const decimal = /^-?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/u

export function parseDecimalInput(value: string): number | null {
  const text = value.trim()
  if (!text) return null
  return decimal.test(text) ? Number(text.replace(",", ".")) : Number.NaN
}

type DecimalInputProps = Omit<
  ComponentProps<typeof Input>,
  "type" | "inputMode" | "min" | "max" | "step" | "ref"
> & {
  min?: number | undefined
  max?: number | undefined
}

/** Accept either decimal separator without a browser-dependent number step. */
export function DecimalInput({
  min,
  max,
  onChange,
  ...props
}: DecimalInputProps) {
  function validate(input: HTMLInputElement) {
    const number = parseDecimalInput(input.value)
    input.setCustomValidity(
      number == null
        ? ""
        : !Number.isFinite(number)
          ? "Enter a decimal number."
          : min != null && number < min
            ? `Enter ${min} or more.`
            : max != null && number > max
              ? `Enter ${max} or less.`
              : ""
    )
  }
  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      ref={(input) => {
        if (input) validate(input)
      }}
      onChange={(event) => {
        validate(event.currentTarget)
        onChange?.(event)
      }}
    />
  )
}
