export type Product = {
  id: string
  name: string
  updatedAt: string
}

export type RenameProductInput = {
  id: string
  name: string
}

export type ProductsApi = {
  list: () => Promise<Product[]>
  updateName: (input: RenameProductInput) => Promise<Product>
}
