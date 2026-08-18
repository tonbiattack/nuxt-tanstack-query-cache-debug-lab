# Nuxt + TanStack Query キャッシュ更新デバッグラボ

Nuxt 3、Vue 3、`@tanstack/vue-query` を使い、**更新 API は成功しサーバー側の製品データも更新されているのに、一覧画面だけ更新前の値を表示し続ける**不具合を再現・調査・修正するための最小プロジェクトです。記事の根拠となる再現環境として、API 境界、サーバー正本、TanStack Query のキャッシュ、最終 DOM を個別に確認します。

> このラボの直接原因は、検索条件を `queryKey` に入れ忘れる問題ではありません。表示中の一覧キーが `['products', { scope: 'catalog' }]` であるのに、mutation 成功後に `['products']` を `exact: true` で無効化していたため、無効化対象が一致しなかった問題です。既存の `nuxt-usefetch-watch-lab` が扱う Nuxt `useFetch` の監視停止とも、既存の queryKey 欠落題材とも論点を分けています。

## 問題概要

初期表示で `useQuery()` が製品一覧を取得します。更新ボタンは `useMutation()` で `PATCH /api/products/p-1` を実行し、成功時に一覧クエリを無効化する実装です。しかしバグ状態では無効化フィルターに `exact: true` を指定しているため、接頭辞は同じでも配列全体が異なる一覧キーを見つけられません。

| 観測対象 | バグ状態の値 | 意味 |
| --- | --- | --- |
| 一覧の実 `queryKey` | `['products', { scope: 'catalog' }]` | 画面が購読するキャッシュ |
| mutation 側の無効化キー | `['products']` + `exact: true` | 完全一致のみを対象にするフィルター |
| 更新 API の応答 | `出荷準備中（更新済み）` | API 境界は成功 |
| 更新後に再読込したサーバー正本 | `出荷準備中（更新済み）` | サーバー側の状態は正しい |
| 画面と Query Cache | `出荷準備中` | 一覧クエリが無効化されず、古いキャッシュを描画 |

TanStack Query は query key に基づいてキャッシュを管理します。query key は取得対象を一意に表す必要があり、配列の要素順も識別子の一部です。[TanStack Query: Query Keys](https://tanstack.com/query/latest/docs/framework/vue/guides/query-keys)

## 再現方法

前提は Node.js 22 系と pnpm 11 系です。依存関係を取得して、まず失敗を再現します。

```bash
git clone https://github.com/tonbiattack/nuxt-tanstack-query-cache-debug-lab.git
cd nuxt-tanstack-query-cache-debug-lab

git checkout 2cc3c89
pnpm install
pnpm test
```

次の期待値と実際値の差分で、テストが失敗します。

```text
Expected: "出荷準備中（更新済み）"
Received: "出荷準備中"
```

ブラウザでも確認できます。バグコミットで `pnpm dev` を実行し、`http://localhost:3000` を開いてから「先頭製品を更新する」を押してください。成功メッセージが表示されても一覧の名前は古いままです。

## 期待結果

更新 API が成功した場合、サーバーが返す更新済み製品と、後から独立して読み直したサーバー正本が一致し、表示中の一覧も同じ更新済み製品名へ変わることが期待値です。回帰テストは API の呼び出し回数だけでなく、最終 DOM、サーバー正本、QueryClient の一覧キャッシュを検証します。

## 実際の結果

バグコミットでは mutation の成功状態と API の更新済みレスポンスを確認できます。それでも `ProductList` が読む `['products', { scope: 'catalog' }]` のキャッシュは stale にならず、再フェッチも発生しません。`staleTime: Infinity` を設定しているため、明示的に無効化されない限り、このクエリは自動再フェッチされません。[TanStack Query: Important Defaults](https://tanstack.com/query/latest/docs/framework/vue/guides/important-defaults)

なお `gcTime: 30 * 60 * 1000` は、購読者がいない inactive query をいつ破棄するかを決める設定です。表示中の active query を古い値のままにする直接原因ではありません。`gcTime` と `staleTime` を同じ「キャッシュ時間」として扱わないことが重要です。

## 調査方法

調査では、HTTP 応答だけで結論を出さず、次の順に状態を切り分けます。`docs/http-api-observation.txt` には GET → PATCH → GET の実測結果、`docs/cache-observation-bug.txt` にはバグ状態の QueryClient 観測ログを残しています。

| 順序 | 観測するもの | バグ状態で確認した事実 |
| --- | --- | --- |
| 1 | 初期 DOM と一覧 API | 初期値 `出荷準備中` は正しく表示される |
| 2 | mutation の成功状態と応答 | 更新 API は更新済み製品を返す |
| 3 | サーバー正本の再読込 | PATCH 後の GET は `出荷準備中（更新済み）` を返す |
| 4 | QueryClient の実キーとキャッシュ | 一覧キーは `['products', { scope: 'catalog' }]`、キャッシュ値は旧値のまま |
| 5 | QueryClient の状態ログ | `isInvalidated: false`、`fetchStatus: 'idle'` |
| 6 | 最終 DOM | 一覧は `出荷準備中` のまま |

Vue Devtools を使う場合も、mutation の成功表示だけで完了と判断せず、Vue Query の一覧クエリで実際のキー、`isInvalidated`、data、fetch status を確認してください。本ラボでは自動テストに一時ログを入れ、上記の状態を保存した後にログを除去しています。

## 原因

バグ状態の実装は次のとおりです。

```ts
await queryClient.invalidateQueries({
  queryKey: productKeys.all, // ['products']
  exact: true,
})
```

一方、表示中のクエリは次のキーです。

```ts
queryKey: productKeys.list(), // ['products', { scope: 'catalog' }]
```

`exact: true` は完全一致する key だけを無効化します。そのため `['products']` と `['products', { scope: 'catalog' }]` は「製品一覧」に見えても一致しません。TanStack Query の無効化は、キーが一致したクエリを stale にし、表示中ならバックグラウンドで再フェッチします。今回、その最初の一致が起きていませんでした。[TanStack Query: Query Invalidation](https://tanstack.com/query/latest/docs/framework/vue/guides/query-invalidation)

## 修正

修正は `exact: true` を除き、一覧キーの接頭辞で無効化することだけです。

```ts
await queryClient.invalidateQueries({
  queryKey: productKeys.all, // ['products']
})
```

これにより `['products']` で始まる `['products', { scope: 'catalog' }]` が対象になります。`invalidateQueries()` は一致した表示中のクエリを stale として、`staleTime: Infinity` を上書きし、再フェッチします。[TanStack Query: Query Invalidation](https://tanstack.com/query/latest/docs/framework/vue/guides/query-invalidation)

`refetchQueries()` を追加するだけでは根本解決になりません。誤った `exact: true` フィルターをそのまま渡せば、再フェッチ対象も見つからないためです。先に一覧の実キーとフィルターの一致規則を確認します。

mutation の成功レスポンスに十分な一覧データがある場合は、`setQueryData()` を不変更新で使って直接キャッシュを更新する設計もあります。本ラボはサーバー正本の再読込を明示的に確認するため、無効化と再フェッチを採用しました。[TanStack Query: Updates from Mutation Responses](https://tanstack.com/query/latest/docs/framework/vue/guides/updates-from-mutation-responses)

## 回帰テスト

修正済みの `main` では次を実行します。

```bash
git switch main
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

回帰テストは、次の契約を同時に検証します。

| 確認対象 | 回帰テストの条件 |
| --- | --- |
| 更新 API | 更新済みの製品を返す |
| サーバー正本 | 更新 API 後の再読込で更新済みである |
| 最終 DOM | 更新済み製品名を表示する |
| 一覧再取得 | `list()` が初期表示と更新後の 2 回呼ばれる |
| Query Cache | `productKeys.list()` に更新済み製品を保持する |

`exact: true` を戻すと、最終 DOM の期待値で同じ失敗が再現します。したがってテストは「mutation が成功した」だけでなく、「利用者が見る一覧がサーバー正本へ追随した」ことを守ります。

## TanStack Queryとしての学び

| 仕組み | この不具合での位置付け |
| --- | --- |
| `queryKey` | キャッシュを識別し、無効化フィルターとの照合対象になる。見た目が似た key でも配列全体が違えば完全一致しない。 |
| `staleTime` | fresh と見なす期間である。`Infinity` は通常の自動再フェッチを止めるが、正しく一致する `invalidateQueries` は有効である。 |
| `gcTime` | inactive query を破棄するまでの時間であり、表示中の値の鮮度を決めない。 |
| `invalidateQueries` | 一致したクエリを stale にする。active なら再フェッチも起こる。 |
| `refetch` | 明示的な再取得は可能だが、フィルターや対象 key が間違っていれば正しいクエリは更新されない。 |
| mutation 成功後のキャッシュ更新 | `onSuccess` で無効化・再フェッチするか、応答を使って `setQueryData` で不変更新する。更新 API の HTTP 成功だけでは Query Cache は変わらない。 |

本ラボの実装は一覧が一つだけですが、実際の画面ではページング、検索語、並び順、テナント、権限などを key factory に集約し、mutation 側も同じ factory から無効化対象を組み立てると照合漏れをレビューしやすくなります。

## プロジェクト構成

| パス | 役割 |
| --- | --- |
| `components/ProductList.vue` | `useQuery`、`useMutation`、無効化処理を持つ画面コンポーネント |
| `shared/product-keys.ts` | 一覧と接頭辞の query key factory |
| `server/api/products/` | 製品一覧取得と更新の Nuxt サーバー API |
| `tests/product-list.cache.test.ts` | API、サーバー正本、Query Cache、DOM を確認する回帰テスト |
| `docs/debugging-record.md` | 実測した観測・仮説・原因・コミットをまとめた記録 |

## 制約

サーバー正本は決定的に再現するためのインメモリ配列であり、プロセスを再起動すると初期化されます。ネットワーク遅延、並行更新、楽観的更新、ページネーション、SSR hydration は本ラボの範囲外です。これらを扱う場合でも、更新 API の結果、サーバー正本、クエリの実キー、キャッシュ状態、最終 DOM を分けて観測する順序は同じです。

## References

- [TanStack Query: Query Keys](https://tanstack.com/query/latest/docs/framework/vue/guides/query-keys)
- [TanStack Query: Important Defaults](https://tanstack.com/query/latest/docs/framework/vue/guides/important-defaults)
- [TanStack Query: Query Invalidation](https://tanstack.com/query/latest/docs/framework/vue/guides/query-invalidation)
- [TanStack Query: Invalidations from Mutations](https://tanstack.com/query/latest/docs/framework/vue/guides/invalidations-from-mutations)
- [TanStack Query: Updates from Mutation Responses](https://tanstack.com/query/latest/docs/framework/vue/guides/updates-from-mutation-responses)
