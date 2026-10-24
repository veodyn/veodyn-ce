import { z } from 'zod'

export const TURN_CONTEXT_LIMITS = {
  instanceName: 120,
  listItems: 40,
  featureChars: 64,
  pluginChars: 80,
  maps: 8,
  mapIdChars: 32,
  mapLabelChars: 60,
  dataSources: 100,
  sourceNameChars: 255,
  sourceTypeChars: 64,
  syntaxChars: 16,
  resources: 60,
  resourceChars: 128,
  readyQueries: 20,
  choiceIdChars: 64,
  queryNameChars: 255,
  params: 10,
  paramNameChars: 64,
  paramTypeChars: 32,
  paramValues: 50,
} as const

const L = TURN_CONTEXT_LIMITS
const positive = z.number().int().positive()
const scalar = z.union([z.string(), z.number()])

export const instanceSchema = z
  .object({
    name: z.string().max(L.instanceName),
    edition: z.enum(['CE', 'EE', 'HUB']),
    features: z.array(z.string().max(L.featureChars)).max(L.listItems),
    plugins: z.array(z.string().max(L.pluginChars)).max(L.listItems),
    maps: z
      .array(z.object({ id: z.string().max(L.mapIdChars), label: z.string().max(L.mapLabelChars) }).strict())
      .max(L.maps),
  })
  .strict()

export const dataSourceEntrySchema = z
  .object({
    id: positive,
    name: z.string().max(L.sourceNameChars),
    type: z.string().max(L.sourceTypeChars),
    syntax: z.string().max(L.syntaxChars),
    viewOnly: z.boolean(),
    noSchema: z.boolean().optional(),
    resources: z.array(z.string().max(L.resourceChars)).max(L.resources).nullable().optional(),
  })
  .strict()

const readyParamSchema = z
  .object({
    name: z.string().max(L.paramNameChars),
    type: z.string().max(L.paramTypeChars),
    default: scalar.nullable().optional(),
    values: z.array(scalar).max(L.paramValues),
    valuesTruncated: z.boolean().optional(),
    backingQueryId: positive.nullable().optional(),
  })
  .strict()

export const readyQuerySchema = z
  .object({
    choiceId: z.string().max(L.choiceIdChars),
    queryId: positive,
    name: z.string().max(L.queryNameChars),
    dataSourceId: positive,
    visualizationId: positive,
    params: z.array(readyParamSchema).max(L.params),
    more: z.boolean(),
  })
  .strict()

export type InstanceProfile = z.infer<typeof instanceSchema>
export type DataSourceEntry = z.infer<typeof dataSourceEntrySchema>
export type ReadyQuery = z.infer<typeof readyQuerySchema>
export type ReadyParam = z.infer<typeof readyParamSchema>

export interface TurnContext {
  instance?: InstanceProfile
  dataSources?: DataSourceEntry[]
  readyQueries?: ReadyQuery[]
}

function cut(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

function cutList(values: string[], items: number, chars: number): string[] {
  return values.slice(0, items).map((one) => cut(one, chars))
}

function clampInstance(instance: InstanceProfile): InstanceProfile {
  return {
    ...instance,
    name: cut(instance.name, L.instanceName),
    features: cutList(instance.features, L.listItems, L.featureChars),
    plugins: cutList(instance.plugins, L.listItems, L.pluginChars),
    maps: instance.maps
      .slice(0, L.maps)
      .map((map) => ({ id: cut(map.id, L.mapIdChars), label: cut(map.label, L.mapLabelChars) })),
  }
}

function clampSource(source: DataSourceEntry): DataSourceEntry {
  return {
    ...source,
    name: cut(source.name, L.sourceNameChars),
    type: cut(source.type, L.sourceTypeChars),
    syntax: cut(source.syntax, L.syntaxChars),
    ...(source.resources ? { resources: cutList(source.resources, L.resources, L.resourceChars) } : {}),
  }
}

function clampParam(param: ReadyParam): ReadyParam {
  return {
    ...param,
    name: cut(param.name, L.paramNameChars),
    type: cut(param.type, L.paramTypeChars),
    values: param.values.slice(0, L.paramValues),
    valuesTruncated: param.valuesTruncated === true || param.values.length > L.paramValues,
  }
}

function clampQuery(query: ReadyQuery): ReadyQuery {
  return {
    ...query,
    choiceId: cut(query.choiceId, L.choiceIdChars),
    name: cut(query.name, L.queryNameChars),
    params: query.params.slice(0, L.params).map(clampParam),
  }
}

function valid<T>(schema: z.ZodType<T>, values: T[]): T[] {
  return values.filter((value) => schema.safeParse(value).success)
}

export function clampTurnContext(context: TurnContext): TurnContext {
  const instance = context.instance ? clampInstance(context.instance) : undefined
  const clamped: TurnContext = {}
  if (instance && instanceSchema.safeParse(instance).success) clamped.instance = instance
  if (context.dataSources) {
    clamped.dataSources = valid(dataSourceEntrySchema, context.dataSources.map(clampSource)).slice(0, L.dataSources)
  }
  if (context.readyQueries) {
    clamped.readyQueries = valid(readyQuerySchema, context.readyQueries.map(clampQuery)).slice(0, L.readyQueries)
  }
  return clamped
}
