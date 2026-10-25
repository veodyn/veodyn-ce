export interface NewQueryProposal {
  name: string
  description: string
  sql: string
  datasetTable?: string
  vizChoiceId: string
  // As QueryProposal.vizOptions, and required for the same reason.
  vizOptions: Record<string, unknown>
}
