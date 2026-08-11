import type { QueryResultData } from '@/lib/mock-data'

function toCsv(data: QueryResultData, separator = ','): string {
  const escape = (val: unknown): string => {
    const s = val == null ? '' : String(val)
    if (s.includes(separator) || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const header = data.columns.map((c) => escape(c.friendly_name)).join(separator)
  const rows = data.rows.map((row) =>
    data.columns.map((c) => escape(row[c.name])).join(separator)
  )
  return [header, ...rows].join('\n')
}

function downloadString(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function downloadCSV(data: QueryResultData, filename = 'query_result.csv') {
  downloadString(toCsv(data, ','), filename, 'text/csv;charset=utf-8;')
}

export function downloadTSV(data: QueryResultData, filename = 'query_result.tsv') {
  downloadString(toCsv(data, '\t'), filename, 'text/tab-separated-values;charset=utf-8;')
}
