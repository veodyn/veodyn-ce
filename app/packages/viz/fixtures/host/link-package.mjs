import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const link = join(here, 'node_modules', '@veodyn', 'viz')
mkdirSync(dirname(link), { recursive: true })
rmSync(link, { recursive: true, force: true })
symlinkSync(relative(dirname(link), join(here, '..', '..')), link, 'dir')
