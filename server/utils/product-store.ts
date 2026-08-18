import type { Product } from '~/shared/product'

const products: Product[] = [
  {
    id: 'p-1',
    name: '出荷準備中',
    updatedAt: '2026-08-18T00:00:00.000Z',
  },
]

export function listProducts(): Product[] {
  return products.map((product) => ({ ...product }))
}

export function renameProduct(id: string, name: string): Product {
  const product = products.find((candidate) => candidate.id === id)

  if (!product) {
    throw createError({
      statusCode: 404,
      statusMessage: '製品が見つかりません。',
    })
  }

  product.name = name
  product.updatedAt = new Date().toISOString()

  return { ...product }
}
