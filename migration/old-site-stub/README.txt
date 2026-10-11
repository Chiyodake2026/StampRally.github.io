旧サイト用の「転送ページ」です（index.html と 404.html は、同じ内容です）

使い方（旧リポジトリ KoeiSuzuki/Chiyodake を、転送専用にする場合）
  1. 新しいサイト（Organization側）に、最新のファイルを送り、動作を確認できたことを確認する
  2. 旧リポジトリの内容を、この2つのファイルだけにする
       index.html
       404.html
     （旧リポジトリは削除しないでください。削除すると、旧URLが404になり、転送できなくなります）
  3. 旧リポジトリの Settings > Pages が、引き続き有効（main ブランチ / ルート）であることを確認する
  4. 旧URL（https://koeisuzuki.github.io/Chiyodake/?stamp=river など）を開いて、新しいURLに移動することを確認する

新しいURLが、https://chiyodake2026.github.io 以外の場合
（独自ドメインの設定をしたときなど）は、2つのファイルの NEW_BASE を書き換えてください。
