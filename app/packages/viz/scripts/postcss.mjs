import { createRequire } from 'node:module'

const fromTailwind = createRequire(createRequire(import.meta.url).resolve('@tailwindcss/postcss'))

export const postcss = fromTailwind('postcss')
