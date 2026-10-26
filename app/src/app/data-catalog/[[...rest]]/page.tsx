import { permanentRedirect } from 'next/navigation'

export default async function DataCatalogRedirect({
  params,
}: {
  params: Promise<{ rest?: string[] }>
}) {
  const { rest = [] } = await params
  permanentRedirect(['/data', ...rest].join('/'))
}
