import { listProducts } from '~/server/utils/product-store'

export default defineEventHandler(() => {
  return listProducts()
})
