import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount } from '@vue/test-utils'
import ProductList from '~/components/ProductList.vue'
import { productKeys } from '~/shared/product-keys'
import type { Product, ProductsApi, RenameProductInput } from '~/shared/product'

class InMemoryProductsApi implements ProductsApi {
  private products: Product[] = [
    {
      id: 'p-1',
      name: '出荷準備中',
      updatedAt: '2026-08-18T00:00:00.000Z',
    },
  ]

  public lastUpdateResponse: Product | undefined
  public listCallCount = 0

  async list(): Promise<Product[]> {
    this.listCallCount += 1
    return this.products.map((product) => ({ ...product }))
  }

  async updateName(input: RenameProductInput): Promise<Product> {
    const product = this.products.find((candidate) => candidate.id === input.id)

    if (!product) {
      throw new Error('製品が見つかりません。')
    }

    product.name = input.name
    product.updatedAt = '2026-08-18T00:00:01.000Z'
    this.lastUpdateResponse = { ...product }

    return { ...product }
  }

  readServerProduct(id: string): Product | undefined {
    const product = this.products.find((candidate) => candidate.id === id)
    return product ? { ...product } : undefined
  }
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  })
}

describe('製品名の更新後に一覧キャッシュを同期する契約', () => {
  it('更新APIとサーバー正本が更新済みなら、画面も更新済みの製品名を表示する', async () => {
    const api = new InMemoryProductsApi()
    const queryClient = createQueryClient()
    const wrapper = mount(ProductList, {
      props: { api },
      global: {
        plugins: [[VueQueryPlugin, { queryClient }]],
      },
    })

    await vi.waitFor(() => {
      expect(wrapper.get('[data-testid="product-list"]').text()).toContain('出荷準備中')
    })

    await wrapper.get('[data-testid="rename-product"]').trigger('click')
    await flushPromises()

    await vi.waitFor(() => {
      expect(wrapper.get('[data-testid="mutation-status"]').text()).toContain('成功')
    })

    // APIの成功レスポンスと、後から読み直したサーバー正本は更新済みである。
    expect(api.lastUpdateResponse?.name).toBe('出荷準備中（更新済み）')
    expect(api.readServerProduct('p-1')?.name).toBe('出荷準備中（更新済み）')

    // 利用者が見る最終DOMも更新済みになることが契約である。
    await vi.waitFor(
      () => {
        expect(wrapper.get('[data-testid="product-list"]').text()).toContain('出荷準備中（更新済み）')
      },
      { timeout: 150 },
    )

    expect(api.listCallCount).toBe(2)
    expect(queryClient.getQueryData(productKeys.list())).toEqual([
      expect.objectContaining({ name: '出荷準備中（更新済み）' }),
    ])
  })
})
