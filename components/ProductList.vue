<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { productKeys } from '~/shared/product-keys'
import type { ProductsApi, RenameProductInput } from '~/shared/product'

const props = defineProps<{
  api: ProductsApi
}>()

const queryClient = useQueryClient()

const productsQuery = useQuery({
  queryKey: productKeys.list(),
  queryFn: () => props.api.list(),
  // デモでは自動再取得を抑え、mutation後の無効化が一致するかを明確にする。
  staleTime: Infinity,
  // 表示を離れた後もキャッシュの寿命は30分であり、freshかどうかとは別の概念である。
  gcTime: 30 * 60 * 1000,
})

const renameMutation = useMutation({
  mutationFn: (input: RenameProductInput) => props.api.updateName(input),
  onSuccess: async () => {
    // ['products'] を接頭辞として使い、表示中の
    // ['products', { scope: 'catalog' }] も無効化して再取得する。
    await queryClient.invalidateQueries({
      queryKey: productKeys.all,
    })
  },
})

function renameFirstProduct() {
  renameMutation.mutate({
    id: 'p-1',
    name: '出荷準備中（更新済み）',
  })
}
</script>

<template>
  <section>
    <h1>製品一覧</h1>
    <p data-testid="query-key">
      queryKey: ['products', { scope: 'catalog' }]
    </p>
    <p data-testid="cache-policy">
      staleTime: Infinity / gcTime: 30 minutes
    </p>

    <button data-testid="rename-product" type="button" @click="renameFirstProduct">
      先頭製品を更新する
    </button>

    <p v-if="renameMutation.isSuccess.value" data-testid="mutation-status">
      更新APIは成功しました。
    </p>

    <ul v-if="productsQuery.data.value" data-testid="product-list">
      <li v-for="product in productsQuery.data.value" :key="product.id">
        {{ product.name }}
      </li>
    </ul>

    <p v-if="productsQuery.isError.value" data-testid="query-error">
      一覧の取得に失敗しました。
    </p>
  </section>
</template>
