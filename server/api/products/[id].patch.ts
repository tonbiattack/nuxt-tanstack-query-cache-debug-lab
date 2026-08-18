import { renameProduct } from '~/server/utils/product-store'

type RenameBody = {
  name?: unknown
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<RenameBody>(event)

  if (!id || typeof body?.name !== 'string' || body.name.trim() === '') {
    throw createError({
      statusCode: 400,
      statusMessage: '製品IDと空ではない製品名が必要です。',
    })
  }

  return renameProduct(id, body.name)
})
