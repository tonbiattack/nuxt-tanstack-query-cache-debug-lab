export const productKeys = {
  all: ['products'] as const,
  list: () => ['products', { scope: 'catalog' }] as const,
}
