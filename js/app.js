const STAMPS = {
  "river": {name:"川の入口"},
  "bridge": {name:"橋"},
  "fish": {name:"魚"},
  "island": {name:"島"},
  "water": {name:"水辺"},
  "goal": {name:"ゴール"}
};
const STAMP_KEYS = Object.keys(STAMPS);
// "constructor" や "__proto__" のような名前を、スタンプとして受け付けないよう、必ずこの関数で確かめる
const isStamp = code => STAMP_KEYS.includes(code);

// ---- 端末への保存 ----
// ブラウザが保存を許可していない場合（プライベートブラウズや、制限のあるアプリ内ブラウザなど）でも、
// 画面が止まらないようにします。その場合は、このページを開いている間だけ、メモリに保存します。
const participantKey = "stamp_rally_participant_id";
const timesKey = "stamp_rally_stamp_times";
const pendingKey = "stamp_rally_pending";
const stampsKey = "stamp_rally_stamps";
const surveyKey = "stamp_rally_survey_submitted";
const memoryStore = new Map();
let storageBlocked = false;
const store = {
  get(k){ try{ return localStorage.getItem(k); }catch(e){ storageBlocked=true; return memoryStore.has(k)?memoryStore.get(k):null; } },
  set(k,v){ try{ localStorage.setItem(k,v); }catch(e){ storageBlocked=true; memoryStore.set(k,String(v)); } },
  remove(k){ try{ localStorage.removeItem(k); }catch(e){ storageBlocked=true; memoryStore.delete(k); } }
};
// 保存されたスタンプの一覧を読む。壊れた値や、スタンプではない名前は取り除く
function readStampList(key){
  try{
    const value=JSON.parse(store.get(key)||"[]");
    return Array.isArray(value)?[...new Set(value.filter(isStamp))]:[];
  }catch(e){ return []; }
}

// ---- 旧サイトからの引き継ぎ ----
// 公開URLを変更したとき、旧サイトの転送ページが、参加者ID・取得済みスタンプを、URLの「#m=…」に入れて渡します
// （migration/old-site-stub/）。この端末にまだ記録がない（初めて開いた）ときだけ、受け取って保存します。
function importMigration(){
  const raw=location.hash;
  if(!raw.startsWith("#m=")) return null;
  history.replaceState(null,"",location.pathname+location.search); // 受け取ったら（値が正しくなくても）URLから消す
  try{
    const m=/^#m=([A-Za-z0-9_-]+)$/.exec(raw);
    if(!m) return null;
    if(store.get(participantKey)||store.get(stampsKey)) return null; // すでにある記録は、上書きしない
    let b64=m[1].replace(/-/g,"+").replace(/_/g,"/"); while(b64.length%4) b64+="=";
    const data=JSON.parse(atob(b64));
    if(!data||data.v!==1||!/^[0-9A-Za-z]{4,64}$/.test(String(data.id))) return null;
    const list=v=>[...new Set((Array.isArray(v)?v:[]).filter(isStamp))];
    const stamps=list(data.stamps), pending=list(data.pending), times={};
    if(data.times&&typeof data.times==="object") for(const k of stamps){
      const t=data.times[k]; if(typeof t==="string"&&!Number.isNaN(Date.parse(t))) times[k]=new Date(t).toISOString();
    }
    store.set(participantKey,data.id);
    store.set(stampsKey,JSON.stringify(stamps));
    store.set(timesKey,JSON.stringify(times));
    if(pending.length) store.set(pendingKey,JSON.stringify(pending));
    if(data.survey===data.id) store.set(surveyKey,data.id);
    return {stamps:stamps.length};
  }catch(e){ return null; }
}
const migrated = importMigration();

const participantId = getOrCreateParticipantId();
document.getElementById("participantId").textContent = participantId;
document.getElementById("total").textContent = STAMP_KEYS.length;

function getOrCreateParticipantId(){
  let id = store.get(participantKey);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID().replaceAll("-","").slice(0,10).toUpperCase()
                           : Math.random().toString(36).slice(2,12).toUpperCase();
    store.set(participantKey,id);
  }
  return id;
}

// width/height も指定しておく（スタイルシートが読み込めなくても、アイコンが巨大にならないように）
const icon=code=>`<svg class="icon" width="24" height="24" aria-hidden="true"><use href="#icon-${code}"></use></svg>`;
const stampNo=code=>String(STAMP_KEYS.indexOf(code)+1).padStart(2,"0");
const formatTime=iso=>new Date(iso).toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
const surveyUrl=()=>`survey/?participant_id=${encodeURIComponent(participantId)}`;
// 日本語の見出しを文節の区切りでだけ折り返します（「獲得しま／した」のような改行を防ぐ）。
const phrases=(...parts)=>parts.map(p=>`<span class="ph">${p}</span>`).join("");
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));

// 景品を希望できる条件：このリポジトリでは「全スタンプの取得」と定義されています
// （アンケートの送信を受け付ける条件＝SQLの is_completed も、同じく6個すべてです）。
// ここを変えるときは、sql/schema.sql の is_completed なども合わせて変更してください。
const PRIZE_REQUIRED=STAMP_KEYS.length;

function haptic(pattern){
  // Chromeは、画面を一度も触っていないページからのバイブレーションを拒否し、コンソールにエラーを出す。
  // QRコードから開いた直後はその状態なので、触れたあとだけ呼ぶ（iPhoneのSafariは、バイブレーション自体に未対応）
  if(navigator.userActivation&&!navigator.userActivation.hasBeenActive) return;
  try{ if(navigator.vibrate) navigator.vibrate(pattern); }catch(error){ /* 未対応の端末では何もしない */ }
}

function replay(el,className){
  el.classList.remove(className); void el.offsetWidth; el.classList.add(className);
}

// fx: {code, kind:"new"|"again", complete} … 直前に読み取ったスタンプの演出
function render(stamps,fx={}){
  const complete=STAMP_KEYS.every(k=>stamps.includes(k));
  renderBanner(stamps,fx);
  updateSpots(stamps,fx);

  document.getElementById("stamps").innerHTML=STAMP_KEYS.map(k=>{
    const got=stamps.includes(k), state=fx.code===k?` is-${fx.kind}`:"";
    return `<div class="stamp${got?" got":""}${state}">
      <span class="stamp-no">${stampNo(k)}</span>
      <span class="seal">${icon(k)}</span>
      <strong>${STAMPS[k].name}</strong>
      <small>${got?"獲得済み":"未獲得"}</small>
    </div>`;
  }).join("");

  const river=document.getElementById("river");
  river.innerHTML=riverSvg(stamps,fx);
  river.classList.toggle("is-complete",complete);
  document.getElementById("riverMessage").textContent =
    complete ? "川が完成しました！" :
    stamps.length ? `あと ${STAMP_KEYS.length-stamps.length} か所で川が完成します。` :
    "QRコードを読み取って、川をつくろう。";
}

// ---- 進捗バナー ----
// 残り個数＝必要なスタンプ数 − 取得済みのスタンプ数。文言は、取得状況に応じて切り替えます。
// 「景品を希望できる」は、希望の手続き（アンケート）に進める条件のことで、景品の受け取りを約束する表現にはしていません。
function bannerContent(got,total){
  const remain=Math.max(total-got,0);
  if(remain===0) return {state:"complete",message:"コンプリート！景品を希望できる条件を達成したよ！"};
  if(got===0) return {state:"empty",message:"スタンプを集めて、景品の希望に進もう！"};
  if(remain===1) return {state:"almost",message:"あと1個！景品の希望まで、あと少し！"};
  return {state:"progress",message:`あと${remain}個で、景品を希望できるよ！`};
}
function renderBanner(stamps,fx){
  const total=PRIZE_REQUIRED, got=Math.min(stamps.length,total), remain=Math.max(total-got,0);
  const {state,message}=bannerContent(got,total);
  const banner=$("progressBanner"), countEl=$("count"), remainEl=$("remain"), bar=$("bannerBar");
  banner.dataset.state=state;
  // 「あと◯個」と「COMPLETE」の表示は、CSSではなく hidden 属性で切り替える
  document.querySelector(".remain-wrap").hidden=state==="complete";
  document.querySelector(".done-wrap").hidden=state!=="complete";
  countEl.textContent=got;
  remainEl.textContent=remain;
  $("total").textContent=total;
  $("bannerMessage").textContent=message;
  const notice=String((window.RALLY_PRIZE||{}).notice||"").trim();
  $("bannerNote").textContent=notice; $("bannerNote").hidden=!notice;
  bar.setAttribute("aria-valuemax",total); bar.setAttribute("aria-valuenow",got);
  bar.setAttribute("aria-valuetext",remain?`${got}個取得、あと${remain}個`:`${total}個すべて取得`);
  bar.innerHTML=Array.from({length:total},(_,i)=>`<span class="seg${i<got?" on":""}${fx.kind==="new"&&i===got-1?" is-new":""}"></span>`).join("");
  if(fx.kind==="new"){ replay(countEl,"bump"); replay(remainEl,"bump"); replay(banner,"is-new"); }
}

// ---- スタンプポイントの場所（js/rally-data.js の登録内容） ----
// 住所・座標・検索語のどれもないポイントには、地図のリンクを出しません（場所を推測しません）。
const MAPS="https://www.google.com/maps";
function mapTarget(spot){
  const hasNum=v=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v));
  if(hasNum(spot.lat)&&hasNum(spot.lng)){
    const lat=Number(spot.lat), lng=Number(spot.lng);
    if(Math.abs(lat)<=90&&Math.abs(lng)<=180&&!(lat===0&&lng===0)) return {query:`${lat},${lng}`};
  }
  const text=String(spot.mapQuery||spot.address||"").trim();
  return text?{query:text}:null;
}
const mapUrls=t=>({
  view:`${MAPS}/search/?api=1&query=${encodeURIComponent(t.query)}`,
  route:`${MAPS}/dir/?api=1&destination=${encodeURIComponent(t.query)}&travelmode=walking`,
  embed:`${MAPS}?q=${encodeURIComponent(t.query)}&z=17&output=embed&hl=ja`
});
const OVERVIEW_URL_OK=/^https:\/\/(www\.google\.(com|co\.jp)\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)/;

const mapFrame=(url,code)=>`<iframe src="${esc(url)}" title="${esc(STAMPS[code].name)}の地図" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`;
const mapButtonLabel=(code,open)=>`${STAMPS[code].name}の地図を${open?"閉じる":"表示"}`;

function buildSpots(){
  const data=window.RALLY_SPOTS||{}, preview=window.RALLY_SPOTS_PREVIEW!==false;
  const showMap=preview&&window.RALLY_SPOTS_PREVIEW_OPEN===true; // true：最初から地図を表示する（画面の近くまで来たときに読み込む）
  const info=STAMP_KEYS.map(k=>{
    const spot=data[k]||{};
    return {k,desc:String(spot.description||"").trim(),target:mapTarget(spot)};
  });
  const anyInfo=info.some(x=>x.desc||x.target);
  $("spotList").innerHTML=(anyInfo?"":`<li class="spot-lead small">各ポイントの場所は、準備ができしだい、ここに表示されます。</li>`)+info.map(({k,desc,target})=>{
    const name=esc(STAMPS[k].name), urls=target&&mapUrls(target);
    let body="";
    if(desc) body+=`<p class="spot-desc">${esc(desc)}</p>`;
    if(target){
      body+=`<div class="spot-actions">
        <a class="btn" href="${esc(urls.view)}" target="_blank" rel="noopener noreferrer" aria-label="${name}：Googleマップで場所を見る"><svg class="icon" width="18" height="18" aria-hidden="true"><use href="#icon-pin"></use></svg>Googleマップで場所を見る</a>
        <a class="btn sub" href="${esc(urls.route)}" target="_blank" rel="noopener noreferrer" aria-label="${name}：ここへの行き方（Googleマップ）"><svg class="icon" width="18" height="18" aria-hidden="true"><use href="#icon-route"></use></svg>ここへの行き方</a>
        ${preview?`<button type="button" class="btn sub" data-map-toggle aria-expanded="${showMap}" aria-label="${esc(mapButtonLabel(k,showMap))}">${showMap?"地図を閉じる":"地図を表示"}</button>`:""}
      </div><div class="spot-map"${showMap?"":" hidden"}>${showMap?mapFrame(urls.embed,k):""}</div>`;
    } else if(anyInfo){
      body+=`<p class="spot-desc pending">${desc?"地図は準備中です。":"場所は準備中です。"}</p>`;
    }
    return `<li class="spot" data-code="${k}"${target?` data-embed="${esc(urls.embed)}"`:""}>
      <div class="spot-head"><span class="spot-seal">${icon(k)}</span><span class="spot-name">${name}</span><span class="spot-state">未獲得</span></div>${body}</li>`;
  }).join("");

  // 全ポイントをまとめた地図：6か所すべての場所が登録済みで、共有URLが設定されているときだけ表示
  const overview=String(window.RALLY_SPOTS_OVERVIEW_URL||"").trim();
  const overviewBox=$("spotsOverview");
  if(overview&&OVERVIEW_URL_OK.test(overview)&&info.every(x=>x.target)){
    overviewBox.innerHTML=`<a class="btn sub" href="${esc(overview)}" target="_blank" rel="noopener noreferrer"><svg class="icon" width="18" height="18" aria-hidden="true"><use href="#icon-pin"></use></svg>全ポイントの地図を開く</a>`;
    overviewBox.hidden=false;
  } else overviewBox.hidden=true;
}
// 地図のプレビュー：ボタンを押したときだけ、Googleマップを読み込む（表示速度のため）
$("spotList").addEventListener("click",e=>{
  const button=e.target.closest("[data-map-toggle]"); if(!button) return;
  const item=button.closest(".spot"), box=item.querySelector(".spot-map");
  const open=box.hidden;
  if(open){
    box.innerHTML=mapFrame(item.dataset.embed,item.dataset.code);
  } else box.innerHTML="";
  box.hidden=!open;
  button.textContent=open?"地図を閉じる":"地図を表示";
  button.setAttribute("aria-label",mapButtonLabel(item.dataset.code,open));
  button.setAttribute("aria-expanded",String(open));
});
function updateSpots(stamps,fx){
  document.querySelectorAll("#spotList .spot").forEach(li=>{
    const k=li.dataset.code, got=stamps.includes(k);
    li.classList.toggle("got",got);
    li.querySelector(".spot-state").textContent=got?"獲得済み":"未獲得";
    if(fx.code===k&&fx.kind==="new") replay(li,"is-new");
  });
}

// 川の図：点線（暗渠）の上に、獲得したスタンプの区間だけ水が現れます。
// 最後の区間（ゴールの先）は6個そろったときに現れ、川がつながります。
const RIVER_NODES=[[38,100],[98,56],[158,98],[218,54],[276,96],[326,52]];
const RIVER_START=[-12,70], RIVER_END=[372,26];
function riverCurve([x0,y0],[x1,y1]){
  const d=(x1-x0)/2;
  return `C${x0+d} ${y0} ${x1-d} ${y1} ${x1} ${y1}`;
}
function riverSvg(stamps,fx){
  const pts=[RIVER_START,...RIVER_NODES,RIVER_END];
  const complete=STAMP_KEYS.every(k=>stamps.includes(k));
  const full=`M${pts[0].join(" ")}`+pts.slice(1).map((p,i)=>riverCurve(pts[i],p)).join("");
  const water=pts.slice(1).map((p,i)=>{
    const k=STAMP_KEYS[i];
    const on=k ? stamps.includes(k) : complete;
    const fresh=k ? (fx.kind==="new" && fx.code===k) : fx.complete;
    return on ? `<path class="water${k?"":" outflow"}${fresh?" is-new":""}" d="M${pts[i].join(" ")}${riverCurve(pts[i],p)}" pathLength="1"/>` : "";
  }).join("");
  const nodes=RIVER_NODES.map(([x,y],i)=>{
    const k=STAMP_KEYS[i], got=stamps.includes(k), state=fx.code===k?` is-${fx.kind}`:"";
    return `<g transform="translate(${x} ${y})"><g class="node${got?" got":""}${state}">
      <circle class="halo" r="15"/><circle class="disc" r="15"/>
      <use href="#icon-${k}" x="-9" y="-9" width="18" height="18"/></g></g>`;
  }).join("");
  return `<svg viewBox="0 0 360 150" role="img" aria-label="川の図。獲得したスタンプ ${stamps.length}/${STAMP_KEYS.length}">
    <defs><pattern id="riverGrid" width="24" height="24" patternUnits="userSpaceOnUse"><path class="grid" d="M24 0H0V24"/></pattern></defs>
    <rect width="360" height="150" fill="url(#riverGrid)"/>
    <path class="culvert" d="${full}"/>${water}
    ${complete?`<path class="flow${fx.complete?" is-new":""}" d="${full}" pathLength="1"/>`:""}${nodes}
  </svg>`;
}

// ---- 読み取り結果パネル ----
const resultEl=document.getElementById("scanResult");
let resultState=null;
const SYNC_TEXT={
  saving:"サーバーに記録しています…",
  saved:"サーバーに記録しました",
  failed:"サーバーに記録できませんでした",
  demo:"デモモード：この端末にのみ保存しています"
};

// state: {tone:"new"|"again"|"complete"|"info"|"error", code, kicker, title, body, sync, surveyReady}
function showResult(state){
  resultState=state;
  drawResult(false);
}
function updateResult(patch){
  if(!resultState) return;
  Object.assign(resultState,patch);
  drawResult(true);
}
function drawResult(settled){
  const s=resultState, pending=getPending().length>0;
  const seal=s.code ? icon(s.code) : "!";
  let error="";
  if(s.sync==="failed"){
    error = pending
      ? `<div class="sr-error"><strong>通信できませんでした</strong>
          <p>スタンプはこの端末に保存されています。電波の良い場所で「再送する」を押してください。押さなくても、次にこのページを開いたときに自動で再送します。${s.tone==="complete"?"<br>アンケートは、記録が完了すると表示されます。":""}</p>
          <button type="button" class="sr-retry">再送する</button></div>`
      : `<div class="sr-error"><strong>読み取りの記録を送信できませんでした</strong>
          <p>スタンプは獲得済みなので、このままで問題ありません。</p></div>`;
  }
  resultEl.dataset.tone=s.tone;
  resultEl.classList.toggle("settled",settled);
  resultEl.innerHTML=`
    <div class="sr-main">
      <span class="sr-seal" aria-hidden="true">${seal}</span>
      <div>
        <p class="sr-kicker">${s.kicker}</p>
        <p class="sr-title">${s.title}</p>
        ${s.body?`<p class="sr-body">${s.body}</p>`:""}
      </div>
    </div>
    <button type="button" class="sr-close" aria-label="閉じる">×</button>
    ${s.sync?`<p class="sr-sync" data-state="${s.sync}">${SYNC_TEXT[s.sync]}</p>`:""}
    ${error}
    ${s.surveyReady?`<a class="sr-cta" href="${surveyUrl()}">アンケートに進む</a>`:""}`;
  resultEl.hidden=false;
  resultEl.querySelector(".sr-close").onclick=()=>{ resultEl.hidden=true; };
  const retry=resultEl.querySelector(".sr-retry");
  if(retry) retry.onclick=retryPending;
}

function scanMessage(code,again,complete,current){
  const name=STAMPS[code].name, total=STAMP_KEYS.length;
  if(complete){
    return {tone:"complete",code,kicker:`COMPLETE · ${total} / ${total}`,title:phrases("川が","完成しました！"),
      body:`最後のスタンプ「${name}」で、${total}つの場所がひとつの川につながりました。`};
  }
  if(again){
    const at=getStampTimes()[code];
    return {tone:"again",code,kicker:`獲得済み · ${stampNo(code)}`,title:phrases(`「${name}」は`,"すでに","獲得しています"),
      body:`${at?`${formatTime(at)} に獲得したスタンプです。`:""}スタンプの数は変わりません（${current.length}/${total}）。`};
  }
  const left=total-current.length;
  return {tone:"new",code,kicker:`NEW STAMP · ${stampNo(code)}`,title:phrases(`「${name}」を`,"獲得しました"),
    body:`あと ${left} か所で川が完成します。`};
}

// ---- 端末内の保存 ----
async function getLocalStamps(){
  return readStampList(stampsKey);
}

function getStampTimes(){
  try{
    const value=JSON.parse(store.get(timesKey)||"{}");
    return value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  }catch(error){ return {}; }
}

async function saveLocalStamp(code){
  const current=await getLocalStamps();
  if(!current.includes(code)){
    current.push(code);
    store.set(stampsKey,JSON.stringify(current));
    store.set(timesKey,JSON.stringify({...getStampTimes(),[code]:new Date().toISOString()}));
  }
  return current;
}

// ---- Supabase ----
function isSupabaseConfigured(){
  const url=window.SUPABASE_URL, key=window.SUPABASE_ANON_KEY;
  return url && !url.startsWith("YOUR_") && key && !key.startsWith("YOUR_");
}

async function callRpc(name,body){
  const response=await fetch(`${window.SUPABASE_URL}/rest/v1/rpc/${name}`,{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "apikey":window.SUPABASE_ANON_KEY,
      "Authorization":`Bearer ${window.SUPABASE_ANON_KEY}`
    },
    body:JSON.stringify(body)
  });
  if(!response.ok) throw new Error(await response.text());
  return response.json();
}

// 初回取得か再スキャンかはサーバー側（record_scan）で判定・記録されます。
async function recordServerScan(code,resend=false){
  const result=await callRpc("record_scan",{
    p_participant_id:participantId,
    p_stamp_code:code,
    // 通信失敗後の再送は管理画面で見分けられるよう印を付けます。
    p_user_agent:navigator.userAgent+(resend?" [resend]":"")
  });
  return result[0];
}

async function isServerCompleted(){
  return (await callRpc("is_completed",{p_participant_id:participantId}))===true;
}

// サーバーへの記録に失敗したスタンプ（次回表示時に再送します）
function getPending(){
  return readStampList(pendingKey);
}
function setPending(list){
  if(list.length) store.set(pendingKey,JSON.stringify(list));
  else store.remove(pendingKey);
}

function showSurveyLink(){
  const link=document.getElementById("surveyLink");
  link.href=surveyUrl();
  link.hidden=false;
}

// 戻り値：{completed: サーバーでコンプリートを確認, failed: 通信に失敗}
async function recordStamp(code){
  if(!isStamp(code)) {
    showResult({tone:"info",kicker:"QRコード",title:phrases("このQRコードは","登録されていません"),
      body:"会場に掲示されているスタンプラリーのQRコードを読み取ってください。"});
    return {completed:false,failed:false};
  }

  const before=await getLocalStamps();
  const again=before.includes(code);

  // 電波が弱くてもすぐ結果が分かるよう、端末への保存と表示を先に行います。
  const current=await saveLocalStamp(code);
  const complete=!again && STAMP_KEYS.every(k=>current.includes(k));
  render(current,{code,kind:again?"again":"new",complete});
  haptic(complete ? [18,70,18,70,36] : again ? 8 : 24);
  const message=scanMessage(code,again,complete,current);

  if(!isSupabaseConfigured()){
    showResult({...message,sync:"demo"});
    return {completed:false,failed:false};
  }

  showResult({...message,sync:"saving"});
  try{
    const result=await recordServerScan(code);
    setPending(getPending().filter(c=>c!==code));
    if(result.completed) showSurveyLink();
    updateResult({sync:"saved",surveyReady:result.completed});
    return {completed:result.completed,failed:false};
  } catch(error){
    console.error(error);
    if(!again && !getPending().includes(code)) setPending([...getPending(),code]);
    updateResult({sync:"failed"});
    return {completed:false,failed:true};
  }
}

async function resendPending(){
  let completed=false;
  for(const code of getPending()){
    const result=await recordServerScan(code,true);
    setPending(getPending().filter(c=>c!==code));
    completed=result.completed;
  }
  return completed;
}

async function retryPending(){
  updateResult({sync:"saving"});
  try{
    const completed=await resendPending() || await isServerCompleted();
    if(completed) showSurveyLink();
    updateResult({sync:"saved",surveyReady:completed});
  } catch(error){
    console.error(error);
    updateResult({sync:"failed"});
  }
}

// 再読み込み時など、QRを読まずに開いたときに未送信分の再送とアンケートへの導線を復元します。
async function restoreCompletion(){
  if(!isSupabaseConfigured()) return;
  const hadPending=getPending().length>0;
  const quiet=!resultEl.hidden; // 直前の読み取り結果を表示中なら上書きしない
  try{
    const resent=await resendPending();
    if(hadPending && !quiet){
      showResult({tone:"info",kicker:"未送信のスタンプ",title:phrases("前回送信できなかった","スタンプを","記録しました"),sync:"saved",surveyReady:resent});
    }
    if(resent) return showSurveyLink();
    const current=await getLocalStamps();
    if(!STAMP_KEYS.every(k=>current.includes(k))) return;
    if(await isServerCompleted()) return showSurveyLink();
    // 端末では6個そろっているのにサーバーに記録が足りない場合は、取得順に再送します。
    setPending(current);
    if(await resendPending()) showSurveyLink();
  } catch(error){
    console.error(error);
    if(getPending().length && !quiet){
      showResult({tone:"error",kicker:"未送信のスタンプ",title:phrases("まだサーバーに","記録されていない","スタンプがあります"),sync:"failed"});
    }
  }
}

async function init(){
  buildSpots();
  const params=new URLSearchParams(location.search);
  // QRコードの作成ツールなどで、大文字や前後の空白が入っていても、同じスタンプとして扱う
  const code=(params.get("stamp")||"").trim().toLowerCase();
  const current=await getLocalStamps();
  render(current);
  if(storageBlocked) $("storageNote").hidden=false;
  if(migrated&&!code){
    showResult({tone:"info",code:"check",kicker:"引き継ぎ",title:phrases("以前の進み具合を","引き継ぎました"),
      body:`取得済みのスタンプ：${migrated.stamps}個`});
  }
  let result={completed:false,failed:false};
  if(code){
    // 再読み込みで同じ読み取りが二重に記録されないよう、URLからstampを外します。
    params.delete("stamp");
    const query=params.toString();
    history.replaceState(null,"",location.pathname+(query?`?${query}`:"")+location.hash);
    result=await recordStamp(code);
    if(storageBlocked) $("storageNote").hidden=false;
  }
  // 通信に失敗した直後は「再送する」ボタンに任せます。
  if(!result.completed && !result.failed) await restoreCompletion();
}
init();
