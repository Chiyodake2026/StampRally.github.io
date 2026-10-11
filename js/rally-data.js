/*
 * スタンプラリーの設定データ（運営者が編集するファイル）
 *
 * ここに書いた内容が、スタンプラリー画面の「スタンプポイント」に表示されます。
 * Supabaseの接続設定（js/config.js）とは別のファイルです。秘密の情報は書かないでください。
 *
 * 【場所を入力する前に確認してください】
 *   場所を公開して問題ないかを、運営側で確認したうえで入力してください。
 *   何も入力していないポイントは、「場所は準備中です。」と表示され、地図のリンクも出ません。
 */

// 景品に関する、参加者への補足（空のままなら表示されません）
// 例：「景品がなくなり次第、終了します」「受け取り方法は、アンケート送信後にご案内します」
// ※ 在庫・条件を運営側で確認してから入力してください。コンプリートしたことと、景品を受け取れることは別です。
window.RALLY_PRIZE = {
  notice: ""
};

// 各ポイントの場所。キーは、スタンプの種類（river / bridge / fish / island / water / goal）です。
//   description：場所の簡単な説明（例：「◯◯公園の入口にあります」）
//   address    ：住所（座標を入力した場合は、座標が優先されます）
//   lat, lng   ：緯度・経度（数字）。Googleマップで場所を右クリック（スマートフォンは長押し）すると、
//                 「35.69…, 139.77…」のように表示されるので、前が緯度、後ろが経度です。
//   mapQuery   ：Googleマップで探すための言葉（施設名など）。住所の代わりに使えます。
// 住所・座標・mapQuery のどれも入っていないポイントには、地図のリンクを出しません（推測で場所を決めません）。
window.RALLY_SPOTS = {
  river:  { description: "", address: "", lat: null, lng: null, mapQuery: "" },
  bridge: { description: "", address: "", lat: null, lng: null, mapQuery: "" },
  fish:   { description: "", address: "", lat: null, lng: null, mapQuery: "" },
  island: { description: "", address: "", lat: null, lng: null, mapQuery: "" },
  water:  { description: "", address: "", lat: null, lng: null, mapQuery: "" },
  goal:   { description: "", address: "", lat: null, lng: null, mapQuery: "" }
};

// 地図のプレビュー（「地図を表示」を押したときだけGoogleマップを読み込みます）。使わないときは false
window.RALLY_SPOTS_PREVIEW = true;

// 全ポイントをまとめた地図（Googleマイマップなどの共有URL）。
// 6か所すべての場所が上に入力されていて、このURLが入っているときだけ、「全ポイントの地図」リンクを表示します。
// 例：https://www.google.com/maps/d/viewer?mid=…
window.RALLY_SPOTS_OVERVIEW_URL = "";
