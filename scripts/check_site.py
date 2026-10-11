#!/usr/bin/env python3
"""
サイト全体の整合性を検査する（公開前のチェック用）。

  python3 scripts/check_site.py

検査する内容：
  1. HTMLの構造（閉じ忘れ、同じIDの重複）
  2. JavaScript が参照するIDが、そのページのHTMLにあるか
  3. HTMLが読み込むファイル（CSS・JS・リンク先）が実際に存在するか
  4. CSSで使っている変数（var(--…)）が、どこかで定義されているか
  5. 色：ブランドカラー（と、その淡い色）以外の色が使われていないか
  6. フォント：フォントファイルがリポジトリに入っていないか、フォント指定が brand.css に集約されているか
  7. hidden属性が、他のCSSに負けないようになっているか
  8. ファイルの版（?v=…）が最新か（scripts/stamp_assets.py --check）
  9. JavaScript の文法、秘密鍵が含まれていないこと、js/config.js が変更されていないこと
問題があると、× を表示して、終了コード1で終わります（注意は、終了コードに影響しません）。
"""
import html.parser
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".git", "node_modules", "migration", "scripts"}
VOID = {"meta", "link", "br", "hr", "img", "input", "source", "area", "base", "col", "embed", "param", "track", "wbr", "path", "circle", "use", "rect", "stop"}

BRAND_COLORS = {"#30557e", "#4d89b7", "#62adca", "#ffffff", "#fff"}
TINTS = {"#ecf5f9", "#dcedf3", "#c8e2ec", "#d2e2ed", "#eef1f5", "#4f6e91"}          # 上の色を白に重ねた色／補助の文字色（brand.css で定義）
ADMIN_ERROR = {"#b42318", "#fdecea", "#f3b8b2"}                                     # 管理画面のエラー表示だけの例外
RGB_OK = {(255, 255, 255), (48, 85, 126), (98, 173, 202)}

failures, warnings = [], []


def ok(msg):
    print(f"  ✓ {msg}")


def bad(msg):
    failures.append(msg)
    print(f"  × {msg}")


def warn(msg):
    warnings.append(msg)
    print(f"  △ {msg}")


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


def files(ext):
    out = []
    for base, dirs, names in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        out += [os.path.relpath(os.path.join(base, n), ROOT) for n in names if n.endswith(ext)]
    return sorted(out)


class Page(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids, self.dups, self.stack, self.errors = set(), [], [], []
        self.assets, self.links, self.in_comment = [], [], False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            if a["id"] in self.ids:
                self.dups.append(a["id"])
            self.ids.add(a["id"])
        if tag == "link" and a.get("href"):
            self.assets.append(a["href"])
        if tag == "script" and a.get("src"):
            self.assets.append(a["src"])
        if tag == "a" and a.get("href"):
            self.links.append(a["href"])
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        pass  # <path/> などの自己閉じ

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if tag in self.stack:
            while self.stack and self.stack[-1] != tag:
                self.errors.append(f"<{self.stack.pop()}> が閉じられていません")
            self.stack.pop()
        else:
            self.errors.append(f"</{tag}> に対応する開始タグがありません")


def parse(rel):
    p = Page()
    p.feed(read(rel))
    p.errors += [f"<{t}> が閉じられていません" for t in p.stack if t not in {"html", "body", "head"}]
    return p


def main():
    pages = {rel: parse(rel) for rel in files(".html")}

    print("1. HTMLの構造")
    for rel, p in pages.items():
        if p.dups:
            bad(f"{rel}: 同じIDが重複しています：{sorted(set(p.dups))}")
        for e in p.errors[:5]:
            bad(f"{rel}: {e}")
        if not p.dups and not p.errors:
            ok(f"{rel}: 構造に問題なし（ID {len(p.ids)} 個）")

    print("2. JavaScript が参照するIDが、HTMLにあるか")
    id_ref = [re.compile(r'(?<![\w.])document\.getElementById\(\s*["\']([\w-]+)["\']'), re.compile(r'(?<![\w.])\$\(\s*["\']([\w-]+)["\']\s*\)'), re.compile(r'querySelector\(\s*["\']#([\w-]+)')]
    for rel, p in pages.items():
        base = os.path.dirname(rel)
        scripts = [os.path.normpath(os.path.join(base, a.split("?")[0])) for a in p.assets if a.split("?")[0].endswith(".js") and not a.startswith("http")]
        missing = {}
        for js in scripts:
            src = read(js)
            for rx in id_ref:
                for m in rx.finditer(src):
                    if m.group(1) not in p.ids:
                        missing.setdefault(m.group(1), js)
        if missing:
            for i, js in missing.items():
                bad(f"{rel}: {js} が参照する id=\"{i}\" が、このページにありません")
        else:
            ok(f"{rel}: 参照するIDはすべてあります（{', '.join(os.path.basename(s) for s in scripts) or 'JSなし'}）")

    print("3. 読み込むファイル・リンク先が存在するか")
    allowed_external = ("https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/")
    for rel, p in pages.items():
        base, miss = os.path.dirname(rel), []
        for ref in p.assets + p.links:
            clean = ref.split("#")[0].split("?")[0]
            if not clean or ref.startswith(("mailto:", "tel:", "javascript:", "data:")):
                continue
            if clean.startswith(("http://", "https://", "//")):
                if ref.startswith("http") and not ref.startswith(allowed_external) and not ref.startswith("https://www.google.com/maps"):
                    warn(f"{rel}: 外部のURL {ref[:70]} を読み込んでいます（意図したものか確認してください）")
                continue
            target = os.path.normpath(os.path.join(ROOT, base, clean))
            if os.path.isdir(target):
                target = os.path.join(target, "index.html")
            if not os.path.isfile(target):
                miss.append(ref)
        for m in miss:
            bad(f"{rel}: {m} が見つかりません")
        if not miss:
            ok(f"{rel}: 参照先はすべて存在します")

    print("4. CSS変数")
    css_files = files(".css")
    defined_global = set(re.findall(r"(--[\w-]+)\s*:", read("brand.css")))
    for rel in css_files:
        src = read(rel)
        defined = defined_global | set(re.findall(r"(--[\w-]+)\s*:", src))
        undefined = sorted({v for v in re.findall(r"var\(\s*(--[\w-]+)", src) if v not in defined})
        if undefined:
            bad(f"{rel}: 定義されていないCSS変数を使っています：{undefined}")
        else:
            ok(f"{rel}: 使っているCSS変数はすべて定義済み")

    print("5. 色（ブランドカラー以外が使われていないか）")
    for rel in css_files:
        src = re.sub(r"/\*.*?\*/", "", read(rel), flags=re.S)
        found = {h.lower() for h in re.findall(r"#[0-9a-fA-F]{3,8}\b", src)} | {"#" + h.lower() for h in re.findall(r"%23([0-9a-fA-F]{6})", src)}
        allowed = BRAND_COLORS | TINTS | (ADMIN_ERROR if rel.startswith("admin") else set())
        strange = sorted(found - allowed)
        rgbs = {tuple(int(x) for x in m.groups()) for m in re.finditer(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", src)}
        strange_rgb = sorted(rgbs - RGB_OK)
        names = set(re.findall(r"(?<![-\w#])(red|blue|green|orange|purple|yellow|pink|black|gray|grey)(?![-\w])", src))
        if strange or strange_rgb or names:
            bad(f"{rel}: ブランドカラー以外の色：{strange + [str(t) for t in strange_rgb] + sorted(names)}")
        else:
            ok(f"{rel}: 色はブランドカラー（と、その淡い色）だけ")
    for rel in css_files:
        if rel != "brand.css":
            hexes = re.findall(r"#[0-9a-fA-F]{3,8}\b", re.sub(r"/\*.*?\*/", "", read(rel), flags=re.S))
            direct = [h for h in hexes if not (rel.startswith("admin") and h.lower() in ADMIN_ERROR)]
            if direct:
                warn(f"{rel}: 色を直接書いています {sorted(set(direct))}（brand.css の変数を使うほうが、あとで一括変更できます）")

    print("6. フォント")
    fonts = [f for f in subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=ROOT, capture_output=True, text=True).stdout.split("\n") if re.search(r"\.(woff2?|ttf|otf|ttc|eot)$", f, re.I)]
    if fonts:
        bad(f"フォントファイルがリポジトリに含まれています（有料フォントは含めない決まりです）：{fonts}")
    else:
        ok("フォントファイルは、リポジトリに含まれていません")
    for rel in css_files:
        if rel == "brand.css":
            continue
        decl = re.findall(r"font-family\s*:\s*([^;}]+)", re.sub(r"/\*.*?\*/", "", read(rel), flags=re.S))
        direct = [d.strip() for d in decl if "var(--font" not in d and d.strip() != "inherit"]
        if direct:
            bad(f"{rel}: フォント指定が brand.css の変数を使っていません：{direct}")
    ok("各CSSのフォント指定は、brand.css の変数を使っています") if not any("フォント指定が" in f for f in failures) else None

    print("7. hidden属性")
    if re.search(r"\[hidden\]\s*\{\s*display\s*:\s*none\s*!important", read("brand.css")):
        ok("brand.css: hidden属性で隠した要素は、他のCSSに負けず、必ず隠れます")
    else:
        bad("brand.css に [hidden]{display:none!important} がありません（表示の切り替えが、CSSの読み込み状態に左右されます）")
    for rel in ("index.html",):
        src = read(rel)
        if 'class="done-wrap" hidden' in src:
            ok(f"{rel}: 「COMPLETE」の表示は、最初は hidden です")
        else:
            bad(f"{rel}: 「COMPLETE」の表示が、最初から見える状態です")

    print("8. ファイルの版（?v=…）")
    r = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "stamp_assets.py"), "--check"], capture_output=True, text=True)
    (ok if r.returncode == 0 else bad)(r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "版の確認に失敗しました")

    print("9. JavaScript・秘密鍵・接続設定")
    node = shutil.which("node") or os.path.expanduser("~/.codegpt/bin/node")
    for rel in files(".js") + ["gas/sheets-sync.gs"]:
        if rel.startswith("scripts"):
            continue
        if os.path.exists(node):
            tmp = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".syntax_check.js")
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(read(rel))
            res = subprocess.run([node, "--check", tmp], capture_output=True, text=True)
            os.remove(tmp)
            (ok if res.returncode == 0 else bad)(f"{rel}: 文法" + ("に問題なし" if res.returncode == 0 else f" エラー：{res.stderr.strip().splitlines()[-1][:100]}"))
    secret = [rel for rel in files(".js") + files(".html") + files(".css") + ["gas/sheets-sync.gs"] if re.search(r"sb_secret|eyJhbGci", read(rel)) or re.search(r"service_role\s*[=:]\s*[\"']", read(rel))]
    (bad if secret else ok)(f"秘密鍵らしき文字列：{secret}" if secret else "秘密鍵（service_role / secret key）は含まれていません")
    diff = subprocess.run(["git", "diff", "--quiet", "HEAD", "--", "js/config.js"], cwd=ROOT)
    (ok if diff.returncode == 0 else bad)("js/config.js は、変更されていません" if diff.returncode == 0 else "js/config.js が変更されています（Supabaseの接続設定は変更しない決まりです）")

    print()
    print(f"結果：{len(failures)} 件の問題、{len(warnings)} 件の注意")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
