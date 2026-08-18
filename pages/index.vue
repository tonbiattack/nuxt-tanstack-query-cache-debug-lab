<script setup lang="ts">
import type { ProductsApi } from '~/shared/product'

const api: ProductsApi = {
  list: () => $fetch('/api/products'),
  updateName: (input) => $fetch(`/api/products/${input.id}`, {
    method: 'PATCH',
    body: { name: input.name },
  }),
}
</script>

<template>
  <main>
    <ProductList :api="api" />
  </main>
</template>
