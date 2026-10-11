#!/usr/bin/env python3
"""
公開前に実行する：HTMLが読み込む CSS / JavaScript の URL に、ファイルの「中身」から作った版（?v=…）を付ける。

なぜ必要か：
  GitHub Pages は、ファイルを10分間ブラウザに保存（キャッシュ）させます。公開した直後に、
  HTMLだけが新しくて CSS が古いまま、という組み合わせが起きると、画面が崩れたり、
  「コンプリート」のように、本来は隠れているはずの表示が見えてしまうことがあります。
  ファイルの URL に中身から作った版（例：style.css?v=1a2b3c4d）を付けておくと、
  中身が変わったときだけ URL が変わり、ブラウザは必ず新しいファイルを取得します。

使い方：
  python3 scripts/stamp_assets.py            版を更新する（変更があったHTMLの名前を表示する）
  python3 scripts/stamp_assets.py --check    更新が必要なら、その内容を表示して終了コード1で終わる（確認用）

CSS・JavaScript・js/config.js などを変更したら、コミットの前に、必ず1回実行してください。
（毎回の実行を忘れないようにするには、README の「公開前のチェック」の、自動実行の設定を使えます）
"""
import hashlib
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".git", "node_modules", "migration", "scripts", "sql", "gas"}
# <link ... href="x.css"> と <script ... src="x.js"> のうち、このサイト内のファイルだけを対象にする
TAG = re.compile(r'(<(?:link|script)\b[^>]*?\b(?:href|src)=")([^"#?]+\.(?:css|js))(?:\?v=[0-9a-f]+)?(")', re.I)


def html_files():
    found = []
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        found += [os.path.join(base, f) for f in files if f.endswith(".html")]
    return sorted(found)


def short_hash(path):
    with open(path, "rb") as f:
        return hashlib.sha1(f.read()).hexdigest()[:8]


def stamp(html_path, apply):
    """戻り値：(更新後の文章, 変更の一覧)。外部のURL（http…）や、見つからないファイルは変更しない。"""
    with open(html_path, encoding="utf-8") as f:
        text = f.read()
    changes = []

    def repl(m):
        head, url, tail = m.group(1), m.group(2), m.group(3)
        if re.match(r"^(?:[a-z]+:)?//", url) or url.startswith("/"):
            return m.group(0)
        target = os.path.normpath(os.path.join(os.path.dirname(html_path), url))
        if not os.path.isfile(target):
            changes.append((url, "ファイルが見つかりません"))
            return m.group(0)
        new = f"{head}{url}?v={short_hash(target)}{tail}"
        if new != m.group(0):
            changes.append((url, "版を更新"))
        return new

    return TAG.sub(repl, text), changes


def main():
    check = "--check" in sys.argv
    problems = 0
    changed = []
    for path in html_files():
        rel = os.path.relpath(path, ROOT)
        text, changes = stamp(path, not check)
        missing = [c for c in changes if c[1] != "版を更新"]
        if missing:
            problems += 1
            for url, why in missing:
                print(f"  × {rel}: {url}：{why}")
        updates = [c for c in changes if c[1] == "版を更新"]
        if updates:
            changed.append(rel)
            if check:
                problems += 1
                print(f"  × {rel}: 版が古い、または未設定です → " + ", ".join(u for u, _ in updates))
            else:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(text)
    if check:
        print("版の確認：問題なし" if not problems else f"版の確認：{problems} 件の問題があります。python3 scripts/stamp_assets.py を実行してください")
        return 1 if problems else 0
    for rel in changed:
        print(rel)
    if not changed and not problems:
        print("版は、すでに最新です（変更なし）")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
