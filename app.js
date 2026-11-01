(()=>{'use strict';
const $=s=>document.querySelector(s),app=$('#app');const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const random=n=>Array.from(crypto.getRandomValues(new Uint8Array(n)),x=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x%32]).join('');
const labels={mix:'🦩 Flamingo Mix',championship:'🏆 Love Championship',deep:'🌙 Midnight Talks',spicy:'😈 Spicy & Tricky'};
let peer=null,conn=null,role=null,room='',myName='',otherName='',config={mode:'mix',count:20},game=null,remoteView=null,localDraft={},error='';
let connectAttempt=0,connectionEpoch=0,peerReady=false,watchdog=null,peerToken='',peerStartedAt=0,peerFails=0,nextPeerAt=0,guestAttemptAt=0,lastSeen=0,guestSeat='';
const notify=msg=>{error=msg;render()};
const MODE_TYPES={mix:['know','same','tricky','open'],championship:['know','know','same'],deep:['open','open','know','same'],spicy:['tricky','tricky','same','know','open']};
const descs={mix:'خليط حلو من كل شي',championship:'مين بيعرف التاني أكتر؟',deep:'أسئلة من القلب بهدوء الليل',spicy:'غزل ومواقف تريكية'};
const buildQuestions=()=>{const mode=MODE_TYPES[config.mode]?config.mode:'mix',types=MODE_TYPES[mode];const pool=t=>QUESTION_BANK.filter(q=>q.mode===mode&&q.type===t).sort(()=>Math.random()-.5);let pools=Object.fromEntries(types.map(t=>[t,pool(t)]));let out=[];for(let i=0;i<config.count;i++){let t=types[i%types.length];if(!pools[t].length)pools[t]=pool(t);out.push(pools[t].shift())}return out};
function createGame(){return {phase:'waiting',players:[myName,''],questions:[],idx:0,answers:{},scores:[0,0],history:[],config:{...config}}}
function current(){return role==='host'?game:remoteView}
function qAt(g){return g?.questions?.[g.idx]}
function makeView(){if(!game)return null;let q=qAt(game);let a=game.answers||{};return {phase:game.phase,players:game.players,questions:game.questions,idx:game.idx,scores:game.scores,history:game.history,config:game.config,submitted:[!!a[0],!!a[1]],reveal:game.phase==='reveal'?a:null}}
function sendView(){if(role==='host'){remoteView=makeView();if(conn?.open)try{conn.send({kind:'state',state:remoteView})}catch{}render()}}
function updatePhase(){if(game?.phase==='question'&&game.answers[0]&&game.answers[1]){game.phase='reveal';let q=qAt(game),a=game.answers;if(q.type==='know'){for(let i=0;i<2;i++)if(a[i].guess===a[1-i].own)game.scores[i]+=10}else if(q.type==='same'||q.type==='tricky'){if(a[0].own===a[1].own){game.scores[0]+=5;game.scores[1]+=5}}game.history.push({id:q.id,answers:JSON.parse(JSON.stringify(a))})}sendView()}
function submit(idx,answer){if(!game||game.phase!=='question'||game.answers[idx])return;game.answers[idx]=answer;updatePhase()}
function onMessage(data){if(!data||typeof data!=='object'||data.kind==='ping')return;if(role==='host'){if(data.kind==='hello'){error='';if(game.phase==='waiting'){otherName=String(data.name||'حبيبتي').slice(0,32);game.players[1]=otherName}sendView()}else if(data.kind==='answer'&&game.phase==='question'){let q=qAt(game),v=data.answer;if(validate(q,v))submit(1,v)}else if(data.kind==='nextRequest'&&game.phase==='reveal')next()}else if(data.kind==='state'&&data.state){error='';remoteView=data.state;if(data.state.phase!=='question')localDraft={};render()}else if(data.kind==='full'){error='الغرفة مشغولة بلاعب تاني.';render()}}
function validate(q,v){return !!q&&v&&typeof v==='object'&&(q.type==='open'?typeof v.text==='string'&&v.text.length<=1500:q.type==='know'?Number.isInteger(v.own)&&Number.isInteger(v.guess)&&v.own>=0&&v.own<4&&v.guess>=0&&v.guess<4:Number.isInteger(v.own)&&v.own>=0&&v.own<4)}
// A TURN relay is what lets two phones on different mobile networks (CGNAT / strict NAT) connect when STUN alone fails.
// Free public TURN servers are all dead, so paste your own here (see README), e.g.
// {urls:['turn:YOUR_HOST:443?transport=tcp','turn:YOUR_HOST:80'],username:'USER',credential:'PASS'}
const TURN=[];
const ICE=[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'},{urls:'stun:global.stun.twilio.com:3478'},...TURN];
const STALE=15000,ATTEMPT_MS=20000,TICK_MS=2500;
const guestToken=(()=>{try{let t=localStorage.getItem('flguest');if(!t){t=random(16);localStorage.setItem('flguest',t)}return t}catch{return random(16)}})();
const hostId=()=>'flamingo-love-'+room;
function waitHint(){
 if(navigator.onLine===false)return 'ما في إنترنت عندك حالياً. تأكد من الواي فاي أو الداتا.';
 if(role==='guest'&&connectAttempt>=3&&!remoteView)return 'الاتصال عم ياخد وقت. جرّب تبدّل بين الواي فاي والداتا، وتأكد إن صاحب الغرفة فاتح الصفحة.';
 return '';
}
// Keep the screen awake while playing: a sleeping phone drops the connection.
let wakeLock=null;
async function keepAwake(){try{if(!('wakeLock' in navigator)||wakeLock||document.visibilityState!=='visible')return;wakeLock=await navigator.wakeLock.request('screen');wakeLock.addEventListener('release',()=>{wakeLock=null})}catch{}}
function dropConn(c){if(!c)return;if(conn===c)conn=null;try{c.close()}catch{}}
function disconnectAll(){try{wakeLock?.release()}catch{}wakeLock=null;connectionEpoch++;clearInterval(watchdog);watchdog=null;peerReady=false;connectAttempt=0;peerFails=0;nextPeerAt=0;guestSeat='';try{conn?.close()}catch{}try{peer?.destroy()}catch{}peer=null;conn=null;role=null;game=null;remoteView=null;localDraft={};error='';history.replaceState(null,'',location.pathname);render()}
function initPeer(id,onOpen,onCreate){
 if(typeof Peer==='undefined'){notify('مكتبة الاتصال ما تحمّلت. عم نعيد المحاولة… تأكد من الإنترنت.');return}
 try{
  const epoch=connectionEpoch;
  const p=new Peer(id,{debug:0,token:peerToken,config:{iceServers:ICE,iceCandidatePoolSize:2}});
  const live=()=>epoch===connectionEpoch&&peer===p;
  peer=p;peerReady=false;peerStartedAt=Date.now();
  if(onCreate)onCreate(p);
  p.on('open',()=>{if(!live())return;p.__opened=true;peerReady=true;peerFails=0;nextPeerAt=0;error='';onOpen()});
  p.on('error',e=>{if(!live())return;let t=e?.type||'';
   if(t==='peer-unavailable'){if(role==='guest'){dropConn(conn);error='صاحب الغرفة مش متصل حالياً. عم نعيد المحاولة تلقائياً… خليه يفتح الصفحة ويخليها مفتوحة.';render()}return}
   if(t==='unavailable-id'){if(peerFails>5)error='هيدا الكود مستخدم. جرّب إنشاء غرفة جديدة.';render();setTimeout(tick,300);return}
   error='مشكلة اتصال ('+(t||'network')+'). '+(role==='guest'?'عم نحاول من جديد…':'تأكد إن الصفحة مفتوحة، عم نحاول من جديد…');render();setTimeout(tick,300);
  });
  p.on('disconnected',()=>{if(!live())return;peerReady=false;error='انقطع الاتصال بخدمة الربط. عم نحاول نرجّعه…';render();setTimeout(tick,500)});
 }catch(e){notify('تعذّر بدء الاتصال: '+e.message)}
}
// Creates (or re-creates) the Peer; the room id and token stay the same so the signaling server accepts the host back.
function startPeer(){
 if(Date.now()<nextPeerAt)return;
 nextPeerAt=Date.now()+Math.min(2000+peerFails++*1500,10000);
 if(role==='host')initPeer(hostId(),()=>{error='';render()},listenHost);
 else initPeer(undefined,()=>{error='';connectGuest();render()});
}
// Runs every few seconds and on wake-up: heals the signaling link, retries the guest, and drops dead data links.
function tick(){
 if(!role)return;
 if(conn?.open){try{conn.send({kind:'ping'})}catch{}if(Date.now()-lastSeen>STALE)connLost(conn)}
 if(!peer||peer.destroyed){startPeer();return}
 if(peer.disconnected){if(peer.__opened){peerStartedAt=Date.now();try{peer.reconnect()}catch{}}else{try{peer.destroy()}catch{}startPeer()}return}
 if(!peer.open){if(Date.now()-peerStartedAt>15000){try{peer.destroy()}catch{}startPeer()}return}
 if(role==='guest'&&!conn?.open&&(!conn||Date.now()-guestAttemptAt>ATTEMPT_MS))connectGuest();
}
function wake(){if(!role)return;keepAwake();lastSeen=Date.now();nextPeerAt=0;tick();if(role==='host'&&conn?.open)sendView()}
function connLost(c){
 if(conn!==c)return;conn=null;try{c.close()}catch{}
 if(role==='host'){if(game?.phase==='waiting'){game.players[1]='';error='انقطع اتصال الشريك. خليه يرجع يفتح رابط الغرفة.'}}
 else if(role==='guest')error='انقطع الاتصال. عم نحاول نرجع للغرفة…';
 render();
}
// Host side: a connection only becomes the active partner after a valid hello (same token can always take its seat back).
function listenHost(p){
 p.on('connection',c=>{
  c.on('data',d=>{
   if(role!=='host'||!game||!d||typeof d!=='object')return;
   if(c!==conn){
    if(d.kind!=='hello')return;
    const same=!!d.token&&d.token===guestSeat,fresh=!conn?.open||Date.now()-lastSeen>STALE;
    if(!(same||(game.phase==='waiting'&&fresh))){try{c.send({kind:'full'})}catch{}setTimeout(()=>dropConn(c),800);return}
    const old=conn;conn=c;if(old&&old!==c)try{old.close()}catch{}
    guestSeat=String(d.token||'').slice(0,40);
   }
   lastSeen=Date.now();onMessage(d);
  });
  c.on('close',()=>connLost(c));c.on('error',()=>connLost(c));
 });
}
function host(name,mode,count){
 disconnectAll();role='host';myName=name||'أنا';config={mode,count:Number(count)};
 room=random(10);game=createGame();peerToken=random(16);history.replaceState(null,'',location.pathname+'#room='+room);
 watchdog=setInterval(tick,TICK_MS);keepAwake();startPeer();render();
}
function connectGuest(){
 if(role!=='guest'||!peer||peer.destroyed||!peer.open||conn?.open)return;
 connectAttempt++;guestAttemptAt=Date.now();dropConn(conn);
 try{
  const c=peer.connect(hostId(),{reliable:true,serialization:'json'});
  conn=c;
  c.on('data',d=>{lastSeen=Date.now();onMessage(d)});
  c.on('open',()=>{if(role!=='guest'||conn!==c)return;lastSeen=Date.now();error='';c.send({kind:'hello',name:myName,token:guestToken});render()});
  c.on('close',()=>connLost(c));c.on('error',()=>connLost(c));
  render();
 }catch(e){error='تعذّر الاتصال: '+e.message;render()}
}
function join(name,code){
 disconnectAll();role='guest';myName=name||'حبيبتي';room=(String(code).match(/room=([A-Za-z0-9]+)/)?.[1]||code).toUpperCase().replace(/[^A-Z2-9]/g,'');
 if(room.length!==10){role=null;notify('كود الغرفة لازم يكون 10 أحرف.');return}
 history.replaceState(null,'',location.pathname+'#room='+room);peerToken=random(16);
 watchdog=setInterval(tick,TICK_MS);keepAwake();startPeer();render();
}
// When a mobile browser resumes (app switch, screen unlock, network back), restore the signaling link and resync.
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')wake()});
addEventListener('online',wake);addEventListener('pageshow',wake);addEventListener('offline',()=>{if(role)render()});
function start(){if(role!=='host'||game?.phase!=='waiting'||!game.players[1])return;game.questions=buildQuestions();game.phase='question';game.idx=0;game.answers={};sendView()}
function next(){if(role!=='host'||game?.phase!=='reveal')return;game.idx++;game.answers={};game.phase=game.idx>=game.questions.length?'end':'question';sendView()}
function handleAnswer(){let g=current(),q=qAt(g),idx=role==='host'?0:1;if(!q||g.phase!=='question'||g.submitted?.[idx]||game?.answers?.[idx])return;let value;if(q.type==='open'){let text=$('#reply')?.value.trim()||'';if(!text)return;value={text:text.slice(0,1500)}}else if(q.type==='know'){let own=Number(document.querySelector('[name="own"]:checked')?.value),guess=Number(document.querySelector('[name="guess"]:checked')?.value);if(!document.querySelector('[name="own"]:checked')||!document.querySelector('[name="guess"]:checked'))return;value={own,guess}}else{let opt=document.querySelector('[name="own"]:checked');if(!opt)return;value={own:Number(opt.value)}}if(role==='host')submit(0,value);else{if(!conn?.open)return;localDraft={submittedIndex:g.idx};conn.send({kind:'answer',answer:value});render()}}
const optionList=(q,name,headline)=>`<div class="sectionlabel">${headline}</div><div class="opts">${q.options.map((o,i)=>`<label class="option"><input type="radio" name="${name}" value="${i}"> ${esc(o)}</label>`).join('')}</div>`;
function renderHome(){const code=new URLSearchParams(location.hash.slice(1)).get('room');app.innerHTML=`<section class="hero"><div class="flamingos">🦩</div><h1>قديش بتعرفوا بعض؟</h1></section><section class="panel"><h2>${code?'انضم للغرفة':'يلا نلعب'}</h2><div class="field"><label>اسمك</label><input id="name" maxlength="32" class="input" placeholder="اكتب اسمك" value="${esc(sessionStorage.getItem('flname')||'')}"></div>${code?`<div class="status">كود الغرفة: <b>${esc(code)}</b></div><button id="joinDirect" class="primary" style="margin-top:14px">انضم للغرفة</button><button id="ignoreInvite" class="secondary" style="margin-top:10px">رجوع</button>`:`<div class="actions"><button id="create" class="primary">إنشاء غرفة</button><button id="joinOpen" class="secondary">الدخول بكود</button></div><div id="createForm" class="hide"><div class="line"></div><div class="sectionlabel">نوع اللعبة</div><div class="modes">${Object.entries(labels).map(([key,val])=>`<button class="mode ${key==='mix'?'active':''}" data-mode="${key}"><span>${val.split(' ')[0]}</span>${val.split(' ').slice(1).join(' ')}<small class="subtle" style="margin-top:4px;font-size:11px;line-height:1.4">${descs[key]}</small></button>`).join('')}</div><div class="field"><label>عدد الأسئلة</label><select id="count" class="input"><option>10</option><option selected>20</option><option>30</option><option>50</option></select></div><button id="goCreate" class="primary">إنشاء الغرفة</button></div><div id="joinForm" class="hide"><div class="field"><label>كود الغرفة</label><input id="roomCode" class="input" placeholder="الكود أو الرابط" maxlength="150" dir="ltr" style="text-align:center;text-transform:uppercase"></div><button id="goJoin" class="primary">انضمام</button></div>`}</section>`;
const name=()=>{let n=$('#name').value.trim()||'حبيبي';sessionStorage.setItem('flname',n);return n};if(code){$('#joinDirect').onclick=()=>join(name(),code);$('#ignoreInvite').onclick=()=>{history.replaceState(null,'',location.pathname);render()}}else{$('#create').onclick=()=>{$('#createForm').classList.toggle('hide');$('#joinForm').classList.add('hide')};$('#joinOpen').onclick=()=>{$('#joinForm').classList.toggle('hide');$('#createForm').classList.add('hide')};document.querySelectorAll('[data-mode]').forEach(el=>el.onclick=()=>{document.querySelectorAll('[data-mode]').forEach(x=>x.classList.remove('active'));el.classList.add('active')});$('#goCreate').onclick=()=>host(name(),document.querySelector('.mode.active').dataset.mode,$('#count').value);$('#goJoin').onclick=()=>join(name(),$('#roomCode').value)} }
function renderWait(g){let isHost=role==='host';let share=location.href;app.innerHTML=`<section class="panel center"><div class="celebrate">${isHost?'🦩':'💌'}</div><h2>${isHost?'الغرفة جاهزة':'عم نتصل بالغرفة...'}</h2>${isHost?`<p>ابعتوا الرابط لشريكك، وبعدين ارجعوا لهالصفحة وخلّوها مفتوحة.</p><div class="code">${esc(room)}</div><div class="actions"><button class="primary" id="wa">📲 إرسال عبر واتساب</button><button class="secondary" id="copy">نسخ الرابط</button></div>${navigator.share?'<button class="secondary" id="share" style="margin-top:10px">مشاركة بتطبيق تاني</button>':''}<div class="members"><span class="member ready">✅ ${esc(myName)}</span><span class="member ${g?.players?.[1]?'ready':''}">${g?.players?.[1]?'✅ '+esc(g.players[1]):'⏳ ناطرين الشريك'}</span></div><button class="primary" id="start" ${!g?.players?.[1]?'disabled':''}>ابدأ اللعبة</button>`:`<p><span class="spinner"></span> ${g?.players?.[0]?'أهلاً! ناطرين صاحب الغرفة يبدأ اللعبة.':'ناطرين اتصال التلفونين...'}</p><div class="code">${esc(room)}</div>`}<p class="subtle">خلّوا الصفحة مفتوحة خلال اللعب.</p>${error?`<div class="error">${esc(error)}</div>`:''}${waitHint()?`<p class="subtle">${esc(waitHint())}</p>`:''}${!isHost&&!g?.players?.[0]?'<button class="secondary" id="retry">إعادة محاولة الاتصال</button>':''}<button id="leave" class="ghost" style="margin-top:15px">الخروج من الغرفة</button></section>`;if($('#retry'))$('#retry').onclick=()=>{error='';dropConn(conn);guestAttemptAt=0;nextPeerAt=0;tick();render()};const invite='🦩 تعال نلعب Flamingo Love! افتح الرابط وادخل الغرفة:\n'+share;if($('#wa'))$('#wa').onclick=()=>window.open('https://wa.me/?text='+encodeURIComponent(invite),'_blank');if($('#share'))$('#share').onclick=()=>navigator.share({title:'Flamingo Love',text:invite}).catch(()=>{});if($('#copy'))$('#copy').onclick=async()=>{try{await navigator.clipboard.writeText(share);$('#copy').textContent='✅ تم نسخ الرابط'}catch{prompt('انسخ رابط الدعوة:',share)}};if($('#start'))$('#start').onclick=start;$('#leave').onclick=disconnectAll}
function answerDisplay(q,a){if(!a)return '—';if(q.type==='open')return esc(a.text);return esc(q.options[a.own]||'—')}
function renderReveal(g,q){let a=g.reveal||g.answers||{},p=g.players||['الأول','الثاني'];let match=q.type==='know'?null:q.type==='open'?null:a[0]?.own===a[1]?.own;let comp=q.type==='know'?`<div class="answercard"><strong>التوقعات</strong>${esc(p[0])} توقّع: ${esc(q.options[a[0]?.guess]||'—')} ${a[0]?.guess===a[1]?.own?'✅ +10':'💭'}<br>${esc(p[1])} توقّع: ${esc(q.options[a[1]?.guess]||'—')} ${a[1]?.guess===a[0]?.own?'✅ +10':'💭'}</div>`:q.type==='open'?'<div class="status">سؤال مفتوح — بلا نقاط.</div>':`<div class="status">${match?'💞 نفس التفكير! +5 نقاط لكل واحد':'💬 إجابات مختلفة! فرصة حلوة تحكوا ليش.'}</div>`;
app.innerHTML=`<section class="panel"><div class="row"><span class="tag">✨ كشف الإجابات</span><span class="subtle">${g.idx+1} / ${g.questions.length}</span></div><h2 class="question">${esc(q.q)}</h2><div class="answers"><div class="answercard"><strong>💗 ${esc(p[0])}</strong>${answerDisplay(q,a[0])}</div><div class="answercard"><strong>💜 ${esc(p[1])}</strong>${answerDisplay(q,a[1])}</div>${comp}</div><div class="scoregrid" style="margin-top:18px"><div class="scorebox"><div class="subtle">${esc(p[0])}</div><div class="points">${g.scores[0]}</div></div><div class="scorebox"><div class="subtle">${esc(p[1])}</div><div class="points">${g.scores[1]}</div></div></div><button id="next" class="primary" style="margin-top:18px">${g.idx+1>=g.questions.length?'النتيجة':'السؤال التالي'}</button></section>`;$('#next').onclick=()=>{if(role==='host')next();else{if(!conn?.open)return;conn.send({kind:'nextRequest'});$('#next').disabled=true;$('#next').textContent='⏳ ناطرين صاحب الغرفة...'}}}
function renderQuestion(g,q){let idx=role==='host'?0:1,done=!!g.submitted?.[idx]||(role==='guest'&&localDraft.submittedIndex===g.idx);let other=!!g.submitted?.[1-idx];let typeNames={know:'🧠 قديش بتعرفني؟',same:'💞 نفس التفكير',tricky:'😈 تريكي',open:'🌙 من القلب'};app.innerHTML=`<section class="panel"><div class="row"><span class="tag">${typeNames[q.type]}</span><span class="subtle">السؤال ${g.idx+1} من ${g.questions.length}</span></div><div class="progress">${Array.from({length:Math.min(g.questions.length,30)},(_,i)=>`<i class="${i<=g.idx?'done':''}"></i>`).join('')}</div><div class="question">${esc(q.q)}</div>${done?`<div class="status center"><div class="celebrate">🔐</div><h2>تم إرسال جوابك</h2><p>${other?'عم نكشف الإجابات...':'بانتظار الشريك'}</p><span class="spinner"></span></div>`:`${q.type==='open'?`<div class="sectionlabel">إجابتك من القلب (ما في نقاط)</div><textarea maxlength="1500" id="reply" class="input" placeholder="جاوب بصراحة وعلى راحتك..." aria-label="إجابتك"></textarea>`:optionList(q,'own',q.type==='know'?'أولاً: شو جوابك إنت عن حالك؟':'اختار جوابك بسرية')}${q.type==='know'?`<div class="line"></div>${optionList(q,'guess','ثانياً: شو بتتوقّع شريكك يجاوب عن حاله؟')}`:''}<button id="submit" class="primary" style="margin-top:22px">تأكيد الجواب</button>`}<p class="subtle center"></p></section>`;if($('#submit'))$('#submit').onclick=handleAnswer}
function renderEnd(g){let p=g.players||['الأول','الثاني'];let winner=g.scores[0]===g.scores[1]?'تعادل حلو بين قلبين 💞':`🏆 ${esc(p[g.scores[0]>g.scores[1]?0:1])} ربِح تحدّي المعرفة!`;app.innerHTML=`<section class="panel center"><div class="celebrate">🎉🦩💗</div><h2>النتيجة النهائية</h2><p>${winner}</p><div class="scoregrid"><div class="scorebox"><div class="subtle">${esc(p[0])}</div><div class="points">${g.scores[0]}</div></div><div class="scorebox"><div class="subtle">${esc(p[1])}</div><div class="points">${g.scores[1]}</div></div></div><p class="subtle"></p><button id="copyResults" class="secondary">📋 انسخوا النتيجة</button>${role==='host'?'<button id="again" class="primary" style="margin-top:12px">جولة جديدة</button>':'<p>صاحب الغرفة فيو يبدأ جولة جديدة.</p>'}<button id="leave" class="ghost" style="margin-top:12px">الخروج للرئيسية</button></section>`;$('#copyResults').onclick=async()=>{let txt=`🦩 Flamingo Love ❤️\n${p[0]}: ${g.scores[0]} نقطة\n${p[1]}: ${g.scores[1]} نقطة\n${winner}`;try{await navigator.clipboard.writeText(txt);$('#copyResults').textContent='✅ نسخنا النتيجة'}catch{prompt('انسخوا النتيجة',txt)}};if($('#again'))$('#again').onclick=()=>{game.questions=buildQuestions();game.idx=0;game.answers={};game.scores=[0,0];game.history=[];game.phase='question';sendView()};$('#leave').onclick=disconnectAll}
let drawnKey='';
function awayBanner(){if(role&&!conn?.open){app.insertAdjacentHTML('afterbegin',`<div class="error">${role==='host'?'الشريك مش متصل حالياً. ناطرينه يرجع…':'انقطع الاتصال. عم نحاول نرجع للغرفة…'} <button id="leaveAway" class="ghost small">الخروج</button></div>`);$('#leaveAway').onclick=disconnectAll}}
function render(){let g=current();if(!role){drawnKey='';renderHome();if(error)app.insertAdjacentHTML('afterbegin',`<div class="error">${esc(error)}</div>`);return}if(!g||g.phase==='waiting'){drawnKey='';renderWait(g);return}let q=qAt(g);if(g.phase!=='end'&&!q){notify('صار خلل بعرض السؤال. جرّبوا فتح الغرفة من جديد.');return}
 // keep what the player already typed/selected when a connection event redraws the same question
 const key=g.phase+':'+g.idx,keep=key===drawnKey?[...app.querySelectorAll('#reply,input[type=radio]:checked')].map(x=>[x.id||x.name,x.value]):[];drawnKey=key;
 if(g.phase==='end')renderEnd(g);else if(g.phase==='reveal')renderReveal(g,q);else renderQuestion(g,q);
 keep.forEach(([k,v])=>{if(k==='reply'){const t=$('#reply');if(t)t.value=v}else{const r=document.querySelector(`input[name="${k}"][value="${v}"]`);if(r)r.checked=true}});
 awayBanner()}
$('#helpBtn').onclick=()=>$('#helpDialog').showModal();$('#closeHelp').onclick=()=>$('#helpDialog').close();render();
})();
