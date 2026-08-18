# 更新 API 成功後に一覧が古いまま残る不具合のデバッグ記録

## 対象の不具合

製品一覧を表示した状態で先頭製品の名前を更新すると、`PATCH /api/products/p-1` は更新済みの製品を返し、更新後に `GET /api/products` を独立して実行してもサーバー正本は更新済みでした。それにもかかわらず、`ProductList.vue` の最終 DOM は更新前の `出荷準備中` を表示しました。期待する契約は、更新 API とサーバー正本が更新済みなら、表示中の一覧と TanStack Query の該当キャッシュも更新済みになることです。

| 観測点 | 期待値 | バグ状態の実際値 |
| --- | --- | --- |
| API 境界 | PATCH が更新済み製品を返す | `出荷準備中（更新済み）` を返した |
| サーバー正本 | PATCH 後の GET が更新済み製品を返す | `出荷準備中（更新済み）` を返した |
| Query Cache | 表示中の一覧キーが stale 化・再取得される | 旧値を保持し、`isInvalidated: false` |
| 最終 DOM | 更新済み製品名を表示する | `出荷準備中` のまま |

## 再現条件

バグ状態のコミットは [`2cc3c89`](https://github.com/tonbiattack/nuxt-tanstack-query-cache-debug-lab/commit/2cc3c89) です。

```bash
git checkout 2cc3c89
pnpm install
pnpm test
```

実測した失敗は次のとおりです。完全な出力は [`bug-test-output.txt`](./bug-test-output.txt) に保存しています。

```text
Expected: "出荷準備中（更新済み）"
Received: "出荷準備中"
```

テストは失敗する前に、更新 API の応答と `readServerProduct('p-1')` による独立したサーバー正本の再読込が更新済みであることを確認しています。したがって、HTTP 成功だけを根拠にせず、画面だけが旧値である差分を固定しています。

## 調査

| 確認対象 | 観測結果 | 判断 |
| --- | --- | --- |
| 初期入力・初期 DOM | `出荷準備中` を表示した | 初期の一覧取得と描画は正常 |
| mutation 境界 | 成功状態となり、更新済み製品を返した | 更新 API 自体の失敗ではない |
| サーバー正本 | GET → PATCH → GET で更新後の GET が更新済み製品を返した | 保存されていないという仮説を除外 |
| QueryClient の実キー | `['products', { scope: 'catalog' }]` | 画面が購読するキャッシュはこのキー |
| 一時ログ | 旧値、`isInvalidated: false`、`fetchStatus: 'idle'` | 無効化・再フェッチが起きていない |
| mutation 側の実装 | `['products']` に `exact: true` を指定 | 完全一致の条件で一覧キーが対象外 |
| `staleTime` | `Infinity` | 一致しない無効化を補う自動再取得は起きない |
| `gcTime` | 30 分 | inactive query の破棄時刻であり、active な旧表示の直接原因ではない |

一時ログの実測値は [`cache-observation-bug.txt`](./cache-observation-bug.txt) に残しています。`queryKey`、キャッシュ値、`isInvalidated`、`fetchStatus` を同時に見ることで、mutation の成功とキャッシュ更新を別の状態遷移として扱えました。HTTP の実測は [`http-api-observation.txt`](./http-api-observation.txt) にあります。

Vue Devtools では、画面の mutation 成功表示だけで結論を出さず、Vue Query の表示中一覧クエリについて実キー、data、fresh/stale、fetch status を確認します。本件ではテスト内のログで候補を十分に除外できたため、デバッガーのブレークポイントは使用していません。

## 原因

直接原因は、mutation 成功後の `invalidateQueries` が一覧の実 `queryKey` と一致しなかったことです。バグ実装は `['products']` を `exact: true` で無効化していましたが、画面のクエリは `['products', { scope: 'catalog' }]` です。TanStack Query の公式仕様では、`exact: true` を付けると完全に一致する key だけが対象です。そのため、接頭辞が同じでもこの二つのキーは一致しません。[TanStack Query: Query Invalidation](https://tanstack.com/query/latest/docs/framework/vue/guides/query-invalidation)

TanStack Query は query key をキャッシュの識別子として使い、取得対象を一意に表すキーを求めます。配列の並びも同一性に影響します。[TanStack Query: Query Keys](https://tanstack.com/query/latest/docs/framework/vue/guides/query-keys) この不具合は、変数を key から欠落させる問題ではなく、mutation 側の完全一致フィルターと表示側の実キーが異なる問題です。

`staleTime: Infinity` は手動で正しく無効化されるまで自動再取得を発生させません。正しく一致する `invalidateQueries` はこの設定を上書きして stale 化できますが、本件では対象クエリの一致自体がなかったため機能しませんでした。[TanStack Query: Important Defaults](https://tanstack.com/query/latest/docs/framework/vue/guides/important-defaults)

## 修正

修正コミットは [`21a4e37`](https://github.com/tonbiattack/nuxt-tanstack-query-cache-debug-lab/commit/21a4e37) です。`exact: true` を除去し、`productKeys.all` の `['products']` を接頭辞フィルターとして使うだけにしました。

```ts
await queryClient.invalidateQueries({
  queryKey: productKeys.all,
})
```

これにより表示中の `['products', { scope: 'catalog' }]` が無効化対象となり、active な `useQuery` が再フェッチします。`refetchQueries` を追加する代わりに、対象選択をまず正しくする最小修正です。誤った `exact: true` を残したまま refetch を呼んでも、同じフィルターで対象を見つけられません。

更新 API の応答で一覧全体を正確に更新できる場合は、`setQueryData` による不変更新も代替です。本ラボはサーバー正本を再読込する契約を検証するため、`onSuccess` での無効化・再フェッチを選びました。[TanStack Query: Updates from Mutation Responses](https://tanstack.com/query/latest/docs/framework/vue/guides/updates-from-mutation-responses)

## 回帰確認

修正済みコミットで次を実行しました。

```bash
git checkout 21a4e37
pnpm test
pnpm typecheck
pnpm build
```

実測結果は、Vitest が 1 ファイル・1 テスト成功、Nuxt の型検査成功、Nuxt の本番ビルド成功です。回帰テストは mutation の成功、サーバー正本、最終 DOM、一覧 API が 2 回呼ばれること、`productKeys.list()` のキャッシュが更新済みであることを検証します。

## 設計上の制約

サーバー正本は再現を決定的にするインメモリ配列で、再起動すると初期値へ戻ります。並行更新、楽観的更新、ページング、複数の一覧バリアント、SSR hydration は扱いません。実務で `setQueryData` を採用する場合は、mutation レスポンスが一覧の正本を十分に表すか、更新を不変に行えるかを別途確認します。
